import OpenAI from "openai";
import {
  runPreVerifyForProposalSet,
  isBaselinePreverifyFailure,
  attemptRepairProposalSet,
} from "@/lib/chamber/verify";
import { loadRepoInference } from "@/lib/chamber/repoContext";
import { resolveVerifyCommand, type VerifyCommand } from "@/lib/chamber/verifyRuntime";

export async function finalizeProposalSet(opts: {
  openai: OpenAI;
  model: string;
  repoId: string;
  userRequest: string;
  baselineVerifyPayload: any;
  verifyCmd: VerifyCommand | null;
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
  verifyCmd,
} = opts;

  let finalProposals = [...opts.proposals];
  let repaired = false;

  let preverify:
    | {
        ok: boolean;
        skipped: boolean;
        command: VerifyCommand | null;
        exitCode: number;
        durationMs: number;
        stdout: string;
        stderr: string;
        error: string | null;
        failedStep: string | null;
        failureKind: string | null;
        timedOut: boolean;
        fileIds: string[];
      }
    | Awaited<ReturnType<typeof runPreVerifyForProposalSet>>;

  if (verifyCmd) {
    preverify = await runPreVerifyForProposalSet({
      repoId,
      proposals: finalProposals,
      verifyCmd,
    });
  } else {
    preverify = {
      ok: true,
      skipped: true,
      command: null,
      exitCode: 0,
      durationMs: 0,
      stdout: "",
      stderr: "",
      error: null,
      failedStep: null,
      failureKind: null,
      timedOut: false,
      fileIds: finalProposals.map((p) => String(p.fileId)).filter(Boolean),
    };
  }

  console.log("[preverify] result", {
  ok: preverify.ok,
  failedStep: preverify.failedStep,
  failureKind: preverify.failureKind,
  fileIds: preverify.fileIds,
  command: preverify.command,
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
        preverify: {
          ok: preverify.ok,
          command: preverify.command ?? "",
          exitCode: preverify.exitCode ?? 0,
          stdout: preverify.stdout ?? "",
          stderr: preverify.stderr ?? "",
          error: preverify.error ?? null,
          failedStep: preverify.failedStep ?? null,
          failureKind: preverify.failureKind ?? null,
        },
      });

      finalProposals = repairedSet;
      repaired = true;

      if (verifyCmd) {
        preverify = await runPreVerifyForProposalSet({
          repoId,
          proposals: finalProposals,
          verifyCmd,
        });
      } else {
        preverify = {
          ok: true,
          skipped: true,
          command: null,
          exitCode: 0,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: null,
          failedStep: null,
          failureKind: null,
          timedOut: false,
          fileIds: finalProposals.map((p) => String(p.fileId)).filter(Boolean),
        };
      }

      console.log("[preverify] repaired result", {
        ok: preverify.ok,
        failedStep: preverify.failedStep,
        failureKind: preverify.failureKind,
        fileIds: preverify.fileIds,
        command: preverify.command,
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