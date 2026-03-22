// lib/chamber/applyRuntime.ts
import { setRepoFileStatus } from "@/lib/vault/fileStatus";
import { confirmCreatePhrase, confirmPhrase } from "@/lib/vault/utils";
import { vault_apply_create, vault_apply_write } from "@/lib/vault/tools";
import {
  runAutoVerifyForRepo,
  buildPendingVerifyPayload,
  buildFinalVerifyPayload,
} from "@/lib/chamber/verify";
import { updateChamberStateDoc } from "@/lib/chamber/memory";
import { buildSuggestedPromptsFromAppliedFiles } from "@/lib/chamber/suggestions";
import {
  findLatestGoalPlan,
  findLatestGoalStatus,
  advanceGoalAfterStepSuccess,
  findLatestGoalExecute
} from "@/lib/chamber/goalRuntime";
import { resolveVerifyCommand } from "@/lib/chamber/verifyRuntime";
import { loadRepoInference } from "@/lib/chamber/repoContext";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function handleApplySetCommand(args: {
  supabase: any;
  repoId: string;
  userId: string;
  requestId: string;
  content: string;
}): Promise<Response> {
  const { supabase, repoId, userId, requestId, content } = args;

  const raw = content.slice("__APPLY_SET__:".length);

  try {
    const payload = JSON.parse(raw);
    const proposals = Array.isArray(payload?.proposals) ? payload.proposals : [];

    if (proposals.length === 0) {
      throw new Error("No proposals provided");
    }

    console.log("[apply_set recv]", {
      count: proposals.length,
      paths: proposals.map((p: any) => p?.path),
      fileIds: proposals.map((p: any) => p?.fileId),
    });

    const touchedFileIds: string[] = [];
    const appliedFiles: any[] = [];

    for (const proposal of proposals) {
      console.log("[apply_set item]", {
        path: proposal?.path,
        fileId: proposal?.fileId,
        op: proposal?.meta?.op === "create" ? "create" : "overwrite",
      });

      const op = proposal?.meta?.op === "create" ? "create" : "overwrite";
      let applied: any;

      if (op === "create") {
        const expected = confirmCreatePhrase(proposal.fileId, proposal.nextHash);
        applied = await vault_apply_create(
          supabase,
          repoId,
          userId,
          expected,
          { ...proposal, confirm: expected }
        );
      } else {
        const expected = confirmPhrase(proposal.fileId, proposal.nextHash);
        applied = await vault_apply_write(
          supabase,
          repoId,
          userId,
          expected,
          { ...proposal, confirm: expected }
        );
      }

      touchedFileIds.push(String(proposal.fileId));
      appliedFiles.push({
        fileId: applied?.fileId ?? String(proposal.fileId),
        path: applied?.path ?? proposal?.path ?? null,
        version: applied?.version ?? null,
        mime: proposal?.mime ?? null,
      });
    }

    const { data: rowsAfter, error: rowsAfterErr } = await supabase
      .from("repo_files")
      .select("id, path, name, deleted_at")
      .eq("repo_id", repoId)
      .is("deleted_at", null)
      .in("id", touchedFileIds);

    console.log("[apply_set after_rows]", {
      repoId,
      touchedFileIds,
      rowsAfterErr: rowsAfterErr?.message ?? null,
      rowsAfter,
    });

    console.log("[apply_set done]", {
      touchedFileIds,
      appliedFiles,
    });

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: userId,
      role: "assistant",
      content:
        "[Observation]\nWrites applied.\n\n" +
        "[Assessment]\nThe staged multi-file change set was confirmed and file versions advanced.\n\n" +
        "[Action]\nNo pending confirmation remains for this applied change set.",
    });

    const applyPayload = {
      ok: true,
      repoId,
      requestId,
      changeId: null,
      touchedFileIds,
      appliedFiles,
    };

    const suggestedPrompts = buildSuggestedPromptsFromAppliedFiles(appliedFiles);

    const { inference } = await loadRepoInference({
      supabase,
      repoId,
    });

    const verifyCmd =
      inference?.projectType === "unknown" || inference?.projectType === "loose_files"
        ? null
        : resolveVerifyCommand(inference?.projectType ?? null);

    console.log("[verify_cmd_resolved]", {
      repoId,
      projectType: inference?.projectType ?? null,
      verifyCmd,
      skipped: !verifyCmd,
      reason: !verifyCmd ? "static site (no verify pipeline)" : null,
    });

    let goalAdvanceText = "";

    if (!verifyCmd) {
      for (const fid of touchedFileIds) {
        await setRepoFileStatus(repoId, fid, "ok", "verify_skipped", "verify");
      }

      try {
        const latestPlan = await findLatestGoalPlan(supabase, repoId);
        const latestStatus = latestPlan
          ? await findLatestGoalStatus(supabase, repoId, latestPlan.goalId)
          : null;

        const currentStepId =
          latestStatus?.currentStepId ??
          latestPlan?.currentStepId ??
          null;

        if (latestPlan?.goalId && currentStepId) {
          const goalAdvanceResult = await advanceGoalAfterStepSuccess({
            supabase,
            repoId,
            userId,
            goalId: String(latestPlan.goalId),
            stepId: String(currentStepId),
          });

          if (goalAdvanceResult?.content) {
            goalAdvanceText = `\n${goalAdvanceResult.content}\n`;
          }

          console.log("[goal_advance_after_apply_set]", {
            repoId,
            goalId: latestPlan.goalId,
            stepId: currentStepId,
            done: goalAdvanceResult?.done ?? null,
            nextStepId: goalAdvanceResult?.nextStepId ?? null,
            verifySkipped: true,
          });
        }
      } catch (e: any) {
        console.log("[goal_advance_after_apply_set failed]", e?.message);
      }

      const skippedVerifyPayload = {
        pending: false,
        ok: true,
        skipped: true,
        command: null,
        reason: "static site (no verify pipeline)",
        fileIds: touchedFileIds,
      };

      const txt =
        `[Observation]\nWrites applied.\n\n` +
        `[Assessment]\nMultiple file versions advanced. Verification was skipped because no supported project type was detected.\n\n` +
        `[Action]\nFiles updated deterministically.\n` +
        `\n__APPLY__:${JSON.stringify(applyPayload)}\n` +
        `\n__VERIFY__:${JSON.stringify(skippedVerifyPayload)}\n` +
        `\n__SUGGESTED_PROMPTS__:${JSON.stringify(suggestedPrompts)}\n` +
        goalAdvanceText;

      return new Response(txt, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const pendingVerifyPayload = buildPendingVerifyPayload({
      fileIds: touchedFileIds,
      command: verifyCmd,
    });

    let finalVerifyPayload: any;
    let verifySummaryText = "";

    try {
      const { verifyPayload } = await runAutoVerifyForRepo({
        repoId,
        verifyCmd,
      });

      for (const fid of touchedFileIds) {
        await setRepoFileStatus(
          repoId,
          fid,
          verifyPayload.ok ? "ok" : "error",
          verifyPayload.ok ? null : (verifyPayload.failureKind ?? "verify_failed"),
          "verify"
        );
      }

      finalVerifyPayload = buildFinalVerifyPayload({
        base: verifyPayload,
        fileIds: touchedFileIds,
      });

      console.log("[apply_set verify result]", {
        ok: finalVerifyPayload?.ok,
        failedStep: finalVerifyPayload?.failedStep ?? null,
        failureKind: finalVerifyPayload?.failureKind ?? null,
      });

      if (finalVerifyPayload?.ok) {
        try {
          const latestPlan = await findLatestGoalPlan(supabase, repoId);
          const latestStatus = latestPlan
            ? await findLatestGoalStatus(supabase, repoId, latestPlan.goalId)
            : null;

          const currentStepId =
            latestStatus?.currentStepId ??
            latestPlan?.currentStepId ??
            null;

          console.log("[apply_set advance attempt]", {
            repoId,
            latestPlanGoalId: latestPlan?.goalId ?? null,
            latestPlanCurrentStepId: latestPlan?.currentStepId ?? null,
            latestStatusCurrentStepId: latestStatus?.currentStepId ?? null,
            chosenCurrentStepId: currentStepId,
            verifyOk: finalVerifyPayload?.ok ?? null,
          });

          if (latestPlan?.goalId && currentStepId) {
            const goalAdvanceResult = await advanceGoalAfterStepSuccess({
              supabase,
              repoId,
              userId,
              goalId: String(latestPlan.goalId),
              stepId: String(currentStepId),
            });

            if (goalAdvanceResult?.content) {
              goalAdvanceText = `\n${goalAdvanceResult.content}\n`;
            }

            console.log("[goal_advance_after_apply_set]", {
              repoId,
              goalId: latestPlan.goalId,
              stepId: currentStepId,
              done: goalAdvanceResult?.done ?? null,
              nextStepId: goalAdvanceResult?.nextStepId ?? null,
            });
          }
        } catch (e: any) {
          console.log("[goal_advance_after_apply_set failed]", e?.message);
        }
      }

      try {
        await updateChamberStateDoc(supabase, repoId, {
          activeEngineeringArea: "Verification and repository integrity checks.",
          recentChanges: [
            "Applied multi-file staged change set.",
            `Auto-verify result: ${verifyPayload.ok ? "PASS" : "FAIL"}.`,
          ],
          immediateNextSteps: verifyPayload.ok
            ? ["Continue implementation or stage the next change."]
            : ["Review verify output and fix failing files before continuing."],
        });
      } catch (e: any) {
        console.log("[chamber-state] apply_set auto-verify update skipped:", e?.message);
        for (const fid of touchedFileIds) {
          await setRepoFileStatus(
            repoId,
            fid,
            "error",
            "verify_internal_error",
            "verify"
          );
        }
      }

      verifySummaryText =
        `\n[Observation]\nAuto verification executed.\n\n` +
        `[Assessment]\ncommand=${finalVerifyPayload.command} ok=${finalVerifyPayload.ok} exitCode=${finalVerifyPayload.exitCode} durationMs=${finalVerifyPayload.durationMs}\n\n` +
        `[Action]\nVerification result recorded.\n`;
    } catch (e: any) {
      finalVerifyPayload = buildFinalVerifyPayload({
        base: {
          command: verifyCmd,
          ok: false,
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: e?.message ?? "Auto verify failed",
          jobId: null,
          fingerprint: null,
          failedStep: "verify_boot",
          failureKind: "internal_error",
          timedOut: false,
        },
        fileIds: touchedFileIds,
      });

      verifySummaryText =
        `\n[Observation]\nAuto verification failed.\n\n` +
        `[Assessment]\n${e?.message ?? "Unknown auto-verify error"}\n\n` +
        `[Action]\nReview verify pipeline logs.\n`;
    }

    const txt =
      `[Observation]\nWrites applied.\n\n` +
      `[Assessment]\nMultiple file versions advanced.\n\n` +
      `[Action]\nFiles updated deterministically.\n` +
      `\n__APPLY__:${JSON.stringify(applyPayload)}\n` +
      `\n__VERIFY__:${JSON.stringify(pendingVerifyPayload)}\n` +
      `\n__VERIFY__:${JSON.stringify(finalVerifyPayload)}\n` +
      `\n__SUGGESTED_PROMPTS__:${JSON.stringify(suggestedPrompts)}\n` +
      goalAdvanceText +
      verifySummaryText;

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return new Response(
      `[Observation]\nApply failed.\n\n[Assessment]\n${e?.message ?? "Unknown error"}\n\n[Action]\nRecreate proposal set.`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

export async function handleApplyCommand(args: {
  supabase: any;
  repoId: string;
  userId: string;
  requestId: string;
  content: string;
}): Promise<Response> {
  const { supabase, repoId, userId, requestId, content } = args;

  const raw = content.slice("__APPLY__:".length);

  try {
    const proposal = JSON.parse(raw);
    console.log("[apply] keys=", Object.keys(proposal || {}));
    console.log("[apply] meta=", proposal?.meta ?? null);

    const op = proposal?.meta?.op === "create" ? "create" : "overwrite";
    let applied: any;

    if (op === "create") {
      const expected = confirmCreatePhrase(proposal.fileId, proposal.nextHash);
      applied = await vault_apply_create(
        supabase,
        repoId,
        userId,
        expected,
        { ...proposal, confirm: expected }
      );
    } else {
      const expected = confirmPhrase(proposal.fileId, proposal.nextHash);
      applied = await vault_apply_write(
        supabase,
        repoId,
        userId,
        expected,
        { ...proposal, confirm: expected }
      );
    }

    const appliedPath = String(applied?.path ?? proposal?.path ?? "the file");

    const appliedAssistantText =
      `[Observation]\nWrite applied.\n\n` +
      `[Assessment]\nThe staged change to ${appliedPath} was confirmed and the file version advanced.\n\n` +
      `[Action]\nNo pending confirmation remains for this applied file change.`;

    if (proposal?.meta?.kind === "engraving" && Array.isArray(proposal?.meta?.keepIds)) {
      const keepIds = proposal.meta.keepIds.map((x: any) => String(x)).filter(Boolean);

      if (keepIds.length > 0) {
        const supabaseAdmin = createSupabaseAdmin();

        const { data: files, error: filesErr } = await supabaseAdmin
          .from("repo_files")
          .select("id, path, mime")
          .eq("repo_id", repoId)
          .is("deleted_at", null);

        if (filesErr) {
          throw new Error(`Auto verify file lookup failed: ${filesErr.message}`);
        }

        const { count: beforeCount, error: beforeErr } = await supabaseAdmin
          .from("repo_messages")
          .select("id", { count: "exact", head: true })
          .eq("repo_id", repoId);

        if (beforeErr) {
          console.log("[engraving] count(before) failed:", beforeErr.message);
        }

        const { data: delRows, error: listErr } = await supabaseAdmin
          .from("repo_messages")
          .select("id")
          .eq("repo_id", repoId)
          .not("id", "in", `(${keepIds.map((id: string) => `"${id}"`).join(",")})`);

        if (listErr) {
          console.log("[engraving] prune list failed:", listErr.message);
        } else {
          const deleteIds = (delRows ?? []).map((r: any) => String(r.id)).filter(Boolean);

          let actualDeleted = 0;

          if (deleteIds.length > 0) {
            const { data: deletedRows, error: delErr } = await supabaseAdmin
              .from("repo_messages")
              .delete()
              .eq("repo_id", repoId)
              .in("id", deleteIds)
              .select("id");

            if (delErr) {
              console.log("[engraving] prune delete failed:", delErr.message);
            } else {
              actualDeleted = deletedRows?.length ?? 0;
              console.log("[engraving] prune deleted rows:", actualDeleted);
            }
          }

          const { count: afterCount, error: afterErr } = await supabaseAdmin
            .from("repo_messages")
            .select("id", { count: "exact", head: true })
            .eq("repo_id", repoId);

          if (afterErr) {
            console.log("[engraving] count(after) failed:", afterErr.message);
          }

          console.log("[engraving] prune result", {
            repoId,
            keep: keepIds.length,
            candidates: deleteIds.length,
            deleted: actualDeleted,
            before: beforeCount ?? null,
            after: afterCount ?? null,
          });
        }
      }
    }

    const didEngraving = proposal?.meta?.kind === "engraving";
    const touchedFileIds = [String(proposal.fileId)].filter(Boolean);

    const applyPayload = {
      ok: true,
      repoId,
      requestId,
      changeId: typeof proposal?.meta?.changeId === "string" ? proposal.meta.changeId : null,
      touchedFileIds,
      appliedFile: {
        fileId: applied?.fileId ?? String(proposal.fileId),
        path: applied?.path ?? proposal?.path ?? null,
        version: applied?.version ?? null,
        mime: proposal?.mime ?? null,
      },
    };

    try {
      await updateChamberStateDoc(supabase, repoId, {
        activeEngineeringArea: "Applying staged repository changes.",
        importantFiles: [String(applied?.path ?? proposal?.path ?? "repository file")].filter(Boolean),
        recentChanges: [
          `Applied staged change to ${String(applied?.path ?? proposal?.path ?? "a repository file")}.`,
        ],
        immediateNextSteps: [
          "Auto verification is running.",
          "Continue with the next engineering task.",
        ],
      });
    } catch (e: any) {
      console.log("[chamber-state] apply update skipped:", e?.message);
    }

    const suggestedPrompts = buildSuggestedPromptsFromAppliedFiles([
      {
        path: applied?.path ?? proposal?.path ?? null,
        mime: proposal?.mime ?? null,
      },
    ]);

    const { inference } = await loadRepoInference({
      supabase,
      repoId,
    });

    const verifyCmd =
      inference?.projectType === "unknown" || inference?.projectType === "loose_files"
        ? null
        : resolveVerifyCommand(inference?.projectType ?? null);

    console.log("[verify_cmd_resolved]", {
      repoId,
      projectType: inference?.projectType ?? null,
      verifyCmd,
      skipped: !verifyCmd,
      reason: !verifyCmd ? "static site (no verify pipeline)" : null,
    });

    if (!verifyCmd) {
      let goalAdvanceText = "";

      await setRepoFileStatus(
        repoId,
        applied?.fileId ?? proposal.fileId,
        "ok",
        "verify_skipped",
        "verify"
      );

      try {
        const latestPlan = await findLatestGoalPlan(supabase, repoId);
        const latestExecute = latestPlan
          ? await findLatestGoalExecute(
              supabase,
              repoId,
              String(latestPlan.goalId ?? "")
            )
          : null;

        if (latestExecute?.goalId && latestExecute?.stepId) {
          const advancement = await advanceGoalAfterStepSuccess({
            supabase,
            repoId,
            userId,
            goalId: String(latestExecute.goalId),
            stepId: String(latestExecute.stepId),
          });

          if (advancement?.content) {
            goalAdvanceText = `\n${advancement.content}\n`;
          }

          console.log("[goal_advance_after_apply]", {
            repoId,
            goalId: latestExecute.goalId,
            stepId: latestExecute.stepId,
            done: advancement?.done ?? null,
            nextStepId: advancement?.nextStepId ?? null,
            verifySkipped: true,
          });
        }
      } catch (e: any) {
        console.log("[goal_advance_after_apply] failed:", e?.message);
      }

      const skippedVerifyPayload = {
        pending: false,
        ok: true,
        skipped: true,
        command: null,
        reason: "static site (no verify pipeline)",
        fileIds: touchedFileIds,
      };

      await supabase.from("repo_messages").insert({
        repo_id: repoId,
        user_id: userId,
        role: "assistant",
        content: `${appliedAssistantText}${goalAdvanceText}`,
      });

      const txt =
        `[Observation]\nWrite applied.\n\n` +
        `[Assessment]\nVersion advanced. Verification was skipped because no supported project type was detected.\n\n` +
        `[Action]\nFile updated deterministically.\n` +
        `\n__APPLY__:${JSON.stringify(applyPayload)}\n` +
        `\n__VERIFY__:${JSON.stringify(skippedVerifyPayload)}\n` +
        `\n__SUGGESTED_PROMPTS__:${JSON.stringify(suggestedPrompts)}\n` +
        goalAdvanceText +
        (didEngraving ? `\n__RESET__\n` : "");

      return new Response(txt, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const pendingVerifyPayload = buildPendingVerifyPayload({
      fileIds: touchedFileIds,
      command: verifyCmd,
    });

    let finalVerifyPayload: any;
    let verifySummaryText = "";

    try {
      const { verifyPayload } = await runAutoVerifyForRepo({
        repoId,
        verifyCmd,
      });

      await setRepoFileStatus(
        repoId,
        applied?.fileId ?? proposal.fileId,
        verifyPayload.ok ? "ok" : "error",
        verifyPayload.ok ? null : (verifyPayload.failureKind ?? "verify_failed"),
        "verify"
      );

      finalVerifyPayload = buildFinalVerifyPayload({
        base: verifyPayload,
        fileIds: touchedFileIds,
      });

      try {
        await updateChamberStateDoc(supabase, repoId, {
          activeEngineeringArea: "Verification and repository integrity checks.",
          importantFiles: [String(applied?.path ?? proposal?.path ?? "repository file")].filter(Boolean),
          recentChanges: [
            `Applied staged change to ${String(applied?.path ?? proposal?.path ?? "a repository file")}.`,
            `Auto-verify result: ${verifyPayload.ok ? "PASS" : "FAIL"}.`,
          ],
          immediateNextSteps: verifyPayload.ok
            ? ["Continue implementation or stage the next change."]
            : ["Review verify output and fix failing files before continuing."],
        });
      } catch (e: any) {
        console.log("[chamber-state] single apply auto-verify update skipped:", e?.message);
        await setRepoFileStatus(
          repoId,
          applied?.fileId ?? proposal.fileId,
          "error",
          "verify_internal_error",
          "verify"
        );
      }

      verifySummaryText =
        `\n[Observation]\nAuto verification executed.\n\n` +
        `[Assessment]\ncommand=${finalVerifyPayload.command} ok=${finalVerifyPayload.ok} exitCode=${finalVerifyPayload.exitCode} durationMs=${finalVerifyPayload.durationMs}\n\n` +
        `[Action]\nVerification result recorded.\n`;
    } catch (e: any) {
      finalVerifyPayload = buildFinalVerifyPayload({
        base: {
          command: verifyCmd,
          ok: false,
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: e?.message ?? "Auto verify failed",
          jobId: null,
          fingerprint: null,
          failedStep: "verify_boot",
          failureKind: "internal_error",
          timedOut: false,
        },
        fileIds: touchedFileIds,
      });

      verifySummaryText =
        `\n[Observation]\nAuto verification failed.\n\n` +
        `[Assessment]\n${e?.message ?? "Unknown auto-verify error"}\n\n` +
        `[Action]\nReview verify pipeline logs.\n`;
    }

    let goalAdvanceText = "";

    try {
      const latestPlan = await findLatestGoalPlan(supabase, repoId);
      const latestExecute = latestPlan
        ? await findLatestGoalExecute(
            supabase,
            repoId,
            String(latestPlan.goalId ?? "")
          )
        : null;

      if (latestExecute?.goalId && latestExecute?.stepId) {
        const advancement = await advanceGoalAfterStepSuccess({
          supabase,
          repoId,
          userId,
          goalId: String(latestExecute.goalId),
          stepId: String(latestExecute.stepId),
        });

        if (advancement?.content) {
          goalAdvanceText = `\n${advancement.content}\n`;

          console.log("[goal_advance_after_apply]", {
            repoId,
            goalId: latestExecute.goalId,
            stepId: latestExecute.stepId,
            done: advancement.done,
            nextStepId: advancement.nextStepId ?? null,
          });
        }
      }
    } catch (e: any) {
      console.log("[goal_advance_after_apply] failed:", e?.message);
    }

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: userId,
      role: "assistant",
      content: `${appliedAssistantText}${goalAdvanceText}`,
    });

    const txt =
      `[Observation]\nWrite applied.\n\n` +
      `[Assessment]\nVersion advanced.\n\n` +
      `[Action]\nFile updated deterministically.\n` +
      `\n__APPLY__:${JSON.stringify(applyPayload)}\n` +
      `\n__VERIFY__:${JSON.stringify(pendingVerifyPayload)}\n` +
      `\n__VERIFY__:${JSON.stringify(finalVerifyPayload)}\n` +
      `\n__SUGGESTED_PROMPTS__:${JSON.stringify(suggestedPrompts)}\n` +
      goalAdvanceText +
      verifySummaryText +
      (didEngraving ? `\n__RESET__\n` : "");

    console.log("[apply] didEngraving=", didEngraving);

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return new Response(
      `[Observation]\nApply failed.\n\n[Assessment]\n${e?.message ?? "Unknown error"}\n\n[Action]\nRecreate proposal.`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}