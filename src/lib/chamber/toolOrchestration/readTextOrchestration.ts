import OpenAI from "openai";
import {
  extractMentionedPaths,
  isCreateAndModifyIntent,
  isExtractToModuleIntent,
} from "@/lib/chamber/intent";
import {
  isSplitFileIntent,
  extractSplitTargets,
  deriveDefaultSplitTargets,
  extractRequestedSplitCount,
  isSplitReadAllowed,
} from "@/lib/chamber/refactorIntent";
import {
  generateSplitFileContents,
} from "@/lib/chamber/generation";
import { runTool } from "@/lib/vault/toolRuntime";
import { resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { shouldPreVerifyProposalSet } from "@/lib/chamber/verify";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";
import { validateGeneratedSplitFiles } from "@/lib/chamber/proposalRuntimeUtils";
import { isImportRefactorIntent } from "@/lib/chamber/refactorIntent";
import {
  isSourceTargetTransferIntent,
  resolveSourceAndTargetPaths,
} from "@/lib/chamber/refactorIntent";
import {
  generateExtractHelpersResult,
  generateRewrittenFileContent,
} from "@/lib/chamber/generation";
import { vault_read_text } from "@/lib/vault/tools";
import { normalizeForNoopCheck, inferTextMimeFromPath } from "@/lib/vault/utils";


// (add more imports as you move blocks in)

function targetStillLooksExtracted(text: string) {
  return /\bcardBaseStyle\b/.test(text) && /\bcardHoverStyle\b/.test(text);
}

function sourceStillLooksUnextracted(sourceContent: string, targetPath: string) {
  const text = String(sourceContent ?? "");
  const targetFileName = targetPath.split("/").pop() ?? targetPath;
  const targetBaseName = targetFileName.replace(/\.[^.]+$/, "");

  const lower = text.toLowerCase();
  const targetBaseLower = targetBaseName.toLowerCase();

  const referencesTarget =
    lower.includes(`./${targetBaseLower}`) || lower.includes(targetBaseLower);

  const stillDefinesStyleObjects =
    /\bconst\s+cardBaseStyle\b/.test(text) ||
    /\bconst\s+cardHoverStyle\b/.test(text) ||
    /\bcardBaseStyle\s*=\s*\{/.test(text) ||
    /\bcardHoverStyle\s*=\s*\{/.test(text);

  return stillDefinesStyleObjects || !referencesTarget;
}

type ReadTextOrchestrationArgs = {
  ctx: {
    openai: OpenAI;
    supabase: any;
    repoId: string;
    userId: string;
    content: string;
    runtimePolicy: any;
    executionMode: any;

    // verify context (needed for split later)
    baselineVerify?: any;
    inferredVerifyCmd?:  string | null;

    // helpers
    generateNewFileContentSafe: (args: {
      openai: OpenAI;
      model: string;
      userRequest: string;
      path: string;
      mime: string;
      maxOutputTokens?: number;
    }) => Promise<string>;
  };

  toolName: string;
  out: any;
  callId: string;

  state: {
    requestHandledByOrchestration: boolean;
    pendingProposalOuts: any[];

    // split-specific state
    handledSplitTurn?: boolean;
  };
};

type ReadTextOrchestrationResult = {
  handled: boolean;
  requestHandledByOrchestration: boolean;
  pendingProposalOuts: any[];

  handledSplitTurn?: boolean;

  preverifyPayload?: any;

  deterministicToolHandled?: boolean;
  assistantText?: string;

  toolOutput?: {
    type: "function_call_output";
    call_id: string;
    output: string;
  };
};

export async function tryHandleReadTextOrchestration({
  ctx,
  toolName,
  out,
  callId,
  state,
}: ReadTextOrchestrationArgs): Promise<ReadTextOrchestrationResult> {
  // only handle read_text
  if (toolName !== "vault_read_text") {
    return {
      handled: false,
      requestHandledByOrchestration: state.requestHandledByOrchestration,
      pendingProposalOuts: state.pendingProposalOuts,
    };
  }

  const {
    openai,
    supabase,
    repoId,
    userId,
    content,
    runtimePolicy,
    executionMode,
    baselineVerify,
    inferredVerifyCmd,
    generateNewFileContentSafe,
  } = ctx;

  let {
    requestHandledByOrchestration,
    pendingProposalOuts,
    handledSplitTurn = false,
  } = state;

  // ─────────────────────────────────────────────
  // 🔻 INSERT SPLIT BLOCK HERE
  // ─────────────────────────────────────────────
  // ─────────────────────────────────────────────
  // Deterministic split-file orchestration
  // ─────────────────────────────────────────────
  if (
    isSplitFileIntent(content) &&
    !isCreateAndModifyIntent(content) &&
    out &&
    typeof out === "object" &&
    !("error" in out)
  ) {
    if (isExtractToModuleIntent(content)) {
      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }

    const readOut = out as {
      id: string;
      path?: string;
      mime?: string;
      content: string;
    };

    const mentionedPaths = extractMentionedPaths(content);
    const explicitTargets = extractSplitTargets(content);

    const sourcePathForSplit =
      mentionedPaths.find((p) => !explicitTargets.includes(p)) ??
      mentionedPaths[0] ??
      null;

    if (handledSplitTurn) {
      console.log("[split_guard] skipping extra split read after turn already handled", {
        sourcePath: sourcePathForSplit,
        attempted: readOut.path ?? null,
      });

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            skipped: true,
            reason: "split_already_handled",
            path: readOut.path ?? null,
          }),
        },
      };
    }

    if (!isSplitReadAllowed(sourcePathForSplit, readOut.path ?? null)) {
      console.log("[split_guard] blocked unrelated read", {
        sourcePath: sourcePathForSplit,
        attempted: readOut.path ?? null,
      });

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            skipped: true,
            reason: "split_read_blocked",
            path: readOut.path ?? null,
          }),
        },
      };
    }

    try {
      const sourcePath = String(readOut.path ?? "").trim();

      let targetPaths = extractSplitTargets(content);

      if (targetPaths.length < 2) {
        const requestedCount = extractRequestedSplitCount(content) ?? 2;

        console.log("[split_orchestration] deriving default targets", {
          sourcePath,
          requestedCount,
        });

        targetPaths = deriveDefaultSplitTargets(sourcePath, requestedCount);
      }

      const generatedFiles = await generateSplitFileContents({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
        sourcePath,
        sourceContent: String(readOut.content ?? ""),
        targetPaths,
      });

      const splitValidation = validateGeneratedSplitFiles({
        sourcePath,
        sourceContent: String(readOut.content ?? ""),
        targetPaths,
        files: generatedFiles,
      });

      if (!splitValidation.ok) {
        return {
          handled: true,
          requestHandledByOrchestration,
          pendingProposalOuts,
          handledSplitTurn,
          toolOutput: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              error: `split_validation_failed: ${splitValidation.reason}`,
              details: splitValidation.details ?? null,
            }),
          },
        };
      }

      const localSplitProposals: any[] = [];

      for (const file of generatedFiles) {
        const existingId = await resolveFileIdByPathOrName(
          supabase,
          repoId,
          file.path
        );

        const proposal = existingId
          ? await runTool(
              supabase,
              repoId,
              userId,
              content,
              "vault_propose_write",
              {
                fileId: existingId,
                path: file.path,
                content: file.content,
              }
            )
          : await runTool(
              supabase,
              repoId,
              userId,
              content,
              "vault_propose_create",
              {
                path: file.path,
                content: file.content,
                mime: inferTextMimeFromPath(file.path),
              }
            );

        if (
          !proposal ||
          typeof proposal !== "object" ||
          "error" in proposal ||
          (proposal as any).noop
        ) {
          return {
            handled: true,
            requestHandledByOrchestration,
            pendingProposalOuts,
            handledSplitTurn,
            toolOutput: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({
                error: "split_proposal_failed",
                details: {
                  path: file.path,
                  proposal: proposal ?? null,
                },
              }),
            },
          };
        }

        localSplitProposals.push(proposal);
      }

      if (localSplitProposals.length !== generatedFiles.length) {
        return {
          handled: true,
          requestHandledByOrchestration,
          pendingProposalOuts,
          handledSplitTurn,
          toolOutput: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              error: "split_incomplete_proposal_set",
              details: {
                expected: generatedFiles.length,
                actual: localSplitProposals.length,
                targetPaths,
              },
            }),
          },
        };
      }

      const splitShouldPreverify = shouldPreVerifyProposalSet(localSplitProposals);

      console.log("[split_preverify] proposal_count", localSplitProposals.length);
      console.log("[split_preverify] should_run", splitShouldPreverify);
      console.log(
        "[split_preverify] proposal_paths",
        localSplitProposals.map((p) => String(p?.path ?? p?.meta?.path ?? ""))
      );

      let preverifyPayload: any | undefined;

      if (splitShouldPreverify) {
        console.log("[split_preverify] starting");

        const result = await finalizeProposalSet({
          openai,
          model: runtimePolicy.model,
          repoId,
          userRequest: content,
          baselineVerifyPayload: baselineVerify?.verifyPayload,
          verifyCmd: (inferredVerifyCmd ?? null) as
          | "node_verify"
          | "node_lint"
          | "node_typecheck"
          | "node_test"
          | "python_verify"
          | null,
          proposals: localSplitProposals,
        });

        preverifyPayload = result.preverifyPayload;

        if (!result.preverifyPayload?.ok && !result.preverifyPayload?.baseline) {
          return {
            handled: true,
            requestHandledByOrchestration,
            pendingProposalOuts,
            handledSplitTurn,
            preverifyPayload,
            toolOutput: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({
                error: "split_preverify_failed",
                details: result.preverifyPayload,
              }),
            },
          };
        }

        localSplitProposals.length = 0;
        localSplitProposals.push(...result.finalProposals);
      }

      pendingProposalOuts.push(...localSplitProposals);
      handledSplitTurn = true;

      console.log("[split_orchestration]", {
        sourcePath,
        targetPaths,
        generatedCount: generatedFiles.length,
      });

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        preverifyPayload,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            ok: true,
            handled: "split",
            sourcePath,
            targetPaths,
          }),
        },
      };
    } catch (e: any) {
      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            error: `split_orchestration_failed: ${e?.message ?? "unknown error"}`,
          }),
        },
      };
    }
  }

  // ─────────────────────────────────────────────
  // Import refactor orchestration
  // ─────────────────────────────────────────────
  const requestedPaths = extractMentionedPaths(content);

  if (
    isImportRefactorIntent(content) &&
    !/\bcreate\b/i.test(content) &&
    !/\bmove\b/i.test(content) &&
    !/\bextract\b/i.test(content) &&
    !/\bthen update\b/i.test(content) &&
    requestedPaths.length >= 2 &&
    out &&
    typeof out === "object" &&
    !("error" in out)
  ) {
    const readOut = out as {
      id: string;
      path?: string;
      mime?: string;
      content: string;
    };

    const readPath = String(readOut.path ?? "").trim();

    const sourcePath = requestedPaths[0] ?? "";
    const helperPath = requestedPaths.find((p) => p !== sourcePath) ?? "";

    if (!sourcePath || !helperPath) {
      console.log("[import_refactor_guard] skipped because source/helper could not be resolved", {
        requestedPaths,
        readPath,
      });

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }

    if (readPath !== sourcePath) {
      console.log("[import_refactor_guard] blocked non-source read", {
        requestedPaths,
        sourcePath,
        helperPath,
        readPath,
      });

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }

    const sourceExists = await resolveFileIdByPathOrName(supabase, repoId, sourcePath);
    const helperExists = await resolveFileIdByPathOrName(supabase, repoId, helperPath);

    console.log("[import_refactor_orchestration] detected", {
      sourcePath,
      helperPath,
      readPath,
      sourceExists: Boolean(sourceExists),
      helperExists: Boolean(helperExists),
    });

    if (!sourceExists || !helperExists) {
      console.log("[import_refactor_guard] skipped because one or more requested paths do not already exist", {
        sourcePath,
        helperPath,
        sourceExists: Boolean(sourceExists),
        helperExists: Boolean(helperExists),
      });

      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }

    const helperRead = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_read_text",
      { path: helperPath }
    );

    if (!helperRead || typeof helperRead !== "object" || "error" in helperRead) {
      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(
            helperRead ?? { error: `Failed to read helper module: ${helperPath}` }
          ),
        },
      };
    }

    const rewritten = await generateRewrittenFileContent({
      openai,
      model: runtimePolicy.model,
      userRequest:
        content + "\n\nRewrite the file and output the full updated file content only.",
      path: sourcePath,
      mime: String(readOut.mime ?? "application/typescript"),
      currentContent: String(readOut.content ?? ""),
    });

    if (!rewritten) {
      return {
        handled: true,
        requestHandledByOrchestration,
        pendingProposalOuts,
        handledSplitTurn,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            error: "import_refactor_failed: empty rewritten content",
          }),
        },
      };
    }

    const proposal = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_propose_write",
      {
        fileId: readOut.id,
        content: rewritten,
      }
    );

    if (proposal && typeof proposal === "object" && !("error" in proposal)) {
      if ((proposal as any).noop === true) {
        return {
          handled: true,
          requestHandledByOrchestration,
          pendingProposalOuts,
          handledSplitTurn,
          deterministicToolHandled: true,
          assistantText:
            "[Observation]\nThe requested file already reflects this goal step.\n\n" +
            `[Assessment]\nNo staged change was needed because ${readOut.path} already contains the requested update.\n\n` +
            "[Action]\nContinue to the next goal step.",
          toolOutput: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(out),
          },
        };
      }

      pendingProposalOuts.push(proposal);
    }

    return {
      handled: true,
      requestHandledByOrchestration,
      pendingProposalOuts,
      handledSplitTurn,
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(out),
      },
    };
  }

  // ─────────────────────────────────────────────
  // Source → Target helper extraction / extract orchestration
  // ─────────────────────────────────────────────
  if (
    isSourceTargetTransferIntent(content) &&
    out &&
    typeof out === "object" &&
    !("error" in out)
  ) {
    const readOut = out as {
      id: string;
      path?: string;
      mime?: string;
      content: string;
    };

    if (typeof readOut.content === "string") {
      try {
        const resolvedPaths = resolveSourceAndTargetPaths(content);

        if (!resolvedPaths) {
          console.log("[extract_orchestration] could not resolve source/target", {
            mentionedPaths: extractMentionedPaths(content),
            content,
          });

          return {
            handled: true,
            requestHandledByOrchestration,
            pendingProposalOuts,
            handledSplitTurn,
            toolOutput: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(out),
            },
          };
        }

        const { sourcePath, targetPath, paths: mentionedPaths } = resolvedPaths;

        if (!targetPath.includes("/")) {
          throw new Error(
            `extract_orchestration_failed: target path is not specific enough (${targetPath})`
          );
        }

        const readPath = String(readOut.path ?? "").trim();
        const readName = readPath.split("/").filter(Boolean).pop() ?? "";
        const sourceName =
          String(sourcePath ?? "")
            .trim()
            .split("/")
            .filter(Boolean)
            .pop() ?? "";

        const sourceMatchesRead =
          !!readPath &&
          (sourcePath === readPath ||
            sourcePath === readName ||
            sourceName === readName);

        if (!sourceMatchesRead) {
          return {
            handled: true,
            requestHandledByOrchestration,
            pendingProposalOuts,
            handledSplitTurn,
            toolOutput: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(out),
            },
          };
        }

        console.log("[extract_orchestration] detected", {
          sourcePath,
          targetPath,
          mentionedPaths,
        });

        const generated = await generateExtractHelpersResult({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          sourcePath,
          sourceContent: String(readOut.content ?? ""),
          targetPath,
        });

        if (!generated?.targetContent?.trim() || !generated?.sourceContent?.trim()) {
          throw new Error("Model returned empty extraction result");
        }

        const sourceText = String(generated?.sourceContent ?? "");
        const originalSourceText = String(readOut.content ?? "");

        const placeholderPatterns = [
          "rest of file unchanged",
          "other code remains unchanged",
          "the rest of the file",
          "omitted",
          "...",
        ];

        const lowerSource = sourceText.toLowerCase();

        if (placeholderPatterns.some((p) => lowerSource.includes(p))) {
          throw new Error(
            "Source rewrite contains placeholder text instead of full file content"
          );
        }

        if (sourceText.length < originalSourceText.length * 0.4) {
          throw new Error("Source rewrite is too small relative to original file");
        }

        const targetFileName =
          (targetPath ?? "").split("/").pop() || targetPath || "";
        const targetBaseName = targetFileName.replace(/\.[^.]+$/, "");
        const targetDir = targetPath.includes("/")
          ? targetPath.slice(0, targetPath.lastIndexOf("/"))
          : "";
        const sourceDir = sourcePath.includes("/")
          ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
          : "";

        const targetImportBase =
          sourceDir && targetDir && sourceDir === targetDir
            ? `./${targetBaseName}`
            : targetBaseName;

        const escapedImportBase = targetImportBase.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        const escapedFileName = targetFileName.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        const escapedBaseName = targetBaseName.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

        const sourceWithoutImports = sourceText.replace(
          /^import[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm,
          ""
        );

        const hasTargetReference =
          new RegExp(`from\\s+['"]${escapedImportBase}['"]`).test(sourceText) ||
          new RegExp(`from\\s+['"]${escapedImportBase}\\.ts['"]`).test(sourceText) ||
          new RegExp(`from\\s+['"]${escapedFileName}['"]`).test(sourceText) ||
          new RegExp(`\\b${escapedBaseName}\\b`).test(sourceWithoutImports);

        if (!hasTargetReference) {
          throw new Error(`Source rewrite did not reference ${targetFileName}`);
        }

        console.log("[extract_orchestration] generated", {
          sourcePath,
          targetPath,
          sourceBytes: Buffer.byteLength(generated.sourceContent, "utf8"),
          targetBytes: Buffer.byteLength(generated.targetContent, "utf8"),
        });

        const existingTargetId = await resolveFileIdByPathOrName(
          supabase,
          repoId,
          targetPath
        );

        let existingTargetText = "";

        if (existingTargetId) {
          const existingTargetFile = await vault_read_text(
            supabase,
            repoId,
            existingTargetId
          );

          existingTargetText = String(existingTargetFile.content ?? "");
        }

        const targetProposal = existingTargetId
          ? await runTool(
              supabase,
              repoId,
              userId,
              content,
              "vault_propose_write",
              {
                fileId: existingTargetId,
                path: targetPath,
                content: generated.targetContent,
              }
            )
          : await runTool(
              supabase,
              repoId,
              userId,
              content,
              "vault_propose_create",
              {
                path: targetPath,
                content: generated.targetContent,
                mime: inferTextMimeFromPath(targetPath),
              }
            );

        const sourceProposal = await runTool(
          supabase,
          repoId,
          userId,
          content,
          "vault_propose_write",
          {
            fileId: readOut.id,
            path: sourcePath,
            content: generated.sourceContent,
          }
        );

        const targetIsUsable =
          targetProposal &&
          typeof targetProposal === "object" &&
          !("error" in targetProposal) &&
          !(targetProposal as any).noop;

        const sourceIsUsable =
          sourceProposal &&
          typeof sourceProposal === "object" &&
          !("error" in sourceProposal) &&
          !(sourceProposal as any).noop;

        let allowTargetNoop = false;
        let allowSourceNoop = false;

        if (!targetIsUsable) {
          const normalizedExistingTarget = normalizeForNoopCheck(existingTargetText);
          const normalizedGeneratedTarget = normalizeForNoopCheck(
            String(generated.targetContent ?? "")
          );

          const targetAlreadyMatches =
            !!existingTargetText &&
            normalizedExistingTarget === normalizedGeneratedTarget;

          if (!targetAlreadyMatches) {
            throw new Error("Target extraction proposal was empty or noop");
          }

          allowTargetNoop = true;

          console.log("[extract_orchestration] target noop accepted", {
            sourcePath,
            targetPath,
            reason: "target already matches extracted module",
          });
        }

        if (!sourceIsUsable) {
          const sourceStillNeedsRewrite = sourceStillLooksUnextracted(
            String(readOut.content ?? ""),
            targetPath
          );

          if (sourceStillNeedsRewrite) {
            throw new Error(
              "Source rewrite was noop; extraction did not actually modify the source file"
            );
          }

          allowSourceNoop = true;

          console.log("[extract_orchestration] source noop accepted", {
            sourcePath,
            targetPath,
            reason: "source already references extracted module",
          });
        }

        if (!targetIsUsable) {
          const targetStillValid = targetStillLooksExtracted(
            String(generated.targetContent ?? "")
          );

          if (!targetStillValid) {
            throw new Error("Target extraction proposal was empty or noop");
          }
        }

        if (!sourceIsUsable) {
          const sourceStillNeedsRewrite = sourceStillLooksUnextracted(
            String(readOut.content ?? ""),
            targetPath
          );

          if (sourceStillNeedsRewrite) {
            throw new Error(
              "Source rewrite was noop; extraction did not actually modify the source file"
            );
          }

          console.log("[extract_orchestration] source noop accepted", {
            sourcePath,
            targetPath,
            reason: "source already references extracted module",
          });
        }

        if (
          !targetIsUsable &&
          !sourceIsUsable &&
          allowTargetNoop &&
          allowSourceNoop
        ) {
          console.log("[extract_orchestration] extraction already satisfied", {
            sourcePath,
            targetPath,
          });

          return {
            handled: true,
            requestHandledByOrchestration,
            pendingProposalOuts,
            handledSplitTurn,
            toolOutput: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(out),
            },
          };
        }

        if (
          !targetIsUsable &&
          !sourceIsUsable &&
          !allowTargetNoop &&
          !allowSourceNoop
        ) {
          throw new Error(
            "Extraction produced no effective change in either source or target"
          );
        }

        if (targetIsUsable) {
          pendingProposalOuts.push(targetProposal);
        }

        if (sourceIsUsable) {
          pendingProposalOuts.push(sourceProposal);
        }

        return {
          handled: true,
          requestHandledByOrchestration,
          pendingProposalOuts,
          handledSplitTurn,
          toolOutput: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(out),
          },
        };
      } catch (e: any) {
        return {
          handled: true,
          requestHandledByOrchestration,
          pendingProposalOuts,
          handledSplitTurn,
          toolOutput: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              error: `extract_orchestration_failed: ${e?.message ?? "unknown error"}`,
            }),
          },
        };
      }
    }
  }

  // ─────────────────────────────────────────────
  // (future blocks go here)
  // import refactor
  // extract module
  // etc
  // ─────────────────────────────────────────────



  // fallback → not handled
  return {
    handled: false,
    requestHandledByOrchestration,
    pendingProposalOuts,
    handledSplitTurn,
  };
}