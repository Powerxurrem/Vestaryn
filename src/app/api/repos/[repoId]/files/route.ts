import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "@/lib/supabase/server";

/**
 * @file app/api/repos/[repoId]/files/route.ts
 * @purpose List Vault files for a repo (DB metadata canon).
 * @exports GET
 *
 * @sections
 * - Runtime
 * - Types
 * - Validation: repoId must be UUID
 * - Auth: Supabase user required (RLS enforces repo access)
 * - Query: repo_files (exclude soft-deleted) ordered by updated_at desc
 *
 * @invariants
 * - DB (repo_files) is the source-of-truth for file metadata.
 * - Soft-deleted files are filtered at API/UI level (this endpoint filters deleted_at IS NULL).
 * - RLS must NOT reference deleted_at (policy invariant). Filtering here is application logic.
 *
 * @touchpoints
 * - repo_files: select(id, repo_id, path, name, mime, size_bytes, updated_at, created_at)
 */

export const runtime = "nodejs";


// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type Ctx = { params: Promise<{ repoId: string }> };

// ─────────────────────────────────────────────────────────────
// Helpers: validation
// ─────────────────────────────────────────────────────────────
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v
  );
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─────────────────────────────────────────────────────────────
// GET /api/repos/[repoId]/files
// Returns non-deleted files ordered by recently updated.
// ─────────────────────────────────────────────────────────────
export async function GET(_req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;

  // Validate repoId early
  if (!repoId || repoId === "undefined" || !isUuid(repoId)) {
    return NextResponse.json(
      { error: "invalid repoId", received: repoId, files: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = await supabaseRouteHandler();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json(
      { error: "unauthorized", files: [] },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { data, error } = await supabase
    .from("repo_files")
    .select("id, repo_id, path, name, mime, size_bytes, updated_at, created_at")
    .eq("repo_id", repoId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message, files: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { files: data ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}