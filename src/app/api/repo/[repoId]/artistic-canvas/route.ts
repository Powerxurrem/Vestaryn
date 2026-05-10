import { supabaseRouteHandler } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function requireRepoMember(repoId: string) {
  const supabase = await supabaseRouteHandler();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      supabase,
      user: null,
      error: new Response("Unauthorized", { status: 401 }),
    };
  }

  const { data: isMember, error } = await supabase.rpc("is_repo_member", {
    _repo_id: repoId,
  });

  if (error) {
    console.error("[artistic-canvas] membership check failed", error);
    return {
      supabase,
      user,
      error: new Response("Membership check failed", { status: 500 }),
    };
  }

  if (!isMember) {
    return {
      supabase,
      user,
      error: new Response("Forbidden", { status: 403 }),
    };
  }

  return {
    supabase,
    user,
    error: null,
  };
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await context.params;

  const guard = await requireRepoMember(repoId);
  if (guard.error) return guard.error;

  const { data, error } = await guard.supabase
    .from("repo_artistic_canvas_states")
    .select("state, updated_at")
    .eq("repo_id", repoId)
    .maybeSingle();

  if (error) {
    console.error("[artistic-canvas] load failed", error);
    return new Response("Failed to load artistic canvas.", { status: 500 });
  }

  return Response.json({
    state: data?.state ?? { cards: [] },
    updatedAt: data?.updated_at ?? null,
  });
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await context.params;

  const guard = await requireRepoMember(repoId);
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => null);
  const cards = body?.cards;

  if (!Array.isArray(cards)) {
    return new Response("Invalid artistic canvas payload.", { status: 400 });
  }

  // Simple safety guard. This can be raised later.
  const encodedSize = Buffer.byteLength(JSON.stringify(cards), "utf8");
  if (encodedSize > 5_000_000) {
    return new Response("Canvas state is too large to save.", { status: 413 });
  }

  const { error } = await guard.supabase
    .from("repo_artistic_canvas_states")
    .upsert(
      {
        repo_id: repoId,
        state: { cards },
        updated_by: guard.user!.id,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "repo_id",
      }
    );

  if (error) {
    console.error("[artistic-canvas] save failed", error);
    return new Response("Failed to save artistic canvas.", { status: 500 });
  }

  return Response.json({
    ok: true,
  });
}