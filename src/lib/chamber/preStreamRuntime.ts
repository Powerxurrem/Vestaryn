import OpenAI from "openai";
import { resolveFileIdByPathOrName, vault_read_text, vault_propose_create, vault_propose_write } from "@/lib/vault/tools";
import { inferTextMimeFromPath, normalizeForNoopCheck } from "@/lib/vault/utils";
import {
  isCreateAndModifyIntent,
  resolveCreateAndModifyPaths,
  isExtractToModuleIntent,
  resolveExtractToModulePaths,
} from "@/lib/chamber/intent";
import { isImportRefactorIntent } from "@/lib/chamber/refactorIntent";
import {
  generateNewFileContent,
  generateRewrittenFileContent,
  generateExtractHelpersResult,
} from "@/lib/chamber/generation";
import { shouldPreVerifyProposalSet } from "@/lib/chamber/verify";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";
import { resolveVerifyCommand } from "@/lib/chamber/verifyRuntime";
import { loadRepoInference } from "@/lib/chamber/repoContext";

export async function tryHandlePreStreamRepoOps(args: {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  runtimePolicy: { model: string };
  baselineVerify: { verifyPayload: any };
}): Promise<Response | null> {
  const {
    openai,
    supabase,
    repoId,
    content,
    runtimePolicy,
    baselineVerify,
  } = args;

  const { inference } = await loadRepoInference({ supabase, repoId });

  const inferredVerifyCmd =
    inference?.projectType === "unknown" || inference?.projectType === "loose_files"
      ? null
      : resolveVerifyCommand(inference?.projectType ?? null);

  console.log("[prestream_verify_cmd]", {
    repoId,
    projectType: inference?.projectType ?? null,
    verifyCmd: inferredVerifyCmd,
  });

  const createModifyPaths = isCreateAndModifyIntent(content)
    ? resolveCreateAndModifyPaths(content)
    : null;

  if (createModifyPaths) {
    try {
      const { createPath, modifyPath } = createModifyPaths;

      const createExists = await resolveFileIdByPathOrName(supabase, repoId, createPath);
      const modifyExists = await resolveFileIdByPathOrName(supabase, repoId, modifyPath);

      console.log("[create_modify_short_circuit]", {
        createPath,
        modifyPath,
        createExists: Boolean(createExists),
        modifyExists: Boolean(modifyExists),
      });

      if (!createExists && !modifyExists) {
        console.log("[create_modify_bootstrap]", {
          createPath,
          modifyPath,
        });

        const newFileContent = await generateNewFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: createPath,
          mime: inferTextMimeFromPath(createPath),
        });

        const createProposal = await vault_propose_create(
          supabase,
          repoId,
          {
            path: createPath,
            content: newFileContent,
            mime: inferTextMimeFromPath(createPath),
          }
        );

        const proposals: any[] = [];
        if (createProposal) proposals.push(createProposal);

        if (modifyPath) {
          const modifyContent = await generateNewFileContent({
            openai,
            model: runtimePolicy.model,
            userRequest: content,
            path: modifyPath,
            mime: inferTextMimeFromPath(modifyPath),
          });

          const modifyProposal = await vault_propose_create(
            supabase,
            repoId,
            {
              path: modifyPath,
              content: modifyContent,
              mime: inferTextMimeFromPath(modifyPath),
            }
          );

          if (modifyProposal) proposals.push(modifyProposal);
        }

        if (shouldPreVerifyProposalSet(proposals)) {
          const result = await finalizeProposalSet({
            openai,
            model: runtimePolicy.model,
            repoId,
            userRequest: content,
            baselineVerifyPayload: baselineVerify.verifyPayload,
            verifyCmd: inferredVerifyCmd,
            proposals,
          });

          const finalProposalSet = result.repaired
            ? result.finalProposals
            : proposals;

          const visible =
            "[Observation]\nRequired repository changes were staged.\n\n" +
            "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
            "[Action]\nA staged change is ready. Confirm to apply.";

          return new Response(
            `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
          "[Action]\nA staged change is ready. Confirm to apply.";

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }

      if (createExists && !modifyExists) {
        console.log("[create_modify_bootstrap_missing_modify]", {
          createPath,
          modifyPath,
        });

        const newModifyContent = await generateNewFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: modifyPath,
          mime: inferTextMimeFromPath(modifyPath),
        });

        const modifyProposal = await vault_propose_create(
          supabase,
          repoId,
          {
            path: modifyPath,
            content: newModifyContent,
            mime: inferTextMimeFromPath(modifyPath),
          }
        );

        const proposals = [modifyProposal].filter(Boolean);

        if (shouldPreVerifyProposalSet(proposals)) {
        const result = await finalizeProposalSet({
          openai,
          model: runtimePolicy.model,
          repoId,
          userRequest: content,
          baselineVerifyPayload: baselineVerify.verifyPayload,
          verifyCmd: inferredVerifyCmd,
          proposals,
        });

          const finalProposalSet = result.repaired ? result.finalProposals : proposals;

          const visible =
            "[Observation]\nRequired repository changes were staged.\n\n" +
            "[Assessment]\nThe missing bootstrap file was prepared and staged.\n\n" +
            "[Action]\nA staged change is ready. Confirm to apply.";

          return new Response(
            `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe missing bootstrap file was prepared and staged.\n\n" +
          "[Action]\nA staged change is ready. Confirm to apply.";

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }

      if (!createExists && modifyExists) {
        const existingFile = await vault_read_text(supabase, repoId, modifyExists);

        const newFileContent = await generateNewFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: createPath,
          mime: inferTextMimeFromPath(createPath),
        });

        const createProposal = await vault_propose_create(
          supabase,
          repoId,
          {
            path: createPath,
            content: newFileContent,
            mime: inferTextMimeFromPath(createPath),
          }
        );

        const rewritten = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: existingFile.path,
          mime: existingFile.mime,
          currentContent: existingFile.content,
        });

        const writeProposal = await vault_propose_write(
          supabase,
          repoId,
          existingFile.id,
          rewritten
        );

        const proposals = [createProposal, writeProposal].filter(Boolean);

        if (shouldPreVerifyProposalSet(proposals)) {
          const result = await finalizeProposalSet({
            openai,
            model: runtimePolicy.model,
            repoId,
            userRequest: content,
            baselineVerifyPayload: baselineVerify.verifyPayload,
            verifyCmd: inferredVerifyCmd,
            proposals,
          });

          const finalProposalSet = result.repaired ? result.finalProposals : proposals;

          const visible =
            "[Observation]\nRequired repository changes were staged.\n\n" +
            "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
            "[Action]\nA staged change is ready. Confirm to apply.";

          return new Response(
            `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
          "[Action]\nA staged change is ready. Confirm to apply.";

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }

      if (createExists && modifyExists) {
        console.log("[create_modify_existing_both]", {
          createPath,
          modifyPath,
        });

        const createFile = await vault_read_text(supabase, repoId, createExists);
        const modifyFile = await vault_read_text(supabase, repoId, modifyExists);

        const rewrittenCreate = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: createFile.path,
          mime: createFile.mime,
          currentContent: createFile.content,
        });

        const rewrittenModify = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: modifyFile.path,
          mime: modifyFile.mime,
          currentContent: modifyFile.content,
        });

        const proposals: any[] = [];

        if (
          normalizeForNoopCheck(String(createFile.content ?? "")) !==
          normalizeForNoopCheck(String(rewrittenCreate ?? ""))
        ) {
          const createWriteProposal = await vault_propose_write(
            supabase,
            repoId,
            createFile.id,
            rewrittenCreate
          );
          if (createWriteProposal) proposals.push(createWriteProposal);
        }

        if (
          normalizeForNoopCheck(String(modifyFile.content ?? "")) !==
          normalizeForNoopCheck(String(rewrittenModify ?? ""))
        ) {
          const modifyWriteProposal = await vault_propose_write(
            supabase,
            repoId,
            modifyFile.id,
            rewrittenModify
          );
          if (modifyWriteProposal) proposals.push(modifyWriteProposal);
        }

        if (proposals.length === 0) {
          const visible =
            "[Observation]\nI inspected the target files.\n\n" +
            "[Assessment]\nNo repository changes were needed for this step.\n\n" +
            "[Action]\nContinue to the next goal step.";

          return new Response(visible, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nExisting target files were updated for the current goal step.\n\n" +
          "[Action]\nA staged change is ready. Confirm to apply.";

        if (shouldPreVerifyProposalSet(proposals)) {
          const result = await finalizeProposalSet({
            openai,
            model: runtimePolicy.model,
            repoId,
            userRequest: content,
            baselineVerifyPayload: baselineVerify.verifyPayload,
            verifyCmd: inferredVerifyCmd,
            proposals,
          });

          const finalProposalSet = result.repaired ? result.finalProposals : proposals;

          return new Response(
            `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
    } catch (e: any) {
      console.log("[create_modify_short_circuit] failed:", e?.message);
    }
  }

  const extractToModulePaths =
    isExtractToModuleIntent(content) && !isImportRefactorIntent(content)
      ? resolveExtractToModulePaths(content)
      : null;

  if (extractToModulePaths) {
    try {
      const { sourcePath, targetPath } = extractToModulePaths;

      const sourceId = await resolveFileIdByPathOrName(supabase, repoId, sourcePath);
      const targetId = await resolveFileIdByPathOrName(supabase, repoId, targetPath);

      console.log("[extract_to_module_short_circuit]", {
        sourcePath,
        targetPath,
        sourceExists: Boolean(sourceId),
        targetExists: Boolean(targetId),
      });

      if (sourceId) {
        const sourceFile = await vault_read_text(supabase, repoId, sourceId);

        const generated = await generateExtractHelpersResult({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          sourcePath,
          sourceContent: String(sourceFile.content ?? ""),
          targetPath,
        });

        const normalizedOriginalSource = normalizeForNoopCheck(
          String(sourceFile.content ?? "")
        );
        const normalizedGeneratedSource = normalizeForNoopCheck(
          String(generated.sourceContent ?? "")
        );

        if (normalizedOriginalSource === normalizedGeneratedSource) {
          throw new Error("Generated source rewrite is identical to the current source file");
        }

        if (!generated.targetContent.trim() || !generated.sourceContent.trim()) {
          throw new Error("Model returned empty extraction result");
        }

        let sourceProposal;
        console.log("[intent] extractToModulePaths", {
          hit: Boolean(extractToModulePaths),
          resolved: extractToModulePaths,
          text: content,
        });

        try {
          sourceProposal = await vault_propose_write(
            supabase,
            repoId,
            sourceFile.id,
            generated.sourceContent
          );
        } catch (e: any) {
          if (e?.message === "__NOOP_PROPOSAL__") {
            const visible =
              `[Observation]\nI inspected ${sourcePath} and ${targetPath}.\n\n` +
              `[Assessment]\nNo file change is needed.\n\n` +
              `[Action]\nNo staged change was created.`;

            await supabase.from("repo_messages").insert({
              repo_id: repoId,
              user_id: args.userId,
              role: "assistant",
              content: visible,
            });

            return new Response(visible, {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          }

          throw e;
        }

        const targetProposal = targetId
          ? await vault_propose_write(
              supabase,
              repoId,
              targetId,
              generated.targetContent
            )
          : await vault_propose_create(
              supabase,
              repoId,
              {
                path: targetPath,
                content: generated.targetContent,
                mime: inferTextMimeFromPath(targetPath),
              }
            );

        const proposals = [sourceProposal, targetProposal].filter(Boolean);

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe requested extraction was prepared from the current repository content.\n\n" +
          "[Action]\nA staged change is ready. Confirm to apply.";

        if (shouldPreVerifyProposalSet(proposals)) {
          const result = await finalizeProposalSet({
            openai,
            model: runtimePolicy.model,
            repoId,
            userRequest: content,
            baselineVerifyPayload: baselineVerify.verifyPayload,
            verifyCmd: inferredVerifyCmd,
            proposals,
          });

          const finalProposalSet = result.repaired ? result.finalProposals : proposals;

          return new Response(
            `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
    } catch (e: any) {
      console.log("[extract_to_module_short_circuit] failed:", e?.message);
    }
  }

  return null;
}