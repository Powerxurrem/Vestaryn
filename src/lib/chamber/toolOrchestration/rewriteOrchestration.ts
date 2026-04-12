import OpenAI from "openai";
import { runTool } from "@/lib/vault/toolRuntime";
import { vault_read_text, resolveFileIdByPathOrName } from "@/lib/vault/tools";
import {
  generateRewrittenFileContent,
  buildRequirementsTxtContentFromPython,
  mergeRequirementsTxt,
} from "@/lib/chamber/generation";
import { isSourceTargetTransferIntent } from "@/lib/chamber/refactorIntent";

type RewriteOrchestrationArgs = {
  ctx: {
    openai: OpenAI;
    supabase: any;
    repoId: string;
    userId: string;
    content: string;
    runtimePolicy: any;
    executionMode: any;
    continuityTargetPath: string | null;
    getEffectiveSinglePath: () => string | null;
    getEffectiveMentionedPaths: () => string[];
    resolveEditTarget: (
      mentionedPaths: string[],
      content: string,
      availableFiles?: string[],
      continuityTargetPath?: string | null
    ) => {
      target: string | null;
      references: string[];
      preserveMultiTarget: boolean;
    };
    getAvailableFiles?: () => string[];
  };
  toolName: string;
  out: any;
  callId: string;
  state: {
    requestHandledByOrchestration: boolean;
    pendingProposalOuts: any[];
  };
};

type RewriteOrchestrationResult = {
  handled: boolean;
  requestHandledByOrchestration: boolean;
  pendingProposalOuts: any[];
  deterministicToolHandled?: boolean;
  toolOutput?: {
    type: "function_call_output";
    call_id: string;
    output: string;
  };
};

async function stagePythonRequirementsRewrite(args: {
  supabase: any;
  repoId: string;
  userId: string;
  userMessage: string;
  pythonPath: string;
  rewrittenPython: string;
}) {
  const { supabase, repoId, userId, userMessage, pythonPath, rewrittenPython } = args;

  if (!/\.py$/i.test(String(pythonPath ?? "").trim())) {
    return null;
  }

  const requirementsPath = "requirements.txt";
  const generatedRequirements = buildRequirementsTxtContentFromPython(rewrittenPython);

  const existingRequirementsId = await resolveFileIdByPathOrName(
    supabase,
    repoId,
    requirementsPath
  );

  if (!existingRequirementsId) {
    const proposal = await runTool(
      supabase,
      repoId,
      userId,
      userMessage,
      "vault_propose_create",
      {
        path: requirementsPath,
        content: generatedRequirements,
        mime: "text/plain",
      }
    );

    if (!proposal || typeof proposal !== "object" || "error" in proposal) {
      throw new Error("requirements create proposal failed");
    }

    return proposal;
  }

  const existingRequirements = await vault_read_text(
    supabase,
    repoId,
    existingRequirementsId
  );

  const mergedRequirements = mergeRequirementsTxt(
    String(existingRequirements?.content ?? ""),
    generatedRequirements
  );

  const proposal = await runTool(
    supabase,
    repoId,
    userId,
    userMessage,
    "vault_propose_write",
    {
      fileId: existingRequirementsId,
      content: mergedRequirements,
    }
  );

  if (!proposal || typeof proposal !== "object" || "error" in proposal) {
    throw new Error("requirements write proposal failed");
  }

  if ((proposal as any).noop === true) {
    return null;
  }

  return proposal;
}

export async function tryHandleRewriteOrchestration({
  ctx,
  toolName,
  out,
  callId,
  state,
}: RewriteOrchestrationArgs): Promise<RewriteOrchestrationResult> {
  if (toolName !== "vault_read_text") {
    return {
      handled: false,
      requestHandledByOrchestration: state.requestHandledByOrchestration,
      pendingProposalOuts: state.pendingProposalOuts,
    };
  }

  const {
  openai,
  supabase,
  repoId,
  userId,
  content,
  runtimePolicy,
  executionMode,
  continuityTargetPath,
  getEffectiveSinglePath,
  getEffectiveMentionedPaths,
  getAvailableFiles,
  resolveEditTarget,
} = ctx;

  let { requestHandledByOrchestration, pendingProposalOuts } = state;

  const isEditIntent =
    executionMode.mode === "surgical" ||
    executionMode.mode === "incremental" ||
    executionMode.mode === "rewrite";

  if (
    !isEditIntent ||
    isSourceTargetTransferIntent(content) ||
    !out ||
    typeof out !== "object" ||
    "error" in out
  ) {
    return {
      handled: false,
      requestHandledByOrchestration,
      pendingProposalOuts,
    };
  }

  const readOut = out as {
    id: string;
    path?: string;
    mime?: string;
    content: string;
  };

  const continuityPinnedThisRead =
    !!continuityTargetPath &&
    String(readOut.path ?? "").trim() === String(continuityTargetPath).trim();

  console.log("[rewrite_orchestration.context]", {
    readPath: readOut.path ?? null,
    continuityTargetPath,
    continuityPinnedThisRead,
    isConcreteModificationIntent:
      /\b(change|edit|update|modify|fix|add|remove|rename|make|restyle|polish|adjust)\b/i.test(
        content
      ),
  });

  if (!(typeof readOut.id === "string" && typeof readOut.content === "string")) {
    return {
      handled: false,
      requestHandledByOrchestration,
      pendingProposalOuts,
    };
  }

  const requestedPath = getEffectiveSinglePath();

  if (requestedPath && readOut.path && requestedPath !== readOut.path) {
    console.log(
      "[rewrite_orchestration] skipped because requested path does not match read path",
      {
        requestedPath,
        readPath: readOut.path,
      }
    );

    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      deterministicToolHandled: true,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
  }

  let requestedPaths = getEffectiveMentionedPaths();
  let rewriteReferences: string[] = [];

  const availableFiles = getAvailableFiles?.() ?? [];

  if (requestedPaths.length >= 2 || (requestedPaths.length === 0 && continuityTargetPath)) {
    const resolved = resolveEditTarget(
      requestedPaths,
      content,
      availableFiles,
      continuityTargetPath
    );

    console.log("[smart_target_resolution]", {
      requestedPaths,
      availableFilesCount: availableFiles.length,
      continuityTargetPath,
      target: resolved.target,
      references: resolved.references,
      preserveMultiTarget: resolved.preserveMultiTarget,
      readPath: readOut.path,
    });

    if (resolved.preserveMultiTarget) {
      console.log("[rewrite_orchestration] preserving multi-target request", {
        requestedPaths,
        readPath: readOut.path,
      });

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        deterministicToolHandled: true,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }

    if (!resolved.target) {
      console.log(
        "[rewrite_orchestration] skipped because multiple paths were requested",
        {
          requestedPaths,
          readPath: readOut.path,
        }
      );

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        deterministicToolHandled: true,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }

    requestedPaths = [resolved.target];
    rewriteReferences = resolved.references;

    if (readOut.path && resolved.target !== readOut.path) {
      console.log(
        "[rewrite_orchestration] skipped because resolved target does not match read path",
        {
          requestedPaths,
          target: resolved.target,
          references: rewriteReferences,
          readPath: readOut.path,
        }
      );

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        deterministicToolHandled: true,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }

    console.log(
      "[rewrite_orchestration] downgraded multi-path request to single edit target",
      {
        target: resolved.target,
        references: rewriteReferences,
        readPath: readOut.path,
      }
    );
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

    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      deterministicToolHandled: true,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
  }

  const isVagueIncremental =
    executionMode.mode === "incremental" &&
    requestedPaths.length === 0 &&
    !continuityPinnedThisRead;

  if (isVagueIncremental) {
    const primaryTargets = ["index.html", "app/page.tsx"];

    const isPrimary = primaryTargets.some((p) =>
      String(readOut.path ?? "").includes(p)
    );

    if (!isPrimary) {
      console.log(
        "[rewrite_orchestration] skipped secondary file in vague incremental request",
        {
          readPath: readOut.path,
        }
      );

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        deterministicToolHandled: true,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }
  }

  const isMultiPath = requestedPaths.length >= 2;
  const hasRewriteTarget = Boolean(readOut?.path);

  if (isMultiPath && !hasRewriteTarget) {
    console.log(
      "[rewrite_orchestration] skipped because multiple paths were requested",
      {
        requestedPaths,
        readPath: readOut.path,
      }
    );

    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      deterministicToolHandled: true,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
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
        userRequest:
          rewriteReferences.length > 0
            ? `${content}\n\nReference files mentioned but not to be rewritten: ${rewriteReferences.join(", ")}`
            : content,
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
        rewriteReferences.length > 0
          ? `Reference files mentioned but not to be rewritten: ${rewriteReferences.join(", ")}`
          : "",
        "",
        "Retry rules:",
        "- Return the FULL complete file.",
        "- Keep the edit compact and focused.",
        "- Do not truncate.",
        "- Do not leave partial sections.",
        "- Prefer minimal safe edits over broad rewrites.",
      ]
        .filter(Boolean)
        .join("\n");

      rewritten = await generateRewrittenFileContent({
        openai,
        model: runtimePolicy.model,
        userRequest: retryPrompt,
        path: String(readOut.path ?? ""),
        mime: String(readOut.mime ?? "text/plain"),
        currentContent: String(readOut.content ?? ""),
        maxOutputTokens: 10000,
      });
    }

    if (!rewritten) {
      throw new Error("Model returned empty rewritten content");
    }

    const proposal = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_propose_write",
      {
        fileId: readOut.id,
        content: rewritten,
      }
    );

    if (proposal && typeof proposal === "object" && !("error" in proposal)) {
      pendingProposalOuts = [...pendingProposalOuts, proposal];
    }

if (/\.py$/i.test(String(readOut.path ?? ""))) {
  const requirementsProposal = await stagePythonRequirementsRewrite({
    supabase,
    repoId,
    userId,
    userMessage: content,
    pythonPath: String(readOut.path ?? ""),
    rewrittenPython: String(rewritten ?? ""),
  });

  if (
    requirementsProposal &&
    typeof requirementsProposal === "object" &&
    !("error" in requirementsProposal)
  ) {
    pendingProposalOuts = [...pendingProposalOuts, requirementsProposal];
  }
}

    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      deterministicToolHandled: true,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
  } catch (e: any) {
    const message = String(e?.message ?? e ?? "");

    console.log("[rewrite_orchestration] soft-skip", {
      repoId,
      reason: message,
      readPath: readOut.path,
    });

    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      deterministicToolHandled: true,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
  }
}