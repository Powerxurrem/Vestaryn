// lib/chamber/toolOrchestration/toolExecutionLoopOrchestration.ts

type ToolExecutionLoopArgs = {
  toolsToRun: any[];
  ctx: any;
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

export async function runToolExecutionLoop({
  toolsToRun,
  ctx,
  toolArgsByCallId,
  state,
  io,
}: ToolExecutionLoopArgs) {
  const toolOutputs: any[] = [];

  for (const tool of toolsToRun) {
    const toolResult = await ctx.executeToolOrchestration({
      ctx,
      tool,
      toolArgsByCallId,
      state,
      io,
    });

    state.requestHandledByOrchestration =
      toolResult.requestHandledByOrchestration;
    state.pendingProposalOuts =
      toolResult.pendingProposalOuts;
    state.handledSplitTurn =
      toolResult.handledSplitTurn;
    state.deterministicToolHandled =
      toolResult.deterministicToolHandled;
    state.fullText =
      toolResult.fullText;

    toolOutputs.push(...toolResult.toolOutputs);

    if (toolResult.shouldContinue) {
      continue;
    }
  }

  return {
    state,
    toolOutputs,
  };
}