import OpenAI from "openai";
import { runTool } from "@/lib/vault/toolRuntime";
import { tryHandleListFilesOrchestration } from "@/lib/chamber/toolOrchestration/listFilesOrchestration";
import { tryHandleReadTextOrchestration } from "@/lib/chamber/toolOrchestration/readTextOrchestration";
import { tryHandleRewriteOrchestration } from "@/lib/chamber/toolOrchestration/rewriteOrchestration";
import { tryHandleProposalCollectionOrchestration } from "@/lib/chamber/toolOrchestration/proposalCollectionOrchestration";
import { tryHandleCreateModifyFallbackOrchestration } from "@/lib/chamber/toolOrchestration/createModifyFallbackOrchestration";

type ToolExecutionArgs = {
  ctx: {
    openai: OpenAI;
    supabase: any;
    repoId: string;
    userId: string;
    content: string;
    runtimePolicy: any;
    tierPolicy: any;
    executionMode: any;
    continuityTargetPath: string | null;
    baselineVerify: any;
    inferredVerifyCmd: string | null;
    generateNewFileContentSafe: (args: {
      openai: OpenAI;
      model: string;
      userRequest: string;
      path: string;
      mime: string;
      maxOutputTokens?: number;
    }) => Promise<string>;
    getEffectiveSinglePath: () => string | null;
    getEffectiveMentionedPaths: () => string[];
    resolveEditTarget: (
      mentionedPaths: string[],
      content: string
    ) => {
      target: string | null;
      references: string[];
      preserveMultiTarget: boolean;
    };
  };
  tool: {
    call_id: string;
    name: string;
    arguments: string;
  };
  toolArgsByCallId: Map<string, string>;
  state: {
    requestHandledByOrchestration: boolean;
    pendingProposalOuts: any[];
    handledSplitTurn: boolean;
    deterministicToolHandled: boolean;
    fullText: string;
  };
  io: {
    controller: ReadableStreamDefaultController<Uint8Array>;
    encoder: TextEncoder;
  };
};

type ToolExecutionResult = {
  requestHandledByOrchestration: boolean;
  pendingProposalOuts: any[];
  handledSplitTurn: boolean;
  deterministicToolHandled: boolean;
  fullText: string;
  toolOutputs: any[];
  shouldContinue: boolean;
};

export async function executeToolOrchestration({
  ctx,
  tool,
  toolArgsByCallId,
  state,
  io,
}: ToolExecutionArgs): Promise<ToolExecutionResult> {
  const {
    openai,
    supabase,
    repoId,
    userId,
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
    resolveEditTarget,
  } = ctx;

  const { controller, encoder } = io;

  let {
    requestHandledByOrchestration,
    pendingProposalOuts,
    handledSplitTurn,
    deterministicToolHandled,
    fullText,
  } = state;

  const callId = tool.call_id;
  const toolName = tool.name;
  const toolOutputs: any[] = [];

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

      return {
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        deterministicToolHandled,
        fullText,
        toolOutputs,
        shouldContinue: true,
      };
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

    return {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      deterministicToolHandled,
      fullText,
      toolOutputs,
      shouldContinue: true,
    };
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

        return {
          requestHandledByOrchestration,
          pendingProposalOuts,
          handledSplitTurn,
          deterministicToolHandled,
          fullText,
          toolOutputs,
          shouldContinue: true,
        };
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

        return {
          requestHandledByOrchestration,
          pendingProposalOuts,
          handledSplitTurn,
          deterministicToolHandled,
          fullText,
          toolOutputs,
          shouldContinue: true,
        };
      }
    }
  }

  if (toolName === "vault_propose_create" && !tierPolicy.capabilities.allowCreateFiles) {
    const path = String(parsedArgs?.path ?? "").trim();

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

    return {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      deterministicToolHandled,
      fullText,
      toolOutputs,
      shouldContinue: true,
    };
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

    return {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      deterministicToolHandled,
      fullText,
      toolOutputs,
      shouldContinue: true,
    };
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

    return {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      deterministicToolHandled,
      fullText,
      toolOutputs,
      shouldContinue: true,
    };
  }

  let out: any;

  try {
    out = await runTool(
      supabase,
      repoId,
      userId,
      content,
      toolName,
      parsedArgs
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

    return {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      deterministicToolHandled,
      fullText,
      toolOutputs,
      shouldContinue: true,
    };
  }

  const listFilesOrchestration =
  (await tryHandleListFilesOrchestration({
    ctx: {
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
      generateNewFileContentSafe,
    },
    toolName,
    out,
    callId,
    state: {
      requestHandledByOrchestration,
      pendingProposalOuts,
    },
  })) ?? {
    handled: false,
    requestHandledByOrchestration,
    pendingProposalOuts,
  };

  if (listFilesOrchestration.handled) {
    requestHandledByOrchestration =
      listFilesOrchestration.requestHandledByOrchestration;
    pendingProposalOuts = listFilesOrchestration.pendingProposalOuts;
    deterministicToolHandled =
      listFilesOrchestration.deterministicToolHandled ?? deterministicToolHandled;

    if (listFilesOrchestration.assistantText) {
      fullText = listFilesOrchestration.assistantText;
      controller.enqueue(encoder.encode(listFilesOrchestration.assistantText));
    }

    if (listFilesOrchestration.toolOutput) {
      toolOutputs.push(listFilesOrchestration.toolOutput);
    }

    return {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      deterministicToolHandled,
      fullText,
      toolOutputs,
      shouldContinue: true,
    };
  }

  const readTextOrchestration = await tryHandleReadTextOrchestration({
    ctx: {
      openai,
      supabase,
      repoId,
      userId,
      content,
      runtimePolicy,
      executionMode,
      baselineVerify,
      inferredVerifyCmd,
      generateNewFileContentSafe,
    },
    toolName,
    out,
    callId,
    state: {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
    },
  });

  if (readTextOrchestration.handled) {
    requestHandledByOrchestration =
      readTextOrchestration.requestHandledByOrchestration;
    pendingProposalOuts = readTextOrchestration.pendingProposalOuts;
    handledSplitTurn =
      readTextOrchestration.handledSplitTurn ?? handledSplitTurn;
    deterministicToolHandled =
      readTextOrchestration.deterministicToolHandled ?? deterministicToolHandled;

    if (readTextOrchestration.assistantText) {
      fullText = readTextOrchestration.assistantText;
      controller.enqueue(encoder.encode(readTextOrchestration.assistantText));
    }

    if (readTextOrchestration.preverifyPayload) {
      controller.enqueue(
        encoder.encode(
          `\n__PREVERIFY__:${JSON.stringify(readTextOrchestration.preverifyPayload)}\n`
        )
      );
    }

    if (readTextOrchestration.toolOutput) {
      toolOutputs.push(readTextOrchestration.toolOutput);
    }

    return {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      deterministicToolHandled,
      fullText,
      toolOutputs,
      shouldContinue: true,
    };
  }

  const rewriteOrchestration = await tryHandleRewriteOrchestration({
    ctx: {
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
      resolveEditTarget,
    },
    toolName,
    out,
    callId,
    state: {
      requestHandledByOrchestration,
      pendingProposalOuts,
    },
  });

  if (rewriteOrchestration.handled) {
    requestHandledByOrchestration =
      rewriteOrchestration.requestHandledByOrchestration;
    pendingProposalOuts = rewriteOrchestration.pendingProposalOuts;
    deterministicToolHandled =
      rewriteOrchestration.deterministicToolHandled ?? deterministicToolHandled;

    if (rewriteOrchestration.toolOutput) {
      toolOutputs.push(rewriteOrchestration.toolOutput);
    }

    return {
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      deterministicToolHandled,
      fullText,
      toolOutputs,
      shouldContinue: true,
    };
  }

  const proposalCollectionOrchestration =
    await tryHandleProposalCollectionOrchestration({
      ctx: {
        openai,
        supabase,
        repoId,
        userId,
        content,
        runtimePolicy,
      },
      toolName,
      out,
      callId,
      state: {
        requestHandledByOrchestration,
        pendingProposalOuts,
      },
    });

  requestHandledByOrchestration =
    proposalCollectionOrchestration.requestHandledByOrchestration;
  pendingProposalOuts =
    proposalCollectionOrchestration.pendingProposalOuts;

  if (proposalCollectionOrchestration.toolOutput) {
    toolOutputs.push(proposalCollectionOrchestration.toolOutput);
  }

  const createModifyFallbackOrchestration =
    await tryHandleCreateModifyFallbackOrchestration({
      ctx: {
        openai,
        supabase,
        repoId,
        userId,
        content,
        runtimePolicy,
      },
      toolName,
      out,
      state: {
        requestHandledByOrchestration,
        pendingProposalOuts,
      },
    });

  if (createModifyFallbackOrchestration.handled) {
    requestHandledByOrchestration =
      createModifyFallbackOrchestration.requestHandledByOrchestration;
    pendingProposalOuts =
      createModifyFallbackOrchestration.pendingProposalOuts;
  }

  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(out),
  });

  return {
    requestHandledByOrchestration,
    pendingProposalOuts,
    handledSplitTurn,
    deterministicToolHandled,
    fullText,
    toolOutputs,
    shouldContinue: false,
  };
}