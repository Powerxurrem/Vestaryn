import OpenAI from "openai";
import { runTool } from "@/lib/vault/toolRuntime";
import { generateRewrittenFileContent } from "@/lib/chamber/generation";
import { extractMentionedPaths, isCreateAndModifyIntent } from "@/lib/chamber/intent";

type ProposalCollectionOrchestrationArgs = {
  ctx: {
    openai: OpenAI;
    supabase: any;
    repoId: string;
    userId: string;
    content: string;
    runtimePolicy: any;
  };
  toolName: string;
  out: any;
  callId: string;
  state: {
    requestHandledByOrchestration: boolean;
    pendingProposalOuts: any[];
  };
};

type ProposalCollectionOrchestrationResult = {
  requestHandledByOrchestration: boolean;
  pendingProposalOuts: any[];
  toolOutput?: {
    type: "function_call_output";
    call_id: string;
    output: string;
  };
};

export async function tryHandleProposalCollectionOrchestration({
  ctx,
  toolName,
  out,
  callId,
  state,
}: ProposalCollectionOrchestrationArgs): Promise<ProposalCollectionOrchestrationResult> {
  const {
    openai,
    supabase,
    repoId,
    userId,
    content,
    runtimePolicy,
  } = ctx;

  let { requestHandledByOrchestration, pendingProposalOuts } = state;

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
    pendingProposalOuts = [...pendingProposalOuts, out];
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
        userId,
        content,
        "vault_read_text",
        { path: modifyPath }
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
          userId,
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
          pendingProposalOuts = [...pendingProposalOuts, writeProposal];
        }
      }
    }
  }

  return {
    requestHandledByOrchestration,
    pendingProposalOuts,
    toolOutput: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(out),
    },
  };
}