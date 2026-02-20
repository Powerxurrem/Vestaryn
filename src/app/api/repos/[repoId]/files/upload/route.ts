import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ repoId: string }> };

/**
 * @file app/api/repos/[repoId]/files/upload/route.ts
 * @purpose Upload a new file to Vault (storage first, then DB + version row).
 *
 * @invariants
 * - Storage key format: repos/<repoId>/<fileId>/v1
 * - DB (repo_files) is metadata canon.
 * - Version table must reflect storage state.
 * - On failure: roll back in reverse order (storage last removed).
 *
 * @touchpoints
 * - Supabase Storage: vestaryn-files
 * - repo_files
 * - repo_file_versions
 */

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function isTextLike(mime: string) {
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-typescript",
    ].includes(mime)
  );
}

// ─────────────────────────────────────────────────────────────
// POST /api/repos/[repoId]/files/upload
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request, ctx: Ctx) {
  const { repoId } = await ctx.params;

  if (!repoId || repoId === "undefined" || !isUuid(repoId)) {
    return NextResponse.json(
      { error: "invalid repoId", received: repoId },
      { status: 400 }
    );
  }

  const supabase = await supabaseRouteHandler();

  // Auth (RLS remains real boundary)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Parse multipart form
  const form = await req.formData();
  const file = form.get("file");
  const path = (form.get("path") as string | null) ?? null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  // Deterministic identity + v1 model
  const fileId = crypto.randomUUID();
  const version = 1;

  const name = file.name || "file";
  const mime = file.type || "application/octet-stream";
  const sizeBytes = file.size;

  const logicalPath = path?.trim() ? path.trim() : name;
  const storageKey = `repos/${repoId}/${fileId}/v${version}`;

  const bytes = new Uint8Array(await file.arrayBuffer());

  // 1) Upload to storage first
  const up = await supabase.storage
    .from("vestaryn-files")
    .upload(storageKey, bytes, {
      contentType: mime,
      upsert: false,
    });

  if (up.error) {
    return NextResponse.json({ error: up.error.message }, { status: 400 });
  }

  // 2) Insert DB metadata row
  const { error: fileErr } = await supabase.from("repo_files").insert({
    id: fileId,
    repo_id: repoId,
    path: logicalPath,
    name,
    mime,
    size_bytes: sizeBytes,
    storage_key: storageKey,
  });

  if (fileErr) {
    // Rollback storage
    await supabase.storage.from("vestaryn-files").remove([storageKey]);
    return NextResponse.json({ error: fileErr.message }, { status: 400 });
  }

  // 3) Insert version row (v1)
  const { error: verErr } = await supabase
    .from("repo_file_versions")
    .insert({
      file_id: fileId,
      version,
      actor: "user",
      note: "upload",
      storage_key: storageKey,
      size_bytes: sizeBytes,
    });

  if (verErr) {
    // Rollback DB + storage
    await supabase.from("repo_files").delete().eq("id", fileId);
    await supabase.storage.from("vestaryn-files").remove([storageKey]);
    return NextResponse.json({ error: verErr.message }, { status: 400 });
  }

  return NextResponse.json({
    file: {
      id: fileId,
      repo_id: repoId,
      path: logicalPath,
      name,
      mime,
      size_bytes: sizeBytes,
      storage_key: storageKey,
      version,
      text_like: isTextLike(mime),
    },
  });
}