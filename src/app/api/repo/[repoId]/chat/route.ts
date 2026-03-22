import OpenAI from "openai";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { resolveTierPolicy } from "@/lib/membership/tiers";
import { runnerRun } from "@/lib/runner/client";
import { SYSTEM_PROTECTOR_DEFAULT,SYSTEM_PROTECTOR_ARCH,} from "@/lib/chamber/prompts";
import { normalizeForNoopCheck, sha256,confirmPhrase,confirmCreatePhrase,inferTextMimeFromPath,stripDuplicateTriplet,scrubVisibleToolPayload,ensureTriplet,
} from "@/lib/vault/utils";
import {extractMentionedPaths,extractSingleMentionedPath,isRepositoryExecutionIntent,
isCreateAndModifyIntent,isExtractToModuleIntent,looksLikeStandaloneModule,isHighLevelBuildRequest, isInternalGoalExecutionPrompt,normText,isInternalControlPrompt, isGoalPlanningUserIntent,isNewGoalPlanIntent
} from "@/lib/chamber/intent";
import {isSourceTargetTransferIntent,resolveSourceAndTargetPaths,
isImportRefactorIntent,isSplitFileIntent,extractSplitTargets,deriveDefaultSplitTargets,extractRequestedSplitCount,  isSplitReadAllowed} from "@/lib/chamber/refactorIntent";
import { resolveFileIdByPathOrName,vault_read_text} from "@/lib/vault/tools";
import { generateSplitFileContents,generateExtractHelpersResult,generateNewFileContent,generateRewrittenFileContent} from "@/lib/chamber/generation";
import { shouldPreVerifyProposalSet,runAutoVerifyForRepo,} from "@/lib/chamber/verify";
import { maybeSummarizeAndEngraveProposal,} from "@/lib/chamber/memory";
import { TOOLS, runTool}from "@/lib/vault/toolRuntime";
import { hasValidAssistantContract}from "@/lib/chamber/output";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";
import { containsGoalMarker, extractRawGoalMarkerBlock } from "@/types/goalMarkers";
import { loadRepoInference } from "@/lib/chamber/repoInferenceRuntime";
import {
  resolveDirectVerifyCommand,
  handleDirectVerifyCommand,
  resolveVerifyCommand,
} from "@/lib/chamber/verifyRuntime";
import { buildChatContext } from "@/lib/chamber/chatContext";
import {  handleApplySetCommand,handleApplyCommand,} from "@/lib/chamber/applyRuntime";
import { handlePlanningRequest } from "@/lib/chamber/planningRuntime";
import { tryHandleBootstrap } from "@/lib/chamber/bootstrapRuntime";
import { tryHandlePreStreamRepoOps } from "@/lib/chamber/preStreamRuntime";
import { dedupePendingProposals,isProbablyBrokenSplitFile,validateGeneratedSplitFiles,assertCanonicalProposal} from "@/lib/chamber/proposalRuntimeUtils";
import { emitMaintenanceIfNeeded,autoResummarizeIfNeeded} from "@/lib/chamber/maintenanceRuntime";
import { tryHandleRunnerPing } from "@/lib/chamber/runnerRuntime";
import {
  resolveRuntimePolicyFromCredits,
  chargeCreditsForUsage,
} from "@/lib/chamber/creditsRuntime";
import { tryHandleDeterministicCommands } from "@/lib/chamber/deterministicCommands";
import { streamResponse } from "@/lib/chamber/streamRuntime";
import {  resolveExecutionMode,shouldAllowBootstrapForMode,shouldAllowPreStreamRepoOpsForMode,  shouldRunBaselineVerifyForMode} from "@/lib/chamber/executionMode";
import { handleSurgicalMode } from "@/lib/chamber/handleSurgicalMode";
import { handleCreateMissingFileMode } from "@/lib/chamber/handleCreateMissingFileMode";
import { handleImplicitStaticPageMode } from "@/lib/chamber/handleImplicitStaticPageMode";

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

const executionMode = resolveExecutionMode(text);

console.log("[execution_mode]", {
  mode: executionMode.mode,
  confidence: executionMode.confidence,
  reasons: executionMode.reasons,
  mentionedPaths: executionMode.mentionedPaths,
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

if (shouldRunBaselineVerifyForMode(executionMode.mode)) {
  baselineVerify = await runAutoVerifyForRepo({ repoId });

  console.log("[baseline_verify]", {
    ok: baselineVerify.verifyPayload.ok,
    failedStep: baselineVerify.verifyPayload.failedStep,
    mode: executionMode.mode,
  });

  if (!baselineVerify.verifyPayload.ok) {
    console.log("[baseline_verify] repo currently broken, repair needed");
  }
} else {
  console.log("[baseline_verify] skipped", {
    mode: executionMode.mode,
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



const chatCtx = await buildChatContext({
  supabase,
  repoId,
  userId: user.id,
  content,
  tierPolicy,
});

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
} = chatCtx;

const inferredVerifyCmd =
  inference?.projectType === "unknown" || inference?.projectType === "loose_files"
    ? null
    : resolveVerifyCommand(inference?.projectType ?? null);

const creditsResolution = await resolveRuntimePolicyFromCredits({
  supabase,
  repoId,
  tierPolicy,
});

if (creditsResolution.errorResponse) {
  return creditsResolution.errorResponse;
}

const {
  workspaceId,
  periodStart,
  remaining,
  runtimePolicy,
} = creditsResolution;

console.log("[credits]", {
  workspaceId,
  periodStart,
  remaining,
  runtimeTier: runtimePolicy.tier,
});

const shouldRunCreateMissingMode =
  executionMode.mode === "bootstrap" ||
  executionMode.mode === "incremental" ||
  executionMode.mode === "surgical" ||
  executionMode.mode === "rewrite";

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
  });

  if (createMissingResponse) {
    const responseText = await createMissingResponse.text();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(responseText));

          const { error: aInsErr } = await supabase.from("repo_messages").insert({
            repo_id: repoId,
            user_id: user.id,
            role: "assistant",
            content: responseText,
          });

          if (aInsErr) {
            console.log("[repo_messages] create-missing assistant insert failed:", aInsErr.message);
          }
          if (!aInsErr) {
            await chargeCreditsForUsage({
              supabase,
              workspaceId,
              periodStart,
              repoId,
              requestId,
              amount: 1,
              kind: "chat_turn",
              metadata: {
                mode: executionMode.mode,
                model: runtimePolicy.model,
                tier: runtimePolicy.tier,
              },
            });
          }
        } finally {
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
  });

  if (surgicalResponse) {
    const responseText = await surgicalResponse.text();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(responseText));

          const { error: aInsErr } = await supabase.from("repo_messages").insert({
            repo_id: repoId,
            user_id: user.id,
            role: "assistant",
            content: responseText,
          });

          if (aInsErr) {
            console.log("[repo_messages] surgical assistant insert failed:", aInsErr.message);
          }
        } finally {
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
}

if (executionMode.mode === "explain") {
  console.log("[execution_mode] explain guard active");

  const explainInput = [
    { role: "system", content: membershipBlock },
    { role: "system", content: sacredBlock },
    { role: "system", content: profileBlock },
    { role: "system", content: masterBlock },
    { role: "system", content: chamberBlock },
    { role: "system", content: treeBlock },
    { role: "system", content: ledgerBlock },
    ...cleanedHistory.map((m: any) => ({
      role: m.role,
      content: m.content,
    })),
    {
      role: "system",
      content:
        "Mode: EXPLAIN_ONLY. Analyze and explain the repository or requested files. Do not propose changes. Do not emit __PROPOSAL__ or __PROPOSAL_SET__. Do not claim staged changes. Reference real files when possible.",
    },
    { role: "user", content },
  ];

  const resp = await openai.responses.create({
    model: runtimePolicy.model,
    instructions: resolvedInstructions,
    input: explainInput,
    tools: TOOLS,
    tool_choice: "auto",
    max_output_tokens: runtimePolicy.output.maxOutputTokens,
  });

  const rawText = String((resp as any).output_text ?? "").trim();
  let out = scrubVisibleToolPayload(rawText);
  out = ensureTriplet(stripDuplicateTriplet(out)).trim();

  if (!hasValidAssistantContract(out)) {
    out =
      "[Observation]\nRepository explanation requested.\n\n" +
      "[Assessment]\nThe chamber analyzed the request in explain mode without staging changes.\n\n" +
      "[Action]\nReview the explanation above and request a concrete file change when ready.";
  }

  const { error: aInsErr } = await supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: user.id,
    role: "assistant",
    content: out,
  });

  if (aInsErr) {
    console.log("[repo_messages] assistant insert failed:", aInsErr.message);
  }

  return new Response(out, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
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
    

    try {
      let resp = await openai.responses.create({
        model: runtimePolicy.model,
        instructions: resolvedInstructions,
        input,
        tools: TOOLS,
        tool_choice: "auto",
        stream: true,
        max_output_tokens: runtimePolicy.output.maxOutputTokens,
      });

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

      if (!initialHadTools) {
        const rawOut = String(pass1.buffer ?? "");
        const hasGoalMarkers = containsGoalMarker(rawOut);

        // ─────────────────────────────────────────────
        // Deterministic fallback when incremental repo execution produced no tools
        // ─────────────────────────────────────────────
        if (
          !hasGoalMarkers &&
          isRepositoryExecutionIntent(content) &&
          executionMode.mode === "incremental"
        ) {
          try {
            console.log(
              "[pass1_fallback] incremental repo execution produced no tools"
            );

            const inferred = await loadRepoInference({
              supabase,
              repoId,
            });

            const filePaths = Array.isArray(inferred?.filePaths)
              ? inferred.filePaths
              : [];

            const preferredPath =
              /background|color|spacing|padding|margin|font|shadow|border|animation|styles?/i.test(
                content
              )
                ? filePaths.includes("styles.css")
                  ? "styles.css"
                  : filePaths.includes("index.html")
                    ? "index.html"
                    : filePaths.includes("app/page.tsx")
                      ? "app/page.tsx"
                      : null
                : /section|layout|structure|hero|content|sidebar|footer|header/i.test(
                      content
                    )
                  ? filePaths.includes("index.html")
                    ? "index.html"
                    : filePaths.includes("app/page.tsx")
                      ? "app/page.tsx"
                      : filePaths.includes("styles.css")
                        ? "styles.css"
                        : null
                  : filePaths.includes("index.html")
                    ? "index.html"
                    : filePaths.includes("app/page.tsx")
                      ? "app/page.tsx"
                      : filePaths.includes("styles.css")
                        ? "styles.css"
                        : null;

            if (preferredPath) {
              console.log("[pass1_fallback] forcing read", {
                repoId,
                preferredPath,
              });

              initialHadTools = true;
              pendingTools = [
                {
                  call_id: `fallback_${Date.now()}`,
                  name: "vault_read_text",
                  arguments: JSON.stringify({ path: preferredPath }),
                } as any,
              ];
            }
          } catch (e: any) {
            console.log("[pass1_fallback] failed", {
              repoId,
              message: e?.message ?? "unknown error",
            });
          }
        }

        if (!initialHadTools) {
          if (hasGoalMarkers) {
            console.log("[contract] goal marker response detected; skipping fallback");

            fullText = rawOut.trim();
            controller.enqueue(encoder.encode(fullText));
          } else {
            let out = scrubVisibleToolPayload(rawOut);
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
          }
        } else {
          fullText = "";
        }
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

        console.log("[tool] round start", {
          round,
          count: toolsToRun.length,
          tools: toolsToRun.map((t) => ({
            callId: t.call_id,
            name: t.name,
            argsLen: String(t.arguments ?? "").length,
            argsHead: String(t.arguments ?? "").slice(0, 200),
          })),
        });

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
      console.log("[tool] final args snapshot", {
        toolName,
        callId,
        argsLen: argsJson.length,
        argsHead: argsJson.slice(0, 300),
      });
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

  let out: any;

  try {
    out = await runTool(
      supabase,
      repoId,
      user.id,
      content,
      toolName,
      parsedArgs,
    );
  } catch (e: any) {
    console.log("[tool] runTool threw", {
      toolName,
      callId,
      message: e?.message,
      stack: e?.stack?.slice?.(0, 1000) ?? null,
      parsedArgs,
    });

    toolOutputs.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        error: `runTool failed for ${toolName}: ${e?.message ?? "unknown error"}`,
      }),
    });

    continue;
  }

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

    if (
      createProposal &&
      typeof createProposal === "object" &&
      !("error" in createProposal)
    ) {
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

    if (
      existingFile &&
      typeof existingFile === "object" &&
      !("error" in existingFile)
    ) {
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

      if (
        writeProposal &&
        typeof writeProposal === "object" &&
        !("error" in writeProposal)
      ) {
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
// Deterministic generic repo edit orchestration
// Example: "make it look more premium"
// ─────────────────────────────────────────────
const isEditExecutionMode =
  executionMode.mode === "incremental" ||
  executionMode.mode === "rewrite" ||
  executionMode.mode === "surgical";

if (
  toolName === "vault_list_files" &&
  !requestHandledByOrchestration &&
  isEditExecutionMode &&
  !isCreateAndModifyIntent(content) &&
  !isSourceTargetTransferIntent(content) &&
  out &&
  typeof out === "object" &&
  !("error" in out)
) {
  const files = Array.isArray((out as any).files) ? (out as any).files : [];

  const requestedPath = extractSingleMentionedPath(content);

  const editableFiles = files.filter((f: any) => {
    const path = String(f?.path ?? "").toLowerCase();
    if (!path) return false;
    if (path.startsWith("memory/")) return false;

    return (
      path.endsWith(".html") ||
      path.endsWith(".css") ||
      path.endsWith(".ts") ||
      path.endsWith(".tsx") ||
      path.endsWith(".js") ||
      path.endsWith(".jsx")
    );
  });

  let targetFile: any | null = null;

  if (requestedPath) {
    targetFile =
      editableFiles.find((f: any) => String(f.path) === requestedPath) ?? null;
  }

  if (!targetFile) {
    const cssFile =
      editableFiles.find((f: any) =>
        String(f.path ?? "").toLowerCase().endsWith(".css")
      ) ?? null;

    const htmlFile =
      editableFiles.find((f: any) =>
        String(f.path ?? "").toLowerCase().endsWith(".html")
      ) ?? null;

    const tsxFile =
      editableFiles.find((f: any) =>
        String(f.path ?? "").toLowerCase().endsWith(".tsx")
      ) ?? null;

    const tsFile =
      editableFiles.find((f: any) =>
        String(f.path ?? "").toLowerCase().endsWith(".ts")
      ) ?? null;

    // Prefer CSS first for visual polish requests
    if (/\b(look|design|style|premium|modern|cleaner|nicer|prettier|polish|visual)\b/i.test(content)) {
      targetFile = cssFile ?? htmlFile ?? tsxFile ?? tsFile ?? editableFiles[0] ?? null;
    } else {
      targetFile = htmlFile ?? tsxFile ?? tsFile ?? cssFile ?? editableFiles[0] ?? null;
    }
  }

  if (targetFile?.path) {
    console.log("[generic_edit_orchestration] target selected", {
      repoId,
      requestedPath: requestedPath ?? null,
      selectedPath: targetFile.path,
    });

    const existingFile = await runTool(
      supabase,
      repoId,
      user.id,
      content,
      "vault_read_text",
      { path: targetFile.path },
    );

    if (
      existingFile &&
      typeof existingFile === "object" &&
      !("error" in existingFile)
    ) {
      const resolvedPath = String((existingFile as any).path ?? targetFile.path);
      const resolvedMime = String(
        (existingFile as any).mime ?? targetFile.mime ?? "text/plain"
      );
      const currentContent = String((existingFile as any).content ?? "");

      let rewritten: string;

      try {
        rewritten = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: resolvedPath,
          mime: resolvedMime,
          currentContent,
        });
      } catch (e: any) {
        const msg = String(e?.message ?? "");

        if (!/appears truncated/i.test(msg)) {
          throw e;
        }

        console.log("[generic_edit_orchestration] retrying after truncation", {
          repoId,
          selectedPath: resolvedPath,
          reason: msg,
        });

        rewritten = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest:
            `${content}\n\nRetry rules:\n` +
            `- Return the FULL complete file.\n` +
            `- Do not truncate.\n` +
            `- Keep changes focused.\n` +
            `- Prefer structure over bloated inline styling.\n`,
          path: resolvedPath,
          mime: resolvedMime,
          currentContent,
          maxOutputTokens: 5200,
        });
      }

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

      if (
        writeProposal &&
        typeof writeProposal === "object" &&
        !("error" in writeProposal)
      ) {
        pendingProposalOuts.push(writeProposal);
        requestHandledByOrchestration = true;
      }
    }
  }

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  continue;
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
  verifyCmd: inferredVerifyCmd,
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
const isEditIntent =
  executionMode.mode === "surgical" ||
  executionMode.mode === "incremental" ||
  executionMode.mode === "rewrite";

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
      console.log(
        "[rewrite_orchestration] skipped because requested path does not match read path",
        {
          requestedPath,
          readPath: readOut.path,
        }
      );

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      });

      continue;
    }

    const requestedPaths = extractMentionedPaths(content);

    if (requestedPaths.length >= 2 && !isImportRefactorIntent(content)) {
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


    
    // ─────────────────────────────────────────────
    // Guard: avoid multi-file rewrite on vague incremental requests
    // ─────────────────────────────────────────────
    const isVagueIncremental =
      executionMode.mode === "incremental" &&
      requestedPaths.length === 0;

    if (isVagueIncremental) {
      const primaryTargets = ["index.html", "app/page.tsx"];

      const isPrimary = primaryTargets.some((p) =>
        String(readOut.path ?? "").includes(p)
      );

      if (!isPrimary) {
        console.log("[rewrite_orchestration] skipped secondary file in vague incremental request", {
          readPath: readOut.path,
        });

        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        });

        continue;
      }
    }

    const isMultiPath = requestedPaths.length >= 2;
    const hasRewriteTarget = Boolean(readOut?.path);


    
    if (isMultiPath && !isImportRefactorIntent(content) && !hasRewriteTarget) {
      console.log(
        "[rewrite_orchestration] skipped because multiple paths were requested",
        {
          requestedPaths,
          readPath: readOut.path,
        }
      );

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
      let rewritten: string;

      try {
        rewritten = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: String(readOut.path ?? ""),
          mime: String(readOut.mime ?? "text/plain"),
          currentContent: String(readOut.content ?? ""),
        });
      } catch (e: any) {
        const message = String(e?.message ?? e ?? "");

        if (!/appears truncated/i.test(message)) {
          throw e;
        }

        console.log("[rewrite_orchestration] retrying after truncation", {
          repoId,
          readPath: readOut.path,
          reason: message,
        });

        const retryPrompt = [
          content,
          "",
          "Retry rules:",
          "- Return the FULL complete file.",
          "- Keep the edit compact and focused.",
          "- Do not truncate.",
          "- Do not leave partial sections.",
          "- Prefer minimal safe edits over broad rewrites.",
        ].join("\n");

        rewritten = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: retryPrompt,
          path: String(readOut.path ?? ""),
          mime: String(readOut.mime ?? "text/plain"),
          currentContent: String(readOut.content ?? ""),
          maxOutputTokens: 5200,
        });
      }

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
        }
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
      const message = String(e?.message ?? e ?? "");

      console.log("[rewrite_orchestration] soft-skip", {
        repoId,
        reason: message,
        readPath: readOut.path,
      });

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
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

  console.log("[stream enqueue proposal]", {
    kind: "single",
    fileId: proposal?.fileId,
    path: proposal?.path ?? proposal?.meta?.path ?? null,
    confirm: proposal?.confirm ?? null,
  });

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
  verifyCmd: inferredVerifyCmd,
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
          verifyCmd: "node_verify",
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

  console.log("[stream enqueue proposal_set]", {
    kind: "set",
    count: proposals.length,
    ids: proposals.map((p) => p?.fileId),
    paths: proposals.map((p) => p?.path ?? p?.meta?.path ?? null),
  });

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
  verifyCmd: inferredVerifyCmd,
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
          command: inferredVerifyCmd,
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

const hadDeterministicRewriteFailure =
  toolOutputs.some((t: any) =>
    String(t?.output ?? "").includes("rewrite_orchestration_failed") ||
    String(t?.output ?? "").includes("Rewritten file appears truncated")
  );

const noProposalPrepared =
  !hadAnyProposalSet && pendingProposalOuts.length === 0;

if (hadAnyProposalSet) {
  fullText =
    "[Observation]\nRequired repository changes were staged.\n\n" +
    "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
    "[Action]\nA staged change is ready. Confirm to apply.";

  console.log("[pass2] skipped because proposals already exist");
  controller.enqueue(encoder.encode(fullText));
} else if (
  deterministicToolHandled &&
  hadDeterministicRewriteFailure &&
  noProposalPrepared
) {
  fullText =
    "[Observation]\nThe requested rewrite could not be staged safely.\n\n" +
    "[Assessment]\nThe rewrite attempt failed because the generated file output was truncated before a valid repository proposal could be produced.\n\n" +
    "[Action]\nRetry with a narrower file-scoped request, or split the change into smaller steps.";

  controller.enqueue(encoder.encode(fullText));
} else if (deterministicToolHandled) {
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
      instructions:
        resolvedInstructions +
        "\n\nPass 2 rule:\n" +
        "- Do not emit __GOAL_PLAN__, __GOAL_STATUS__, or __GOAL_DONE__.\n" +
        "- If repository proposals were already prepared, respond only with the normal Vestaryn triplet.\n" +
        "- Do not create a new plan.\n" +
        "- Do not discuss planning.\n" +
        "- Do not claim staged changes unless proposals already exist.\n",
      previous_response_id: lastResponseId as string,
      input: toolOutputs,
      tools: TOOLS,
      tool_choice: "none",
      stream: true,
      max_output_tokens: runtimePolicy.output.maxOutputTokens,
    });

    const pass2 = await streamResponse({
      respStream: resp,
      mode: "pass2",
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

    rawAssistantText = pass2.buffer ?? "";
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
  const normalized = String(fullText ?? "").trim();

  if (!normalized || !hasValidAssistantContract(normalized)) {
    fullText =
      "[Observation]\nRequired repository changes were staged.\n\n" +
      "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
      "[Action]\nA staged change is ready. Confirm to apply.";
  } else if (!normalized.includes("A staged change is ready. Confirm to apply.")) {
    fullText = normalized.replace(
      /\[Action\]\n([\s\S]*)$/,
      "[Action]\n$1\n\nA staged change is ready. Confirm to apply."
    );
  }
}

const rawSourceForPersistence = rawAssistantText || fullText;
let persistedAssistantContent = fullText;

if (!hadAnyProposalSet) {
  const rawGoalPlan = extractRawGoalMarkerBlock(
    rawSourceForPersistence,
    "__GOAL_PLAN__:"
  );
  if (rawGoalPlan) {
    persistedAssistantContent = rawGoalPlan;
  }

  const rawGoalStatus = extractRawGoalMarkerBlock(
    rawSourceForPersistence,
    "__GOAL_STATUS__:"
  );
  if (rawGoalStatus) {
    persistedAssistantContent = rawGoalStatus;
  }

  const rawGoalDone = extractRawGoalMarkerBlock(
    rawSourceForPersistence,
    "__GOAL_DONE__:"
  );
  if (rawGoalDone) {
    persistedAssistantContent = rawGoalDone;
  }
}

console.log("========== ASSISTANT PERSIST DEBUG ==========", {
  rawLen: rawSourceForPersistence.length,
  hasGoalPlanInRaw: rawSourceForPersistence.includes("__GOAL_PLAN__"),
  startsWithGoalPlanInRaw: rawSourceForPersistence.startsWith("__GOAL_PLAN__:"),
  hasGoalPlan: persistedAssistantContent.includes("__GOAL_PLAN__"),
  startsWithGoalPlan: persistedAssistantContent.startsWith("__GOAL_PLAN__:"),
  hasGoalStatus: persistedAssistantContent.includes("__GOAL_STATUS__"),
  startsWithGoalStatus: persistedAssistantContent.startsWith("__GOAL_STATUS__:"),
  length: persistedAssistantContent.length,
  head: persistedAssistantContent.slice(0, 200),
}); 

const { error: aInsErr } = await supabase.from("repo_messages").insert({
  repo_id: repoId,
  user_id: user.id,
  role: "assistant",
  content: persistedAssistantContent,
});

      if (aInsErr) {
        console.log("[repo_messages] assistant insert failed:", aInsErr.message);
      }

            emitMaintenanceIfNeeded({
        controller,
        encoder,
        forceMaintenance,
        totalMsgCount,
        repoId,
        triggerMsgs: MAINTENANCE_TRIGGER_MSGS,
      });

        await autoResummarizeIfNeeded({
        repoId,
        totalMsgCount,
      });

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