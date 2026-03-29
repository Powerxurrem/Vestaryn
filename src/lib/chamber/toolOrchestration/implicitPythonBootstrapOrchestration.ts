import OpenAI from "openai";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import { generateNewFileContent } from "@/lib/chamber/generation";
import { runTool } from "@/lib/vault/toolRuntime";

type ImplicitPythonBootstrapOrchestrationArgs = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  inference: any;
  executionMode: any;
  runtimePolicy: any;
  requestHandledByOrchestration: boolean;
  isImplicitPythonScriptBootstrapRequest: (text: string) => boolean;
};

export async function tryHandleImplicitPythonBootstrapOrchestration({
  openai,
  supabase,
  repoId,
  userId,
  content,
  inference,
  executionMode,
  runtimePolicy,
  requestHandledByOrchestration,
  isImplicitPythonScriptBootstrapRequest,
}: ImplicitPythonBootstrapOrchestrationArgs): Promise<Response | null> {
  if (
    requestHandledByOrchestration ||
    !inference?.needsBootstrap ||
    executionMode?.hasExplicitPaths ||
    !isImplicitPythonScriptBootstrapRequest(content)
  ) {
    return null;
  }

  const createPath = "scripts/generate_xlsx.py";
  const mime = inferTextMimeFromPath(createPath);

  const newContent = await generateNewFileContent({
    openai,
    model: runtimePolicy.model,
    userRequest:
      `${content}\n\n` +
      `Create the file at ${createPath}.\n` +
      `Return a complete runnable Python script.\n` +
      `Use openpyxl.\n`,
    path: createPath,
    mime,
    maxOutputTokens: 5200,
  });

  const proposal = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_propose_create",
    {
      path: createPath,
      content: newContent,
      mime,
    }
  );

  if (!proposal || typeof proposal !== "object" || "error" in proposal) {
    return null;
  }

  const visible =
    "[Observation]\nRequired repository changes were staged.\n\n" +
    "[Assessment]\nA new Python workbook generator was prepared for the empty repository.\n\n" +
    "[Action]\nA staged change is ready. Confirm to apply.";

  return new Response(
    `${visible}\n\n__PROPOSAL__:${JSON.stringify(proposal)}\n`,
    {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
}