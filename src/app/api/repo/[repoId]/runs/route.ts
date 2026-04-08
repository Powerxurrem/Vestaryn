import { supabaseServerComponent } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await context.params;
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

  const { data, error } = await supabase
    .from("repo_runs")
    .select(`
      id,
      repo_id,
      created_at,
      ok,
      command,
      failed_step,
      failure_kind,
      duration_ms,
      timed_out,
      stdout_preview,
      stderr_preview,
      log_storage_key,
      log_size_bytes,
      run_kind,
      summary,
      stdout,
      stderr
    `)
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ runs: data ?? [] }),
    { headers: { "Content-Type": "application/json" } }
  );
}