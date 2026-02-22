import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseRouteHandler } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ repoId: string }> };

/**
 * @file app/api/repos/[repoId]/files/upload/route.ts
 * @purpose Upload a new file to Vault (storage first, then DB + version row).
 *
 * @invariants
 * - Storage key format: repos/<repoId>/<fileId>/v1
 * - DB (repo_files) is metadata canon.
 * - Version table must reflect storage state.
 * - On failure: roll back in reverse order (storage removed).
 */

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v
  );
}

function isTextLike(mime: string) {
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "text/javascript",
      "application/typescript",
      "application/x-typescript",
    ].includes(mime)
  );
}

function json(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// ─────────────────────────────────────────────────────────────
// POST /api/repos/[repoId]/files/upload
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request, ctx: Ctx) {
  const { repoId } = await ctx.params;

  if (!repoId || repoId === "undefined" || !isUuid(repoId)) {
    return json({ error: "invalid repoId", received: repoId }, 400);
  }

  const supabase = await supabaseRouteHandler();

  // Auth (RLS remains real boundary)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  // Parse multipart form
  const form = await req.formData();
  const file = form.get("file");
  const path = (form.get("path") as string | null) ?? null;

  if (!(file instanceof File)) {
    return json({ error: "missing file" }, 400);
  }

  // Deterministic identity + v1 model
  const fileId = randomUUID();
  const version = 1;

  const name = file.name || "file";
  const mime = file.type || "application/octet-stream";
  const sizeBytes = file.size;

  const logicalPath = path?.trim() ? path.trim() : name;
  const storageKey = `repos/${repoId}/${fileId}/v${version}`;

  const buf = Buffer.from(await file.arrayBuffer());

  // 1) Upload to storage first
  const { error: upErr } = await supabase.storage
    .from("vestaryn-files")
    .upload(storageKey, buf, {
      contentType: mime,
      upsert: false,
    });

  if (upErr) return json({ error: upErr.message }, 400);

  // 2) Insert DB metadata row (return canonical row)
  const { data: fileRow, error: fileErr } = await supabase
    .from("repo_files")
    .insert({
      id: fileId,
      repo_id: repoId,
      path: logicalPath,
      name,
      mime,
      size_bytes: sizeBytes,
      storage_key: storageKey,
    })
    .select(
      "id, repo_id, path, name, mime, size_bytes, storage_key, updated_at, created_at, deleted_at"
    )
    .single();

  if (fileErr) {
    // Rollback storage
    await supabase.storage.from("vestaryn-files").remove([storageKey]);
    return json({ error: fileErr.message }, 400);
  }

  // 3) Insert version row (v1) (best-effort per your earlier notes is OK too)
  const { error: verErr } = await supabase.from("repo_file_versions").insert({
    file_id: fileId,
    version,
    actor: "user",
    note: "upload",
    storage_key: storageKey,
    size_bytes: sizeBytes,
  });

  if (verErr) {
    // Rollback DB + storage
    await supabase
      .from("repo_files")
      .delete()
      .eq("id", fileId)
      .eq("repo_id", repoId);
    await supabase.storage.from("vestaryn-files").remove([storageKey]);
    return json({ error: verErr.message }, 400);
  }

  return json(
    {
      file: {
        ...fileRow,
        version,
        text_like: isTextLike(mime),
      },
    },
    200
  );
}