import OpenAI from "openai";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { resolveTierPolicy } from "@/lib/membership/tiers";
import { runnerRun } from "@/lib/runner/client";
import { buildRepoSnapshotSignedUrl } from "@/lib/runner/snapshot";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { SYSTEM_PROTECTOR_DEFAULT,SYSTEM_PROTECTOR_ARCH,} from "@/lib/chamber/prompts";
import { setRepoFileStatus } from "@/lib/vault/fileStatus";
import { normalizeForNoopCheck, sha256,confirmPhrase,confirmCreatePhrase,normalizePath,nameFromPath,inferTextMimeFromPath,stripCodeFences,stripDuplicateTriplet,scrubVisibleToolPayload,ensureTriplet,
} from "@/lib/vault/utils";
import {extractMentionedPaths,extractSingleMentionedPath, isNamedFileExecutionRequest,isRepositoryExecutionIntent,
isCreateAndModifyIntent,resolveCreateAndModifyPaths,
isExtractToModuleIntent,looksLikeStandaloneModule,isMetaRepositoryQuestion, resolveExtractToModulePaths,contentStartsWithControlMarker, isGoalPlanningRequest
} from "@/lib/chamber/intent";
import {isSourceTargetTransferIntent,resolveSourceAndTargetPaths,
isImportRefactorIntent,isExtractHelpersIntent,isSplitFileIntent,extractSplitTargets,deriveDefaultSplitTargets,extractRequestedSplitCount,  isSplitReadAllowed} from "@/lib/chamber/refactorIntent";
import { resolveFileIdByPathOrName,vault_list_files,vault_read_text, vault_propose_create,vault_apply_write,vault_apply_create, vault_propose_append,vault_propose_write} from "@/lib/vault/tools";
import { generateSplitFileContents,generateExtractHelpersResult,generateNewFileContent,generateRewrittenFileContent} from "@/lib/chamber/generation";
import { isBaselinePreverifyFailure,runPreVerifyForProposalSet,shouldPreVerifyProposalSet,attemptFastPathRepair,runAutoVerifyForRepo,buildPendingVerifyPayload,buildFinalVerifyPayload,attemptRepairProposalSet} from "@/lib/chamber/verify";
import { ensureSacredMemoryFile,ensureUserProfileFile,
updateChamberStateDoc,maybeSummarizeAndEngraveProposal,} from "@/lib/chamber/memory";
import { TOOLS, runTool}from "@/lib/vault/toolRuntime";
import { choosePrimarySuggestionTarget,buildSuggestedPromptsFromAppliedFiles}from "@/lib/chamber/suggestions";
import { hasValidAssistantContract}from "@/lib/chamber/output";
import { SACRED_PATH,USER_PROFILE_PATH, 
} from "@/lib/chamber/constants";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";
import { inferRepoProfile } from "@/lib/chamber/repoInference";

/**
 * @file app/api/repo/[repoId]/chat/route.ts
 * @purpose Stream assistant output for a repo chat, while enforcing Vestaryn output contract.
 * @exports POST
 */

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────
// OpenAI client
// ─────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MAINTENANCE_TRIGGER_MSGS = 160;

function extractGoalPlan(text: string) {
  const marker = "__GOAL_PLAN__:";
  const s = String(text ?? "");

  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  const after = s.slice(start);

  const endIdx = after.indexOf("\n__");
  const json = (endIdx === -1 ? after : after.slice(0, endIdx)).trim();

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractGoalStatus(text: string) {
  const marker = "__GOAL_STATUS__:";
  const s = String(text ?? "");

  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  const after = s.slice(start);

  const endIdx = after.indexOf("\n");
  const json = (endIdx === -1 ? after : after.slice(0, endIdx)).trim();

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function findLatestGoalStatus(
  supabase: any,
  repoId: string,
  goalId: string
) {
  const { data: rows, error } = await supabase
    .from("repo_messages")
    .select("content, created_at")
    .eq("repo_id", repoId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to load goal status history: ${error.message}`);
  }

  for (const row of rows ?? []) {
    const txt = String(row.content ?? "");
    const parsed = extractGoalStatus(txt);
    if (parsed && String(parsed.goalId ?? "") === goalId) {
      return parsed;
    }
  }

  return null;
}
// ─────────────────────────────────────────────────────────────
// Route: POST /api/repo/[repoId]/chat
// ─────────────────────────────────────────────────────────────
console.log("[supabase]", process.env.NEXT_PUBLIC_SUPABASE_URL);
export async function POST(req: Request, context: { params: Promise<{ repoId: string }> }) {
  const t0 = performance.now();
  const { repoId } = await context.params;
  const requestId = crypto.randomUUID();
  const url = new URL(req.url);
  const forceMaintenance = url.searchParams.get("forceMaintenance") === "1";
  const supabase = await supabaseServerComponent();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", { _repo_id: repoId });
console.log("[is_repo_member]", { userId: user.id, repoId, isMember, memErr: memErr?.message });

if (memErr) {
  return new Response("Membership check failed", { status: 500 });
}

if (!isMember) {
  return new Response("Forbidden", { status: 403 });
}
  const { content } = await req.json();
  if (!content?.trim()) return new Response("Missing content", { status: 400 });
  const planningRequest = isGoalPlanningRequest(content);

console.log("[goal_debug_content]", JSON.stringify(content));

async function findLatestGoalPlan(
  supabase: any,
  repoId: string
) {
  const { data: rows, error } = await supabase
    .from("repo_messages")
    .select("content, created_at")
    .eq("repo_id", repoId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to load goal history: ${error.message}`);
  }

  for (const row of rows ?? []) {
    const txt = String(row.content ?? "");
    const parsed = extractGoalPlan(txt);

    if (parsed) {
      console.log("[findLatestGoalPlan] found", {
        goalId: parsed.goalId,
        title: parsed.title,
      });
      return parsed;
    }
  }

  return null;
}

// ─────────────────────────────────────────
// GOAL STOP (deterministic)
// ─────────────────────────────────────────
if (content.trim() === "__GOAL_STOP__") {
  const plan = await findLatestGoalPlan(supabase, repoId);

  if (!plan) {
    return new Response("No active goal found", { status: 400 });
  }

  const statusPayload = {
    goalId: String(plan.goalId ?? ""),
    status: "cancelled",
    currentStepId: null,
    note: "Goal stopped by user.",
  };

  const final = `__GOAL_STATUS__:${JSON.stringify(statusPayload)}`;

  console.log("[goal_stop]", {
    repoId,
    goalId: statusPayload.goalId,
  });

  await supabase.from("repo_messages").insert([
    {
      repo_id: repoId,
      user_id: user.id,
      role: "user",
      content,
    },
    {
      repo_id: repoId,
      user_id: user.id,
      role: "assistant",
      content: final,
    },
  ]);

  return new Response(final, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

if (content.trim() === "__GOAL_APPROVE__") {
  const { data: rows, error } = await supabase
    .from("repo_messages")
    .select("content, created_at")
    .eq("repo_id", repoId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(200);


    
  if (error) {
    return new Response(
      "[Observation]\nGoal approval failed.\n\n[Assessment]\nCould not load recent assistant messages.\n\n[Action]\nRetry approval.",
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }

  const latestGoalPlanMsg = (rows ?? []).find((r: any) =>
    String(r.content ?? "").trim().startsWith("__GOAL_PLAN__:")
  );

  if (!latestGoalPlanMsg) {
    return new Response(
      "[Observation]\nGoal approval failed.\n\n[Assessment]\nNo pending goal plan was found.\n\n[Action]\nCreate a plan first.",
      {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }

  const raw = String(latestGoalPlanMsg.content ?? "").trim();
  const json = raw.slice("__GOAL_PLAN__:".length);

  let plan: any;
  try {
    plan = JSON.parse(json);
  } catch (e: any) {
    return new Response(
      "[Observation]\nGoal approval failed.\n\n[Assessment]\nStored goal plan JSON was invalid.\n\n[Action]\nRegenerate the plan.",
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }

  const statusPayload = {
    goalId: String(plan.goalId ?? ""),
    status: "running",
    currentStepId:
      Array.isArray(plan.steps) && plan.steps.length > 0
        ? String(plan.steps[0].id ?? "")
        : null,
  };

console.log("[goal_approve]", {
  repoId,
  goalId: statusPayload.goalId,
  currentStepId: statusPayload.currentStepId,
  stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
});

  const final = `__GOAL_STATUS__:${JSON.stringify(statusPayload)}`;

  await supabase.from("repo_messages").insert([
    {
      repo_id: repoId,
      user_id: user.id,
      role: "user",
      content,
    },
    {
      repo_id: repoId,
      user_id: user.id,
      role: "assistant",
      content: final,
    },
  ]);

  return new Response(final, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
  
const { data: repoFiles, error: repoFilesErr } = await supabase
  .from("repo_files")
  .select("path")
  .eq("repo_id", repoId)
  .is("deleted_at", null);

if (repoFilesErr) {
  console.log("[repo_inference] repo file load failed:", repoFilesErr.message);
}

const filePaths = (repoFiles ?? [])
  .map((f: any) => String(f.path ?? "").trim())
  .filter(Boolean);

const inference = inferRepoProfile(filePaths);

console.log("[repo_inference]", {
  repoId,
  fileCount: filePaths.length,
  inference,
});

  let preReadFile: {
  id: string;
  path: string;
  name: string;
  mime: string;
  content: string;
} | null = null;

  console.log("[chat] content_head:", content.slice(0, 40));

// ─────────────────────────────────────────
// GOAL CONTINUE
// ─────────────────────────────────────────
if (content.trim() === "__GOAL_CONTINUE__") {

const plan = await findLatestGoalPlan(supabase, repoId);

if (!plan) {
  return new Response(
    "[Observation]\nNo active goal was found.\n\n[Assessment]\nThe latest goal plan could not be located.\n\n[Action]\nCreate a new plan or reload the chamber.",
    {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
}

const latestStatus = await findLatestGoalStatus(
  supabase,
  repoId,
  String(plan.goalId ?? "")
);

const effectiveCurrentStepId =
  typeof latestStatus?.currentStepId === "string"
    ? latestStatus.currentStepId
    : typeof plan.currentStepId === "string"
    ? plan.currentStepId
    : null;

const steps = Array.isArray(plan.steps) ? plan.steps : [];
const idx = steps.findIndex((s: any) => s.id === effectiveCurrentStepId);

let nextStepId: string | null = null;

if (idx >= 0 && idx + 1 < steps.length) {
  nextStepId = String(steps[idx + 1].id);
}

const statusPayload = {
  goalId: String(plan.goalId ?? ""),
  status: nextStepId ? "running" : "completed",
  currentStepId: nextStepId,
};

const stepToExecute = steps.find((s: any) => s.id === effectiveCurrentStepId) ?? null;

const executePayload =
  stepToExecute && statusPayload.status === "running"
    ? {
        goalId: String(plan.goalId ?? ""),
        stepId: String(stepToExecute.id ?? ""),
        instruction: String(stepToExecute.description ?? "").trim(),
      }
    : null;

const parts = [
  `__GOAL_STATUS__:${JSON.stringify(statusPayload)}`,
];

if (executePayload?.instruction) {
  parts.push(`__GOAL_EXECUTE__:${JSON.stringify(executePayload)}`);
}

const final = parts.join("\n");

await supabase.from("repo_messages").insert([
    {
      repo_id: repoId,
      user_id: user.id,
      role: "user",
      content
    },
    {
      repo_id: repoId,
      user_id: user.id,
      role: "assistant",
      content: final
    }
  ]);

  return new Response(final, {
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

  // ─────────────────────────────────────────────────────────────
  // Membership tier policy (server clamp)
  // ─────────────────────────────────────────────────────────────
  const requestedTier = req.headers.get("x-vestaryn-tier");

  const isAdminAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VESTARYN_ALLOW_ADMIN_TIER === "1";

  const tierPolicy = resolveTierPolicy(requestedTier, {
  isAdminAllowed,
  forcedTier: "early_access",
});

// ─────────────────────────────────────────
// Architecture mode resolver (server-side)
// ─────────────────────────────────────────
const wantsArchitecture =
  /architecture|system design|topology|multi-file|refactor plan|deep dive/i.test(content);

const allowArchitecture =
  tierPolicy.capabilities?.allowArchitectureMode === true;

const useArchitectureMode = allowArchitecture && wantsArchitecture;

const resolvedInstructions = useArchitectureMode
  ? SYSTEM_PROTECTOR_ARCH
  : SYSTEM_PROTECTOR_DEFAULT;

const resolvedMode: "default" | "arch" = useArchitectureMode ? "arch" : "default";

console.log("[policy]", {
  tier: tierPolicy.tier,
  model: tierPolicy.model,
  maxOutputTokens: tierPolicy.output.maxOutputTokens,
  maxToolRounds: tierPolicy.tools.maxToolRounds,
  mode: resolvedMode,
});

if (planningRequest) {
  await supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: user.id,
    role: "user",
    content,
  });

const goalPlanInstructions = `
You are generating a GoalPlan object for Vestaryn.

Return only valid JSON.
Do not return markdown.
Do not use code fences.
Do not add prose before or after the JSON.

Schema:
{
  "goalId": string,
  "title": string,
  "summary": string,
  "status": "awaiting_approval",
  "scope": "small" | "medium" | "large",
  "estimatedTouchedFiles": string[],
  "steps": [
    {
      "id": string,
      "title": string,
      "description": string,
      "status": "pending",
      "files": string[]
    }
  ]
}

Rules:
- Honor the user's requested number of steps exactly if specified.
- This is planning only.
- Keep the JSON compact.
- summary must be one short sentence.
- each step title must be short.
- each step description must be one short sentence only.
- keep estimatedTouchedFiles minimal.
- do not emit repository proposal markers.
- do not emit prose outside the JSON.
`;

  try {
    const resp = await openai.responses.create({
      model: tierPolicy.model,
      instructions: goalPlanInstructions,
      input: [{ role: "user", content }],
      tool_choice: "none",
      max_output_tokens: 1900,
    });

    const raw = String(resp.output_text ?? "").trim();

    console.log("[goal_plan] raw", raw);

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      console.log("[goal_plan] invalid_json", {
        message: e?.message,
        raw,
      });

      return new Response(
        "[Observation]\nGoal plan generation failed.\n\n[Assessment]\nThe model did not return valid GoalPlan JSON.\n\n[Action]\nRetry with the dedicated planning contract.",
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    const final = `__GOAL_PLAN__:${JSON.stringify(parsed)}`;

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: user.id,
      role: "assistant",
      content: final,
    });

    return new Response(final, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[goal_plan] failed", e?.message);

    return new Response(
      "[Observation]\nGoal plan generation failed.\n\n[Assessment]\nThe dedicated planning branch failed before a valid marker could be created.\n\n[Action]\nCheck server logs for [goal_plan].",
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }
}

console.log("[verify_probe] content:", JSON.stringify(content));

const baselineVerify = await runAutoVerifyForRepo({ repoId });

console.log("[baseline_verify]", {
  ok: baselineVerify.verifyPayload.ok,
  failedStep: baselineVerify.verifyPayload.failedStep,
});

if (!baselineVerify.verifyPayload.ok) {
  console.log("[baseline_verify] repo currently broken, repair needed");
}

console.log("[baseline_verify]", {
  ok: baselineVerify.verifyPayload.ok,
  failedStep: baselineVerify.verifyPayload.failedStep,
});

if (!baselineVerify.verifyPayload.ok) {
  console.log("[baseline_verify] repo currently broken, repair needed");
}

const verifyCmd =
  content.trim() === "__VERIFY_ALL__" ? "node_verify" :
  content.trim() === "__VERIFY_TEST__" ? "node_test" :
  content.trim() === "__VERIFY_LINT__" ? "node_lint" :
  content.trim() === "__VERIFY_TYPECHECK__" ? "node_typecheck" :
  null;

console.log("[verify_probe] verifyCmd:", verifyCmd);

if (verifyCmd) {
  const jobId = `verify-${repoId}-${Date.now()}`;
  try {
    console.log("[verify] building snapshot", { repoId, jobId, verifyCmd });


    const supabaseAdmin = createSupabaseAdmin();
    const snap = await buildRepoSnapshotSignedUrl(supabaseAdmin, repoId, jobId, {
      signedUrlTtlSec: 600,
    });

    console.log("[verify] snapshot ready", {
      fileCount: snap.fileCount,
      zipBytes: snap.zipBytes,
      snapshotObjectPath: snap.snapshotObjectPath,
    });

    const result = await runnerRun({
      jobId,
      commandId: verifyCmd,
      snapshotUrl: snap.snapshotSignedUrl,
      timeoutMs: 120_000,
    });

console.log("[verify] runner raw output", {
  stdoutLen: String(result.stdout ?? "").length,
  stderrLen: String(result.stderr ?? "").length,
  stdoutHead: String(result.stdout ?? "").slice(0, 500),
  stderrHead: String(result.stderr ?? "").slice(0, 500),
});

await supabaseAdmin.from("repo_runs").insert({
  repo_id: repoId,
  change_id: null,
  command: verifyCmd,
  ok: Boolean(result.ok),
  exit_code: Number(result.exitCode ?? -1),
  duration_ms: Number(result.durationMs ?? 0),
  stdout: (result.stdout ?? "").slice(0, 8000),
  stderr: (result.stderr ?? "").slice(0, 8000),

  job_id: jobId,
  runner_fingerprint: result.fingerprint ?? null,
  failed_step: result.failedStep ?? null,
  failure_kind: result.failureKind ?? null,
  timed_out: Boolean(result.timedOut),
});

console.log("[verify] runner returned", {
  ok: result.ok,
  exitCode: result.exitCode,
  durationMs: result.durationMs,
  error: result.error ?? null,
  stdoutLen: (result.stdout ?? "").length,
  stderrLen: (result.stderr ?? "").length,
});

const verifyPayload = {
  command: verifyCmd,
  ok: Boolean(result.ok),
  exitCode: Number(result.exitCode ?? -1),
  durationMs: Number(result.durationMs ?? 0),
  stdout: String(result.stdout ?? ""),
  stderr: String(result.stderr ?? ""),
  error: result.error ?? null,

  jobId,
  fingerprint: result.fingerprint ?? null,
  failedStep: result.failedStep ?? null,
  failureKind: result.failureKind ?? null,
  timedOut: Boolean(result.timedOut),
};

try {
  await updateChamberStateDoc(supabase, repoId, {
    activeEngineeringArea: "Verification and repository integrity checks.",
    recentChanges: [
      `Ran ${verifyCmd} with result ${result.ok ? "PASS" : "FAIL"}.`,
    ],
    immediateNextSteps: result.ok
      ? ["Continue implementation or stage the next change."]
      : ["Review verify output and fix failing files before continuing."],
  });
} catch (e: any) {
  console.log("[chamber-state] verify update skipped:", e?.message);
}

// Stream structured marker for UI (same pattern as __PROPOSAL__)
const marker = `\n__VERIFY__:${JSON.stringify(verifyPayload)}\n`;

const txt =
  `[Observation]\nVerification executed.\n\n` +
  `[Assessment]\ncommand=${verifyCmd}\nok=${result.ok} exitCode=${result.exitCode} durationMs=${result.durationMs}\n\n` +
  `[Action]\nstdout:\n${(result.stdout ?? "").slice(0, 3000)}\n\n` +
  `stderr:\n${(result.stderr ?? "").slice(0, 3000)}\n` +
  marker;

// Persist the deterministic apply result so it survives refresh
await supabase.from("repo_messages").insert({
  repo_id: repoId,
  user_id: user.id,
  role: "assistant",
  content:
    "[Observation]\nVerification executed.\n\n" +
    `[Assessment]\ncommand=${verifyCmd} ok=${Boolean(result.ok)} exitCode=${Number(result.exitCode ?? -1)} durationMs=${Number(result.durationMs ?? 0)}\n\n` +
    "[Action]\nVerification result recorded.",
});

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[verify] error", { message: e?.message, name: e?.name });

    const txt =
      `[Observation]\nVerification failed.\n\n` +
      `[Assessment]\n${e?.message ?? "Unknown error"}\n\n` +
      `[Action]\nCheck server logs for [verify] and runner logs.\n`;

    return new Response(txt, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}


// 🔒 Runner connectivity test (deterministic, bypass LLM)
if (content.trim() === "__RUNNER_PING__") {
  try {
    console.log("[runner_ping] calling runnerRun", {
      base: (process.env.RUNNER_URL ?? "").trim(),
      secretLen: ((process.env.RUNNER_SECRET ?? "").trim()).length,
      repoId,
    });

    const result = await runnerRun({
      jobId: `ping-${repoId}-${Date.now()}`,
      commandId: "ping",
      timeoutMs: 30_000,
    });

    console.log("[runner_ping] runnerRun returned", {
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      error: result.error ?? null
    });

    const txt =
      `[Observation]\nVerification executed.\n\n` +
      `[Assessment]\n` +
      `command=${verifyCmd}\n` +
      `ok=${result.ok} exitCode=${result.exitCode} durationMs=${result.durationMs}\n` +
      `error=${result.error ?? "null"}\n\n` +
      `[Action]\nstdout:\n${(result.stdout ?? "").slice(0, 3000)}\n\n` +
      `stderr:\n${(result.stderr ?? "").slice(0, 3000)}\n`;

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[runner_ping] error", {
      name: e?.name,
      message: e?.message,
      code: e?.code,
    });
    console.log("[runner_ping] message:", e?.message);
    console.log("[runner_ping] cause:", e?.cause);

    const txt =
      `[Observation]\nRunner ping failed.\n\n` +
      `[Assessment]\n${e?.message ?? "Unknown error"}\n\n` +
      `[Action]\nCheck RUNNER_URL/RUNNER_SECRET and Fly app status.\n`;

    return new Response(txt, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

  // 🔒 Deterministic short-circuit: current year
  if (/\bwhat year\b|\bcurrent year\b/i.test(content)) {
    const year = new Date().getFullYear();

    const txt = `[Observation]\nUser requested current year.\n\n[Assessment]\nThis is deterministic from server clock and should not use the LLM.\n\n[Action]\nNot a systems question. It is currently ${year}.`;

    await supabase.from("repo_messages").insert({ repo_id: repoId, user_id: user.id, role: "user", content });
    await supabase.from("repo_messages").insert({ repo_id: repoId, user_id: user.id, role: "assistant", content: txt });

    return new Response(txt, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

// 🔒 APPLY_SET SHORT-CIRCUIT (deterministic multi-apply, bypass LLM)
if (content.startsWith("__APPLY_SET__:")) {
  const raw = content.slice("__APPLY_SET__:".length);

  try {
    const payload = JSON.parse(raw);
    const proposals = Array.isArray(payload?.proposals) ? payload.proposals : [];

    if (proposals.length === 0) {
      throw new Error("No proposals provided");
    }

    console.log("[apply_set recv]", {
      count: proposals.length,
      paths: proposals.map((p: any) => p?.path),
      fileIds: proposals.map((p: any) => p?.fileId),
    });

    const touchedFileIds: string[] = [];
    const appliedFiles: any[] = [];

    for (const proposal of proposals) {
      console.log("[apply_set item]", {
        path: proposal?.path,
        fileId: proposal?.fileId,
        op: proposal?.meta?.op === "create" ? "create" : "overwrite",
      });

      const op = proposal?.meta?.op === "create" ? "create" : "overwrite";
      let applied: any;

      if (op === "create") {
        const expected = confirmCreatePhrase(proposal.fileId, proposal.nextHash);
        applied = await vault_apply_create(
          supabase,
          repoId,
          user.id,
          expected,
          { ...proposal, confirm: expected }
        );
      } else {
        const expected = confirmPhrase(proposal.fileId, proposal.nextHash);
        applied = await vault_apply_write(
          supabase,
          repoId,
          user.id,
          expected,
          { ...proposal, confirm: expected }
        );
      }

      touchedFileIds.push(String(proposal.fileId));
      appliedFiles.push({
        fileId: applied?.fileId ?? String(proposal.fileId),
        path: applied?.path ?? proposal?.path ?? null,
        version: applied?.version ?? null,
        mime: proposal?.mime ?? null,
      });
    }

    const { data: rowsAfter, error: rowsAfterErr } = await supabase
      .from("repo_files")
      .select("id, path, name, deleted_at")
      .eq("repo_id", repoId)
      .is("deleted_at", null)
      .in("id", touchedFileIds);

    console.log("[apply_set after_rows]", {
      repoId,
      touchedFileIds,
      rowsAfterErr: rowsAfterErr?.message ?? null,
      rowsAfter,
    });

    console.log("[apply_set done]", {
      touchedFileIds,
      appliedFiles,
    });

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: user.id,
      role: "assistant",
      content:
        "[Observation]\nWrites applied.\n\n" +
        "[Assessment]\nThe staged multi-file change set was confirmed and file versions advanced.\n\n" +
        "[Action]\nNo pending confirmation remains for this applied change set.",
    });

    const applyPayload = {
      ok: true,
      repoId,
      requestId,
      changeId: null,
      touchedFileIds,
      appliedFiles,
    };

    const suggestedPrompts = buildSuggestedPromptsFromAppliedFiles(appliedFiles);

    const pendingVerifyPayload = buildPendingVerifyPayload({
      fileIds: touchedFileIds,
      command: "node_verify",
    });

    let finalVerifyPayload: any;
    let verifySummaryText = "";

    try {
      const { verifyPayload } = await runAutoVerifyForRepo({
        repoId,
        verifyCmd: "node_verify",
      });

    for (const fid of touchedFileIds) {
      await setRepoFileStatus(
        repoId,
        fid,
        verifyPayload.ok ? "ok" : "error",
        verifyPayload.ok ? null : (verifyPayload.failureKind ?? "verify_failed"),
        "verify"
      );
    }
      
      finalVerifyPayload = buildFinalVerifyPayload({
        base: verifyPayload,
        fileIds: touchedFileIds,
      });

      try {
        await updateChamberStateDoc(supabase, repoId, {
          activeEngineeringArea: "Verification and repository integrity checks.",
          recentChanges: [
            `Applied multi-file staged change set.`,
            `Auto-verify result: ${verifyPayload.ok ? "PASS" : "FAIL"}.`,
          ],
          immediateNextSteps: verifyPayload.ok
            ? ["Continue implementation or stage the next change."]
            : ["Review verify output and fix failing files before continuing."],
        });
      } catch (e: any) {
        console.log("[chamber-state] apply_set auto-verify update skipped:", e?.message);
        for (const fid of touchedFileIds) {
          await setRepoFileStatus(
            repoId,
            fid,
            "error",
            "verify_internal_error",
            "verify"
          );
        }
      }

      verifySummaryText =
        `\n[Observation]\nAuto verification executed.\n\n` +
        `[Assessment]\ncommand=${finalVerifyPayload.command} ok=${finalVerifyPayload.ok} exitCode=${finalVerifyPayload.exitCode} durationMs=${finalVerifyPayload.durationMs}\n\n` +
        `[Action]\nVerification result recorded.\n`;
    } catch (e: any) {
      finalVerifyPayload = buildFinalVerifyPayload({
        base: {
          command: "node_verify",
          ok: false,
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: e?.message ?? "Auto verify failed",
          jobId: null,
          fingerprint: null,
          failedStep: "verify_boot",
          failureKind: "internal_error",
          timedOut: false,
        },
        fileIds: touchedFileIds,
      });

      verifySummaryText =
        `\n[Observation]\nAuto verification failed.\n\n` +
        `[Assessment]\n${e?.message ?? "Unknown auto-verify error"}\n\n` +
        `[Action]\nReview verify pipeline logs.\n`;
    }

    const txt =
      `[Observation]\nWrites applied.\n\n` +
      `[Assessment]\nMultiple file versions advanced.\n\n` +
      `[Action]\nFiles updated deterministically.\n` +
      `\n__APPLY__:${JSON.stringify(applyPayload)}\n` +
      `\n__VERIFY__:${JSON.stringify(pendingVerifyPayload)}\n` +
      `\n__VERIFY__:${JSON.stringify(finalVerifyPayload)}\n` +
      `\n__SUGGESTED_PROMPTS__:${JSON.stringify(suggestedPrompts)}\n` +
      verifySummaryText;

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  } catch (e: any) {
    return new Response(
      `[Observation]\nApply failed.\n\n[Assessment]\n${e?.message ?? "Unknown error"}\n\n[Action]\nRecreate proposal set.`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

// 🔒 APPLY SHORT-CIRCUIT (deterministic single apply, bypass LLM)
if (content.startsWith("__APPLY__:")) {
  const raw = content.slice("__APPLY__:".length);

  try {
    const proposal = JSON.parse(raw);
    console.log("[apply] keys=", Object.keys(proposal || {}));
    console.log("[apply] meta=", proposal?.meta ?? null);

    const op = proposal?.meta?.op === "create" ? "create" : "overwrite";
    let applied: any;

    if (op === "create") {
      const expected = confirmCreatePhrase(proposal.fileId, proposal.nextHash);
      applied = await vault_apply_create(
        supabase,
        repoId,
        user.id,
        expected,
        { ...proposal, confirm: expected }
      );
    } else {
      const expected = confirmPhrase(proposal.fileId, proposal.nextHash);
      applied = await vault_apply_write(
        supabase,
        repoId,
        user.id,
        expected,
        { ...proposal, confirm: expected }
      );
    }

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: user.id,
      role: "assistant",
      content:
        "[Observation]\nWrite applied.\n\n" +
        "[Assessment]\nThe staged change was confirmed and the file version advanced.\n\n" +
        "[Action]\nNo pending confirmation remains for this applied change.",
    });

    if (proposal?.meta?.kind === "engraving" && Array.isArray(proposal?.meta?.keepIds)) {
      const keepIds = proposal.meta.keepIds.map((x: any) => String(x)).filter(Boolean);

      if (keepIds.length > 0) {
        const supabaseAdmin = createSupabaseAdmin();

        const { count: beforeCount, error: beforeErr } = await supabaseAdmin
          .from("repo_messages")
          .select("id", { count: "exact", head: true })
          .eq("repo_id", repoId);

        if (beforeErr) console.log("[engraving] count(before) failed:", beforeErr.message);

        const { data: delRows, error: listErr } = await supabaseAdmin
          .from("repo_messages")
          .select("id")
          .eq("repo_id", repoId)
          .not("id", "in", `(${keepIds.map((id: string) => `"${id}"`).join(",")})`);

        if (listErr) {
          console.log("[engraving] prune list failed:", listErr.message);
        } else {
          const deleteIds = (delRows ?? []).map((r: any) => String(r.id)).filter(Boolean);

          let actualDeleted = 0;

          if (deleteIds.length > 0) {
            const { data: deletedRows, error: delErr } = await supabaseAdmin
              .from("repo_messages")
              .delete()
              .eq("repo_id", repoId)
              .in("id", deleteIds)
              .select("id");

            if (delErr) {
              console.log("[engraving] prune delete failed:", delErr.message);
            } else {
              actualDeleted = deletedRows?.length ?? 0;
              console.log("[engraving] prune deleted rows:", actualDeleted);
            }
          }

          const { count: afterCount, error: afterErr } = await supabaseAdmin
            .from("repo_messages")
            .select("id", { count: "exact", head: true })
            .eq("repo_id", repoId);

          if (afterErr) console.log("[engraving] count(after) failed:", afterErr.message);

          console.log("[engraving] prune result", {
            repoId,
            keep: keepIds.length,
            candidates: deleteIds.length,
            deleted: actualDeleted,
            before: beforeCount ?? null,
            after: afterCount ?? null,
          });
        }
      }
    }

    const didEngraving = proposal?.meta?.kind === "engraving";

    const touchedFileIds = [String(proposal.fileId)].filter(Boolean);

    const applyPayload = {
      ok: true,
      repoId,
      requestId,
      changeId: typeof proposal?.meta?.changeId === "string" ? proposal.meta.changeId : null,
      touchedFileIds,
      appliedFile: {
        fileId: applied?.fileId ?? String(proposal.fileId),
        path: applied?.path ?? proposal?.path ?? null,
        version: applied?.version ?? null,
        mime: proposal?.mime ?? null,
      },
    };

    try {
      await updateChamberStateDoc(supabase, repoId, {
        activeEngineeringArea: "Applying staged repository changes.",
        importantFiles: [String(applied?.path ?? proposal?.path ?? "repository file")].filter(Boolean),
        recentChanges: [
          `Applied staged change to ${String(applied?.path ?? proposal?.path ?? "a repository file")}.`,
        ],
        immediateNextSteps: [
          "Auto verification is running.",
          "Continue with the next engineering task.",
        ],
      });
    } catch (e: any) {
      console.log("[chamber-state] apply update skipped:", e?.message);
    }

    const suggestedPrompts = buildSuggestedPromptsFromAppliedFiles([
      {
        path: applied?.path ?? proposal?.path ?? null,
        mime: proposal?.mime ?? null,
      },
    ]);

    const pendingVerifyPayload = buildPendingVerifyPayload({
      fileIds: touchedFileIds,
      command: "node_verify",
    });

    let finalVerifyPayload: any;
    let verifySummaryText = "";

    try {
      const { verifyPayload } = await runAutoVerifyForRepo({
        repoId,
        verifyCmd: "node_verify",
      });

      await setRepoFileStatus(
        repoId,
        applied?.fileId ?? proposal.fileId,
        verifyPayload.ok ? "ok" : "error",
        verifyPayload.ok ? null : (verifyPayload.failureKind ?? "verify_failed"),
        "verify"
      );

      finalVerifyPayload = buildFinalVerifyPayload({
        base: verifyPayload,
        fileIds: touchedFileIds,
      });

      try {
        await updateChamberStateDoc(supabase, repoId, {
          activeEngineeringArea: "Verification and repository integrity checks.",
          importantFiles: [String(applied?.path ?? proposal?.path ?? "repository file")].filter(Boolean),
          recentChanges: [
            `Applied staged change to ${String(applied?.path ?? proposal?.path ?? "a repository file")}.`,
            `Auto-verify result: ${verifyPayload.ok ? "PASS" : "FAIL"}.`,
          ],
          immediateNextSteps: verifyPayload.ok
            ? ["Continue implementation or stage the next change."]
            : ["Review verify output and fix failing files before continuing."],
        });
      } catch (e: any) {
        console.log("[chamber-state] single apply auto-verify update skipped:", e?.message);
        await setRepoFileStatus(
          repoId,
          applied?.fileId ?? proposal.fileId,
          "error",
          "verify_internal_error",
          "verify"
        );
      }

      verifySummaryText =
        `\n[Observation]\nAuto verification executed.\n\n` +
        `[Assessment]\ncommand=${finalVerifyPayload.command} ok=${finalVerifyPayload.ok} exitCode=${finalVerifyPayload.exitCode} durationMs=${finalVerifyPayload.durationMs}\n\n` +
        `[Action]\nVerification result recorded.\n`;
    } catch (e: any) {
      finalVerifyPayload = buildFinalVerifyPayload({
        base: {
          command: "node_verify",
          ok: false,
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: e?.message ?? "Auto verify failed",
          jobId: null,
          fingerprint: null,
          failedStep: "verify_boot",
          failureKind: "internal_error",
          timedOut: false,
        },
        fileIds: touchedFileIds,
      });

      verifySummaryText =
        `\n[Observation]\nAuto verification failed.\n\n` +
        `[Assessment]\n${e?.message ?? "Unknown auto-verify error"}\n\n` +
        `[Action]\nReview verify pipeline logs.\n`;
    }

    const txt =
      `[Observation]\nWrite applied.\n\n` +
      `[Assessment]\nVersion advanced.\n\n` +
      `[Action]\nFile updated deterministically.\n` +
      `\n__APPLY__:${JSON.stringify(applyPayload)}\n` +
      `\n__VERIFY__:${JSON.stringify(pendingVerifyPayload)}\n` +
      `\n__VERIFY__:${JSON.stringify(finalVerifyPayload)}\n` +
      `\n__SUGGESTED_PROMPTS__:${JSON.stringify(suggestedPrompts)}\n` +
      verifySummaryText +
      (didEngraving ? `\n__RESET__\n` : "");

    console.log("[apply] didEngraving=", didEngraving);

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return new Response(
      `[Observation]\nApply failed.\n\n[Assessment]\n${e?.message ?? "Unknown error"}\n\n[Action]\nRecreate proposal.`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

// 🔒 Engraving probe (deterministic, bypass LLM)
if (content.trim() === "__ENGRAVE__") {
  try {
    console.log("[engrave_probe] hit", { repoId, userId: user.id });

    const engraving = await maybeSummarizeAndEngraveProposal(
      supabase,
      repoId,
      user.id,
      { force: true }
    );

    const markerLine = engraving?.marker
      ? `\n__ENGRAVING__:${JSON.stringify(engraving.marker)}\n`
      : "";

    const txt =
      `[Observation]\nEngraving probe executed.\n\n` +
      `[Assessment]\nmarker=${Boolean(engraving?.marker)}\n\n` +
      `[Action]\nIf marker=true, UI should render the Engraving panel.\n` +
      markerLine;

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[engrave_probe] error", e?.message);
    return new Response(
      `[Observation]\nEngraving probe failed.\n\n[Assessment]\n${e?.message ?? "Unknown error"}\n\n[Action]\nCheck server logs.\n`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}
// ─────────────────────────────────────────────
// Credits preflight (workspace pool, server-canonical)
// ─────────────────────────────────────────────

// 1) Get workspace_id for this repo
const { data: repoRow, error: repoErr } = await supabase
  .from("repos")
  .select("workspace_id")
  .eq("id", repoId)
  .single();

if (repoErr || !repoRow?.workspace_id) {
  return new Response("Missing workspace", { status: 500 });
}

const workspaceId = repoRow.workspace_id;

// 2) Compute UTC month start as YYYY-MM-01
const now = new Date();
const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  .toISOString()
  .slice(0, 10); // "YYYY-MM-DD"

// 3) Ensure balance row exists + get remaining
const { data: statusRows, error: stErr } = await supabase.rpc("credits_get_status", {
  _workspace_id: workspaceId,
  _period_start: periodStart,
  _grant: tierPolicy.budget.creditsPerPeriod,
  _tier: tierPolicy.tier,
});

if (stErr) {
  console.log("[credits] get_status failed:", stErr.message);
  return new Response("Credits unavailable", { status: 500 });
}

const creditStatus = Array.isArray(statusRows) ? statusRows[0] : statusRows;
const remaining = Number(creditStatus?.remaining ?? 0);

let runtimePolicy = tierPolicy;

// 4) Hard block if exhausted
if (remaining <= 0) {
  return new Response(
    "[Observation]\nCredits exhausted.\n\n[Assessment]\nWorkspace credit balance is depleted for this period.\n\n[Action]\nUpgrade plan or wait for reset.",
    { status: 402, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

// 5) Soft reserve grace mode
if (remaining <= tierPolicy.budget.softReserveCredits) {
  if (tierPolicy.budget.graceMode === "block") {
    return new Response(
      "[Observation]\nCredits below reserve threshold.\n\n[Assessment]\nGrace mode is block.\n\n[Action]\nUpgrade plan or wait for reset.",
      { status: 402, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
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

  // If you want downgrade later, we can add it using TIER_POLICIES.
}

console.log("[credits]", { workspaceId, periodStart, remaining, runtimeTier: runtimePolicy.tier });

  // Sacred memory + profile
  await ensureSacredMemoryFile(supabase, repoId, user.id);
  await ensureUserProfileFile(supabase, repoId, user.id);

  let sacredText = "";
  try {
    const sacred = await vault_read_text(supabase, repoId, SACRED_PATH);
    sacredText = sacred.content || "";
  } catch (e: any) {
    sacredText = "";
    console.log("[sacred] read failed:", e?.message);
  }

  let profileText = "";
  try {
    const profile = await vault_read_text(supabase, repoId, USER_PROFILE_PATH);
    profileText = profile.content || "";
  } catch (e: any) {
    profileText = "";
    console.log("[profile] read failed:", e?.message);
  }

let masterSummary = "";
let chamberState = "";
let pathTree = "";
let ledger = "";

try {
  const { data: memDocs } = await supabase
    .from("repo_memory_docs")
    .select("key, content")
    .eq("repo_id", repoId);

  for (const d of memDocs ?? []) {
    if (d.key === "master-summary") masterSummary = d.content ?? "";
    if (d.key === "chamber-state") chamberState = d.content ?? "";
    if (d.key === "path-tree") pathTree = d.content ?? "";
    if (d.key === "ledger") ledger = d.content ?? "";
  }
} catch (e: any) {
  console.log("[memory] load failed:", e?.message);
}

  const insertUserPromise = supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: user.id,
    role: "user",
    content,
  });

  const historyPromise = supabase
    .from("repo_messages")
    .select("role, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(16);

  const [{ data: history }, insertResult] = await Promise.all([historyPromise, insertUserPromise]);
  if (insertResult.error) return new Response("Failed to save message", { status: 500 });

  const orderedHistory = (history ?? []).slice().reverse();
  const cleanedHistory = orderedHistory.filter((m: any) => {
    if (m.role !== "assistant") return true;

    const text = String(m.content || "").trim();

    return (
      text.startsWith("[Observation]") ||
      text.startsWith("__GOAL_PLAN__:") ||
      text.startsWith("__GOAL_STATUS__:") ||
      text.startsWith("__GOAL_DONE__:")
    );
  });

  const sacredBlock = sacredText.trim()
    ? `=== SACRED_MEMORY (authoritative, user-confirmed) ===\n${sacredText.trim()}\n=== END SACRED_MEMORY ===`
    : `=== SACRED_MEMORY ===\n(empty)\n=== END SACRED_MEMORY ===`;   
  const profileBlock = profileText.trim()
    ? `=== USER_PROFILE (non-personal preferences + observed level) ===\n${profileText.trim()}\n=== END USER_PROFILE ===`
    : `=== USER_PROFILE ===\n(empty)\n=== END USER_PROFILE ===`;

const masterBlock = masterSummary.trim()
  ? `=== MASTER_MEMORY ===\n${masterSummary.trim()}\n=== END MASTER_MEMORY ===`
  : `=== MASTER_MEMORY ===\n(empty)\n=== END MASTER_MEMORY ===`;

const chamberBlock = chamberState.trim()
  ? `=== CHAMBER_STATE ===\n${chamberState.trim()}\n=== END CHAMBER_STATE ===`
  : `=== CHAMBER_STATE ===\n(empty)\n=== END CHAMBER_STATE ===`;

const treeBlock = pathTree.trim()
  ? `=== PATH_TREE ===\n${pathTree.trim()}\n=== END PATH_TREE ===`
  : `=== PATH_TREE ===\n(empty)\n=== END PATH_TREE ===`;

const ledgerBlock = ledger.trim()
  ? `=== ENGINEERING_LEDGER ===\n${ledger.trim()}\n=== END ENGINEERING_LEDGER ===`
  : `=== ENGINEERING_LEDGER ===\n(empty)\n=== END ENGINEERING_LEDGER ===`;

  const membershipBlock =
    `=== MEMBERSHIP_TIER (hard caps, server-enforced) ===\n` +
    `tier: ${tierPolicy.tier}\n` +
    `model: ${tierPolicy.model}\n` +
    `max_output_tokens: ${tierPolicy.output.maxOutputTokens}\n` +
    `max_tool_rounds: ${tierPolicy.tools.maxToolRounds}\n` +
    `capabilities:\n` +
    `- export: ${tierPolicy.capabilities.allowExport}\n` +
    `- multi_export: ${tierPolicy.capabilities.allowMultiExport}\n` +
    `- create_files: ${tierPolicy.capabilities.allowCreateFiles}\n` +
    `- create_trees: ${tierPolicy.capabilities.allowCreateTrees}\n` +
    `RULE: These caps override USER_PROFILE preferences.\n` +
    `=== END MEMBERSHIP_TIER ===`;

try {
  const targetPath = extractSingleMentionedPath(content);

  if (
  targetPath &&
  isNamedFileExecutionRequest(content) &&
  !isMetaRepositoryQuestion(content)
) {
    const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, targetPath);

    if (resolvedId) {
      preReadFile = await vault_read_text(supabase, repoId, resolvedId);

      console.log("[pre-read] loaded target file", {
        repoId,
        path: preReadFile.path,
        fileId: preReadFile.id,
      });
    }
  }
} catch (e: any) {
  console.log("[pre-read] skipped:", e?.message);
}
  
if (preReadFile && isNamedFileExecutionRequest(content)) {
  try {
    const rewritten = await generateRewrittenFileContent({
      openai,
      model: runtimePolicy.model,
      userRequest: content,
      path: preReadFile.path,
      mime: preReadFile.mime,
      currentContent: preReadFile.content,
    });

    if (!rewritten) {
      throw new Error("Model returned empty rewritten content");
    }

    let proposal: any;
    try {
      proposal = await vault_propose_write(
        supabase,
        repoId,
        preReadFile.id,
        rewritten
      );
    } catch (e: any) {
      if (e?.message === "__NOOP_PROPOSAL__") {
        const visible =
          `[Observation]\nI inspected ${preReadFile.path}.\n\n` +
          `[Assessment]\nNo file change is needed.\n\n` +
          `[Action]\nNo staged change was created.`;

        await supabase.from("repo_messages").insert({
          repo_id: repoId,
          user_id: user.id,
          role: "assistant",
          content: visible,
        });

        return new Response(visible, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      throw e;
    }

    const visible =
      "[Observation]\nRequired repository change was staged.\n\n" +
      "[Assessment]\nThe requested file fix was prepared from the current repository content.\n\n" +
      "[Action]\nA staged change is ready. Confirm to apply.";

    let preverifyMarker = "";

    try {
      const proposals = [
        {
          ...proposal,
          path: proposal.path ?? preReadFile.path,
          mime: proposal.mime ?? preReadFile.mime,
          meta: proposal.meta ?? null,
        },
      ];

      if (shouldPreVerifyProposalSet(proposals)) {
        console.log("[fast-path preverify] starting", {
          repoId,
          path: proposal.path ?? preReadFile.path,
          fileId: proposal.fileId,
        });

        const preverify = await runPreVerifyForProposalSet({
          repoId,
          proposals,
        });

        const baselineNoise = isBaselinePreverifyFailure(
          
  baselineVerify.verifyPayload,
  preverify

);console.log("[baseline_classifier]", {
  baselineFailedStep: baselineVerify.verifyPayload.failedStep,
  proposalFailedStep: preverify.failedStep,
  baselineNoise,
});
        console.log("[baseline_classifier input]", {
  failedStep: preverify.failedStep,
  failureKind: preverify.failureKind,
  stderrHead: String(preverify.stderr ?? "").slice(0, 2000),
  stdoutHead: String(preverify.stdout ?? "").slice(0, 1000),
  error: preverify.error ?? null,
});
console.log("[fast-path preverify] stderr head", String(preverify.stderr ?? "").slice(0, 1200));
console.log("[fast-path preverify] stdout head", String(preverify.stdout ?? "").slice(0, 1200));
console.log("[fast-path preverify] baseline?", baselineNoise);
console.log("[fast-path preverify] result", {
  ok: preverify.ok,
  failedStep: preverify.failedStep,
  failureKind: preverify.failureKind,
  baseline: baselineNoise,
  fileIds: preverify.fileIds,
});

        if (!preverify.ok && !baselineNoise) {
          await setRepoFileStatus(
            repoId,
            proposal.fileId,
            "error",
            preverify.failureKind ?? "preverify_failed",
            "preverify"
          );
        }

        if (!preverify.ok && !baselineNoise) {
          console.log("[fast-path repair] attempting repair", {
            failedStep: preverify.failedStep,
            kind: preverify.failureKind,
          });

          const repaired = await attemptFastPathRepair({
            repoId,
            path: proposal.path ?? preReadFile.path,
            fileId: proposal.fileId ?? preReadFile.id,
            failedStep: preverify.failedStep,
            userRequest: content,
            currentContent: proposal.content,
            stdout: String(preverify.stdout ?? ""),
            stderr: String(preverify.stderr ?? ""),
            error: preverify.error ?? null,
          });

          if (repaired?.ok) {
            console.log("[fast-path repair] repair succeeded");

            const repairedRaw =
              typeof repaired.proposal === "string" ? repaired.proposal : "";

            const repairedContent = stripCodeFences(repairedRaw);

            if (!repairedContent) {
              throw new Error("fast-path repair returned empty content");
            }

            const repairedProposal = await vault_propose_write(
              supabase,
              repoId,
              preReadFile.id,
              repairedContent
            );

            console.log("[fast-path repair] reverify starting", {
              repoId,
              path: repairedProposal.path ?? preReadFile.path,
              fileId: repairedProposal.fileId,
            });

            const repairedPreverify = await runPreVerifyForProposalSet({
              repoId,
              proposals: [
                {
                  fileId: repairedProposal.fileId,
                  path: repairedProposal.path ?? preReadFile.path,
                  content: repairedProposal.content,
                  mime: repairedProposal.mime ?? preReadFile.mime,
                  meta: null,
                },
              ],
            });

            const repairedBaseline = isBaselinePreverifyFailure(
              baselineVerify.verifyPayload,
              repairedPreverify
            );

            console.log("[fast-path repair] reverify result", {
              ok: repairedPreverify.ok,
              failedStep: repairedPreverify.failedStep,
              failureKind: repairedPreverify.failureKind,
              baseline: repairedBaseline,
              fileIds: repairedPreverify.fileIds,
            });

            preverifyMarker = `\n__PREVERIFY__:${JSON.stringify({
              ...repairedPreverify,
              baseline: repairedBaseline,
            })}\n`;

            if (!repairedPreverify.ok) {
              console.log("[fast-path] proposal rejected after failed repair");

              await setRepoFileStatus(
                repoId,
                repairedProposal.fileId ?? preReadFile.id,
                "error",
                repairedPreverify.failureKind ?? "repair_reverify_failed",
                "verify"
              );

              return new Response(`${visible}\n\n${preverifyMarker}\n`, {
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              });
            }

            proposal = repairedProposal;

            await setRepoFileStatus(
              repoId,
              proposal.fileId ?? preReadFile.id,
              "pending",
              "verify_running",
              "verify"
            );
          } else {
            console.log("[fast-path repair] repair failed");
          }
        }

        if (!preverifyMarker) {
          preverifyMarker = `\n__PREVERIFY__:${JSON.stringify({
            ...preverify,
            baselineVerify,
          })}\n`;
        }
      }
    } catch (e: any) {
      console.log("[fast-path preverify] failed:", e?.message);

      preverifyMarker = `\n__PREVERIFY__:${JSON.stringify({
        ok: false,
        command: "node_verify",
        exitCode: -1,
        durationMs: 0,
        stdout: "",
        stderr: "",
        error: e?.message ?? "Pre-verify failed",
        failedStep: "preverify_boot",
        failureKind: "internal_error",
        timedOut: false,
        fileIds: [String(proposal.fileId)].filter(Boolean),
        paths: [String(proposal.path ?? preReadFile.path ?? "")].filter(Boolean),
        baseline: false,
      })}\n`;
    }

    return new Response(
      `${visible}\n\n__PROPOSAL__:${JSON.stringify(proposal)}${preverifyMarker}\n`,
      {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  } catch (e: any) {
    console.log("[fast-path rewrite] failed:", e?.message);
  }
}

const createModifyPaths =
  isCreateAndModifyIntent(content)
    ? resolveCreateAndModifyPaths(content)
    : null;

if (createModifyPaths) {
  try {
    const { createPath, modifyPath } = createModifyPaths;

    const createExists = await resolveFileIdByPathOrName(supabase, repoId, createPath);
    const modifyExists = await resolveFileIdByPathOrName(supabase, repoId, modifyPath);

    console.log("[create_modify_short_circuit]", {
      createPath,
      modifyPath,
      createExists: Boolean(createExists),
      modifyExists: Boolean(modifyExists),
    });

    if (!createExists && modifyExists) {
      const existingFile = await vault_read_text(supabase, repoId, modifyExists);

      const newFileContent = await generateNewFileContent({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
        path: createPath,
        mime: inferTextMimeFromPath(createPath),
      });

const createProposal = await vault_propose_create(
  supabase,
  repoId,
  {
    path: createPath,
    content: newFileContent,
    mime: inferTextMimeFromPath(createPath),
  }
);

      const rewritten = await generateRewrittenFileContent({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
        path: existingFile.path,
        mime: existingFile.mime,
        currentContent: existingFile.content,
      });

      const writeProposal = await vault_propose_write(
        supabase,
        repoId,
        existingFile.id,
        rewritten
      );

      const proposals = [createProposal, writeProposal].filter(Boolean);

      let preverifyMarker = "";

      if (shouldPreVerifyProposalSet(proposals)) {
        const result = await finalizeProposalSet({
          openai,
          model: runtimePolicy.model,
          repoId,
          userRequest: content,
          baselineVerifyPayload: baselineVerify.verifyPayload,
          proposals,
        });

        const finalProposalSet = result.repaired ? result.finalProposals : proposals;

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
          "[Action]\nA staged change is ready. Confirm to apply.";

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }

      const visible =
        "[Observation]\nRequired repository changes were staged.\n\n" +
        "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
        "[Action]\nA staged change is ready. Confirm to apply.";

      return new Response(
        `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n${preverifyMarker}`,
        {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }
  } catch (e: any) {
    console.log("[create_modify_short_circuit] failed:", e?.message);
  }
}

const extractToModulePaths =
  isExtractToModuleIntent(content) && !isImportRefactorIntent(content)
    ? resolveExtractToModulePaths(content)
    : null;

if (extractToModulePaths) {
  try {
    const { sourcePath, targetPath } = extractToModulePaths;

    const sourceId = await resolveFileIdByPathOrName(supabase, repoId, sourcePath);
    const targetId = await resolveFileIdByPathOrName(supabase, repoId, targetPath);

    console.log("[extract_to_module_short_circuit]", {
      sourcePath,
      targetPath,
      sourceExists: Boolean(sourceId),
      targetExists: Boolean(targetId),
    });

    if (sourceId) {
      const sourceFile = await vault_read_text(supabase, repoId, sourceId);

      const generated = await generateExtractHelpersResult({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
        sourcePath,
        sourceContent: String(sourceFile.content ?? ""),
        targetPath,
      });

const normalizedOriginalSource = normalizeForNoopCheck(
  String(sourceFile.content ?? "")
);
const normalizedGeneratedSource = normalizeForNoopCheck(String(generated.sourceContent ?? ""));

if (normalizedOriginalSource === normalizedGeneratedSource) {
  throw new Error("Generated source rewrite is identical to the current source file");
}

      if (!generated.targetContent.trim() || !generated.sourceContent.trim()) {
        throw new Error("Model returned empty extraction result");
      }

      let sourceProposal;
console.log("[intent] extractToModulePaths", {
  hit: Boolean(extractToModulePaths),
  resolved: extractToModulePaths,
  text: content,
});
      try {
        sourceProposal = await vault_propose_write(
          supabase,
          repoId,
          sourceFile.id,
          generated.sourceContent
        );
      } catch (e: any) {
        if (e?.message === "__NOOP_PROPOSAL__") {
          const visible =
            `[Observation]\nI inspected ${sourcePath} and ${targetPath}.\n\n` +
            `[Assessment]\nNo file change is needed.\n\n` +
            `[Action]\nNo staged change was created.`;

          await supabase.from("repo_messages").insert({
            repo_id: repoId,
            user_id: user.id,
            role: "assistant",
            content: visible,
          });

          return new Response(visible, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        throw e;
      }

      const targetProposal = targetId
        ? await vault_propose_write(
            supabase,
            repoId,
            targetId,
            generated.targetContent
          )
        : await vault_propose_create(
            supabase,
            repoId,
            {
              path: targetPath,
              content: generated.targetContent,
              mime: inferTextMimeFromPath(targetPath),
            }
          );

      const proposals = [sourceProposal, targetProposal].filter(Boolean);

      const visible =
        "[Observation]\nRequired repository changes were staged.\n\n" +
        "[Assessment]\nThe requested extraction was prepared from the current repository content.\n\n" +
        "[Action]\nA staged change is ready. Confirm to apply.";

      if (shouldPreVerifyProposalSet(proposals)) {
        const result = await finalizeProposalSet({
          openai,
          model: runtimePolicy.model,
          repoId,
          userRequest: content,
          baselineVerifyPayload: baselineVerify.verifyPayload,
          proposals,
        });

        const finalProposalSet = result.repaired ? result.finalProposals : proposals;

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }

      return new Response(
        `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`,
        {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }
  } catch (e: any) {
    console.log("[extract_to_module_short_circuit] failed:", e?.message);
  }
}

const input = [
  { role: "system", content: membershipBlock },
  { role: "system", content: sacredBlock },
  { role: "system", content: profileBlock },

  // 🧠 Vestaryn chamber memory
  { role: "system", content: masterBlock },
  { role: "system", content: chamberBlock },
  { role: "system", content: treeBlock },
  { role: "system", content: ledgerBlock },

  ...cleanedHistory.map((m: any) => ({
    role: m.role,
    content: m.content,
  })),

  { role: "user", content },
];

const { count: totalMsgCount, error: totalCountErr } = await supabase
  .from("repo_messages")
  .select("id", { count: "exact", head: true })
  .eq("repo_id", repoId);

if (totalCountErr) console.log("[maintenance] count failed:", totalCountErr.message);

  const encoder = new TextEncoder();

function emitMaintenanceIfNeeded(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  try {
    const msgCount = Number(totalMsgCount ?? 0);
    const MESSAGE_CAP = 160; // dev test

    const shouldEmit = forceMaintenance || msgCount >= MAINTENANCE_TRIGGER_MSGS;

    if (!shouldEmit) return;

    const payload = forceMaintenance
      ? { type: "recommend_resummarize", reason: "dev_force", count: msgCount, cap: MESSAGE_CAP }
      : { type: "recommend_resummarize", reason: "message_cap", count: msgCount, cap: MESSAGE_CAP };

    console.log("[maintenance] trigger", { repoId, msgCount, cap: MESSAGE_CAP, forceMaintenance });

    controller.enqueue(
      encoder.encode(`\n__MAINTENANCE__:${JSON.stringify(payload)}\n`)
    );

    console.log("[maintenance] emitted", payload);
  } catch (e: any) {
    console.log("[maintenance] emit failed:", e?.message ?? e);
  }
}

function dedupePendingProposals(
  proposals: Array<{
    fileId?: string;
    path?: string | null;
    meta?: any;
    [key: string]: any;
  }>
) {
  const byKey = new Map<string, any>();

  for (const proposal of proposals) {
    const op = String(proposal?.meta?.op ?? "").trim().toLowerCase();
    const fileId = String(proposal?.fileId ?? "").trim();
    const path = String(proposal?.path ?? proposal?.meta?.path ?? "").trim();

    const key =
      op === "create"
        ? (path ? `create:${path}` : "")
        : fileId
          ? `file:${fileId}`
          : path
            ? `path:${path}`
            : "";

    if (!key) continue;
console.log("[proposal_dedupe key]", {
  op,
  fileId,
  path,
  key,
});
    // last proposal wins
    byKey.set(key, proposal);
  }

  return Array.from(byKey.values());
}

function isProbablyBrokenSplitFile(path: string, content: string) {
  const text = String(content ?? "").trim();
  const lower = text.toLowerCase();

  if (!text) {
    return { broken: true, reason: "empty_file" };
  }

  if (text.length < 40) {
    return { broken: true, reason: "too_small" };
  }

  const hasDefaultExport = /\bexport\s+default\s+([A-Za-z0-9_]+)\s*;?/.test(text);
  const defaultExportMatch = text.match(/\bexport\s+default\s+([A-Za-z0-9_]+)\s*;?/);
  const defaultExportName = defaultExportMatch?.[1] ?? null;

  if (hasDefaultExport && defaultExportName) {
    const definesLocally =
      new RegExp(`\\bconst\\s+${defaultExportName}\\b`).test(text) ||
      new RegExp(`\\bfunction\\s+${defaultExportName}\\b`).test(text) ||
      new RegExp(`\\bclass\\s+${defaultExportName}\\b`).test(text);

    const importsName =
      new RegExp(`\\bimport\\s+${defaultExportName}\\b`).test(text) ||
      new RegExp(`\\bimport\\s*\\{[^}]*\\b${defaultExportName}\\b[^}]*\\}`).test(text);

    if (!definesLocally && !importsName) {
      return { broken: true, reason: "dangling_default_export" };
    }
  }

  const placeholderPatterns = [
    "rest of file unchanged",
    "other code remains unchanged",
    "the rest of the file",
    "omitted",
    "...",
  ];

  if (placeholderPatterns.some((p) => lower.includes(p))) {
    return { broken: true, reason: "placeholder_text" };
  }

  return { broken: false as const, reason: null };
}

function validateGeneratedSplitFiles(args: {
  sourcePath: string;
  sourceContent: string;
  targetPaths: string[];
  files: Array<{ path: string; content: string }>;
}) {
  const { sourcePath, sourceContent, targetPaths, files } = args;

  if (!Array.isArray(files) || files.length !== targetPaths.length) {
    return {
      ok: false,
      reason: "target_count_mismatch",
      details: {
        expected: targetPaths.length,
        actual: Array.isArray(files) ? files.length : 0,
      },
    };
  }

  const returnedPaths = files.map((f) => String(f.path ?? "").trim());
  const expectedPaths = targetPaths.map((p) => String(p).trim());

  for (let i = 0; i < expectedPaths.length; i++) {
    if (returnedPaths[i] !== expectedPaths[i]) {
      return {
        ok: false,
        reason: "target_path_mismatch",
        details: {
          expectedPaths,
          returnedPaths,
        },
      };
    }
  }

  const badFiles: Array<{ path: string; reason: string }> = [];

  for (const file of files) {
    const content = String(file.content ?? "");

    if (!content.trim()) {
      badFiles.push({
        path: file.path,
        reason: "empty_content",
      });
      continue;
    }

    const check = isProbablyBrokenSplitFile(file.path, content);
    if (check.broken) {
      badFiles.push({ path: file.path, reason: String(check.reason) });
      continue;
    }

    if (!looksLikeStandaloneModule(file.path, content)) {
      badFiles.push({
        path: file.path,
        reason: "not_standalone_module",
      });
      continue;
    }
  }

  if (badFiles.length > 0) {
    return {
      ok: false,
      reason: "invalid_split_shape",
      details: { badFiles },
    };
  }

  const sourceLen = String(sourceContent ?? "").trim().length;
  const fileLens = files.map((f) => String(f.content ?? "").trim().length);
  const tinyCount = fileLens.filter((n) => n < Math.max(60, Math.floor(sourceLen * 0.08))).length;

  if (files.length >= 2 && tinyCount >= Math.max(1, files.length - 1)) {
    return {
      ok: false,
      reason: "over_fragmented_split",
      details: { fileLens, sourceLen },
    };
  }

  return {
    ok: true as const,
    reason: null,
    details: null,
  };
}

function assertCanonicalProposal(proposal: any) {
  const content = String(proposal?.content ?? "");
  const fileId = String(proposal?.fileId ?? "");
  const nextHash = String(proposal?.nextHash ?? "");
  const op = String(proposal?.meta?.op ?? "");
  const confirm = String(proposal?.confirm ?? "");

  const recomputedHash = sha256(normalizeForNoopCheck(content));
  const expectedConfirm =
    op === "create"
      ? confirmCreatePhrase(fileId, recomputedHash)
      : confirmPhrase(fileId, recomputedHash);

  console.log("[proposal_canonical_check]", {
    fileId,
    path: proposal?.path ?? null,
    op,
    nextHash,
    recomputedHash,
    confirm,
    expectedConfirm,
    contentHead: content.slice(0, 80),
  });

  if (nextHash !== recomputedHash) {
    throw new Error(
      `Non-canonical proposal hash for ${proposal?.path ?? fileId}: expected ${recomputedHash}, got ${nextHash}`
    );
  }

  if (confirm !== expectedConfirm) {
    throw new Error(
      `Non-canonical proposal confirm for ${proposal?.path ?? fileId}`
    );
  }
}

 const stream = new ReadableStream<Uint8Array>({
  async start(controller) {
    let lastResponseId: string | null = null;
    let pendingProposalOuts: any[] = [];
    let fullText = "";
    let hadAnyProposalSet = false;
    let handledSplitTurn = false;
    let firstTokenTime: number | null = null;
    let creditsCharged = false;
    let requestHandledByOrchestration = false;
    let deterministicToolHandled = false;
    let pendingTools: { call_id: string; name: string; arguments: string }[] = [];
    const toolArgsByCallId = new Map<string, string>();
    

    try {
      async function streamResponse(respStream: any, mode: "pass1" | "pass2") {
        let sawToolsThisPass = false;
        let sentAnyDelta = false;

        // pass1 buffers EVERYTHING, pass2 can stream
        let buffer = "";

        for await (const event of respStream) {
          const e: any = event;

          if (
            (e.type === "response.created" || e.type === "response.running") &&
            e.response?.id
          ) {
            lastResponseId = e.response.id;
          }

          if (e.type === "response.output_item.added" && e.item?.type === "function_call") {
            sawToolsThisPass = true;

            const callId = e.item.call_id || e.item.id;
            if (callId) {
              toolArgsByCallId.set(callId, e.item.arguments ?? "");
              pendingTools.push({
                call_id: callId,
                name: e.item.name,
                arguments: e.item.arguments ?? "",
              });
              console.log("[tool] queued", { name: e.item.name, callId });
            }
            continue;
          }

          if (e.type === "response.output_item.done" && e.item?.type === "function_call") {
            const callId = e.item.call_id || e.item.id;
            if (callId) {
              const finalArgs = (e.item.arguments ?? "").toString();
              if (finalArgs) toolArgsByCallId.set(callId, finalArgs);
            }
            continue;
          }

          if (e.type === "response.output_item.done" && e.item?.type === "message") {
            const parts = Array.isArray(e.item.content) ? e.item.content : [];
            for (const p of parts) {
              const txt =
                (typeof p?.text === "string" ? p.text : null) ??
                (typeof p?.output_text === "string" ? p.output_text : null) ??
                (typeof p?.content === "string" ? p.content : null);

              if (!txt) continue;

              if (firstTokenTime === null) {
                firstTokenTime = performance.now();
                console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
              }

            buffer += txt;
            }
            continue;
          }

          if (e.type === "response.function_call_arguments.done") {
            const callId = e.call_id || e.item_id;
            if (callId) {
              const finalArgs = (e.arguments ?? "").toString();
              if (finalArgs) toolArgsByCallId.set(callId, finalArgs);
            }
            continue;
          }

          if (e.type === "response.function_call_arguments.delta") {
            const callId = e.call_id || e.item_id;
            if (callId) {
              toolArgsByCallId.set(
                callId,
                (toolArgsByCallId.get(callId) ?? "") + (e.delta ?? "")
              );
            }
            continue;
          }

          if (e.type === "response.output_text.delta") {
            if (firstTokenTime === null) {
              firstTokenTime = performance.now();
              console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
            }

            sentAnyDelta = true;
            const chunk = e.delta ?? "";
            if (!chunk) continue;

            
              buffer += chunk;
            continue;
          }

          if (e.type === "response.output_text.done") {
            if (sentAnyDelta) continue;
            const txt = e.text ?? "";
            if (!txt) continue;

            if (firstTokenTime === null) {
              firstTokenTime = performance.now();
              console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
            }

            buffer += txt;
            continue;
          }

          if (e.type === "response.completed") {
            const finalText = (e.response?.output_text ?? "").toString();

            if (finalText) {
              buffer += finalText;
            }

            const textForBilling = buffer;

                if (!creditsCharged) {
                  creditsCharged = true;

                  const usage = e.response?.usage ?? null;
                  const inputTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0) || 0;
                  const outputTokens =
                    Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0) || 0;

                  const estimated = inputTokens === 0 && outputTokens === 0;

                  const amount = estimated
                    ? Math.max(1, Math.ceil(textForBilling.length / 4))
                    : Math.max(1, inputTokens + outputTokens);

                  const meta = {
                    requestId,
                    mode,
                    tier: tierPolicy.tier,
                    runtimeTier: runtimePolicy.tier,
                    model: runtimePolicy.model,
                    estimated,
                    inputTokens,
                    outputTokens,
                    responseId: lastResponseId,
                  };

                  if (runtimePolicy.tier === "admin") {
                    controller.enqueue(
                      encoder.encode(
                        `\n__CREDITS__:${JSON.stringify({
                          remaining: 99999999,
                          charged: 0,
                          duplicated: false,
                          requestId,
                        })}\n`
                      )
                    );

                    console.log("[credits] admin tier - skipping deduction", {
                      requestId,
                      repoId,
                      workspaceId,
                      model: runtimePolicy.model,
                      inputTokens,
                      outputTokens,
                      estimated,
                    });
                  } else {
                    const { data: chargeRows, error: chErr } = await supabase.rpc("credits_charge", {
                      _workspace_id: workspaceId,
                      _period_start: periodStart,
                      _request_id: requestId,
                      _amount: amount,
                      _repo_id: repoId,
                      _meta: meta,
                    });

                    if (!chErr) {
                      const charge = Array.isArray(chargeRows) ? chargeRows[0] : chargeRows;

                      controller.enqueue(
                        encoder.encode(
                          `\n__CREDITS__:${JSON.stringify({
                            remaining: Number(charge?.remaining ?? 0),
                            charged: amount,
                            duplicated: Boolean(charge?.duplicated),
                            requestId,
                          })}\n`
                        )
                      );

                      console.log("[credits] charged", {
                        amount,
                        ok: charge?.ok,
                        duplicated: charge?.duplicated,
                        remaining: charge?.remaining,
                      });
                    } else {
                      console.log("[credits] charge failed:", chErr.message);
                    }
                  }
                }

            break;
          }
        }

        return { sawToolsThisPass, buffer };
      }

      let resp = await openai.responses.create({
        model: runtimePolicy.model,
        instructions: resolvedInstructions,
        input,
        tools: TOOLS,
        tool_choice: "auto",
        stream: true,
        max_output_tokens: runtimePolicy.output.maxOutputTokens,
      });

      const pass1 = await streamResponse(resp, "pass1");
      const initialHadTools = pendingTools.length > 0 || pass1.sawToolsThisPass;

      console.log("[pass1] hadTools=", initialHadTools, "bufLen=", pass1.buffer?.length ?? 0);

      if (!initialHadTools) {
        let out = pass1.buffer ?? "";
        out = scrubVisibleToolPayload(out);
        out = ensureTriplet(stripDuplicateTriplet(out));
        out = out.trim();

        if (!hasValidAssistantContract(out)) {
          console.log("[contract] violation: pass1 missing [Observation]");
          out =
            "[Observation]\nContract violation detected.\n\n" +
            "[Assessment]\nAssistant output did not start with [Observation].\n\n" +
            "[Action]\nRetry the request or adjust prompt to conform to the output contract.";
        }

        fullText = out;
        controller.enqueue(encoder.encode(out));
      } else {
        fullText = "";
      }

      console.log("[stream] pass1", {
        pass1SawTools: pass1.sawToolsThisPass,
        pendingTools: pendingTools.length,
        initialHadTools,
      });

      console.log("[stream] pass1 flushed", { len: fullText.length });

 for (let round = 0; round < runtimePolicy.tools.maxToolRounds; round++) {
  if (pendingTools.length === 0) break;

  let toolsToRun = pendingTools;
  pendingTools = [];

  let truncated = false;

  if (toolsToRun.length > runtimePolicy.tools.maxToolCallsPerRound) {
    console.log("[tool] per-round cap exceeded", {
      requested: toolsToRun.length,
      allowed: tierPolicy.tools.maxToolCallsPerRound,
    });

    truncated = true;
    toolsToRun = toolsToRun.slice(0, tierPolicy.tools.maxToolCallsPerRound);
  }

  if (pendingTools.length > 0) {
    console.log("[tool] max rounds reached, terminating deterministically", {
      remaining: pendingTools.length,
      maxRounds: tierPolicy.tools.maxToolRounds,
    });

    const terminationNotice =
      "[Observation]\nTool execution depth limit reached.\n\n" +
      "[Assessment]\nThe current tier does not allow additional tool rounds.\n\n" +
      "[Action]\nRefine the request or upgrade tier for deeper operations.";

    controller.enqueue(encoder.encode(terminationNotice));
    fullText = terminationNotice;
  }

  const toolOutputs: any[] = [];

  for (const tool of toolsToRun) {
    const callId = tool.call_id;
    const toolName = tool.name;

    if (truncated) {
      toolOutputs.push({
        type: "function_call_output",
        call_id: "tier_cap_notice",
        output: JSON.stringify({
          error: "Tool call limit per round exceeded for this tier.",
          code: "TIER_TOOL_ROUND_LIMIT",
          allowed: runtimePolicy.tools.maxToolCallsPerRound,
        }),
      });
    }

    let argsJson = (toolArgsByCallId.get(callId) ?? tool.arguments ?? "").trim();

    if (!argsJson) {
      if (toolName === "vault_list_files") {
        argsJson = "{}";
      } else {
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ error: `Empty arguments for ${toolName}` }),
        });
        continue;
      }
    }

    console.log("[tool] args", { toolName, callId, argsJson });

    let parsedArgs: any;
    try {
      parsedArgs = JSON.parse(argsJson);
    } catch {
      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ error: `Invalid JSON arguments for ${toolName}` }),
      });
      continue;
    }

    if (toolName === "vault_propose_write" && !tierPolicy.capabilities.allowCreateFiles) {
      const path = String(parsedArgs?.path ?? "").trim();

      if (path) {
        const { data: existsRows, error: existsErr } = await supabase
          .from("repo_files")
          .select("id")
          .eq("repo_id", repoId)
          .eq("path", path)
          .is("deleted_at", null)
          .limit(1);

        if (existsErr) {
          toolOutputs.push({
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              error: `file existence check failed: ${existsErr.message}`,
            }),
          });
          continue;
        }

        const exists = (existsRows?.length ?? 0) > 0;

        if (!exists) {
          toolOutputs.push({
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              error:
                "This tier cannot create new files from scratch. Ask to modify an existing file or upgrade to Pro.",
              code: "TIER_CREATE_FILE_BLOCKED",
              path,
            }),
          });

          if (truncated) {
            toolOutputs.push({
              type: "function_call_output",
              call_id: "tier_cap_notice",
              output: JSON.stringify({
                error: "Tool call limit per round exceeded for this tier.",
                code: "TIER_TOOL_ROUND_LIMIT",
                allowed: tierPolicy.tools.maxToolCallsPerRound,
              }),
            });
          }

          continue;
        }
      }
    }

    if (toolName === "vault_propose_create" && !tierPolicy.capabilities.allowCreateFiles) {
      const path = String(parsedArgs?.path ?? "").trim();
      const blocked = {
        error:
          "This tier cannot create new files from scratch. Ask to modify an existing file or upgrade to Pro.",
        code: "TIER_CREATE_FILE_BLOCKED",
        path,
      };

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(blocked),
      });

      if (truncated) {
        toolOutputs.push({
          type: "function_call_output",
          call_id: "tier_cap_notice",
          output: JSON.stringify({
            error: "Tool call limit per round exceeded for this tier.",
            code: "TIER_TOOL_ROUND_LIMIT",
            allowed: tierPolicy.tools.maxToolCallsPerRound,
          }),
        });
      }

      continue;
    }

    if (toolName === "export_chat" && !tierPolicy.capabilities.allowExport) {
      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          error: "Export is not available on this tier.",
          code: "TIER_EXPORT_BLOCKED",
        }),
      });
      continue;
    }

    if (toolName === "export_multi" && !tierPolicy.capabilities.allowMultiExport) {
      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          error: "Multi-export is not available on this tier.",
          code: "TIER_MULTI_EXPORT_BLOCKED",
        }),
      });
      continue;
    }

    const out = await runTool(
      supabase,
      repoId,
      user.id,
      content,
      toolName,
      parsedArgs,
      
    );

    // ─────────────────────────────────────────────
    // Deterministic create+modify orchestration
    // Example: create components/X.tsx and use it in app/page.tsx
    // ─────────────────────────────────────────────
    if (
      toolName === "vault_list_files" &&
      isCreateAndModifyIntent(content) &&
      out &&
      typeof out === "object" &&
      !("error" in out)
    ) {
      if (requestHandledByOrchestration) {
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        });
        continue;
      }
      const paths = extractMentionedPaths(content);
  
      const createPath = paths.find((p) => p.startsWith("components/"));
      const modifyPath = paths.find((p) => p !== createPath);

      const files = Array.isArray((out as any).files) ? (out as any).files : [];
      const existingPaths = new Set(files.map((f: any) => String(f.path)));

      if (
        createPath &&
        modifyPath &&
        !existingPaths.has(createPath) &&
        existingPaths.has(modifyPath)
      ) {
        const newFileContent = await generateNewFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: createPath,
          mime: inferTextMimeFromPath(createPath),
        });

        const createProposal = await runTool(
          supabase,
          repoId,
          user.id,
          content,
          "vault_propose_create",
          {
            path: createPath,
            content: newFileContent,
            mime: inferTextMimeFromPath(createPath),
          },
          
        );

        if (createProposal && typeof createProposal === "object" && !("error" in createProposal)) {
          pendingProposalOuts.push(createProposal);
        }

        const existingFile = await runTool(
          supabase,
          repoId,
          user.id,
          content,
          "vault_read_text",
          { path: modifyPath },
          
        );

        if (existingFile && typeof existingFile === "object" && !("error" in existingFile)) {

          const rewritten = await generateRewrittenFileContent({
            openai,
            model: runtimePolicy.model,
            userRequest: content,
            path: String((existingFile as any).path ?? modifyPath),
            mime: String((existingFile as any).mime ?? "text/plain"),
            currentContent: String((existingFile as any).content ?? ""),
          });

          const writeProposal = await runTool(
            supabase,
            repoId,
            user.id,
            content,
            "vault_propose_write",
            {
              fileId: (existingFile as any).id,
              content: rewritten,
            },
            
          );

          if (writeProposal && typeof writeProposal === "object" && !("error" in writeProposal)) {
            pendingProposalOuts.push(writeProposal);

          }
        }

        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        });

        continue;
      }
    }

// ─────────────────────────────────────────────
// Deterministic split-file orchestration
// Example:
// Split app/test/test-script.js into:
// - vault.js
// - demo.js
// ─────────────────────────────────────────────



if (
  toolName === "vault_read_text" &&
  isSplitFileIntent(content) &&
  !isCreateAndModifyIntent(content) &&
  out &&
  typeof out === "object" &&
  !("error" in out)
) {
  const readOut = out as {
    id: string;
    path?: string;
    mime?: string;
    content: string;
  };

  const mentionedPaths = extractMentionedPaths(content);
  const splitTargets = extractSplitTargets(content);

  const sourcePathForSplit =
    mentionedPaths.find((p) => !splitTargets.includes(p)) ??
    mentionedPaths[0] ??
    null;

  if (!isSplitReadAllowed(sourcePathForSplit, readOut.path ?? null)) {
    console.log("[split_guard] blocked unrelated read", {
      sourcePath: sourcePathForSplit,
      attempted: readOut.path ?? null,
    });

    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        error: "Split operation restricted to the target file only.",
      }),
    });

    continue;
  }
if (isExtractToModuleIntent(content)) {
  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });
  continue;
}
  if (typeof readOut.id === "string" && typeof readOut.content === "string") {
    try {
      const sourcePath = String(readOut.path ?? "").trim();
      const sourceDir =
        sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";

let targetNames = extractSplitTargets(content);

if (targetNames.length < 2) {
  const requestedCount = extractRequestedSplitCount(content) ?? 2;

  console.log("[split_orchestration] deriving default targets", {
    sourcePath,
    requestedCount,
  });

  targetNames = deriveDefaultSplitTargets(sourcePath, requestedCount).map((p) =>
    p.split("/").pop() ?? p
  );
}
if (
  toolName === "vault_read_text" &&
  isSplitFileIntent(content) &&
  out &&
  typeof out === "object" &&
  !("error" in out)
) {
  const readOut = out as {
    id: string;
    path?: string;
    mime?: string;
    content: string;
  };

  const mentionedPaths = extractMentionedPaths(content);
  const explicitTargets = extractSplitTargets(content);

  const sourcePathForSplit =
    mentionedPaths.find((p) => !explicitTargets.includes(p)) ??
    mentionedPaths[0] ??
    null;

  if (handledSplitTurn) {
    console.log("[split_guard] skipping extra split read after turn already handled", {
      sourcePath: sourcePathForSplit,
      attempted: readOut.path ?? null,
    });

    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        skipped: true,
        reason: "split_already_handled",
        path: readOut.path ?? null,
      }),
    });

    continue;
  }

  if (!isSplitReadAllowed(sourcePathForSplit, readOut.path ?? null)) {
    console.log("[split_guard] blocked unrelated read", {
      sourcePath: sourcePathForSplit,
      attempted: readOut.path ?? null,
    });

    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        skipped: true,
        reason: "split_read_blocked",
        path: readOut.path ?? null,
      }),
    });

    continue;
  }

  try {
    const sourcePath = String(readOut.path ?? "").trim();

    let targetPaths = extractSplitTargets(content);

    if (targetPaths.length < 2) {
      const requestedCount = extractRequestedSplitCount(content) ?? 2;

      console.log("[split_orchestration] deriving default targets", {
        sourcePath,
        requestedCount,
      });

      targetPaths = deriveDefaultSplitTargets(sourcePath, requestedCount);
    }

const generatedFiles = await generateSplitFileContents({
  openai,
  model: runtimePolicy.model,
  userRequest: content,
  sourcePath,
  sourceContent: String(readOut.content ?? ""),
  targetPaths,
});

const splitValidation = validateGeneratedSplitFiles({
  sourcePath,
  sourceContent: String(readOut.content ?? ""),
  targetPaths,
  files: generatedFiles,
});

if (!splitValidation.ok) {
  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify({
      error: `split_validation_failed: ${splitValidation.reason}`,
      details: splitValidation.details ?? null,
    }),
  });

  continue;
}

const localSplitProposals: any[] = [];

for (const file of generatedFiles) {
  const existingId = await resolveFileIdByPathOrName(supabase, repoId, file.path);

  const proposal = existingId
    ? await runTool(
        supabase,
        repoId,
        user.id,
        content,
        "vault_propose_write",
        {
          fileId: existingId,
          path: file.path,
          content: file.content,
        }
      )
    : await runTool(
        supabase,
        repoId,
        user.id,
        content,
        "vault_propose_create",
        {
          path: file.path,
          content: file.content,
          mime: inferTextMimeFromPath(file.path),
        }
      );

  if (!proposal || typeof proposal !== "object" || "error" in proposal || (proposal as any).noop) {
    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        error: "split_proposal_failed",
        details: {
          path: file.path,
          proposal: proposal ?? null,
        },
      }),
    });

    continue;
  }

  localSplitProposals.push(proposal);
}

if (localSplitProposals.length !== generatedFiles.length) {
  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify({
      error: "split_incomplete_proposal_set",
      details: {
        expected: generatedFiles.length,
        actual: localSplitProposals.length,
        targetPaths,
      },
    }),
  });

  continue;
}

const splitShouldPreverify = shouldPreVerifyProposalSet(localSplitProposals);

console.log("[split_preverify] proposal_count", localSplitProposals.length);
console.log("[split_preverify] should_run", splitShouldPreverify);
console.log(
  "[split_preverify] proposal_paths",
  localSplitProposals.map((p) => String(p?.path ?? p?.meta?.path ?? ""))
);

if (splitShouldPreverify) {
  console.log("[split_preverify] starting");

  const result = await finalizeProposalSet({
    openai,
    model: runtimePolicy.model,
    repoId,
    userRequest: content,
    baselineVerifyPayload: baselineVerify.verifyPayload,
    proposals: localSplitProposals,
  });

  controller.enqueue(
    encoder.encode(
      `\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`
    )
  );

  if (!result.preverifyPayload?.ok && !result.preverifyPayload?.baseline) {
    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        error: "split_preverify_failed",
        details: result.preverifyPayload,
      }),
    });

    continue;
  }

  localSplitProposals.length = 0;
  localSplitProposals.push(...result.finalProposals);
}
    pendingProposalOuts.push(...localSplitProposals);
    handledSplitTurn = true;

    console.log("[split_orchestration]", {
      sourcePath,
      targetPaths,
      generatedCount: generatedFiles.length,
    });

    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        ok: true,
        handled: "split",
        sourcePath,
        targetPaths,
      }),
    });

    continue;
  } catch (e: any) {
    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        error: `split_orchestration_failed: ${e?.message ?? "unknown error"}`,
      }),
    });

    continue;
  }
}

const requestedPaths = extractMentionedPaths(content);
      if (
        toolName === "vault_read_text" &&
        isImportRefactorIntent(content) &&
        !/\bcreate\b/i.test(content) &&
        !/\bmove\b/i.test(content) &&
        !/\bextract\b/i.test(content) &&
        !/\bthen update\b/i.test(content) &&
        requestedPaths.length >= 2 &&
        out &&
        typeof out === "object" &&
        !("error" in out)
      ) {
        const readOut = out as {
          id: string;
          path?: string;
          mime?: string;
          content: string;
        };

const readPath = String(readOut.path ?? "").trim();

const sourcePath = requestedPaths[0] ?? "";
const helperPath = requestedPaths.find((p) => p !== sourcePath) ?? "";

if (!sourcePath || !helperPath) {
  console.log("[import_refactor_guard] skipped because source/helper could not be resolved", {
    requestedPaths,
    readPath,
  });

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  continue;
}

if (readPath !== sourcePath) {
  console.log("[import_refactor_guard] blocked non-source read", {
    requestedPaths,
    sourcePath,
    helperPath,
    readPath,
  });

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  continue;
}

if (!helperPath) {
  console.log("[import_refactor_guard] skipped because helper path could not be resolved", {
    requestedPaths,
    readPath,
  });

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  continue;
}

const sourceExists = await resolveFileIdByPathOrName(supabase, repoId, sourcePath);
const helperExists = await resolveFileIdByPathOrName(supabase, repoId, helperPath);

console.log("[import_refactor_orchestration] detected", {
  sourcePath,
  helperPath,
  readPath,
  sourceExists: Boolean(sourceExists),
  helperExists: Boolean(helperExists),
});

if (!sourceExists || !helperExists) {
  console.log("[import_refactor_guard] skipped because one or more requested paths do not already exist", {
    sourcePath,
    helperPath,
    sourceExists: Boolean(sourceExists),
    helperExists: Boolean(helperExists),
  });

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  continue;
}

        if (readPath !== sourcePath) {
          toolOutputs.push({
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(out),
          });
          continue;
        }

        const helperRead = await runTool(
          supabase,
          repoId,
          user.id,
          content,
          "vault_read_text",
          { path: helperPath },
          
        );

        if (!helperRead || typeof helperRead !== "object" || "error" in helperRead) {
          toolOutputs.push({
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(helperRead ?? { error: `Failed to read helper module: ${helperPath}` }),
          });
          continue;
        }

        const rewritten = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content + "\n\nRewrite the file and output the full updated file content only.",
          path: sourcePath,
          mime: String(readOut.mime ?? "application/typescript"),
          currentContent: String(readOut.content ?? ""),
        });

        if (!rewritten) {
          toolOutputs.push({
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ error: "import_refactor_failed: empty rewritten content" }),
          });
          continue;
        }

 const proposal = await runTool(
  supabase,
  repoId,
  user.id,
  content,
  "vault_propose_write",
  {
    fileId: readOut.id,
    content: rewritten,
  },
);

if (proposal && typeof proposal === "object" && !("error" in proposal)) {

  if ((proposal as any).noop === true) {
    const noopText =
      "[Observation]\nThe requested file already reflects this goal step.\n\n" +
      `[Assessment]\nNo staged change was needed because ${readOut.path} already contains the requested update.\n\n` +
      "[Action]\nContinue to the next goal step.";

    deterministicToolHandled = true;
    fullText = noopText;

    controller.enqueue(encoder.encode(noopText));

    continue;
  }

  pendingProposalOuts.push(proposal);
}

toolOutputs.push({
  type: "function_call_output",
  call_id: callId,
  output: JSON.stringify(out),
});

continue;
      }

    } catch (e: any) {
      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          error: `split_orchestration_failed: ${e?.message ?? "unknown error"}`,
        }),
      });

      continue;
    }
  }
}

// ─────────────────────────────────────────────
// Source → Target helper extraction / extract orchestration
// ─────────────────────────────────────────────
if (
  toolName === "vault_read_text" &&
  isSourceTargetTransferIntent(content) &&
  out &&
  typeof out === "object" &&
  !("error" in out)
) {
  const readOut = out as {
    id: string;
    path?: string;
    mime?: string;
    content: string;
  };

  if (typeof readOut.content === "string") {
    try {
      const resolvedPaths = resolveSourceAndTargetPaths(content);

      if (!resolvedPaths) {
        console.log("[extract_orchestration] could not resolve source/target", {
          mentionedPaths: extractMentionedPaths(content),
          content,
        });

        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        });

        continue;
      }

      const { sourcePath, targetPath, paths: mentionedPaths } = resolvedPaths;
      if (!targetPath.includes("/")) {
        throw new Error(`extract_orchestration_failed: target path is not specific enough (${targetPath})`);
      }

      const readPath = String(readOut.path ?? "").trim();
      const readName = readPath.split("/").filter(Boolean).pop() ?? "";
      const sourceName = String(sourcePath ?? "")
        .trim()
        .split("/")
        .filter(Boolean)
        .pop() ?? "";

      const sourceMatchesRead =
        !!readPath &&
        (sourcePath === readPath || sourcePath === readName || sourceName === readName);

      if (!sourceMatchesRead) {
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        });

        continue;
      }

      console.log("[extract_orchestration] detected", {
        sourcePath,
        targetPath,
        mentionedPaths,
      });

const generated = await generateExtractHelpersResult({
  openai,
  model: runtimePolicy.model,
  userRequest: content,
  sourcePath,
  sourceContent: String(readOut.content ?? ""),
  targetPath,
});

if (!generated?.targetContent?.trim() || !generated?.sourceContent?.trim()) {
  throw new Error("Model returned empty extraction result");
}

const sourceText = String(generated?.sourceContent ?? "");
const targetText = String(generated?.targetContent ?? "");
const originalSourceText = String(readOut.content ?? "");

const placeholderPatterns = [
  "rest of file unchanged",
  "other code remains unchanged",
  "the rest of the file",
  "omitted",
  "...",
];

const lowerSource = sourceText.toLowerCase();

if (placeholderPatterns.some((p) => lowerSource.includes(p))) {
  throw new Error("Source rewrite contains placeholder text instead of full file content");
}

if (sourceText.length < originalSourceText.length * 0.4) {
  throw new Error("Source rewrite is too small relative to original file");
}

const targetFileName = (targetPath ?? "").split("/").pop() || targetPath || "";
const targetBaseName = targetFileName.replace(/\.[^.]+$/, "");
const targetDir = targetPath.includes("/")
  ? targetPath.slice(0, targetPath.lastIndexOf("/"))
  : "";
const sourceDir = sourcePath.includes("/")
  ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
  : "";

const targetImportBase =
  sourceDir && targetDir && sourceDir === targetDir
    ? `./${targetBaseName}`
    : targetBaseName;

const escapedImportBase = targetImportBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapedFileName = targetFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapedBaseName = targetBaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sourceWithoutImports = sourceText.replace(
  /^import[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm,
  ""
);

const hasTargetReference =
  new RegExp(`from\\s+['"]${escapedImportBase}['"]`).test(sourceText) ||
  new RegExp(`from\\s+['"]${escapedImportBase}\\.ts['"]`).test(sourceText) ||
  new RegExp(`from\\s+['"]${escapedFileName}['"]`).test(sourceText) ||
  new RegExp(`\\b${escapedBaseName}\\b`).test(sourceWithoutImports);

if (!hasTargetReference) {
  throw new Error(`Source rewrite did not reference ${targetFileName}`);
}

console.log("[extract_orchestration] generated", {
  sourcePath,
  targetPath,
  sourceBytes: Buffer.byteLength(generated.sourceContent, "utf8"),
  targetBytes: Buffer.byteLength(generated.targetContent, "utf8"),
});

      const existingTargetId = await resolveFileIdByPathOrName(
        supabase,
        repoId,
        targetPath
      );

      let existingTargetText = "";

      if (existingTargetId) {
        const existingTargetFile = await vault_read_text(
          supabase,
          repoId,
          existingTargetId
        );

        existingTargetText = String(existingTargetFile.content ?? "");
      }

      const targetProposal = existingTargetId
        ? await runTool(
            supabase,
            repoId,
            user.id,
            content,
            "vault_propose_write",
            {
              fileId: existingTargetId,
              path: targetPath,
              content: generated.targetContent,
            }
          )
        : await runTool(
            supabase,
            repoId,
            user.id,
            content,
            "vault_propose_create",
            {
              path: targetPath,
              content: generated.targetContent,
              mime: inferTextMimeFromPath(targetPath),
            }
          );

      const sourceProposal = await runTool(
        supabase,
        repoId,
        user.id,
        content,
        "vault_propose_write",
        {
          fileId: readOut.id,
          path: sourcePath,
          content: generated.sourceContent,
        }
      );

      const targetIsUsable =
        targetProposal &&
        typeof targetProposal === "object" &&
        !("error" in targetProposal) &&
        !(targetProposal as any).noop;

      const sourceIsUsable =
        sourceProposal &&
        typeof sourceProposal === "object" &&
        !("error" in sourceProposal) &&
        !(sourceProposal as any).noop;

      let allowTargetNoop = false;
      let allowSourceNoop = false;

      if (!targetIsUsable) {
        const normalizedExistingTarget = normalizeForNoopCheck(existingTargetText);
        const normalizedGeneratedTarget = normalizeForNoopCheck(
          String(generated.targetContent ?? "")
        );

        const targetAlreadyMatches =
          !!existingTargetText &&
          normalizedExistingTarget === normalizedGeneratedTarget;

        if (!targetAlreadyMatches) {
          throw new Error("Target extraction proposal was empty or noop");
        }

        allowTargetNoop = true;

        console.log("[extract_orchestration] target noop accepted", {
          sourcePath,
          targetPath,
          reason: "target already matches extracted module",
        });
      }

      if (!sourceIsUsable) {
        const sourceStillNeedsRewrite = sourceStillLooksUnextracted(
          String(readOut.content ?? ""),
          targetPath
        );

        if (sourceStillNeedsRewrite) {
          throw new Error(
            "Source rewrite was noop; extraction did not actually modify the source file"
          );
        }

        allowSourceNoop = true;

        console.log("[extract_orchestration] source noop accepted", {
          sourcePath,
          targetPath,
          reason: "source already references extracted module",
        });
      }

function targetStillLooksExtracted(text: string) {
  return (
    /\bcardBaseStyle\b/.test(text) &&
    /\bcardHoverStyle\b/.test(text)
  );
}

if (!targetIsUsable) {
  const targetStillValid = targetStillLooksExtracted(
    String(generated.targetContent ?? "")
  );

  if (!targetStillValid) {
    throw new Error("Target extraction proposal was empty or noop");
  }

}

if (!sourceIsUsable) {
  const sourceStillNeedsRewrite = sourceStillLooksUnextracted(
    String(readOut.content ?? ""),
    targetPath
  );

  if (sourceStillNeedsRewrite) {
    throw new Error(
      "Source rewrite was noop; extraction did not actually modify the source file"
    );
  }

  console.log("[extract_orchestration] source noop accepted", {
    sourcePath,
    targetPath,
    reason: "source already references extracted module",
  });
}


function sourceStillLooksUnextracted(sourceContent: string, targetPath: string) {
  const text = String(sourceContent ?? "");
  const targetFileName = targetPath.split("/").pop() ?? targetPath;
  const targetBaseName = targetFileName.replace(/\.[^.]+$/, "");

  const lower = text.toLowerCase();
  const targetBaseLower = targetBaseName.toLowerCase();

  const referencesTarget =
    lower.includes(`./${targetBaseLower}`) ||
    lower.includes(targetBaseLower);

  const stillDefinesStyleObjects =
    /\bconst\s+cardBaseStyle\b/.test(text) ||
    /\bconst\s+cardHoverStyle\b/.test(text) ||
    /\bcardBaseStyle\s*=\s*\{/.test(text) ||
    /\bcardHoverStyle\s*=\s*\{/.test(text);

  return stillDefinesStyleObjects || !referencesTarget;
}

if (!sourceIsUsable) {
const sourceStillNeedsRewrite = sourceStillLooksUnextracted(
  String(readOut.content ?? ""),
  targetPath
);

  if (sourceStillNeedsRewrite) {
    throw new Error(
      "Source rewrite was noop; extraction did not actually modify the source file"
    );
  }

  console.log("[extract_orchestration] source noop accepted", {
    sourcePath,
    targetPath,
    reason: "source already references extracted module",
  });
}

if (
  !targetIsUsable &&
  !sourceIsUsable &&
  allowTargetNoop &&
  allowSourceNoop
) {
  console.log("[extract_orchestration] extraction already satisfied", {
    sourcePath,
    targetPath,
  });

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  continue;
}

if (
  !targetIsUsable &&
  !sourceIsUsable &&
  !allowTargetNoop &&
  !allowSourceNoop
) {
  throw new Error(
    "Extraction produced no effective change in either source or target"
  );
}

if (targetIsUsable) {
  pendingProposalOuts.push(targetProposal);
}

if (sourceIsUsable) {
  pendingProposalOuts.push(sourceProposal);
}

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      });

      continue;
    } catch (e: any) {
      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          error: `extract_orchestration_failed: ${e?.message ?? "unknown error"}`,
        }),
      });

      continue;
    }
  }
}

if (
  toolName === "vault_read_text" &&
  isCreateAndModifyIntent(content) &&
  out &&
  typeof out === "object" &&
  !("error" in out)
) {
  const readOut = out as {
    id: string;
    path?: string;
    mime?: string;
    content: string;
  };

  const mentionedPaths = extractMentionedPaths(content);
  const readPath = String(readOut.path ?? "").trim();

  const createPath =
    mentionedPaths.find((p) => p !== readPath) ?? "";

  const modifyPath = readPath;

  if (!createPath || !modifyPath) {
    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(out),
    });
    continue;
  }

  const createExists = await resolveFileIdByPathOrName(supabase, repoId, createPath);
  const modifyExists = await resolveFileIdByPathOrName(supabase, repoId, modifyPath);

  console.log("[create_modify_read_orchestration] detected", {
    createPath,
    modifyPath,
    createExists: Boolean(createExists),
    modifyExists: Boolean(modifyExists),
    readPath,
  });

  if (createExists || !modifyExists) {
    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(out),
    });
    continue;
  }

requestHandledByOrchestration = true;

  try {
    const newFileContent = await generateNewFileContent({
      openai,
      model: runtimePolicy.model,
      userRequest: content,
      path: createPath,
      mime: inferTextMimeFromPath(createPath),
    });

    const createProposal = await runTool(
      supabase,
      repoId,
      user.id,
      content,
      "vault_propose_create",
      {
        path: createPath,
        content: newFileContent,
        mime: inferTextMimeFromPath(createPath),
      }
    );

    if (
      createProposal &&
      typeof createProposal === "object" &&
      !("error" in createProposal) &&
      !(createProposal as any).noop
    ) {
      pendingProposalOuts.push(createProposal);
    }

    const rewritten = await generateRewrittenFileContent({
      openai,
      model: runtimePolicy.model,
      userRequest: content,
      path: modifyPath,
      mime: String(readOut.mime ?? "text/plain"),
      currentContent: String(readOut.content ?? ""),
    });

    const writeProposal = await runTool(
      supabase,
      repoId,
      user.id,
      content,
      "vault_propose_write",
      {
        fileId: readOut.id,
        path: modifyPath,
        content: rewritten,
      }
    );

    if (
      writeProposal &&
      typeof writeProposal === "object" &&
      !("error" in writeProposal) &&
      !(writeProposal as any).noop
    ) {
      pendingProposalOuts.push(writeProposal);
    }

requestHandledByOrchestration = true;

toolOutputs.push({
  type: "function_call_output",
  call_id: callId,
  output: JSON.stringify(out),
});

continue;

    continue;
  } catch (e: any) {
    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        error: `create_modify_read_orchestration_failed: ${e?.message ?? "unknown error"}`,
      }),
    });

    continue;
  }
}

// ─────────────────────────────────────────────
// Deterministic rewrite orchestration for existing files
// ─────────────────────────────────────────────
const isEditIntent = isRepositoryExecutionIntent(content);

if (
  toolName === "vault_read_text" &&
  isEditIntent &&
  !isSourceTargetTransferIntent(content) &&
  out &&
  typeof out === "object" &&
  !("error" in out)
) {
  const readOut = out as {
    id: string;
    path?: string;
    mime?: string;
    content: string;
  };

  if (typeof readOut.id === "string" && typeof readOut.content === "string") {
    const requestedPath = extractSingleMentionedPath(content);

if (requestedPath && readOut.path && requestedPath !== readOut.path) {
  console.log("[rewrite_orchestration] skipped because requested path does not match read path", {
    requestedPath,
    readPath: readOut.path,
  });

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  continue;
}

    const requestedPaths = extractMentionedPaths(content);

    const isMultiPath = requestedPaths.length >= 2;
    const hasRewriteTarget = Boolean(readOut?.path);

    if (isMultiPath && !isImportRefactorIntent(content) && !hasRewriteTarget) {
      console.log("[rewrite_orchestration] skipped because multiple paths were requested", {
        requestedPaths,
        readPath: readOut.path,
      });

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      });

      continue;
    }
if (
  /\bcreate\b/i.test(content) ||
  /\bmove\b/i.test(content) ||
  /\bextract\b/i.test(content) ||
  /\bthen update\b/i.test(content)
) {
  console.log("[rewrite_orchestration] skipped for create/move/extract request", {
    content,
    requestedPaths,
    readPath: readOut.path,
  });

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  continue;
}

console.log("[rewrite_orchestration] triggered", {
  paths: requestedPaths,
  readPath: readOut.path,
});

    try {
      const rewritten = await generateRewrittenFileContent({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
        path: String(readOut.path ?? ""),
        mime: String(readOut.mime ?? "text/plain"),
        currentContent: String(readOut.content ?? ""),
      });

      if (!rewritten) {
        throw new Error("Model returned empty rewritten content");
      }

      const proposal = await runTool(
        supabase,
        repoId,
        user.id,
        content,
        "vault_propose_write",
        {
          fileId: readOut.id,
          content: rewritten,
        },
        
      );

      if (proposal && typeof proposal === "object" && !("error" in proposal)) {
        pendingProposalOuts.push(proposal);
      }

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      });

      continue;
    } catch (e: any) {
      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          error: `rewrite_orchestration_failed: ${e?.message ?? "unknown error"}`,
        }),
      });

      continue;
    }
  }
}
const hasError = typeof out === "object" && out !== null && "error" in out;
const isNoop = typeof out === "object" && out !== null && (out as any).noop === true;

const isProposalTool =
  toolName === "vault_propose_write" ||
  toolName === "vault_propose_append" ||
  toolName === "vault_propose_create";
  
const isFallbackCreate =
  toolName === "vault_propose_write" &&
  out &&
  typeof out === "object" &&
  (out as any).fallback === "create";

if (
  isProposalTool &&
  out &&
  !hasError &&
  !isNoop &&
  !(isCreateAndModifyIntent(content) && isFallbackCreate)
) {
  pendingProposalOuts.push(out);
}

if (
  toolName === "vault_propose_create" &&
  out &&
  typeof out === "object" &&
  !("error" in out) &&
  isCreateAndModifyIntent(content) &&
  !requestHandledByOrchestration
  
) {
  const created = out as {
    fileId: string;
    path?: string;
    mime?: string;
    content?: string;
  };

  const mentionedPaths = extractMentionedPaths(content);
  const createPath = String(created.path ?? "").trim();

  const modifyPath =
    mentionedPaths.find((p) => p !== createPath) ||
    (content.includes("app/page.tsx") ? "app/page.tsx" : "");

  if (modifyPath) {
    console.log("[create_modify_fallback] triggered", {
      createPath,
      modifyPath,
    });

    const existingFile = await runTool(
      supabase,
      repoId,
      user.id,
      content,
      "vault_read_text",
      { path: modifyPath }
    );

    if (existingFile && typeof existingFile === "object" && !("error" in existingFile)) {
      const rewritten = await generateRewrittenFileContent({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
        path: String((existingFile as any).path ?? modifyPath),
        mime: String((existingFile as any).mime ?? "text/plain"),
        currentContent: String((existingFile as any).content ?? ""),
      });

      const writeProposal = await runTool(
        supabase,
        repoId,
        user.id,
        content,
        "vault_propose_write",
        {
          fileId: (existingFile as any).id,
          path: modifyPath,
          content: rewritten,
        }
      );

      if (
        writeProposal &&
        typeof writeProposal === "object" &&
        !("error" in writeProposal) &&
        !(writeProposal as any).noop
      ) {
        pendingProposalOuts.push(writeProposal);
      }
    }
  }
}

    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(out),
    });
  }

  pendingProposalOuts = pendingProposalOuts.filter(
  (p) => !(p && typeof p === "object" && (p as any).noop === true)
);
const beforeDedupe = pendingProposalOuts.length;
pendingProposalOuts = dedupePendingProposals(pendingProposalOuts);

if (beforeDedupe !== pendingProposalOuts.length) {
  console.log("[proposal_dedupe]", {
    before: beforeDedupe,
    after: pendingProposalOuts.length,
    keys: pendingProposalOuts.map((p) =>
      String(p?.fileId ?? p?.path ?? p?.meta?.path ?? "")
    ),
  });
}

if (pendingProposalOuts.length === 1) {
  hadAnyProposalSet = true;

  const proposals = [...pendingProposalOuts];
  const proposal = proposals[0];

  controller.enqueue(
    encoder.encode(`\n__PROPOSAL__:${JSON.stringify(proposal)}\n`)
  );

  console.log("[preverify] proposal_count", proposals.length);
  console.log("[preverify] should_run", shouldPreVerifyProposalSet(proposals));
  console.log(
    "[preverify] proposal_paths",
    proposals.map((p) => String(p.path ?? p.meta?.path ?? ""))
  );

  try {
    if (shouldPreVerifyProposalSet(proposals)) {
      console.log("[preverify] starting");

      const result = await finalizeProposalSet({
        openai,
        model: runtimePolicy.model,
        repoId,
        userRequest: content,
        baselineVerifyPayload: baselineVerify.verifyPayload,
        proposals,
      });

if (result.repaired) {
  for (const p of result.finalProposals) {
    assertCanonicalProposal(p);
  }

  if (result.finalProposals.length === 1) {
    controller.enqueue(
      encoder.encode(
        `\n__PROPOSAL__:${JSON.stringify(result.finalProposals[0])}\n`
      )
    );
  } else {
    controller.enqueue(
      encoder.encode(
        `\n__PROPOSAL_SET__:${JSON.stringify({ proposals: result.finalProposals })}\n`
      )
    );
  }
}

      controller.enqueue(
        encoder.encode(
          `\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`
        )
      );
    }
  } catch (e: any) {
    console.log("[preverify] failed", e?.message);

    controller.enqueue(
      encoder.encode(
        `\n__PREVERIFY__:${JSON.stringify({
          ok: false,
          command: "node_verify",
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: e?.message ?? "Pre-verify failed",
          failedStep: "preverify_boot",
          failureKind: "internal_error",
          timedOut: false,
          fileIds: proposals.map((p) => String(p.fileId)).filter(Boolean),
          paths: proposals.map((p) => String(p.path ?? p.meta?.path ?? "")).filter(Boolean),
          baseline: false,
        })}\n`
      )
    );
  }

  pendingProposalOuts = [];
 
} else if (pendingProposalOuts.length > 1) {
  hadAnyProposalSet = true;

  const proposals = [...pendingProposalOuts];
  const proposalSet = { proposals };

  controller.enqueue(
    encoder.encode(
      `\n__PROPOSAL_SET__:${JSON.stringify(proposalSet)}\n`
    )
  );

  console.log("[preverify] proposal_count", proposals.length);
  console.log("[preverify] should_run", shouldPreVerifyProposalSet(proposals));
  console.log(
    "[preverify] proposal_paths",
    proposals.map((p) => String(p.path ?? p.meta?.path ?? ""))
  );

  try {
    if (shouldPreVerifyProposalSet(proposals)) {
      console.log("[preverify] starting");

      const result = await finalizeProposalSet({
        openai,
        model: runtimePolicy.model,
        repoId,
        userRequest: content,
        baselineVerifyPayload: baselineVerify.verifyPayload,
        proposals,
      });

if (result.repaired) {
  for (const p of result.finalProposals) {
    assertCanonicalProposal(p);
  }

  if (result.finalProposals.length === 1) {
    controller.enqueue(
      encoder.encode(
        `\n__PROPOSAL__:${JSON.stringify(result.finalProposals[0])}\n`
      )
    );
  } else {
    controller.enqueue(
      encoder.encode(
        `\n__PROPOSAL_SET__:${JSON.stringify({ proposals: result.finalProposals })}\n`
      )
    );
  }
}

      controller.enqueue(
        encoder.encode(
          `\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`
        )
      );
    }
  } catch (e: any) {
    console.log("[preverify] failed", e?.message);

    controller.enqueue(
      encoder.encode(
        `\n__PREVERIFY__:${JSON.stringify({
          ok: false,
          command: "node_verify",
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: e?.message ?? "Pre-verify failed",
          failedStep: "preverify_boot",
          failureKind: "internal_error",
          timedOut: false,
          fileIds: proposals.map((p) => String(p.fileId)).filter(Boolean),
          paths: proposals.map((p) => String(p.path ?? p.meta?.path ?? "")).filter(Boolean),
          baseline: false,
        })}\n`
      )
    );
  }

  pendingProposalOuts = [];
}


if (deterministicToolHandled) {
  console.log("[pass2] skipped due to deterministic tool handling");
} else {
  console.log("[pass2] starting", {
    previous_response_id: lastResponseId,
    toolOutputsCount: toolOutputs.length,
    toolNames: toolsToRun.map((t) => t.name),
    inputPreview: JSON.stringify(toolOutputs).slice(0, 1000),
  });

  if (!lastResponseId) {
    throw new Error("Missing response id; cannot send tool output");
  }

  try {
    resp = await openai.responses.create({
      model: runtimePolicy.model,
      instructions: resolvedInstructions,
      previous_response_id: lastResponseId as string,
      input: toolOutputs,
      tools: TOOLS,
      tool_choice: "none",
      stream: true,
      max_output_tokens: runtimePolicy.output.maxOutputTokens,
    });

    const pass2 = await streamResponse(resp, "pass2");
    fullText = pass2.buffer ?? "";
  } catch (err: any) {
    console.log("[pass2] error", {
      message: err?.message,
      name: err?.name,
      cause: err?.cause,
      status: err?.status,
      code: err?.code,
    });
    throw err;
  }
}

if (!fullText.trim()) {
  const fallback = hadAnyProposalSet
    ? "[Observation]\nRequired repository changes were staged.\n\n" +
      "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
      "[Action]\nA staged change is ready. Confirm to apply."
    : "[Observation]\nTool executed but produced no assistant text.\n\n" +
      "[Assessment]\nThe tool-call stream resolved without output_text deltas.\n\n" +
      "[Action]\nReturn deterministic fallback and close.";

  fullText = fallback;
  controller.enqueue(encoder.encode(fallback));
}

fullText = fullText.trim();

if (!hasValidAssistantContract(fullText)) {
  console.log("[contract] violation: assistant output missing valid contract markers");
  fullText =
    "[Observation]\nContract violation detected.\n\n" +
    "[Assessment]\nAssistant output did not include a valid triplet or repository proposal marker.\n\n" +
    "[Action]\nRetry the request or adjust prompt to conform to the output contract.";
}

fullText = scrubVisibleToolPayload(fullText);
fullText = ensureTriplet(stripDuplicateTriplet(fullText));

const claimsStagedChange = fullText.includes("A staged change is ready. Confirm to apply.");

if (claimsStagedChange && !hadAnyProposalSet) {
  console.log("[proposal_guard] staged change claimed but no proposal marker");

  fullText =
    "[Observation]\nA staged change was claimed but no repository proposal was produced.\n\n" +
    "[Assessment]\nThe chamber described a staged change without emitting a __PROPOSAL__ or __PROPOSAL_SET__ marker for this turn.\n\n" +
    "[Action]\nRetry required. The chamber must stage the change through vault tools before claiming it is ready to apply.";
}

if (hadAnyProposalSet) {
  fullText =
    "[Observation]\nRequired repository changes were staged.\n\n" +
    "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
    "[Action]\nA staged change is ready. Confirm to apply.";
}

      const { error: aInsErr } = await supabase.from("repo_messages").insert({
        repo_id: repoId,
        user_id: user.id,
        role: "assistant",
        content: fullText,
      });

      if (aInsErr) {
        console.log("[repo_messages] assistant insert failed:", aInsErr.message);
      }

      emitMaintenanceIfNeeded(controller, encoder);

      try {
        const MESSAGE_CAP = 160;
        const msgCount = Number(totalMsgCount ?? 0);

        if (msgCount >= MESSAGE_CAP) {
          console.log("[maintenance] auto-resummarize trigger", {
            repoId,
            msgCount,
          });

          await fetch(`/api/repo/${repoId}/maintenance/resummarize`, {
            method: "POST",
          });
        }
      } catch (e: any) {
        console.log("[maintenance] auto-resummarize failed:", e?.message);
      }

      try {
        const engraving = await maybeSummarizeAndEngraveProposal(supabase, repoId, user.id);
        if (engraving?.marker) {
          controller.enqueue(
            encoder.encode(`\n__ENGRAVING__:${JSON.stringify(engraving.marker)}\n`)
          );
        }
      } catch (e: any) {
        console.log("[engraving] skipped:", e?.message);
      }
    }
  }  catch (err: any) {
      console.error("LLM error:", err?.message);
      controller.enqueue(encoder.encode("System: LLM unavailable. Check billing/quota."));
    } finally {
      console.log("Total request time (ms):", Math.round(performance.now() - t0));
      controller.close();
    }
  },
});

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}