import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "../../../../../lib/supabase/server";

// ✅ Canonical: never cache auth-bound responses
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;

/**
 * @file app/api/repo/[repoId]/messages/route.ts
 * @purpose Repo message history read/write endpoint (non-streaming).
 * @exports GET, POST
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
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  // Query
  const { data, error } = await supabase
    .from("repo_messages")
    .select("id, role, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    { messages: data ?? [] },
    { headers: NO_STORE_HEADERS }
  );
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
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  // Parse payload
  const body = await req.json().catch(() => null);
  const role = body?.role as "user" | "assistant" | "system";
  const content = (body?.content as string | undefined)?.trim();

  if (!role || !content) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
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

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  // ✅ Return a single message (deterministic shape)
  return NextResponse.json(
    { message: data },
    { headers: NO_STORE_HEADERS }
  );
}