import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "@/lib/supabase/server";
import { resolveTierPolicy } from "@/lib/membership/tiers";

export async function GET(req: Request) {
  try {
    const supabase = await supabaseRouteHandler();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr) {
      return NextResponse.json({ error: userErr.message }, { status: 401 });
    }
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const repoId = searchParams.get("repoId")?.trim();

    if (!repoId) {
      return NextResponse.json({ error: "Missing repoId" }, { status: 400 });
    }

    // 1) repo -> workspace_id
    const { data: repoRow, error: repoErr } = await supabase
      .from("repos")
      .select("workspace_id")
      .eq("id", repoId)
      .single();

    if (repoErr || !repoRow?.workspace_id) {
      return NextResponse.json(
        { error: repoErr?.message || "Repo missing workspace_id" },
        { status: 500 }
      );
    }

    const workspaceId = repoRow.workspace_id;

    // 2) periodStart = UTC month start (YYYY-MM-01)
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);

    // 3) resolve tier policy from header (same pattern as chat route)
    const requestedTier = req.headers.get("x-vestaryn-tier");
    const isAdminAllowed =
      process.env.NODE_ENV !== "production" || process.env.VESTARYN_ALLOW_ADMIN_TIER === "1";

    const tierPolicy = resolveTierPolicy(requestedTier, {
  isAdminAllowed,
  forcedTier: "early_access",
});

    // 4) get/create monthly balance row
    const { data: statusRows, error: stErr } = await supabase.rpc("credits_get_status", {
      _workspace_id: workspaceId,
      _period_start: periodStart,
      _grant: tierPolicy.budget.creditsPerPeriod,
      _tier: tierPolicy.tier,
    });

    if (stErr) {
      return NextResponse.json({ error: stErr.message }, { status: 500 });
    }

    const creditStatus = Array.isArray(statusRows) ? statusRows[0] : statusRows;
    const remaining = Number(creditStatus?.remaining ?? 0);

    return NextResponse.json({
      repoId,
      workspaceId,
      periodStart,
      tier: tierPolicy.tier,
      credits: remaining,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error in /api/credits/balance" },
      { status: 500 }
    );
  }
}