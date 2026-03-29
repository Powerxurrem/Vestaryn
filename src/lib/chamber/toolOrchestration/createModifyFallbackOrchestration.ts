import OpenAI from "openai";
import { extractMentionedPaths, isCreateAndModifyIntent } from "@/lib/chamber/intent";
import { generateRewrittenFileContent } from "@/lib/chamber/generation";
import { runTool } from "@/lib/vault/toolRuntime";

type CreateModifyFallbackOrchestrationArgs = {
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
  state: {
    requestHandledByOrchestration: boolean;
    pendingProposalOuts: any[];
  };
};

type CreateModifyFallbackOrchestrationResult = {
  handled: boolean;
  requestHandledByOrchestration: boolean;
  pendingProposalOuts: any[];
};

export async function tryHandleCreateModifyFallbackOrchestration({
  ctx,
  toolName,
  out,
  state,
}: CreateModifyFallbackOrchestrationArgs): Promise<CreateModifyFallbackOrchestrationResult> {
  const { openai, supabase, repoId, userId, content, runtimePolicy } = ctx;
  let { requestHandledByOrchestration, pendingProposalOuts } = state;

  if (
    toolName !== "vault_propose_create" ||
    !out ||
    typeof out !== "object" ||
    "error" in out ||
    !isCreateAndModifyIntent(content) ||
    requestHandledByOrchestration
  ) {
    return {
      handled: false,
      requestHandledByOrchestration,
      pendingProposalOuts,
    };
  }

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

  if (!modifyPath) {
    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
    };
  }

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

  return {
    handled: true,
    requestHandledByOrchestration,
    pendingProposalOuts,
  };
}