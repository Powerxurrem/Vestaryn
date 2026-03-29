import OpenAI from "openai";
import { dedupePendingProposals, assertCanonicalProposal } from "@/lib/chamber/proposalRuntimeUtils";
import { shouldPreVerifyProposalSet } from "@/lib/chamber/verify";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";

type ProposalPreverifyArgs = {
  ctx: {
    openai: OpenAI;
    repoId: string;
    content: string;
    runtimePolicy: any;
    baselineVerify: any;
    inferredVerifyCmd?: 
  | "node_verify"
  | "node_lint"
  | "node_typecheck"
  | "node_test"
  | "python_verify"
  | null;
  };
  pendingProposalOuts: any[];
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
};

type ProposalPreverifyResult = {
  pendingProposalOuts: any[];
  hadAnyProposalSet: boolean;
};

export async function handleProposalPreverify({
  ctx,
  pendingProposalOuts,
  controller,
  encoder,
}: ProposalPreverifyArgs): Promise<ProposalPreverifyResult> {
  const {
    openai,
    repoId,
    content,
    runtimePolicy,
    baselineVerify,
    inferredVerifyCmd,
  } = ctx;

  let hadAnyProposalSet = false;

  // ─────────────────────────────────────────────
  // Clean + dedupe
  // ─────────────────────────────────────────────
  pendingProposalOuts = pendingProposalOuts.filter(
    (p) => !(p && typeof p === "object" && (p as any).noop === true)
  );

  const beforeDedupe = pendingProposalOuts.length;
  pendingProposalOuts = dedupePendingProposals(pendingProposalOuts);

  if (beforeDedupe !== pendingProposalOuts.length) {
    console.log("[proposal_dedupe]", {
      before: beforeDedupe,
      after: pendingProposalOuts.length,
      keys: pendingProposalOuts.map((p) =>
        String(p?.fileId ?? p?.path ?? p?.meta?.path ?? "")
      ),
    });
  }

  // ─────────────────────────────────────────────
  // SINGLE PROPOSAL
  // ─────────────────────────────────────────────
  if (pendingProposalOuts.length === 1) {
    hadAnyProposalSet = true;

    const proposal = pendingProposalOuts[0];

    controller.enqueue(
      encoder.encode(`\n__PROPOSAL__:${JSON.stringify(proposal)}\n`)
    );

    try {
      if (shouldPreVerifyProposalSet([proposal])) {
        const result = await finalizeProposalSet({
          openai,
          model: runtimePolicy.model,
          repoId,
          userRequest: content,
          baselineVerifyPayload: baselineVerify.verifyPayload,
          verifyCmd: inferredVerifyCmd ?? null,
          proposals: [proposal],
        });

        if (result.repaired) {
          for (const p of result.finalProposals) {
            assertCanonicalProposal(p);
          }

          controller.enqueue(
            encoder.encode(
              `\n__PROPOSAL__:${JSON.stringify(result.finalProposals[0])}\n`
            )
          );
        }

        controller.enqueue(
          encoder.encode(
            `\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`
          )
        );
      }
    } catch (e: any) {
      controller.enqueue(
        encoder.encode(
          `\n__PREVERIFY__:${JSON.stringify({
            ok: false,
            error: e?.message ?? "Pre-verify failed",
            failedStep: "preverify_boot",
          })}\n`
        )
      );
    }

    return {
      pendingProposalOuts: [],
      hadAnyProposalSet,
    };
  }

  // ─────────────────────────────────────────────
  // MULTI PROPOSAL
  // ─────────────────────────────────────────────
  if (pendingProposalOuts.length > 1) {
    hadAnyProposalSet = true;

    const proposals = [...pendingProposalOuts];

    controller.enqueue(
      encoder.encode(
        `\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`
      )
    );

    try {
      if (shouldPreVerifyProposalSet(proposals)) {
        const result = await finalizeProposalSet({
          openai,
          model: runtimePolicy.model,
          repoId,
          userRequest: content,
          baselineVerifyPayload: baselineVerify.verifyPayload,
          verifyCmd: inferredVerifyCmd ?? null,
          proposals,
        });

        if (result.repaired) {
          for (const p of result.finalProposals) {
            assertCanonicalProposal(p);
          }

          controller.enqueue(
            encoder.encode(
              `\n__PROPOSAL_SET__:${JSON.stringify({
                proposals: result.finalProposals,
              })}\n`
            )
          );
        }

        controller.enqueue(
          encoder.encode(
            `\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`
          )
        );
      }
    } catch (e: any) {
      controller.enqueue(
        encoder.encode(
          `\n__PREVERIFY__:${JSON.stringify({
            ok: false,
            error: e?.message ?? "Pre-verify failed",
            failedStep: "preverify_boot",
          })}\n`
        )
      );
    }

    return {
      pendingProposalOuts: [],
      hadAnyProposalSet,
    };
  }

  return {
    pendingProposalOuts,
    hadAnyProposalSet,
  };
}