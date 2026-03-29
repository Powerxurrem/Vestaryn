import OpenAI from "openai";
import { TOOLS } from "@/lib/vault/toolRuntime";
import { hasValidAssistantContract } from "@/lib/chamber/output";
import { streamResponse } from "@/lib/chamber/streamRuntime";
import {
  scrubVisibleToolPayload,
  ensureTriplet,
  stripDuplicateTriplet,
} from "@/lib/vault/utils";

type FinalizeAssistantTurnOrchestrationArgs = {
  ctx: {
    openai: OpenAI;
    resolvedInstructions: string;
    runtimePolicy: any;
    t0: number;
  };
  state: {
    lastResponseId: string | null;
    fullText: string;
    rawAssistantText: string;
    hadAnyProposalSet: boolean;
    deterministicToolHandled: boolean;
    toolOutputs: any[];
    firstTokenTime: number | null;
  };
  io: {
    controller: ReadableStreamDefaultController<Uint8Array>;
    encoder: TextEncoder;
  };
};

type FinalizeAssistantTurnOrchestrationResult = {
  fullText: string;
  rawAssistantText: string;
  firstTokenTime: number | null;
};

export async function finalizeAssistantTurnOrchestration({
  ctx,
  state,
  io,
}: FinalizeAssistantTurnOrchestrationArgs): Promise<FinalizeAssistantTurnOrchestrationResult> {
  const {
    openai,
    resolvedInstructions,
    runtimePolicy,
    t0,
  } = ctx;

  let {
    lastResponseId,
    fullText,
    rawAssistantText,
    hadAnyProposalSet,
    deterministicToolHandled,
    toolOutputs,
    firstTokenTime,
  } = state;

  const { controller, encoder } = io;

  const hadDeterministicRewriteFailure =
    toolOutputs.some((t: any) =>
      String(t?.output ?? "").includes("rewrite_orchestration_failed") ||
      String(t?.output ?? "").includes("Rewritten file appears truncated")
    );

  const noProposalPrepared = !hadAnyProposalSet;

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
      inputPreview: JSON.stringify(toolOutputs).slice(0, 1000),
    });

    if (!lastResponseId) {
      throw new Error("Missing response id; cannot send tool output");
    }

    let resp: any;

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
        previous_response_id: lastResponseId,
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

  const claimsStagedChange = fullText.includes(
    "A staged change is ready. Confirm to apply."
  );

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

  return {
    fullText,
    rawAssistantText,
    firstTokenTime,
  };
}