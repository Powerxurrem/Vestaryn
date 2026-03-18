export async function resolveRuntimePolicyFromCredits(args: {
  supabase: any;
  repoId: string;
  tierPolicy: any;
}): Promise<{
  workspaceId: string;
  periodStart: string;
  remaining: number;
  runtimePolicy: any;
  errorResponse: Response | null;
}> {
  const { supabase, repoId, tierPolicy } = args;

  const { data: repoRow, error: repoErr } = await supabase
    .from("repos")
    .select("workspace_id")
    .eq("id", repoId)
    .single();

  if (repoErr || !repoRow?.workspace_id) {
    return {
      workspaceId: "",
      periodStart: "",
      remaining: 0,
      runtimePolicy: tierPolicy,
      errorResponse: new Response("Missing workspace", { status: 500 }),
    };
  }

  const workspaceId = repoRow.workspace_id;

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  const { data: statusRows, error: stErr } = await supabase.rpc("credits_get_status", {
    _workspace_id: workspaceId,
    _period_start: periodStart,
    _grant: tierPolicy.budget.creditsPerPeriod,
    _tier: tierPolicy.tier,
  });

  if (stErr) {
    console.log("[credits] get_status failed:", stErr.message);

    return {
      workspaceId,
      periodStart,
      remaining: 0,
      runtimePolicy: tierPolicy,
      errorResponse: new Response("Credits unavailable", { status: 500 }),
    };
  }

  const creditStatus = Array.isArray(statusRows) ? statusRows[0] : statusRows;
  const remaining = Number(creditStatus?.remaining ?? 0);

  let runtimePolicy = tierPolicy;

  if (remaining <= 0) {
    return {
      workspaceId,
      periodStart,
      remaining,
      runtimePolicy,
      errorResponse: new Response(
        "[Observation]\nCredits exhausted.\n\n[Assessment]\nWorkspace credit balance is depleted for this period.\n\n[Action]\nUpgrade plan or wait for reset.",
        { status: 402, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      ),
    };
  }

  if (remaining <= tierPolicy.budget.softReserveCredits) {
    if (tierPolicy.budget.graceMode === "block") {
      return {
        workspaceId,
        periodStart,
        remaining,
        runtimePolicy,
        errorResponse: new Response(
          "[Observation]\nCredits below reserve threshold.\n\n[Assessment]\nGrace mode is block.\n\n[Action]\nUpgrade plan or wait for reset.",
          { status: 402, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        ),
      };
    }

    if (tierPolicy.budget.graceMode === "clamp") {
      runtimePolicy = {
        ...tierPolicy,
        output: {
          ...tierPolicy.output,
          maxOutputTokens: Math.max(256, Math.floor(tierPolicy.output.maxOutputTokens * 0.5)),
        },
        tools: {
          ...tierPolicy.tools,
          maxToolRounds: Math.max(1, Math.floor(tierPolicy.tools.maxToolRounds / 2)),
          maxToolCallsPerRound: Math.max(1, Math.floor(tierPolicy.tools.maxToolCallsPerRound / 2)),
        },
      };
    }
  }

  return {
    workspaceId,
    periodStart,
    remaining,
    runtimePolicy,
    errorResponse: null,
  };
}