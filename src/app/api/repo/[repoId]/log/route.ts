import { supabaseServerComponent } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ repoId: string; runId: string }> }
) {
  const { repoId, runId } = await context.params;
  const supabase = await supabaseServerComponent();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", {
    _repo_id: repoId,
  });

  if (memErr) {
    return new Response("Membership check failed", { status: 500 });
  }

  if (!isMember) {
    return new Response("Forbidden", { status: 403 });
  }

  const { data: run, error: runErr } = await supabase
    .from("repo_runs")
    .select("id, repo_id, log_storage_key")
    .eq("id", runId)
    .eq("repo_id", repoId)
    .single();

  if (runErr || !run?.log_storage_key) {
    return new Response("Run log not found", { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from("vestaryn-files")
    .download(run.log_storage_key);

  if (error || !data) {
    return new Response("Failed to fetch run log", { status: 500 });
  }

  const text = await data.text();

  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}