// lib/chamber/deterministicCommands.ts
import {
  extractGoalStatus,
  findLatestGoalPlan,
  findLatestGoalStatus,
  findLatestGoalExecute,
} from "@/lib/chamber/goalRuntime";
import {
  buildGoalExecutionInstruction,
  isInternalControlPrompt,
  isInternalGoalExecutionPrompt,
} from "@/lib/chamber/intent";
import { maybeSummarizeAndEngraveProposal } from "@/lib/chamber/memory";
import { extractRawGoalMarkerBlock } from "@/types/goalMarkers";

export async function tryHandleDeterministicCommands(args: {
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
}): Promise<Response | null> {
  const { supabase, repoId, userId, content } = args;

  // ─────────────────────────────────────────
  // GOAL STOP (deterministic)
  // ─────────────────────────────────────────
  if (content.trim() === "__GOAL_STOP__") {
    const plan = await findLatestGoalPlan(supabase, repoId);

    if (!plan) {
      return new Response("No active goal found", { status: 400 });
    }

    const statusPayload = {
      goalId: String(plan.goalId ?? ""),
      status: "cancelled",
      currentStepId: null,
      note: "Goal stopped by user.",
    };

    const final = `__GOAL_STATUS__:${JSON.stringify(statusPayload)}`;

    console.log("[goal_stop]", {
      repoId,
      goalId: statusPayload.goalId,
    });

    await supabase.from("repo_messages").insert([
      {
        repo_id: repoId,
        user_id: userId,
        role: "user",
        content,
      },
      {
        repo_id: repoId,
        user_id: userId,
        role: "assistant",
        content: final,
      },
    ]);

    return new Response(final, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // ─────────────────────────────────────────
  // GOAL APPROVE (deterministic)
  // ─────────────────────────────────────────
  if (content.trim() === "__GOAL_APPROVE__") {
    const { data: rows, error } = await supabase
      .from("repo_messages")
      .select("content, created_at")
      .eq("repo_id", repoId)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(200);

    const latestGoalStatusMsg = (rows ?? []).find((r: any) => {
      const txt = String(r.content ?? "").trim();
      return txt.startsWith("__GOAL_STATUS__:");
    });

    if (latestGoalStatusMsg) {
      const latestStatus = extractGoalStatus(
        String(latestGoalStatusMsg.content ?? "")
      );

      if (latestStatus?.status === "running") {
        console.log("[goal_approve] already running, returning existing status");

        return new Response(
          `__GOAL_STATUS__:${JSON.stringify(latestStatus)}`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
    }

    const latestGoalPlanMsg = (rows ?? []).find((r: any) => {
      const txt = String(r.content ?? "").trim();
      return txt.startsWith("__GOAL_PLAN__:");
    });

    if (error) {
      return new Response(
        "[Observation]\nGoal approval failed.\n\n[Assessment]\nCould not load recent assistant messages.\n\n[Action]\nRetry approval.",
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    console.log(
      "[goal_approve recent assistant heads]",
      (rows ?? []).slice(0, 5).map((r: any) => ({
        head: String(r.content ?? "").slice(0, 120),
      }))
    );

    if (!latestGoalPlanMsg) {
      return new Response(
        "[Observation]\nGoal approval failed.\n\n[Assessment]\nNo pending goal plan was found.\n\n[Action]\nCreate a plan first.",
        {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    const raw = String(latestGoalPlanMsg.content ?? "").trim();

    let plan: any;
    try {
      if (raw.startsWith("__GOAL_PLAN__:")) {
        plan = JSON.parse(raw.slice("__GOAL_PLAN__:".length));
      } else {
        const extracted = extractRawGoalMarkerBlock(
          `__GOAL_PLAN__:${raw}`,
          "__GOAL_PLAN__:"
        );
        plan = JSON.parse(
          extracted?.slice("__GOAL_PLAN__:".length) ?? raw
        );
      }
    } catch (e: any) {
      return new Response(
        "[Observation]\nGoal approval failed.\n\n[Assessment]\nStored goal plan JSON was invalid.\n\n[Action]\nRegenerate the plan.",
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    const statusPayload = {
      goalId: String(plan.goalId ?? ""),
      status: "running",
      currentStepId:
        Array.isArray(plan.steps) && plan.steps.length > 0
          ? String(plan.steps[0].id ?? "")
          : null,
    };

    console.log("[goal_approve]", {
      repoId,
      goalId: statusPayload.goalId,
      currentStepId: statusPayload.currentStepId,
      stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
    });

    const final = `__GOAL_STATUS__:${JSON.stringify(statusPayload)}`;

    await supabase.from("repo_messages").insert([
      {
        repo_id: repoId,
        user_id: userId,
        role: "user",
        content,
      },
      {
        repo_id: repoId,
        user_id: userId,
        role: "assistant",
        content: final,
      },
    ]);

    return new Response(final, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // ─────────────────────────────────────────
  // GOAL CONTINUE (deterministic)
  // ─────────────────────────────────────────
  if (content.trim() === "__GOAL_CONTINUE__") {
    const plan = await findLatestGoalPlan(supabase, repoId);

    if (!plan) {
      return new Response(
        "[Observation]\nNo active goal was found.\n\n[Assessment]\nThe latest goal plan could not be located.\n\n[Action]\nCreate a new plan or reload the chamber.",
        {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    const goalId = String(plan.goalId ?? "");
    const latestStatus = await findLatestGoalStatus(supabase, repoId, goalId);
    const steps = Array.isArray(plan.steps) ? plan.steps : [];

    const effectiveCurrentStepId =
      typeof latestStatus?.currentStepId === "string"
        ? latestStatus.currentStepId
        : steps.length > 0
        ? String(steps[0].id ?? "")
        : null;

    const stepToExecute =
      effectiveCurrentStepId
        ? steps.find(
            (s: any) => String(s.id ?? "") === String(effectiveCurrentStepId)
          ) ?? null
        : null;

    if (!stepToExecute) {
      const donePayload = {
        goalId,
        status: "completed",
        currentStepId: null,
        completedStepIds: Array.isArray(latestStatus?.completedStepIds)
          ? latestStatus.completedStepIds
          : [],
      };

      const final = `__GOAL_DONE__:${JSON.stringify(donePayload)}`;

      await supabase.from("repo_messages").insert([
        {
          repo_id: repoId,
          user_id: userId,
          role: "user",
          content,
        },
        {
          repo_id: repoId,
          user_id: userId,
          role: "assistant",
          content: final,
        },
      ]);

      return new Response(final, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const statusPayload = {
      goalId,
      status: "running",
      currentStepId: String(stepToExecute.id ?? ""),
      completedStepIds: Array.isArray(latestStatus?.completedStepIds)
        ? latestStatus.completedStepIds
        : [],
    };

    const executePayload = {
      goalId,
      stepId: String(stepToExecute.id ?? ""),
      instruction: buildGoalExecutionInstruction(stepToExecute, plan),
    };

    const final = [
      `__GOAL_STATUS__:${JSON.stringify(statusPayload)}`,
      `__GOAL_EXECUTE__:${JSON.stringify(executePayload)}`,
    ].join("\n");

    console.log("[goal_continue]", {
      repoId,
      goalId,
      currentStepId: statusPayload.currentStepId,
      executeStepId: executePayload.stepId,
    });

    await supabase.from("repo_messages").insert([
      {
        repo_id: repoId,
        user_id: userId,
        role: "user",
        content,
      },
      {
        repo_id: repoId,
        user_id: userId,
        role: "assistant",
        content: final,
      },
    ]);

    return new Response(final, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // ─────────────────────────────────────────
  // Deterministic short-circuit: current year
  // ─────────────────────────────────────────
const normalizedContent = String(content ?? "").trim();

const isInternalPrompt =
  isInternalControlPrompt(normalizedContent) ||
  isInternalGoalExecutionPrompt(normalizedContent);

const isSimpleCurrentYearQuestion =
  /^(what year is it\??|current year\??)$/i.test(normalizedContent);

if (!isInternalPrompt && isSimpleCurrentYearQuestion) {
  const year = new Date().getFullYear();

    const txt = `[Observation]
User requested current year.

[Assessment]
This is deterministic from server clock and should not use the LLM.

[Action]
Not a systems question. It is currently ${year}.`;

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: userId,
      role: "user",
      content: normalizedContent,
    });

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: userId,
      role: "assistant",
      content: txt,
    });

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // ─────────────────────────────────────────
  // Engraving probe (deterministic)
  // ─────────────────────────────────────────
  if (content.trim() === "__ENGRAVE__") {
    try {
      console.log("[engrave_probe] hit", { repoId, userId });

      const engraving = await maybeSummarizeAndEngraveProposal(
        supabase,
        repoId,
        userId,
        { force: true }
      );

      const markerLine = engraving?.marker
        ? `\n__ENGRAVING__:${JSON.stringify(engraving.marker)}\n`
        : "";

      const txt =
        `[Observation]\nEngraving probe executed.\n\n` +
        `[Assessment]\nmarker=${Boolean(engraving?.marker)}\n\n` +
        `[Action]\nIf marker=true, UI should render the Engraving panel.\n` +
        markerLine;

      return new Response(txt, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch (e: any) {
      console.log("[engrave_probe] error", e?.message);

      return new Response(
        `[Observation]\nEngraving probe failed.\n\n[Assessment]\n${e?.message ?? "Unknown error"}\n\n[Action]\nCheck server logs.\n`,
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }
  }

  return null;
}