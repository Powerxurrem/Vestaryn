import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseRouteHandler } from "@/lib/supabase/server";

/**
 * @file app/api/repos/[repoId]/files/create/route.ts
 * @purpose Create a new Vault file (DB row + initial v1 storage object).
 * @exports POST
 *
 * @sections
 * - Auth (Supabase route handler / RLS boundary)
 * - Input validation (name sanitization)
 * - Deterministic IDs + storage key format
 * - DB insert (repo_files) as metadata canon
 * - Storage upload (vestaryn-files bucket)
 * - Rollback behavior on upload failure
 *
 * @invariants
 * - Storage key format is security-relevant and deterministic:
 *   repos/<repoId>/<fileId>/v1
 * - DB is metadata source-of-truth; UI trusts DB response.
 * - Soft-delete visibility is handled elsewhere; create never touches deleted_at.
 *
 * @touchpoints
 * - repo_files (insert)
 * - Supabase Storage bucket: vestaryn-files (upload)
 *
 * @notes
 * - Current rollback deletes the DB row on storage upload failure.
 *   If you later move to soft-delete-only everywhere, revisit this rollback strategy.
 */

type Ctx = { params: Promise<{ repoId: string }> };

// ─────────────────────────────────────────────────────────────
// POST /api/repos/[repoId]/files/create
// Creates repo_files row + uploads initial content to storage (v1)
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request, ctx: Ctx) {
  const { repoId } = await ctx.params;
  const supabase = await supabaseRouteHandler();

  // Parse payload
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const content = String(body?.content ?? "");

  // Validate file name (prevent path traversal / nested paths for now)
  if (!name)
    return NextResponse.json({ error: "File name required" }, { status: 400 });

  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  // IDs + encoding
  const fileId = randomUUID();
  const bytes = new TextEncoder().encode(content);

  // Mime inference (minimal v1)
  const mime = name.toLowerCase().endsWith(".md")
    ? "text/markdown"
    : name.toLowerCase().endsWith(".ts")
    ? "text/plain"
    : "text/plain";

  // Storage key invariant (v1 model)
  const storageKey = `repos/${repoId}/${fileId}/v1`;

  // 1) Insert DB row first (metadata canon)
  const { data: fileRow, error: insertErr } = await supabase
    .from("repo_files")
    .insert({
      id: fileId,
      repo_id: repoId,
      path: name,
      name,
      mime,
      size_bytes: bytes.byteLength,
      storage_key: storageKey,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }

  // 2) Upload storage object (initial v1)
  const { error: upErr } = await supabase.storage
    .from("vestaryn-files") // correct bucket
    .upload(storageKey, bytes, {
      contentType: mime,
      upsert: false,
    });

  // Rollback on upload failure (hard delete DB row)
  if (upErr) {
    await supabase.from("repo_files").delete().eq("id", fileId);
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  return NextResponse.json({ file: fileRow });
}