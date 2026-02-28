import { supabaseServerComponent } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;

  const supabase = await supabaseServerComponent();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase.rpc("credits_get_status", {
    _workspace_id: workspaceId,
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