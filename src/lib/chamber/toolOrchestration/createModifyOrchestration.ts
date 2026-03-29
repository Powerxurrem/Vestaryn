import OpenAI from "openai";
import { extractMentionedPaths, isCreateAndModifyIntent } from "@/lib/chamber/intent";
import { runTool } from "@/lib/vault/toolRuntime";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import { resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { generateRewrittenFileContent } from "@/lib/chamber/generation";

type CreateModifyArgs = {
  ctx: {
    openai: OpenAI;
    supabase: any;
    repoId: string;
    userId: string;
    content: string;
    runtimePolicy: any;

    generateNewFileContentSafe: (args: {
      openai: OpenAI;
      model: string;
      userRequest: string;
      path: string;
      mime: string;
      maxOutputTokens?: number;
    }) => Promise<string>;
  };

  toolName: string;
  out: any;
  callId: string;

  state: {
    requestHandledByOrchestration: boolean;
    pendingProposalOuts: any[];
  };
};

type CreateModifyResult = {
  handled: boolean;
  requestHandledByOrchestration: boolean;
  pendingProposalOuts: any[];

  toolOutput?: {
    type: "function_call_output";
    call_id: string;
    output: string;
  };
};

export async function tryHandleCreateModifyOrchestration({
  ctx,
  toolName,
  out,
  callId,
  state,
}: CreateModifyArgs): Promise<CreateModifyResult> {
  if (
    toolName !== "vault_read_text" ||
    !isCreateAndModifyIntent(ctx.content) ||
    !out ||
    typeof out !== "object" ||
    "error" in out
  ) {
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
    generateNewFileContentSafe,
  } = ctx;

  let { requestHandledByOrchestration, pendingProposalOuts } = state;

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
    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
  }

  const createExists = await resolveFileIdByPathOrName(
    supabase,
    repoId,
    createPath
  );

  const modifyExists = await resolveFileIdByPathOrName(
    supabase,
    repoId,
    modifyPath
  );

  console.log("[create_modify_orchestration] detected", {
    createPath,
    modifyPath,
    createExists: Boolean(createExists),
    modifyExists: Boolean(modifyExists),
  });

  if (createExists || !modifyExists) {
    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
  }

  requestHandledByOrchestration = true;

  try {
    // ───────── CREATE FILE
    const newFileContent = await generateNewFileContentSafe({
      openai,
      model: runtimePolicy.model,
      userRequest: content,
      path: createPath,
      mime: inferTextMimeFromPath(createPath),
    });

    const createProposal = await runTool(
      supabase,
      repoId,
      userId,
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

    // ───────── MODIFY EXISTING FILE
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
      userId,
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

    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
  } catch (e: any) {
    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          error: `create_modify_orchestration_failed: ${e?.message ?? "unknown error"}`,
        }),
      },
    };
  }
}