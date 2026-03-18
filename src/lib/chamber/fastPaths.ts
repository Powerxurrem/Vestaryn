import OpenAI from "openai";
import {
  extractSingleMentionedPath,
  isNamedFileExecutionRequest,
  isMetaRepositoryQuestion,
  isCreateAndModifyIntent,
  resolveCreateAndModifyPaths,
  isExtractToModuleIntent,
  resolveExtractToModulePaths,
  isExplainOnlyQuestion,
} from "@/lib/chamber/intent";
import { isImportRefactorIntent } from "@/lib/chamber/refactorIntent";
import {
  resolveFileIdByPathOrName,
  vault_read_text,
  vault_propose_create,
  vault_propose_write,
} from "@/lib/vault/tools";
import {
  inferTextMimeFromPath,
  normalizeForNoopCheck,
  scrubVisibleToolPayload,
  ensureTriplet,
  stripDuplicateTriplet,
  stripCodeFences,
} from "@/lib/vault/utils";
import {
  generateExtractHelpersResult,
  generateNewFileContent,
  generateRewrittenFileContent,
} from "@/lib/chamber/generation";
import { setRepoFileStatus } from "@/lib/vault/fileStatus";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";
import { type VerifyCommand,
  attemptFastPathRepair,
  isBaselinePreverifyFailure,
  runPreVerifyForProposalSet,
  shouldPreVerifyProposalSet,
} from "@/lib/chamber/verify";
import {
} from "@/lib/chamber/verifyRuntime";
import { hasValidAssistantContract } from "@/lib/chamber/output";
import { resolveVerifyCommand,  } from "@/lib/chamber/verifyRuntime";
import { loadRepoInference } from "@/lib/chamber/repoContext";

export async function tryHandleFastPaths(args: {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  runtimePolicy: any;
  membershipBlock: string;
  sacredBlock: string;
  profileBlock: string;
  masterBlock: string;
  chamberBlock: string;
  treeBlock: string;
  ledgerBlock: string;
  cleanedHistory: any[];
  baselineVerify: any;
}): Promise<Response | null> {
  const {
    openai,
    supabase,
    repoId,
    userId,
    content,
    runtimePolicy,
    membershipBlock,
    sacredBlock,
    profileBlock,
    masterBlock,
    chamberBlock,
    treeBlock,
    ledgerBlock,
    cleanedHistory,
    baselineVerify,
  } = args;

  // ─────────────────────────────────────────
  // Explain-only
  // ─────────────────────────────────────────
  if (isExplainOnlyQuestion(content)) {
    console.log("[explain_only_branch]", {
      repoId,
      contentHead: String(content).slice(0, 120),
    });

    const explanationInstructions =
      "You are Vestaryn. This is an explanation-only turn. " +
      "Do not create files. Do not propose repository changes. " +
      "Do not emit __PROPOSAL__, __PROPOSAL_SET__, __APPLY__, __VERIFY__, or other repo markers. " +
      "Respond only with the normal Vestaryn contract.\n" +
      "Keep the full response concise.\n" +
      "Use exactly this structure:\n" +
      "[Observation]\n" +
      "2-4 lines max.\n\n" +
      "[Assessment]\n" +
      "Use at most 4 bullets total.\n" +
      "Group similar dashboard types together.\n" +
      "Then list 2-3 common stack options.\n" +
      "Keep each bullet short.\n\n" +
      "[Action]\n" +
      "2-3 short next-step suggestions max.";

    const resp = await openai.responses.create({
      model: runtimePolicy.model,
      instructions: explanationInstructions,
      input: [
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
        { role: "user", content },
      ],
      tool_choice: "none",
      max_output_tokens: Math.min(runtimePolicy.output.maxOutputTokens, 500),
    });

    let out = String(resp.output_text ?? "").trim();
    out = scrubVisibleToolPayload(out);
    out = ensureTriplet(stripDuplicateTriplet(out));

    if (!hasValidAssistantContract(out)) {
      out =
        "[Observation]\nUser asked for explanation only.\n\n" +
        "[Assessment]\nA concise overview was requested without repository changes.\n\n" +
        "[Action]\nAsk for a focused follow-up such as dashboard types, recommended stack, or architecture comparison.";
    }

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: userId,
      role: "assistant",
      content: out,
    });

    return new Response(out, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // ─────────────────────────────────────────
  // Named-file pre-read
  // ─────────────────────────────────────────
  let preReadFile: {
    id: string;
    path: string;
    name: string;
    mime: string;
    content: string;
  } | null = null;

  try {
    const targetPath = extractSingleMentionedPath(content);

    if (
      targetPath &&
      isNamedFileExecutionRequest(content) &&
      !isMetaRepositoryQuestion(content)
    ) {
      const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, targetPath);

      if (resolvedId) {
        preReadFile = await vault_read_text(supabase, repoId, resolvedId);

        console.log("[pre-read] loaded target file", {
          repoId,
          path: preReadFile.path,
          fileId: preReadFile.id,
        });
      }
    }
  } catch (e: any) {
    console.log("[pre-read] skipped:", e?.message);
  }

  if (preReadFile && isNamedFileExecutionRequest(content)) {
    try {
      const rewritten = await generateRewrittenFileContent({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
        path: preReadFile.path,
        mime: preReadFile.mime,
        currentContent: preReadFile.content,
      });

      if (!rewritten) {
        throw new Error("Model returned empty rewritten content");
      }

      let proposal: any;
      try {
        proposal = await vault_propose_write(
          supabase,
          repoId,
          preReadFile.id,
          rewritten
        );
      } catch (e: any) {
        if (e?.message === "__NOOP_PROPOSAL__") {
          const visible =
            `[Observation]\nI inspected ${preReadFile.path}.\n\n` +
            `[Assessment]\nNo file change is needed.\n\n` +
            `[Action]\nNo staged change was created.`;

          await supabase.from("repo_messages").insert({
            repo_id: repoId,
            user_id: userId,
            role: "assistant",
            content: visible,
          });

          return new Response(visible, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        throw e;
      }

      const visible =
        "[Observation]\nRequired repository change was staged.\n\n" +
        "[Assessment]\nThe requested file fix was prepared from the current repository content.\n\n" +
        "[Action]\nA staged change is ready. Confirm to apply.";

      let preverifyMarker = "";

      try {
        const proposals = [
          {
            ...proposal,
            path: proposal.path ?? preReadFile.path,
            mime: proposal.mime ?? preReadFile.mime,
            meta: proposal.meta ?? null,
          },
        ];

        if (shouldPreVerifyProposalSet(proposals)) {
          console.log("[fast-path preverify] starting", {
            repoId,
            path: proposal.path ?? preReadFile.path,
            fileId: proposal.fileId,
          });

          const { inference } = await loadRepoInference({ supabase, repoId });

          const verifyCmd =
            inference?.projectType === "unknown" || inference?.projectType === "loose_files"
              ? null
              : resolveVerifyCommand(inference?.projectType ?? null);

        const preverify = verifyCmd
          ? await runPreVerifyForProposalSet({
              repoId,
              proposals,
              verifyCmd,
            })
          : {
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
              fileIds: proposals.map((p) => String(p.fileId)).filter(Boolean),
            };

          const baselineNoise = isBaselinePreverifyFailure(
            baselineVerify.verifyPayload,
            preverify
          );

          console.log("[fast-path preverify] result", {
            ok: preverify.ok,
            failedStep: preverify.failedStep,
            failureKind: preverify.failureKind,
            baseline: baselineNoise,
            fileIds: preverify.fileIds,
          });

          if (!preverify.ok && !baselineNoise) {
            await setRepoFileStatus(
              repoId,
              proposal.fileId,
              "error",
              preverify.failureKind ?? "preverify_failed",
              "preverify"
            );
          }

          if (!preverify.ok && !baselineNoise) {
            const repaired = await attemptFastPathRepair({
              repoId,
              path: proposal.path ?? preReadFile.path,
              fileId: proposal.fileId ?? preReadFile.id,
              failedStep: preverify.failedStep,
              userRequest: content,
              currentContent: proposal.content,
              stdout: String(preverify.stdout ?? ""),
              stderr: String(preverify.stderr ?? ""),
              error: preverify.error ?? null,
            });

            if (repaired?.ok) {
              const repairedRaw =
                typeof repaired.proposal === "string" ? repaired.proposal : "";

              const repairedContent = stripCodeFences(repairedRaw);

              if (!repairedContent) {
                throw new Error("fast-path repair returned empty content");
              }

              const repairedProposal = await vault_propose_write(
                supabase,
                repoId,
                preReadFile.id,
                repairedContent
              );

              const repairedPreverify = verifyCmd
              ? await runPreVerifyForProposalSet({
                  repoId,
                  verifyCmd,
                  proposals: [
                    {
                      fileId: String(repairedProposal.fileId),
                      path: repairedProposal.path ?? preReadFile.path,
                      content: String(repairedProposal.content ?? ""),
                      mime: repairedProposal.mime ?? preReadFile.mime,
                      meta: null,
                    },
                  ],
                })
              : {
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
                  fileIds: [String(repairedProposal.fileId)].filter(Boolean),
                  paths: [String(repairedProposal.path ?? preReadFile.path ?? "")].filter(Boolean),
                };

              const repairedBaseline = isBaselinePreverifyFailure(
                baselineVerify.verifyPayload,
                repairedPreverify
              );

              preverifyMarker = `\n__PREVERIFY__:${JSON.stringify({
                ...repairedPreverify,
                baseline: repairedBaseline,
              })}\n`;

              if (!repairedPreverify.ok) {
                await setRepoFileStatus(
                  repoId,
                  repairedProposal.fileId ?? preReadFile.id,
                  "error",
                  repairedPreverify.failureKind ?? "repair_reverify_failed",
                  "verify"
                );

                return new Response(`${visible}\n\n${preverifyMarker}\n`, {
                  headers: { "Content-Type": "text/plain; charset=utf-8" },
                });
              }

              proposal = repairedProposal;

              await setRepoFileStatus(
                repoId,
                proposal.fileId ?? preReadFile.id,
                "pending",
                "verify_running",
                "verify"
              );
            }
          }

          if (!preverifyMarker) {
            preverifyMarker = `\n__PREVERIFY__:${JSON.stringify({
              ...preverify,
              baselineVerify,
            })}\n`;
          }
        }
      } catch (e: any) {
        console.log("[fast-path preverify] failed:", e?.message);

        preverifyMarker = `\n__PREVERIFY__:${JSON.stringify({
          ok: false,
          command: null,
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: e?.message ?? "Pre-verify failed",
          failedStep: "preverify_boot",
          failureKind: "internal_error",
          timedOut: false,
          fileIds: [String(proposal.fileId)].filter(Boolean),
          paths: [String(proposal.path ?? preReadFile.path ?? "")].filter(Boolean),
          baseline: false,
        })}\n`;
      }

      return new Response(
        `${visible}\n\n__PROPOSAL__:${JSON.stringify(proposal)}${preverifyMarker}\n`,
        {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    } catch (e: any) {
      console.log("[fast-path rewrite] failed:", e?.message);
    }
  }

  // createModifyPaths branch goes here
  // extractToModulePaths branch goes here

  return null;
}