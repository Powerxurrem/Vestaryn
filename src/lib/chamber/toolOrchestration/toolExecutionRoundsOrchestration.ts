// lib/chamber/toolOrchestration/toolExecutionRoundsOrchestration.ts

type ToolExecutionRoundsArgs = {
  pendingTools: any[];
  runtimePolicy: any;
  tierPolicy: any;
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

export async function runToolExecutionRounds({
  pendingTools,
  runtimePolicy,
  tierPolicy,
  ctx,
  toolArgsByCallId,
  state,
  io,
}: ToolExecutionRoundsArgs) {
  const toolOutputs: any[] = [];

  for (let round = 0; round < runtimePolicy.tools.maxToolRounds; round++) {
    if (pendingTools.length === 0) break;

    let toolsToRun = pendingTools;
    pendingTools = [];

    console.log("[tool] round start", {
      round,
      count: toolsToRun.length,
    });

    if (toolsToRun.length > runtimePolicy.tools.maxToolCallsPerRound) {
      console.log("[tool] per-round cap exceeded", {
        requested: toolsToRun.length,
        allowed: tierPolicy.tools.maxToolCallsPerRound,
      });

      toolsToRun = toolsToRun.slice(0, tierPolicy.tools.maxToolCallsPerRound);
    }

    if (pendingTools.length > 0) {
      console.log("[tool] max rounds reached");

      const terminationNotice =
        "[Observation]\nTool execution depth limit reached.\n\n" +
        "[Assessment]\nThe current tier does not allow additional tool rounds.\n\n" +
        "[Action]\nRefine the request or upgrade tier for deeper operations.";

      io.controller.enqueue(io.encoder.encode(terminationNotice));
      state.fullText = terminationNotice;
      break;
    }

    const loopResult = await ctx.runToolExecutionLoop({
      toolsToRun,
      ctx,
      toolArgsByCallId,
      state,
      io,
    });

    state = loopResult.state;
    toolOutputs.push(...loopResult.toolOutputs);
  }

  return {
    state,
    toolOutputs,
  };
}