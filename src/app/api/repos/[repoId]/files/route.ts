import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "@/lib/supabase/server";

/**
 * GET /api/repos/[repoId]/files
 * Returns non-deleted files ordered by recently updated.
 *
 * Notes:
 * - In your Next setup, `params` is a Promise and must be awaited.
 * - DB (repo_files) is source-of-truth; soft-deletes filtered here (not in RLS).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ repoId: string }> };

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v
  );
}

export async function GET(_req: Request, ctx: Ctx) {
  const { repoId } = await ctx.params;

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
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

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