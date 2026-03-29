import OpenAI from "openai";
import { TOOLS } from "@/lib/vault/toolRuntime";
import { scrubVisibleToolPayload, ensureTriplet, stripDuplicateTriplet } from "@/lib/vault/utils";
import { hasValidAssistantContract } from "@/lib/chamber/output";

type ExplainModeOrchestrationArgs = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  executionMode: any;
  runtimePolicy: any;
  resolvedInstructions: string;
  membershipBlock: string;
  sacredBlock: string;
  profileBlock: string;
  masterBlock: string;
  chamberBlock: string;
  treeBlock: string;
  ledgerBlock: string;
  cleanedHistory: Array<{ role: string; content: string }>;
};

export async function tryHandleExplainModeOrchestration({
  openai,
  supabase,
  repoId,
  userId,
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
}: ExplainModeOrchestrationArgs): Promise<Response | null> {
  if (executionMode.mode !== "explain") {
    return null;
  }

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
    user_id: userId,
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