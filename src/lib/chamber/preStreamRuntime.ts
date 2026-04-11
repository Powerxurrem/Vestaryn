import OpenAI from "openai";
import { resolveFileIdByPathOrName, vault_read_text, vault_propose_create, vault_propose_write } from "@/lib/vault/tools";
import { inferTextMimeFromPath, normalizeForNoopCheck } from "@/lib/vault/utils";
import {
  isCreateAndModifyIntent,
  resolveCreateAndModifyPaths,
  isExtractToModuleIntent,
  resolveExtractToModulePaths,
  extractSingleMentionedPath,
  isChapterSequenceRequest,
  isStoryContinuationRequest,
  isAmbiguousCreateForMeFollowup,
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

function buildPreverifyAwareProposalResponse(args: {
  visible?: string;
  proposals: any[];
  result: {
    repaired?: boolean;
    finalProposals?: any[];
    preverifyPayload?: any;
  };
}) {
  const { visible, proposals, result } = args;

  if (!result?.preverifyPayload?.ok) {
    return new Response(
      "[Observation]\nA repository change candidate was prepared.\n\n" +
        "[Assessment]\nIt still fails pre-verify, so no staged change will be exposed.\n\n" +
        "[Action]\nReview the verification failure and retry with a more targeted change.\n" +
        `\n__PREVERIFY__:${JSON.stringify(result?.preverifyPayload ?? {
          ok: false,
          error: "Pre-verify failed",
          failedStep: "preverify_boot",
        })}\n`,
      {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }

  const finalProposalSet =
    result.repaired && Array.isArray(result.finalProposals)
      ? result.finalProposals
      : proposals;

  const safeVisible =
    visible ??
    "[Observation]\nRequired repository changes were staged.\n\n" +
      "[Assessment]\nThe requested operation completed and a proposal was prepared.\n\n" +
      "[Action]\nA staged change is ready. Confirm to apply.";

  return new Response(
    `${safeVisible}\n\n__PROPOSAL_SET__:${JSON.stringify({
      proposals: finalProposalSet,
    })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function inferNextChapterPathFromRepoPaths(paths: string[]) {
  const normalized = Array.isArray(paths)
    ? paths.map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];

  const chapterRows = normalized
    .map((path) => {
      const match =
        path.match(/(^|\/)chapter[-_ ]?(\d+)\.(txt|md)$/i) ||
        path.match(/(^|\/)(\d+)[-_ ]?chapter\.(txt|md)$/i);

      if (!match) return null;

      const chapterNo = Number(match[2]);
      if (!Number.isFinite(chapterNo)) return null;

      return {
        path,
        chapterNo,
        ext: path.toLowerCase().endsWith(".md") ? ".md" : ".txt",
      };
    })
    .filter(Boolean) as Array<{ path: string; chapterNo: number; ext: ".txt" | ".md" }>;

  if (chapterRows.length === 0) return null;

  const maxChapter = Math.max(...chapterRows.map((x) => x.chapterNo));
  const preferredExt =
    chapterRows.find((x) => x.chapterNo === maxChapter)?.ext ?? ".txt";

  return `chapter-${pad2(maxChapter + 1)}${preferredExt}`;
}

function inferExplicitRequestedChapterNumber(text: string): number | null {
  const t = String(text ?? "").toLowerCase();

  const match =
    t.match(/\bcreate\s+a\s+(\d+)(?:st|nd|rd|th)\s+chapter\b/) ||
    t.match(/\bcreate\s+chapter\s+(\d+)\b/) ||
    t.match(/\badd\s+chapter\s+(\d+)\b/);

  if (!match) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildChapterPath(n: number, ext: ".txt" | ".md" = ".txt") {
  return `chapter-${pad2(n)}${ext}`;
}

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

  try {
    const wantsChapterFollowup =
      isChapterSequenceRequest(content) ||
      isStoryContinuationRequest(content) ||
      isAmbiguousCreateForMeFollowup(content);

    if (wantsChapterFollowup) {
      const { data: repoFileRows, error: repoFilesErr } = await supabase
        .from("repo_files")
        .select("path")
        .eq("repo_id", repoId)
        .is("deleted_at", null);

      if (!repoFilesErr) {
        const repoPaths = Array.isArray(repoFileRows)
          ? repoFileRows.map((r: any) => String(r?.path ?? "").trim()).filter(Boolean)
          : [];

        const inferredNextChapterPath = inferNextChapterPathFromRepoPaths(repoPaths);
        const explicitChapterNo = inferExplicitRequestedChapterNumber(content);

        let targetChapterPath: string | null = null;

        if (explicitChapterNo) {
          const ext =
            inferredNextChapterPath?.toLowerCase().endsWith(".md") ? ".md" : ".txt";
          targetChapterPath = buildChapterPath(explicitChapterNo, ext as ".txt" | ".md");
        } else if (inferredNextChapterPath) {
          targetChapterPath = inferredNextChapterPath;
        }

        console.log("[chapter_followup_probe]", {
          content,
          wantsChapterFollowup,
          explicitChapterNo,
          inferredNextChapterPath,
          targetChapterPath,
          repoPaths,
        });

        if (targetChapterPath) {
          const existingId = await resolveFileIdByPathOrName(
            supabase,
            repoId,
            targetChapterPath
          );

          if (!existingId) {
            const mime = inferTextMimeFromPath(targetChapterPath);

            const newFileContent = await generateNewFileContent({
              openai,
              model: runtimePolicy.model,
              userRequest:
                `${content}\n\n` +
                `Repository continuity rules:\n` +
                `- This is a story-chapter continuation request.\n` +
                `- Create exactly one new chapter file.\n` +
                `- Target path: ${targetChapterPath}\n` +
                `- Continue the existing story sequence naturally.\n` +
                `- Return only the full file contents for that one chapter.\n`,
              path: targetChapterPath,
              mime,
            });

            const proposal = await vault_propose_create(supabase, repoId, {
  path: targetChapterPath,
  content: newFileContent,
  mime,
});


            
            const proposals = [proposal].filter(Boolean);

            const visible =
              "[Observation]\nRequired repository changes were staged.\n\n" +
              `[Assessment]\nA follow-up story chapter was prepared as ${targetChapterPath}.\n\n` +
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

              return buildPreverifyAwareProposalResponse({
                visible,
                proposals,
                result,
              });
            }

            return new Response(
              `${visible}\n\n__PROPOSAL__:${JSON.stringify(proposal)}\n`,
              {
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              }
            );
          }
        }
      }
    }
  } catch (e: any) {
    console.log("[chapter_followup_short_circuit] failed:", e?.message);
  }

    const createModifyIntent = isCreateAndModifyIntent(content);
    const createModifyPaths = createModifyIntent
      ? resolveCreateAndModifyPaths(content)
      : null;

    console.log("[intent] create_modify", {
      hit: createModifyIntent,
      resolved: createModifyPaths,
      text: content,
    });

    if (
      createModifyPaths &&
      (!createModifyPaths.createPath ||
        !createModifyPaths.modifyPath ||
        createModifyPaths.createPath === createModifyPaths.modifyPath)
    ) {
      console.log("[create_modify_short_circuit] invalid resolved paths", {
        resolved: createModifyPaths,
        text: content,
      });

        const singlePath = extractSingleMentionedPath(content);

  const shouldDirectRewrite =
    !!singlePath &&
    !isCreateAndModifyIntent(content) &&
    !isExtractToModuleIntent(content) &&
    !isImportRefactorIntent(content);

  if (shouldDirectRewrite) {
    try {
      const fileId = await resolveFileIdByPathOrName(supabase, repoId, singlePath);

      if (fileId) {
        const file = await vault_read_text(supabase, repoId, fileId);

        const rewritten = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: file.path,
          mime: file.mime,
          currentContent: file.content,
        });

        if (
          normalizeForNoopCheck(String(file.content ?? "")) ===
          normalizeForNoopCheck(String(rewritten ?? ""))
        ) {
          return new Response(
            "[Observation]\nI inspected the target file.\n\n" +
              "[Assessment]\nNo repository change was needed.\n\n" +
              "[Action]\nContinue with the next change.",
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        const proposal = await vault_propose_write(
          supabase,
          repoId,
          file.id,
          rewritten
        );

        const proposals = [proposal].filter(Boolean);

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe requested file operation completed and a proposal was prepared.\n\n" +
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

          return buildPreverifyAwareProposalResponse({
            visible,
            proposals,
            result,
          });
        }

        return new Response(
          `${visible}\n\n__PROPOSAL__:${JSON.stringify(proposal)}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
    } catch (e: any) {
      console.log("[single_file_rewrite_short_circuit] failed:", e?.message);
    }
  }
      return null;
    }

    if (createModifyPaths) {
    try {
      const { createPath, modifyPath } = createModifyPaths;

      const createExists = await resolveFileIdByPathOrName(
        supabase,
        repoId,
        createPath
      );
      const modifyExists = await resolveFileIdByPathOrName(
        supabase,
        repoId,
        modifyPath
      );

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

        const createProposal = await vault_propose_create(supabase, repoId, {
          path: createPath,
          content: newFileContent,
          mime: inferTextMimeFromPath(createPath),
        });

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

          const modifyProposal = await vault_propose_create(supabase, repoId, {
            path: modifyPath,
            content: modifyContent,
            mime: inferTextMimeFromPath(modifyPath),
          });

          if (modifyProposal) proposals.push(modifyProposal);
        }

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe requested file operations completed and proposals were prepared.\n\n" +
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

          return buildPreverifyAwareProposalResponse({
            visible,
            proposals,
            result,
          });
        }

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

        const modifyLooksBootstrapable =
          /app\/page\.(tsx|ts|jsx|js)$/i.test(modifyPath) ||
          /index\.html$/i.test(modifyPath) ||
          /\.html?$/i.test(modifyPath);

        if (!modifyLooksBootstrapable) {
          console.log(
            "[create_modify_short_circuit] refusing bootstrap for non-page modify target",
            {
              createPath,
              modifyPath,
            }
          );
          return null;
        }

        const newModifyContent = await generateNewFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: modifyPath,
          mime: inferTextMimeFromPath(modifyPath),
        });

        const modifyProposal = await vault_propose_create(supabase, repoId, {
          path: modifyPath,
          content: newModifyContent,
          mime: inferTextMimeFromPath(modifyPath),
        });

        const proposals = [modifyProposal].filter(Boolean);

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe missing bootstrap file was prepared and staged.\n\n" +
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

          return buildPreverifyAwareProposalResponse({
            visible,
            proposals,
            result,
          });
        }

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

        const createProposal = await vault_propose_create(supabase, repoId, {
          path: createPath,
          content: newFileContent,
          mime: inferTextMimeFromPath(createPath),
        });

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

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe requested operation completed and a proposal was prepared.\n\n" +
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

          return buildPreverifyAwareProposalResponse({
            visible,
            proposals,
            result,
          });
        }

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

          return buildPreverifyAwareProposalResponse({
            visible,
            proposals,
            result,
          });
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

      const sourceId = await resolveFileIdByPathOrName(
        supabase,
        repoId,
        sourcePath
      );
      const targetId = await resolveFileIdByPathOrName(
        supabase,
        repoId,
        targetPath
      );

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
          throw new Error(
            "Generated source rewrite is identical to the current source file"
          );
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
          : await vault_propose_create(supabase, repoId, {
              path: targetPath,
              content: generated.targetContent,
              mime: inferTextMimeFromPath(targetPath),
            });

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

          return buildPreverifyAwareProposalResponse({
            visible,
            proposals,
            result,
          });
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