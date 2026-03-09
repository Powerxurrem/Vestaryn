import { NextResponse } from "next/server";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { resolveTierPolicy } from "@/lib/membership/tiers";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await ctx.params;

  const supabase = await supabaseServerComponent();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const requestedTier = _req.headers.get("x-vestaryn-tier");
  const isAdminAllowed =
    process.env.NODE_ENV !== "production" || process.env.VESTARYN_ALLOW_ADMIN_TIER === "1";
  const tierPolicy = resolveTierPolicy(requestedTier, {
  isAdminAllowed,
  forcedTier: "early_access",
});

  if (!tierPolicy.capabilities.allowExport) {
    return new NextResponse("Export is not available on your tier. Upgrade to Pro.", { status: 403 });
  }

  const { data: msgs, error } = await supabase
    .from("repo_messages")
    .select("role, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) return new NextResponse(`Export failed: ${error.message}`, { status: 500 });

  const md =
    `# Vestaryn Export\n\n` +
    `Repo: ${repoId}\n` +
    `Exported: ${new Date().toISOString()}\n\n---\n\n` +
    (msgs ?? [])
      .map((m: any) => {
        const ts = m.created_at ? new Date(m.created_at).toISOString() : "";
        return `## ${m.role.toUpperCase()} — ${ts}\n\n${String(m.content ?? "").trim()}\n`;
      })
      .join("\n---\n\n");

  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // This forces download instead of opening a new tab view
      "Content-Disposition": `attachment; filename="vestaryn-${repoId}.md"`,
      "Cache-Control": "no-store",
    },
  });
}