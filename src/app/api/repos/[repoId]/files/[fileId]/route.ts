import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "@/lib/supabase/server";

/**
 * @file app/api/repos/[repoId]/files/[fileId]/route.ts
 * @purpose File operations for Vault artifacts:
 *          - GET: return canonical metadata + signed URL (30m)
 *          - PUT: overwrite blob (v1 upsert) + update DB metadata
 *          - DELETE: soft-delete via deleted_at (audit-safe)
 *
 * @exports GET, PUT, DELETE
 *
 * @sections
 * - Runtime + types
 * - Select constants
 * - PUT: write content -> storage (upsert) -> update DB -> return canonical DB row
 * - GET: read DB -> resolve storage_key (latest version fallback) -> sign URL -> return
 * - DELETE: soft delete (DB only)
 *
 * @invariants
 * - DB (repo_files) is metadata source-of-truth; UI should trust DB response.
 * - Storage boundary: signed URLs only (never proxy blobs).
 * - Soft delete is application logic (API/UI), NOT RLS policy logic.
 * - v1 write model: overwrite same storage_key (upsert true) unless versioning is activated.
 *
 * @touchpoints
 * - repo_files
 * - repo_file_versions (optional; latest version fallback)
 * - Supabase Storage bucket: vestaryn-files
 *
 * @security
 * - Access is enforced by Supabase auth + Postgres RLS.
 * - This route additionally checks deleted_at to hide soft-deleted rows.
 */

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────
// Types + constants
// ─────────────────────────────────────────────────────────────
type Ctx = { params: Promise<{ repoId: string; fileId: string }> };

const FILE_SELECT =
  "id, repo_id, path, name, mime, size_bytes, storage_key, updated_at, created_at, deleted_at";

// ─────────────────────────────────────────────────────────────
// PUT /api/repos/[repoId]/files/[fileId]
// Overwrite blob (v1 upsert) + update DB metadata + return canonical DB row
// ─────────────────────────────────────────────────────────────
export async function PUT(req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;
  const supabase = await supabaseRouteHandler();

  // Parse payload
  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? "");
  const bytes = new TextEncoder().encode(content);
  const mime = String(body?.mime ?? "text/plain");

  // Load file row to get storage_key (and ensure membership via RLS)
  const { data: fileRow, error: fileErr } = await supabase
    .from("repo_files")
    .select("id, repo_id, storage_key, deleted_at")
    .eq("id", fileId)
    .eq("repo_id", repoId)
    .single();

  if (fileErr)
    return NextResponse.json({ error: fileErr.message }, { status: 400 });
  if (fileRow?.deleted_at)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const storageKey: string | null = fileRow.storage_key;
  if (!storageKey) {
    return NextResponse.json({ error: "missing storage_key" }, { status: 400 });
  }

  // Write blob (v1: overwrite same key)
  const { error: upErr } = await supabase.storage
    .from("vestaryn-files")
    .upload(storageKey, bytes, { contentType: mime, upsert: true });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  // Update DB metadata (DB remains canon)
  const { error: updErr } = await supabase
    .from("repo_files")
    .update({
      size_bytes: bytes.byteLength,
      mime,
      // updated_at ideally handled by DB trigger/default
    })
    .eq("id", fileId)
    .eq("repo_id", repoId);

  if (updErr)
    return NextResponse.json({ error: updErr.message }, { status: 400 });

  // Read back canonical metadata and return it (locks UI to DB truth)
  const { data: updated, error: readErr } = await supabase
    .from("repo_files")
    .select(FILE_SELECT)
    .eq("id", fileId)
    .eq("repo_id", repoId)
    .single();

  if (readErr)
    return NextResponse.json({ error: readErr.message }, { status: 400 });

  return NextResponse.json({ file: updated }, { status: 200 });
}

// ─────────────────────────────────────────────────────────────
// GET /api/repos/[repoId]/files/[fileId]
// Return metadata + signed_url (30m). Uses latest version storage_key if present.
// ─────────────────────────────────────────────────────────────
export async function GET(_req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;
  const supabase = await supabaseRouteHandler();

  // Auth (RLS remains the real access boundary)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Read file row (DB canon)
  const { data: file, error: fileErr } = await supabase
    .from("repo_files")
    .select(FILE_SELECT)
    .eq("id", fileId)
    .eq("repo_id", repoId)
    .maybeSingle();

  if (fileErr)
    return NextResponse.json({ error: fileErr.message }, { status: 400 });
  if (!file || file.deleted_at)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Optional: latest version fallback (future-proofing for versioning activation)
  const { data: latest, error: latestErr } = await supabase
    .from("repo_file_versions")
    .select("version, storage_key")
    .eq("file_id", fileId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr)
    return NextResponse.json({ error: latestErr.message }, { status: 400 });

  const storageKey: string | null = (latest?.storage_key ??
    file.storage_key) as any;

  if (!storageKey)
    return NextResponse.json({ error: "missing storage_key" }, { status: 400 });

  // Sign URL (30 min)
  const { data: signed, error: signErr } = await supabase.storage
    .from("vestaryn-files")
    .createSignedUrl(storageKey, 60 * 30);

  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 400 });
  if (!signed?.signedUrl)
    return NextResponse.json({ error: "failed to sign url" }, { status: 400 });

  return NextResponse.json({
    file,
    latest_version: latest?.version ?? null,
    signed_url: signed.signedUrl,
  });
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/repos/[repoId]/files/[fileId]
// Soft delete (audit-safe). Storage objects are not removed here.
// ─────────────────────────────────────────────────────────────
export async function DELETE(_req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;
  const supabase = await supabaseRouteHandler();

  // Auth (RLS remains the real access boundary)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Soft delete (application-level visibility rule; keep RLS clean)
  const { error } = await supabase
    .from("repo_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fileId)
    .eq("repo_id", repoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true }, { status: 200 });
}