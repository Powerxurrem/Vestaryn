import os from "os";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import archiver from "archiver";
import { createWriteStream } from "fs";

type SupabaseLike = any;

export type SnapshotBuildResult = {
  ok: true;
  jobId: string;
  fileCount: number;
  zipBytes: number;
  snapshotObjectPath: string;
  snapshotSignedUrl: string;
};

export type SnapshotBuildOpts = {
  // Storage bucket where repo files live (your Vault bucket)
  repoFilesBucket?: string; // default: process.env.VAULT_BUCKET or "repo_files"
  // Storage bucket where snapshots should be uploaded
  snapshotsBucket?: string; // default: process.env.SNAPSHOTS_BUCKET or "repo_snapshots"
  // How long signed URL should be valid (seconds)
  signedUrlTtlSec?: number; // default: 600 (10 min)

  // Safety limits
  maxFiles?: number; // default: 2000
  maxTotalBytes?: number; // default: 50 * 1024 * 1024 (50MB)
};

type RepoFileRow = {
  id: string;           // repo_files.id  (file id)
  repo_id: string;      // repo_files.repo_id
  path: string;         // repo_files.path (repo-relative path)
  deleted_at: string | null;

  // derived from latest version
  storage_key: string;
  byte_size: number;
};

// ---- public API ----

export async function buildRepoSnapshotSignedUrl(
  supabase: SupabaseLike,
  repoId: string,
  jobId: string,
  opts: SnapshotBuildOpts = {}
): Promise<SnapshotBuildResult> {
  const repoFilesBucket =
    opts.repoFilesBucket ?? process.env.VAULT_BUCKET ?? "repo_files";
  const snapshotsBucket =
    opts.snapshotsBucket ?? process.env.SNAPSHOTS_BUCKET ?? "repo_snapshots";
  const signedUrlTtlSec = opts.signedUrlTtlSec ?? 600;

  const maxFiles = opts.maxFiles ?? 2000;
  const maxTotalBytes = opts.maxTotalBytes ?? 50 * 1024 * 1024;

  // 1) list repo files (DB source of truth)
  const files = await listRepoFiles(supabase, repoId);

  // 2) filter + sanity caps
  const filtered = files
    .filter((f) => !f.deleted_at)
    .filter((f) => shouldIncludePath(f.path));

    console.log("[snapshot] include_paths", filtered.map(f => f.path).slice(0, 100));

  if (filtered.length === 0) {
    throw new Error("Snapshot: no files to include.");
  }
  if (filtered.length > maxFiles) {
    throw new Error(
      `Snapshot: too many files (${filtered.length} > ${maxFiles}).`
    );
  }

  // If you have byte_size populated, we can pre-cap. Otherwise we cap during download.
  const preTotal = filtered.reduce((sum, f) => sum + (f.byte_size ?? 0), 0);
  if (preTotal > 0 && preTotal > maxTotalBytes) {
    throw new Error(
      `Snapshot: repo too large (${preTotal} bytes > ${maxTotalBytes}).`
    );
  }

  // 3) prepare temp working directory
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vestaryn-snap-"));
  const workDir = path.join(tmpRoot, "repo");
  await fs.mkdir(workDir, { recursive: true });

  try {
    // 4) materialize files to disk
    let totalBytes = 0;
    for (const f of filtered) {
      const rel = sanitizeRelPath(f.path);
      const abs = path.join(workDir, rel);

      await fs.mkdir(path.dirname(abs), { recursive: true });

      const blob = await downloadStorageObject(
        supabase,
        repoFilesBucket,
        f.storage_key
      );

      const buf = Buffer.from(await blob.arrayBuffer());
      totalBytes += buf.byteLength;

      if (totalBytes > maxTotalBytes) {
        throw new Error(
          `Snapshot: repo too large while downloading (${totalBytes} > ${maxTotalBytes}).`
        );
      }

      await fs.writeFile(abs, buf);
    }

    // 5) zip it
    const zipPath = path.join(tmpRoot, `snapshot-${jobId}.zip`);
    const zipBytes = await zipDirectory(workDir, zipPath);

    // 6) upload zip to snapshots bucket
    const snapshotObjectPath = `repos/${repoId}/snapshots/${jobId}-${shortId()}.zip`;

    const zipBuf = await fs.readFile(zipPath);

    const up = await supabase.storage
      .from(snapshotsBucket)
      .upload(snapshotObjectPath, zipBuf, {
        contentType: "application/zip",
        upsert: true,
      });

    if (up.error) {
      throw new Error(`Snapshot upload failed: ${up.error.message}`);
    }

    // 7) signed URL (10 min)
    const signed = await supabase.storage
      .from(snapshotsBucket)
      .createSignedUrl(snapshotObjectPath, signedUrlTtlSec);

    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(
        `Snapshot signed URL failed: ${signed.error?.message ?? "unknown"}`
      );
    }

    return {
      ok: true,
      jobId,
      fileCount: filtered.length,
      zipBytes,
      snapshotObjectPath,
      snapshotSignedUrl: signed.data.signedUrl,
    };
  } finally {
    // best-effort cleanup
    await safeRm(tmpRoot);
  }
}

// ---- DB + Storage helpers ----

async function listRepoFiles(
  supabase: any,
  repoId: string
): Promise<RepoFileRow[]> {
  // 1) Load repo_files
  // IMPORTANT: if your path column isn't literally "path", change it here.
  const filesRes = await supabase
    .from("repo_files")
    .select("id, repo_id, path, deleted_at")
    .eq("repo_id", repoId);

  if (filesRes.error) {
    throw new Error(`Snapshot list repo_files failed: ${filesRes.error.message}`);
  }

  const files = (filesRes.data ?? []) as Array<{
    id: string;
    repo_id: string;
    path: string | null;
    deleted_at: string | null;
  }>;

  const alive = files.filter((f) => !f.deleted_at);
  if (alive.length === 0) return [];

  // 2) Load versions for these files (we’ll pick latest in code)
  const fileIds = alive.map((f) => f.id);

  const versRes = await supabase
    .from("repo_file_versions")
    .select("file_id, version, storage_key, size_bytes")
    .in("file_id", fileIds)
    .order("file_id", { ascending: true })
    .order("version", { ascending: false });

  if (versRes.error) {
    throw new Error(
      `Snapshot list repo_file_versions failed: ${versRes.error.message}`
    );
  }

  const versions = (versRes.data ?? []) as Array<{
    file_id: string;
    version: number;
    storage_key: string;
    size_bytes: number;
  }>;

  // 3) Pick latest per file_id (because we ordered version desc)
  const latestByFile = new Map<string, { storage_key: string; size_bytes: number }>();
  for (const v of versions) {
    if (!latestByFile.has(v.file_id)) {
      latestByFile.set(v.file_id, { storage_key: v.storage_key, size_bytes: v.size_bytes });
    }
  }

  // 4) Merge file metadata + latest version
  const out: RepoFileRow[] = [];
  for (const f of alive) {
    const p = (f.path ?? "").trim();
    if (!p) continue;

    const latest = latestByFile.get(f.id);
    if (!latest) {
      // file exists but has no versions → skip
      continue;
    }

    out.push({
      id: f.id,
      repo_id: f.repo_id,
      path: p,
      deleted_at: f.deleted_at,
      storage_key: latest.storage_key,
      byte_size: Number(latest.size_bytes ?? 0),
    });
  }

  return out;
}

async function downloadStorageObject(
  supabase: SupabaseLike,
  bucket: string,
  key: string
): Promise<Blob> {
  const dl = await supabase.storage.from(bucket).download(key);
  if (dl.error || !dl.data) {
    throw new Error(`Snapshot download failed (${bucket}/${key}): ${dl.error?.message ?? "unknown"}`);
  }
  return dl.data as Blob;
}

// ---- zip helpers ----

async function zipDirectory(dir: string, outZipPath: string): Promise<number> {
  await fs.mkdir(path.dirname(outZipPath), { recursive: true });

  return await new Promise<number>((resolve, reject) => {
    const output = createWriteStream(outZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(archive.pointer()));
    output.on("error", reject);

    archive.on("warning", (err: unknown) => {
      console.warn("[snapshot_zip] warning:", err);
    });
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(dir, false); // include folder contents
    archive.finalize().catch(reject);
  });
}

// ---- path hygiene / ignore ----

function shouldIncludePath(p: string): boolean {
  const s = (p ?? "").replace(/\\/g, "/");
  if (!s || s.startsWith("/")) return false;

  // ignore typical junk
  const deny = [
    ".git/",
    "node_modules/",
    "dist/",
    "build/",
    ".next/",
    ".turbo/",
    ".vercel/",
    ".DS_Store",
  ];

  return !deny.some((x) => s.includes(x));
}

function sanitizeRelPath(p: string): string {
  const s = (p ?? "").replace(/\\/g, "/").trim();
  if (!s) throw new Error("Snapshot: empty file path.");

  // prevent traversal
  const parts = s.split("/").filter(Boolean);
  if (parts.some((x) => x === "." || x === "..")) {
    throw new Error(`Snapshot: unsafe path: ${p}`);
  }

  // keep it relative
  return parts.join("/");
}

function shortId(): string {
  return crypto.randomBytes(6).toString("hex");
}

async function safeRm(p: string) {
  try {
    // Node 14+ supports fs.rm with recursive; fallback not needed here.
    
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}