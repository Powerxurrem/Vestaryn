import { NextResponse } from "next/server";
import { randomUUID, createHash } from "crypto";
import path from "path";
import unzipper from "unzipper";

import { supabaseRouteHandler } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ repoId: string }> };

function json(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function normalizeZipPath(p: string) {
  // zip entries always use /
  let s = (p ?? "").replace(/\\/g, "/").trim();
  s = s.replace(/^\/+/, "");
  // remove leading "./"
  s = s.replace(/^\.\//, "");
  // prevent traversal
  const parts = s.split("/").filter(Boolean);
  if (parts.some((x) => x === "." || x === "..")) return null;
  if (parts.length === 0) return null;
  return parts.join("/");
}

function shouldIgnore(p: string) {
  const s = p.replace(/\\/g, "/");
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
  return deny.some((x) => s.includes(x));
}

function guessMime(p: string) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".ts") return "application/typescript";
  if (ext === ".tsx") return "application/typescript";
  if (ext === ".js") return "application/javascript";
  if (ext === ".jsx") return "application/javascript";
  if (ext === ".md") return "text/markdown";
  if (ext === ".txt") return "text/plain";
  if (ext === ".css") return "text/css";
  if (ext === ".html") return "text/html";
  return "application/octet-stream";
}

// POST /api/repos/[repoId]/files/import-zip
export async function POST(req: Request, ctx: Ctx) {
  const { repoId } = await ctx.params;

  if (!repoId || repoId === "undefined" || !isUuid(repoId)) {
    return json({ error: "invalid repoId", received: repoId }, 400);
  }

console.log("[import_zip] hit", { repoId });

  const supabaseUser = await supabaseRouteHandler();

  // Auth (RLS is the real boundary)
  const { data: auth } = await supabaseUser.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  // TODO: enforce repo membership + capability allowCreateTrees (recommended)
  // - You likely already have an is_repo_member helper. Reuse it here.

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return json({ error: "missing zip file (field name: file)" }, 400);
  }

  const filename = file.name || "import.zip";
  if (!filename.toLowerCase().endsWith(".zip")) {
    return json({ error: "file must be a .zip" }, 400);
  }

  // Limits (tune later)
  const MAX_FILES = 2000;
  const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50MB
  const MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024; // 5MB

  const vaultBucket = process.env.VAULT_BUCKET ?? "vestaryn-files";

  // Admin client for storage + DB writes
  const supabaseAdmin = createSupabaseAdmin();

  const zipBuf = Buffer.from(await file.arrayBuffer());

  // unzipper Open.buffer gives you a list of entries
  const directory = await unzipper.Open.buffer(zipBuf);
  console.log("[import_zip] zip", { name: filename, bytes: zipBuf.length });

  let totalBytes = 0;
  let processed = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const sample: string[] = [];

  for (const entry of directory.files) {
    if (processed >= MAX_FILES) break;

    // skip directories
    if (entry.type !== "File") continue;

    const rel = normalizeZipPath(entry.path);
    if (!rel) {
      skipped++;
      continue;
    }

    if (shouldIgnore(rel)) {
      skipped++;
      continue;
    }

    // read file content
    const buf = await entry.buffer();
    if (buf.byteLength > MAX_SINGLE_FILE_BYTES) {
      skipped++;
      continue;
    }
    
    const sha256 = createHash("sha256").update(buf).digest("hex");

    totalBytes += buf.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return json(
        { error: `zip too large (>${MAX_TOTAL_BYTES} bytes)`, processed, skipped },
        400
      );
    }

    processed++;
    if (sample.length < 50) sample.push(rel);

    // Upsert-by-path behavior:
    // - if path exists in repo_files => update existing file_id, create new version row
    // - else => create new file_id + v1 + version row
    const existing = await supabaseAdmin
      .from("repo_files")
      .select("id")
      .eq("repo_id", repoId)
      .eq("path", rel)
      .maybeSingle();

    if (existing.error) {
      return json({ error: `repo_files lookup failed: ${existing.error.message}` }, 400);
    }

    const existingId = existing.data?.id ?? null;
    const isNew = !existingId;
    const fileId = existingId ?? randomUUID();

    // version number increments (DB history), but storage stays v1 for now (matches your current model)
    const latestVer = await supabaseAdmin
      .from("repo_file_versions")
      .select("version")
      .eq("file_id", fileId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestVer.error) {
      return json({ error: `repo_file_versions lookup failed: ${latestVer.error.message}` }, 400);
    }

    const version = (latestVer.data?.version ?? 0) + 1;

    const storageKey = `repos/${repoId}/${fileId}/v1`; // current system invariant: overwrite v1
    const mime = guessMime(rel);
    const name = path.posix.basename(rel);
    const sizeBytes = buf.byteLength;

    // 1) upload bytes to storage
    const up = await supabaseAdmin.storage.from(vaultBucket).upload(storageKey, buf, {
      contentType: mime,
      upsert: true, // import overwrites
    });

    if (up.error) {
      return json({ error: `storage upload failed: ${up.error.message}`, path: rel }, 400);
    }

    // 2) upsert repo_files metadata
    if (isNew) {
      const ins = await supabaseAdmin.from("repo_files").insert({
        id: fileId,
        repo_id: repoId,
        path: rel,
        name,
        mime,
        size_bytes: sizeBytes,
        storage_key: storageKey,
      });

      if (ins.error) {
        // best-effort rollback storage
        await supabaseAdmin.storage.from(vaultBucket).remove([storageKey]);
        return json({ error: `repo_files insert failed: ${ins.error.message}`, path: rel }, 400);
      }
      created++;
    } else {
      const upd = await supabaseAdmin
        .from("repo_files")
        .update({
          name,
          mime,
          size_bytes: sizeBytes,
          storage_key: storageKey,
          deleted_at: null,
        })
        .eq("id", fileId)
        .eq("repo_id", repoId);

      if (upd.error) {
        return json({ error: `repo_files update failed: ${upd.error.message}`, path: rel }, 400);
      }
      updated++;
    }

    // 3) insert version row (history)
    const ver = await supabaseAdmin.from("repo_file_versions").insert({
      file_id: fileId,
      version,
      actor: "import",
      note: `zip:${filename}`,
      storage_key: storageKey,
      size_bytes: sizeBytes,
      sha256,
      mime,
    });

    if (ver.error) {
      return json({ error: `repo_file_versions insert failed: ${ver.error.message}`, path: rel }, 400);
    }
  }

  return json({
    ok: true,
    repoId,
    vaultBucket,
    processed,
    created,
    updated,
    skipped,
    totalBytes,
    samplePaths: sample,
  });
}