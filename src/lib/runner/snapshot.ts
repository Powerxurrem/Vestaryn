import os from "os";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import archiver from "archiver";
import { createWriteStream } from "fs";
import { VAULT_BUCKET, SNAPSHOTS_BUCKET } from "@/lib/vault/buckets";

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
  repoFilesBucket?: string;
  snapshotsBucket?: string;
  signedUrlTtlSec?: number;
  maxFiles?: number;
  maxTotalBytes?: number;
  overlayFiles?: Array<{
    path: string;
    content: string;
    mime?: string;
  }>;
};



type RepoFileRow = {
  id: string;
  repo_id: string;
  path: string;
  deleted_at: string | null;
  storage_key: string;
  byte_size: number;
  mime?: string;
};

// ---- public API ----

export async function buildRepoSnapshotSignedUrl(
  supabase: SupabaseLike,
  repoId: string,
  jobId: string,
  opts: SnapshotBuildOpts = {}
): Promise<SnapshotBuildResult> {
const repoFilesBucket =
  opts.repoFilesBucket ?? process.env.VAULT_BUCKET ?? "vestaryn-files";

const snapshotsBucket =
  opts.snapshotsBucket ?? process.env.SNAPSHOTS_BUCKET ?? "vestaryn-snapshots";
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

  const overlayFiles = Array.isArray(opts.overlayFiles) ? opts.overlayFiles : [];

console.log(
  "[snapshot_overlay_input]",
  overlayFiles.map((f) => ({
    path: f.path,
    bytes: Buffer.byteLength(String(f.content ?? ""), "utf8"),
    interestingLines: String(f.content ?? "")
      .split(/\r?\n/)
      .map((line, i) => ({ n: i + 1, line }))
      .filter(
        ({ line }) =>
          line.includes("return ") ||
          line.includes("{count}") ||
          line.includes("LeakGuardTest")
      ),
  }))
);

  const overlayMap = new Map(
    overlayFiles
      .map((f) => ({
        path: String(f?.path ?? "").trim(),
        content: String(f?.content ?? ""),
        mime: f?.mime ? String(f.mime) : undefined,
      }))
      .filter((f) => f.path)
      .map((f) => [f.path, f] as const)
  );

  const effectiveFiles = filtered.map((f) => {
    const overlay = overlayMap.get(f.path);
    if (!overlay) return { ...f, __overlay: false as const };

    overlayMap.delete(f.path);

    return {
      ...f,
      mime: overlay.mime ?? f.mime,
      size_bytes: Buffer.byteLength(overlay.content, "utf8"),
      __overlay: true as const,
      __overlayContent: overlay.content,
    };
  });

const leakGuardEffective = (effectiveFiles as any[]).find(
  (f) => f.path === "components/LeakGuardTest.tsx"
);

if (leakGuardEffective) {
  console.log("[snapshot_effective_source]", {
    path: leakGuardEffective.path,
    overlay: Boolean(leakGuardEffective.__overlay),
    storageKey: leakGuardEffective.storage_key ?? null,
    overlayBytes: leakGuardEffective.__overlay
      ? Buffer.byteLength(String(leakGuardEffective.__overlayContent ?? ""), "utf8")
      : null,
    overlayInterestingLines: leakGuardEffective.__overlay
      ? String(leakGuardEffective.__overlayContent ?? "")
          .split(/\r?\n/)
          .map((line: string, i: number) => ({ n: i + 1, line }))
          .filter(
            ({ line }: { line: string }) =>
              line.includes("return ") ||
              line.includes("{count}") ||
              line.includes("LeakGuardTest")
          )
      : null,
  });
}

  for (const overlay of overlayMap.values()) {
    effectiveFiles.push({
      id: `overlay:${overlay.path}`,
      repo_id: repoId,
      path: overlay.path,
      name: overlay.path.split("/").filter(Boolean).pop() ?? overlay.path,
      mime: overlay.mime ?? "text/plain",
      size_bytes: Buffer.byteLength(overlay.content, "utf8"),
      storage_key: null,
      version: 0,
      deleted_at: null,
      __overlay: true as const,
      __overlayContent: overlay.content,
    } as any);
  }

  console.log(
    "[snapshot] effective_paths",
    effectiveFiles.map((f: any) => f.path).slice(0, 100)
  );

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

for (const f of effectiveFiles as any[]) {
  const rel = sanitizeRelPath(f.path);
  const abs = path.join(workDir, rel);

  await fs.mkdir(path.dirname(abs), { recursive: true });

  let buf: Buffer;

  if (f.__overlay) {
    buf = Buffer.from(String(f.__overlayContent ?? ""), "utf8");
  } else {
    const blob = await downloadStorageObject(
      supabase,
      repoFilesBucket,
      f.storage_key
    );

    buf = Buffer.from(await blob.arrayBuffer());
  }

// DEBUG: confirm snapshot content for this test file
if (f.path === "components/LeakGuardTest.tsx") {
  const text = buf.toString("utf8");

  console.log("[snapshot_materialize]", {
    path: f.path,
    bytes: buf.byteLength,
    hasBrokenSemicolon: text.includes("{count};"),
    hasBrokenTag: text.includes("<;div>"),
    hasCleanReturn: text.includes("return <div>{count}</div>;"),
    interestingLines: text
      .split(/\r?\n/)
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) =>
        line.includes("return ") ||
        line.includes("{count}") ||
        line.includes("LeakGuardTest")
      ),
  });
}

  totalBytes += buf.byteLength;

  if (totalBytes > maxTotalBytes) {
    throw new Error(
      `Snapshot: repo too large while materializing (${totalBytes} > ${maxTotalBytes}).`
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
      fileCount: effectiveFiles.length,
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
    .select("id, repo_id, path, deleted_at, storage_key, byte_size")
    .eq("repo_id", repoId);

if (!Array.isArray(filesRes.data)) {
  console.log("[snapshot:listRepoFiles unexpected data]", filesRes.data);
}

if (filesRes.error) {
  console.log("[snapshot:listRepoFiles error]", {
    error: filesRes.error,
  });

  throw new Error(
    `Snapshot list repo_files failed: ${filesRes.error.message}`
  );
}
console.log("[snapshot:listRepoFiles context]", {
  repoId,
});
  const files = (filesRes.data ?? []) as Array<{
    id: string;
    repo_id: string;
    path: string | null;
    deleted_at: string | null;
    storage_key: string | null;
    byte_size?: number | null;
  }>;

  const alive = files.filter((f) => !f.deleted_at);
  if (alive.length === 0) return [];

  // 2) Load versions for these files (we’ll pick latest in code)
  const fileIds = alive.map((f) => f.id);



const out: RepoFileRow[] = [];
for (const f of alive) {
  const p = (f.path ?? "").trim();
  if (!p) continue;

  const storageKey = (f.storage_key ?? "").trim();
  if (!storageKey) {
    continue;
  }

  out.push({
    id: f.id,
    repo_id: f.repo_id,
    path: p,
    deleted_at: f.deleted_at,
    storage_key: storageKey,
    byte_size: Number((f as any).byte_size ?? 0),
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

  const denyPrefixes = [
    ".git/",
    "node_modules/",
    "dist/",
    "build/",
    ".next/",
    ".turbo/",
    ".vercel/",
  ];

  const denyExact = [
    ".DS_Store",
    "memory/chamber-state.md",
    "memory/user-profile.md",
  ];

  if (denyPrefixes.some((x) => s.includes(x))) return false;
  if (denyExact.includes(s)) return false;

  return true;
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