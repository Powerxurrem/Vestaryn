import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "../../../../../lib/supabase/server";

/**
 * @file app/api/repo/[repoId]/messages/route.ts
 * @purpose Repo message history read/write endpoint (non-streaming).
 * @exports GET, POST
 *
 * @sections
 * - Auth (Supabase route handler)
 * - GET: list messages (ordered ascending, capped)
 * - POST: insert message (role/content)
 *
 * @invariants
 * - Auth is required; RLS enforces repo access (this route never bypasses RLS).
 * - Ordering is explicit: GET returns oldest -> newest for deterministic render.
 * - Hard cap on history size (limit 200) to protect performance.
 * - This route does NOT enforce SYSTEM_PROTECTOR compliance; that filter lives in /chat.
 *
 * @touchpoints
 * - repo_messages: select(id, role, content, created_at), insert(repo_id, user_id, role, content)
 * - supabaseRouteHandler(): server auth context + RLS boundary
 */

// ─────────────────────────────────────────────────────────────
// GET /api/repo/[repoId]/messages
// Returns up to 200 messages, oldest -> newest
// ─────────────────────────────────────────────────────────────
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params;
  const supabase = await supabaseRouteHandler();

  // Auth
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Query
  const { data, error } = await supabase
    .from("repo_messages")
    .select("id, role, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ messages: data ?? [] });
}

// ─────────────────────────────────────────────────────────────
// POST /api/repo/[repoId]/messages
// Inserts a single message for this repo
// ─────────────────────────────────────────────────────────────
export async function POST(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params;
  const supabase = await supabaseRouteHandler();

  // Auth
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Parse payload
  const body = await req.json().catch(() => null);
  const role = body?.role as "user" | "assistant" | "system";
  const content = (body?.content as string | undefined)?.trim();

  if (!role || !content) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Insert
  const { data, error } = await supabase
    .from("repo_messages")
    .insert({
      repo_id: repoId,
      user_id: authData.user.id,
      role,
      content,
    })
    .select("id, role, content, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: data });
}