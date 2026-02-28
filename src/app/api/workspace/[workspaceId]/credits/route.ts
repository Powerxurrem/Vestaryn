// src/app/api/repo/[repoId]/credits/route.ts
import { supabaseServerComponent } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: { repoId: string } }
) {
  const { repoId } = params;

  const supabase = await supabaseServerComponent();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // get workspace_id for repo
  const { data: repoRow, error: repoErr } = await supabase
    .from("repos")
    .select("workspace_id")
    .eq("id", repoId)
    .single();

  if (repoErr || !repoRow?.workspace_id) {
    return new Response("Missing workspace", { status: 500 });
  }

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase.rpc("credits_get_status", {
    _workspace_id: repoRow.workspace_id,
    _period_start: periodStart,
    _grant: 0,
    _tier: "observe",
  });

  if (error) {
    console.log("[credits] get_status failed:", error.message);
    return new Response("Credit status unavailable", { status: 500 });
  }

  return Response.json(data?.[0] ?? null);
}