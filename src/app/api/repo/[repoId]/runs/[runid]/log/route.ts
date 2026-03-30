import { supabaseServerComponent } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  _req: Request,
  context: { params: Promise<{ repoId: string; runid: string }> }
) {
  const { repoId, runid } = await context.params;
  const runId = runid;

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
    console.log("[run_log_route membership error]", {
      repoId,
      runId,
      message: memErr.message,
    });
    return new Response("Membership check failed", { status: 500 });
  }

  if (!isMember) {
    console.log("[run_log_route forbidden]", { repoId, runId, userId: user.id });
    return new Response("Forbidden", { status: 403 });
  }

  const supabaseAdmin = createSupabaseAdmin();

  const { data: run, error: runErr } = await supabaseAdmin
    .from("repo_runs")
    .select("id, repo_id, log_storage_key")
    .eq("id", runId)
    .eq("repo_id", repoId)
    .maybeSingle();

  console.log("[run_log_route lookup]", {
    repoId,
    runId,
    runErr: runErr?.message ?? null,
    found: Boolean(run),
    logStorageKey: run?.log_storage_key ?? null,
  });

  if (runErr) {
    return new Response(`Run lookup failed: ${runErr.message}`, { status: 500 });
  }

  if (!run?.log_storage_key) {
    return new Response("Run log not found", { status: 404 });
  }

  const { data, error } = await supabaseAdmin.storage
    .from("vestaryn-files")
    .download(run.log_storage_key);

  console.log("[run_log_route download]", {
    repoId,
    runId,
    logStorageKey: run.log_storage_key,
    storageErr: error?.message ?? null,
    hasData: Boolean(data),
  });

  if (error) {
    return new Response(`Failed to fetch run log: ${error.message}`, { status: 500 });
  }

  if (!data) {
    return new Response("Failed to fetch run log: no data", { status: 500 });
  }

  const text = await data.text();

  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}