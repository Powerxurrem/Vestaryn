import OpenAI from "openai";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { resolveTierPolicy } from "@/lib/membership/tiers";
import { SYSTEM_PROTECTOR_DEFAULT,SYSTEM_PROTECTOR_ARCH,} from "@/lib/chamber/prompts";
import {extractSingleMentionedPath,isRepositoryExecutionIntent,
isCreateAndModifyIntent,isHighLevelBuildRequest, isInternalGoalExecutionPrompt,normText,isInternalControlPrompt, isGoalPlanningUserIntent,
} from "@/lib/chamber/intent";
import {isSourceTargetTransferIntent,isImportRefactorIntent,isSplitFileIntent} from "@/lib/chamber/refactorIntent";
import { generateNewFileContent} from "@/lib/chamber/generation";
import { runAutoVerifyForRepo,} from "@/lib/chamber/verify";
import { TOOLS}from "@/lib/vault/toolRuntime";
import {  resolveDirectVerifyCommand,handleDirectVerifyCommand} from "@/lib/chamber/verifyRuntime";
import {  handleApplySetCommand,handleApplyCommand,} from "@/lib/chamber/applyRuntime";
import { handlePlanningRequest } from "@/lib/chamber/planningRuntime";
import { tryHandleBootstrap } from "@/lib/chamber/bootstrapRuntime";
import { tryHandlePreStreamRepoOps } from "@/lib/chamber/preStreamRuntime";
import { tryHandleRunnerPing } from "@/lib/chamber/runnerRuntime";
import {chargeCreditsForUsage} from "@/lib/chamber/creditsRuntime";
import { tryHandleDeterministicCommands } from "@/lib/chamber/deterministicCommands";
import { streamResponse } from "@/lib/chamber/streamRuntime";
import {  resolveExecutionMode,shouldAllowBootstrapForMode,shouldAllowPreStreamRepoOpsForMode,  shouldRunBaselineVerifyForMode} from "@/lib/chamber/executionMode";
import { handleSurgicalMode } from "@/lib/chamber/handleSurgicalMode";
import { handleCreateMissingFileMode } from "@/lib/chamber/handleCreateMissingFileMode";
import { handleImplicitStaticPageMode } from "@/lib/chamber/handleImplicitStaticPageMode";
import { handleProposalPreverify } from "@/lib/chamber/toolOrchestration/proposalPreverifyOrchestration";
import { finalizeAssistantTurnOrchestration } from "@/lib/chamber/toolOrchestration/finalizeAssistantTurnOrchestration";
import { persistAssistantTurnOrchestration } from "@/lib/chamber/toolOrchestration/persistAssistantTurnOrchestration";
import { tryHandleRepoWideStyleOrchestration } from "@/lib/chamber/toolOrchestration/repoWideStyleOrchestration";
import { tryHandleExplainModeOrchestration } from "@/lib/chamber/toolOrchestration/explainModeOrchestration";
import { handlePass1FallbackOrchestration } from "@/lib/chamber/toolOrchestration/pass1FallbackOrchestration";
import { executeToolOrchestration } from "@/lib/chamber/toolOrchestration/toolExecutionOrchestration";
import { prepareChatRuntimeOrchestration } from "@/lib/chamber/toolOrchestration/prepareChatRuntimeOrchestration";
import { normalizePass1ToolsOrchestration } from "@/lib/chamber/toolOrchestration/pass1ToolNormalizationOrchestration";
import { buildCreateMissingResponseOrchestration } from "@/lib/chamber/toolOrchestration/createMissingResponseOrchestration";
import { buildSurgicalResponseOrchestration } from "@/lib/chamber/toolOrchestration/surgicalResponseOrchestration";
import { tryHandleEarlyOrchestration } from "@/lib/chamber/toolOrchestration/earlyOrchestration";
import { runToolExecutionLoop } from "@/lib/chamber/toolOrchestration/toolExecutionLoopOrchestration";
import { runToolExecutionRounds } from "@/lib/chamber/toolOrchestration/toolExecutionRoundsOrchestration";


/**
 * @file app/api/repo/[repoId]/chat/route.ts
 * @purpose Stream assistant output for a repo chat, while enforcing Vestaryn output contract.
 * @exports POST
 */

export const runtime = "nodejs";
export const maxDuration = 180;

// ─────────────────────────────────────────────────────────────
// OpenAI client
// ─────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MAINTENANCE_TRIGGER_MSGS = 160;

async function generateNewFileContentSafe(args: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  path: string;
  mime: string;
  maxOutputTokens?: number;
}) {
  try {
    return await generateNewFileContent(args);
  } catch (e: any) {
    const message = String(e?.message ?? "");

    if (!/appears truncated/i.test(message)) {
      throw e;
    }

    return await generateNewFileContent({
      ...args,
      userRequest:
        `${args.userRequest}\n\nRetry rules:\n` +
        `- Return the FULL complete file.\n` +
        `- Do not truncate.\n` +
        `- Keep the file compact and complete.\n` +
        `- Return only valid file contents.\n`,
      maxOutputTokens: Math.max(args.maxOutputTokens ?? 10000, 10000),
    });
  }
}

function isImplicitPythonScriptBootstrapRequest(text: string) {
  const t = String(text ?? "").toLowerCase();
  return (
    /\bpython script\b/.test(t) &&
    (
      /\.xlsx\b/.test(t) ||
      /\bexcel\b/.test(t) ||
      /\bworkbook\b/.test(t) ||
      /\bspreadsheet\b/.test(t)
    )
  );
}

function resolveSurgicalPaths(content: string): {
  targetPath: string | null;
  referencePath: string | null;
} {
  const mentioned = Array.from(
    new Set(
      (content.match(/[a-zA-Z0-9_\-./]+\.(html|css|js|jsx|ts|tsx)/gi) ?? [])
        .map((p) => String(p).trim())
        .filter(Boolean)
    )
  );

  if (mentioned.length === 1) {
    return {
      targetPath: mentioned[0],
      referencePath: null,
    };
  }

  if (mentioned.length >= 2) {
    const lower = content.toLowerCase();

    if (/\balign\b|\bmatch\b|\bvisually align\b|\bsame style\b|\bsame layout\b/.test(lower)) {
      return {
        targetPath: mentioned[0],
        referencePath: mentioned[1],
      };
    }

    return {
      targetPath: mentioned[0],
      referencePath: mentioned[1],
    };
  }

  return {
    targetPath: null,
    referencePath: null,
  };
}

function stripPathInsertCommandPrefix(input: string): string {
  return String(input ?? "").replace(/^\/path\s+/i, "").trim();
}

function dirnameOf(path: string) {
  const s = String(path ?? "").trim();
  const idx = s.lastIndexOf("/");
  return idx === -1 ? "" : s.slice(0, idx);
}

function joinWithinDir(dir: string, leaf: string) {
  const cleanLeaf = String(leaf ?? "").trim().replace(/^\/+/, "");
  if (!dir) return cleanLeaf;
  return `${dir}/${cleanLeaf}`;
}

function resolveMentionedRepoPaths(
  requestedPaths: string[],
  files: Array<{ path?: string; name?: string }>
) {
  return requestedPaths.map((requested) => {
    const raw = String(requested ?? "").trim();
    if (!raw) return raw;

    const exact = files.find((f) => String(f?.path ?? "").trim() === raw);
    if (exact) return String(exact?.path ?? "").trim();

    const byName = files.filter((f) => String(f?.name ?? "").trim() === raw);
    if (byName.length === 1) {
      return String(byName[0]?.path ?? "").trim();
    }

    return raw;
  });
}

function extractLocalHtmlRefs(html: string): string[] {
  const refs = Array.from(
    String(html ?? "").matchAll(/(?:src|href)=["']([^"']+)["']/gi)
  )
    .map((m) => String(m[1] ?? "").trim())
    .filter(Boolean)
    .filter((v) => !/^(https?:|data:|#|mailto:|tel:|\/\/)/i.test(v))
    .filter((v) => /\.html?$/i.test(v));

  return Array.from(new Set(refs));
}

function resolveEditTarget(
  mentionedPaths: string[],
  content: string,
  availableFiles: string[] = [],
  continuityTargetPath?: string | null
): { target: string | null; references: string[]; preserveMultiTarget: boolean } {
  const intent = classifyEditIntent(content);

  const hasStylesCss = availableFiles.some((p) => /(^|\/)styles\.css$/i.test(p));
  const cssTarget =
    availableFiles.find((p) => /(^|\/)styles\.css$/i.test(p)) ?? "styles.css";

  // Strong CSS preference for vague visual/style follow-ups
  if (intent === "style" && hasStylesCss && mentionedPaths.length === 0) {
    return {
      target: cssTarget,
      references: [],
      preserveMultiTarget: false,
    };
  }

  // Continuity fallback when user is clearly continuing a prior edit
  if (!mentionedPaths?.length && continuityTargetPath) {
    // But styling requests should still prefer CSS when it exists
    if (intent === "style" && hasStylesCss) {
      return {
        target: cssTarget,
        references: [],
        preserveMultiTarget: false,
      };
    }

    return {
      target: continuityTargetPath,
      references: [],
      preserveMultiTarget: false,
    };
  }

  if (!mentionedPaths?.length) {
    return { target: null, references: [], preserveMultiTarget: false };
  }

  const wantsSharedStyling =
    intent === "style" &&
    (
      mentionedPaths.length >= 2 ||
      /\b(same style|apply the same style|same theme|same look|match the style|consistent|align style|match the styling)\b/i.test(
        content
      )
    );

  if (wantsSharedStyling) {
    return {
      target: null,
      references: [],
      preserveMultiTarget: true,
    };
  }

  const inMatch = content.match(
    /\bin\s+([a-zA-Z0-9_\-./]+\.(html|css|js|jsx|ts|tsx))\b/i
  );

  if (inMatch) {
    const target = String(inMatch[1] ?? "").trim();
    return {
      target,
      references: mentionedPaths.filter((p) => p !== target),
      preserveMultiTarget: false,
    };
  }

  // If the user explicitly mentioned CSS for a style request, prefer it
  const explicitCssPath = mentionedPaths.find((p) => /\.css$/i.test(p));
  if (intent === "style" && explicitCssPath) {
    return {
      target: explicitCssPath,
      references: mentionedPaths.filter((p) => p !== explicitCssPath),
      preserveMultiTarget: false,
    };
  }

  if (mentionedPaths.length > 1) {
    const target = mentionedPaths[mentionedPaths.length - 1];
    return {
      target,
      references: mentionedPaths.slice(0, -1),
      preserveMultiTarget: false,
    };
  }

  // Final CSS bias for style requests
  if (intent === "style" && hasStylesCss) {
    return {
      target: cssTarget,
      references: [],
      preserveMultiTarget: false,
    };
  }

  return {
    target: mentionedPaths[0],
    references: [],
    preserveMultiTarget: false,
  };
}

function classifyEditIntent(content: string): "style" | "content" | "structure" | "unknown" {
  const t = String(content ?? "").toLowerCase();

  if (
    /\b(color|colors|background|theme|style|styling|navbar|top bar|header|footer|layout|spacing|padding|margin|font|visual|look|feel)\b/.test(t)
  ) {
    return "style";
  }

  if (
    /\b(text|title|heading|paragraph|copy|content|wording|rename|label)\b/.test(t)
  ) {
    return "content";
  }

  if (
    /\b(add|remove|section|div|container|grid|layout block|structure|component)\b/.test(t)
  ) {
    return "structure";
  }

  return "unknown";
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

const text = normText(content);

// Stage 1: raw mode from user text only
const rawExecutionMode = resolveExecutionMode(text);

console.log("[execution_mode.raw]", {
  mode: rawExecutionMode.mode,
  confidence: rawExecutionMode.confidence,
  reasons: rawExecutionMode.reasons,
  mentionedPaths: rawExecutionMode.mentionedPaths,
});

const explicitGoalPlanRequest =
  !isInternalControlPrompt(text) &&
  isGoalPlanningUserIntent(text);

const planningRequest = explicitGoalPlanRequest;

const autoGoalPlanRequest =
  !isInternalControlPrompt(text) &&
  !explicitGoalPlanRequest &&
  !isRepositoryExecutionIntent(text) &&
  isHighLevelBuildRequest(text);

console.log("[goal_plan branch check]", {
  repoId,
  planningRequest,
  autoGoalPlanRequest,
  isInternalControl: isInternalControlPrompt(text),
  isInternalGoalExecution: isInternalGoalExecutionPrompt(text),
  isRepoExecution: isRepositoryExecutionIntent(text),
  contentHead: text.slice(0, 120),
});

console.log("[goal_debug_content]", JSON.stringify(content));

  console.log("[chat] content_head:", content.slice(0, 40));

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

if (planningRequest || autoGoalPlanRequest) {
  return await handlePlanningRequest({
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    model: tierPolicy.model,
  });
}

const deterministicResponse = await tryHandleDeterministicCommands({
  supabase,
  repoId,
  userId: user.id,
  content,
});

if (deterministicResponse) {
  return deterministicResponse;
}

console.log("[verify_probe] content:", JSON.stringify(content));

let baselineVerify = {
  verifyPayload: {
    ok: true,
    skipped: true,
    reason: "mode_skipped",
    failedStep: null,
  },
} as any;

if (shouldRunBaselineVerifyForMode(rawExecutionMode.mode)) {
  baselineVerify = await runAutoVerifyForRepo({ repoId });

  console.log("[baseline_verify]", {
    ok: baselineVerify.verifyPayload.ok,
    failedStep: baselineVerify.verifyPayload.failedStep,
    mode: rawExecutionMode.mode,
  });

  if (!baselineVerify.verifyPayload.ok) {
    console.log("[baseline_verify] repo currently broken, repair needed");
  }
} else {
  console.log("[baseline_verify] skipped", {
    mode: rawExecutionMode.mode,
  });
}

console.log("[baseline_verify]", {
  ok: baselineVerify.verifyPayload.ok,
  failedStep: baselineVerify.verifyPayload.failedStep,
});

if (!baselineVerify.verifyPayload.ok) {
  console.log("[baseline_verify] repo currently broken, repair needed");
}

const directVerifyCmd = resolveDirectVerifyCommand(content);

if (directVerifyCmd) {
  return await handleDirectVerifyCommand({
    supabase,
    repoId,
    userId: user.id,
    verifyCmd: directVerifyCmd,
  });
}

// 🔒 Runner connectivity test (deterministic, bypass LLM)
const runnerPingResponse = await tryHandleRunnerPing({
  content,
  repoId,
});

if (runnerPingResponse) {
  return runnerPingResponse;
}

// 🔒 APPLY_SET SHORT-CIRCUIT (deterministic multi-apply, bypass LLM)
if (content.startsWith("__APPLY_SET__:")) {
  return await handleApplySetCommand({
    supabase,
    repoId,
    userId: user.id,
    requestId,
    content,
  });
}

// 🔒 APPLY SHORT-CIRCUIT (deterministic single apply, bypass LLM)
if (content.startsWith("__APPLY__:")) {
  return await handleApplyCommand({
    supabase,
    repoId,
    userId: user.id,
    requestId,
    content,
  });
}

// ─────────────────────────────────────────────
// Credits preflight (workspace pool, server-canonical)
// ─────────────────────────────────────────────
const runtimeSetup = await prepareChatRuntimeOrchestration({
  supabase,
  repoId,
  userId: user.id,
  content,
  text,
  tierPolicy,
  rawExecutionMode,
});

if (runtimeSetup.errorResponse) {
  return runtimeSetup.errorResponse;
}

const {
  inference,
  cleanedHistory,
  sacredBlock,
  profileBlock,
  masterBlock,
  chamberBlock,
  treeBlock,
  ledgerBlock,
  membershipBlock,
  effectiveMentionedPaths,
  executionMode,
  continuityTargetPath,
  inferredVerifyCmd,
  workspaceId,
  periodStart,
  runtimePolicy,
} = runtimeSetup;

function getEffectiveMentionedPaths() {
  return effectiveMentionedPaths;
}

function getAvailableFiles() {
  const inferredFiles = (inference as any)?.files;
  const files = Array.isArray(inferredFiles) ? inferredFiles : [];

  return files
    .map((f: any) => String(f?.path ?? "").trim())
    .filter(Boolean);
}

function getEffectiveSinglePath() {
  if (effectiveMentionedPaths.length === 1) {
    return effectiveMentionedPaths[0];
  }
  if (executionMode?.mentionedPaths?.length === 1) {
    return executionMode.mentionedPaths[0];
  }
  return extractSingleMentionedPath(content);
}

const shouldRunCreateMissingMode =
  !continuityTargetPath &&
  (
    executionMode.mode === "incremental" ||
    executionMode.mode === "surgical" ||
    executionMode.mode === "rewrite"
  );

if (shouldRunCreateMissingMode) {
  console.log("[execution_mode] create-missing-file handler active", {
    confidence: executionMode.confidence,
    paths: executionMode.mentionedPaths,
  });

  const createMissingResponse = await handleCreateMissingFileMode({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  model: runtimePolicy.model,
  executionMode,
});

   if (createMissingResponse) {
    const responseText = await createMissingResponse.text();

    return await buildCreateMissingResponseOrchestration({
      supabase,
      repoId,
      userId: user.id,
      workspaceId,
      periodStart,
      requestId,
      executionMode,
      runtimePolicy,
      responseText,
      chargeCreditsForUsage,
    });
  }
}

if (executionMode.mode === "surgical") {
  console.log("[execution_mode] surgical handler active", {
    confidence: executionMode.confidence,
    paths: executionMode.mentionedPaths,
  });

  const surgicalResponse = await handleSurgicalMode({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  model: runtimePolicy.model,
  baselineVerify,
  inferredVerifyCmd,
  targetPathOverride: getEffectiveSinglePath(),
});

    if (surgicalResponse) {
    const responseText = await surgicalResponse.text();

  console.log("[execution_mode] surgical handler returned response", {
    repoId,
    responseLen: responseText.length,
  });
    
    return await buildSurgicalResponseOrchestration({
      supabase,
      repoId,
      userId: user.id,
      responseText,
    });
  }
}

const explainModeResponse = await tryHandleExplainModeOrchestration({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  executionMode,
  runtimePolicy,
  resolvedInstructions,
  membershipBlock,
  sacredBlock,
  profileBlock,
  masterBlock,
  chamberBlock,
  treeBlock,
  ledgerBlock,
  cleanedHistory,
});

if (explainModeResponse) {
  return explainModeResponse;
}

const implicitStaticPageResponse = await handleImplicitStaticPageMode({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  model: runtimePolicy.model,
  inference,
  baselineVerify,
  inferredVerifyCmd,
});

if (implicitStaticPageResponse) {
  return implicitStaticPageResponse;
}

const repoWideStyleResponse = await tryHandleRepoWideStyleOrchestration({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  executionMode,
  runtimePolicy,
});

if (repoWideStyleResponse) {
  return repoWideStyleResponse;
}

if (shouldAllowPreStreamRepoOpsForMode(executionMode.mode)) {
  const preStreamResponse = await tryHandlePreStreamRepoOps({
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    runtimePolicy,
    baselineVerify,
  });

  if (preStreamResponse) {
    return preStreamResponse;
  }
} else {
  console.log("[prestream] skipped", {
    mode: executionMode.mode,
  });
}

if (shouldAllowBootstrapForMode(executionMode.mode)) {
  const bootstrapResponse = await tryHandleBootstrap({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  inference,
  runtimePolicy,
  membershipBlock,
  sacredBlock,
  profileBlock,
  masterBlock,
  chamberBlock,
  treeBlock,
  ledgerBlock,
  cleanedHistory,
  baselineVerify,
  workspaceId,
  periodStart,
  requestId,
});

  if (bootstrapResponse) {
    return bootstrapResponse;
  }
} else {
  console.log("[bootstrap] skipped", {
    mode: executionMode.mode,
  });
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

 const stream = new ReadableStream<Uint8Array>({
  async start(controller) {
    let lastResponseId: string | null = null;
    let pendingProposalOuts: any[] = [];
    let fullText = "";
    let rawAssistantText = "";
    let hadAnyProposalSet = false;
    let handledSplitTurn = false;
    let firstTokenTime: number | null = null;
    let creditsCharged = false;
    let requestHandledByOrchestration = false;
    let deterministicToolHandled = false;
    let pendingTools: { call_id: string; name: string; arguments: string }[] = [];
    const toolArgsByCallId = new Map<string, string>();
    const toolNameByCallId = new Map<string, string>();
    
const earlyResponse = await tryHandleEarlyOrchestration({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  inference,
  executionMode,
  runtimePolicy,
  requestHandledByOrchestration,
  isImplicitPythonScriptBootstrapRequest,
});

if (earlyResponse) {
  return earlyResponse;
}

    try {
      let resp: any;
        console.log("[responses.create pass1 start]", {
          model: runtimePolicy.model,
          inputLen: JSON.stringify(input).length,
          instructionsLen: resolvedInstructions.length,
        });
        try {
          resp = await openai.responses.create({
            model: runtimePolicy.model,
            instructions: resolvedInstructions,
            input,
            tools: TOOLS,
            tool_choice: "auto",
            stream: true,
            max_output_tokens: runtimePolicy.output.maxOutputTokens,
          });
        } catch (err: any) {
          console.log("[responses.create pass1 failed]", {
            message: err?.message,
            name: err?.name,
            status: err?.status,
            code: err?.code,
            type: err?.type,
            param: err?.param,
            cause: err?.cause,
          });
          throw err;
        }

      const pass1 = await streamResponse({
        respStream: resp,
        mode: "pass1",
        controller,
        encoder,
        onFirstToken: () => {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
            console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
          }
        },
        onResponseCreated: (id) => {
          lastResponseId = id;
        },
      });

      console.log("[tool] built after pass1", {
        count: (pass1.builtPendingTools ?? []).length,
        tools: (pass1.builtPendingTools ?? []).map((t: any) => ({
          callId: t.call_id,
          name: t.name,
          argsLen: String(t.arguments ?? "").length,
          argsHead: String(t.arguments ?? "").slice(0, 200),
        })),
      });

      pendingTools = pass1.builtPendingTools ?? [];
      rawAssistantText = pass1.buffer ?? "";

      let initialHadTools = pendingTools.length > 0 || pass1.sawToolsThisPass;

           const normalizationResult =
            await normalizePass1ToolsOrchestration({
              repoId,
              content,
              executionMode,
              pendingTools,
              effectiveMentionedPaths,
              inference,
              isImportRefactorIntent,
              isSplitFileIntent,
              isSourceTargetTransferIntent,
              isCreateAndModifyIntent,
            });

          pendingTools = normalizationResult.pendingTools;

      console.log(
        "[pass1] hadTools=",
        initialHadTools,
        "bufLen=",
        pass1.buffer?.length ?? 0
      );

      console.log("[tool] built after pass1", {
        count: (pass1.builtPendingTools ?? []).length,
        tools: (pass1.builtPendingTools ?? []).map((t: any) => ({
          callId: t.call_id,
          name: t.name,
          argsLen: String(t.arguments ?? "").length,
          argsHead: String(t.arguments ?? "").slice(0, 200),
        })),
      });

      const fallbackResult = await handlePass1FallbackOrchestration({
  supabase,
  repoId,
  content,
  executionMode,
  initialHadTools,
  pendingTools,
  pass1Buffer: pass1.buffer ?? "",
  controller,
  encoder,
});

initialHadTools = fallbackResult.initialHadTools;
pendingTools = fallbackResult.pendingTools;
fullText = fallbackResult.fullText;

      console.log("[stream] pass1", {
        pass1SawTools: pass1.sawToolsThisPass,
        pendingTools: pendingTools.length,
        initialHadTools,
      });

      console.log("[stream] pass1 flushed", { len: fullText.length });


      const roundsResult = await runToolExecutionRounds({
  pendingTools,
  runtimePolicy,
  tierPolicy,
  ctx: {
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    runtimePolicy,
    tierPolicy,
    executionMode,
    continuityTargetPath,
    baselineVerify,
    inferredVerifyCmd,
    generateNewFileContentSafe,
    getEffectiveSinglePath,
    getEffectiveMentionedPaths,
    getAvailableFiles,
    resolveEditTarget,
    executeToolOrchestration,
    runToolExecutionLoop,
  },
  toolArgsByCallId,
  state: {
    requestHandledByOrchestration,
    pendingProposalOuts,
    handledSplitTurn,
    deterministicToolHandled,
    fullText,
  },
  io: {
    controller,
    encoder,
  },
});

requestHandledByOrchestration = roundsResult.state.requestHandledByOrchestration;
pendingProposalOuts = roundsResult.state.pendingProposalOuts;
handledSplitTurn = roundsResult.state.handledSplitTurn;
deterministicToolHandled = roundsResult.state.deterministicToolHandled;
fullText = roundsResult.state.fullText;

const toolOutputs = roundsResult.toolOutputs;

const proposalResult = await handleProposalPreverify({
  ctx: {
    openai,
    repoId,
    content,
    runtimePolicy,
    baselineVerify,
    inferredVerifyCmd,
  },
  pendingProposalOuts,
  controller,
  encoder,
});

pendingProposalOuts = proposalResult.pendingProposalOuts;
hadAnyProposalSet = proposalResult.hadAnyProposalSet;

const finalizeResult = await finalizeAssistantTurnOrchestration({
  ctx: {
    openai,
    resolvedInstructions,
    runtimePolicy,
    t0,
  },
  state: {
    lastResponseId,
    fullText,
    rawAssistantText,
    hadAnyProposalSet,
    deterministicToolHandled,
    toolOutputs,
    firstTokenTime,
  },
  io: {
    controller,
    encoder,
  },
});

fullText = finalizeResult.fullText;
rawAssistantText = finalizeResult.rawAssistantText;
firstTokenTime = finalizeResult.firstTokenTime;

await persistAssistantTurnOrchestration({
  ctx: {
    supabase,
    repoId,
    userId: user.id,
    forceMaintenance,
    totalMsgCount,
    maintenanceTriggerMsgs: MAINTENANCE_TRIGGER_MSGS,
  },
  state: {
    rawAssistantText,
    fullText,
    hadAnyProposalSet,
  },
  io: {
    controller,
    encoder,
  },
});
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