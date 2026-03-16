import OpenAI from "openai";
import {
  runPreVerifyForProposalSet,
  isBaselinePreverifyFailure,
  attemptRepairProposalSet,
} from "@/lib/chamber/verify";

export async function finalizeProposalSet(opts: {
  openai: OpenAI;
  model: string;
  repoId: string;
  userRequest: string;
  baselineVerifyPayload: any;
  proposals: Array<{
    fileId: string;
    content: string;
    path?: string | null;
    mime?: string | null;
    meta?: any;
  }>;
}) {
  const {
    openai,
    model,
    repoId,
    userRequest,
    baselineVerifyPayload,
  } = opts;

  let finalProposals = [...opts.proposals];
  let repaired = false;

  let preverify = await runPreVerifyForProposalSet({
    repoId,
    proposals: finalProposals,
  });

  console.log("[preverify] result", {
    ok: preverify.ok,
    failedStep: preverify.failedStep,
    failureKind: preverify.failureKind,
    fileIds: preverify.fileIds,
  });

  const baselineNoise = isBaselinePreverifyFailure(
    baselineVerifyPayload,
    preverify
  );

  if (!preverify.ok && !baselineNoise) {
    console.log("[preverify] failed, attempting repair");

    try {
      const repairedSet = await attemptRepairProposalSet({
        openai,
        model,
        userRequest,
        proposals: finalProposals,
        preverify,
      });

      finalProposals = repairedSet;
      repaired = true;

      preverify = await runPreVerifyForProposalSet({
        repoId,
        proposals: finalProposals,
      });

      console.log("[preverify] repaired result", {
        ok: preverify.ok,
        failedStep: preverify.failedStep,
        failureKind: preverify.failureKind,
        fileIds: preverify.fileIds,
      });
    } catch (repairErr: any) {
      console.log("[preverify] repair failed", repairErr?.message);
    }
  }

  return {
    finalProposals,
    repaired,
    preverifyPayload: {
      ...preverify,
      baseline: baselineNoise,
    },
  };
}