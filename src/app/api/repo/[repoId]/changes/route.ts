import crypto from "crypto";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request, context: { params: Promise<{ repoId: string }> }) {
  const requestId = crypto.randomUUID();
  const { repoId } = await context.params;

  const supabase = await supabaseServerComponent();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", { _repo_id: repoId });
  if (memErr) return new Response("Membership check failed", { status: 500 });
  if (!isMember) return new Response("Forbidden", { status: 403 });

  const body = await req.json().catch(() => ({}));
  const proposal = body.proposal;

  // minimal validation for now
  if (!proposal || typeof proposal !== "object") {
    return new Response("Invalid proposal", { status: 400 });
  }

  const supabaseAdmin = createSupabaseAdmin();

  const ins = await supabaseAdmin
    .from("repo_changes")
    .insert({
      repo_id: repoId,
      actor_user_id: user.id,
      status: "proposed",
      proposal,
    })
    .select("id")
    .single();

  if (ins.error || !ins.data) {
    return new Response(`Insert failed: ${ins.error?.message ?? "unknown"}`, { status: 500 });
  }

  return Response.json({ ok: true, requestId, changeId: ins.data.id });
}