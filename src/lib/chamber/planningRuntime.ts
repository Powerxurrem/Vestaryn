// lib/chamber/planningRuntime.ts
import OpenAI from "openai";
import { findLatestGoalPlan } from "@/lib/chamber/goalRuntime";

export async function handlePlanningRequest(args: {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  model: string;
}): Promise<Response> {
  const { openai, supabase, repoId, userId, content, model } = args;

  const { error: goalUserInsertErr } = await supabase
    .from("repo_messages")
    .insert({
      repo_id: repoId,
      user_id: userId,
      role: "user",
      content,
    });

  if (goalUserInsertErr) {
    console.log("[goal_plan user insert failed]", {
      repoId,
      message: goalUserInsertErr.message,
      details: goalUserInsertErr,
    });

    return new Response(
      "[Observation]\nGoal plan start failed.\n\n[Assessment]\nThe user goal request could not be saved.\n\n[Action]\nCheck server logs for [goal_plan user insert failed].",
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }

  const goalPlanInstructions = `
You are generating a GoalPlan object for Vestaryn.

Return only valid JSON.
Do not return markdown.
Do not use code fences.
Do not add prose before or after the JSON.

Schema:
{
  "goalId": string,
  "title": string,
  "summary": string,
  "status": "awaiting_approval",
  "scope": "small" | "medium" | "large",
  "estimatedTouchedFiles": string[],
  "steps": [
    {
      "id": string,
      "title": string,
      "description": string,
      "status": "pending",
      "files": string[]
    }
  ]
}

Rules:
- Return exactly 3 steps.
- Keep summary under 80 characters.
- Keep each step title under 4 words.
- Keep each step description under 70 characters.
- Keep estimatedTouchedFiles to at most 4 entries.
- Keep each step files array to at most 2 entries.
- Use short file paths only.
- No optional files.
- No extra explanation.
- Keep the JSON extremely compact.
- Prefer terse wording over completeness.
- Omit nonessential file names.
- Use compact descriptions, not sentences with clauses.
- Do not think step-by-step.
- Emit JSON immediately.
`;

  try {
    const resp = await openai.responses.create({
      model,
      instructions: goalPlanInstructions,
      input: [{ role: "user", content }],
      tool_choice: "none",
      max_output_tokens: 500,
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
    });

    console.log("[goal_plan resp debug]", {
      id: resp.id,
      outputTextLen: String(resp.output_text ?? "").length,
      outputLen: Array.isArray((resp as any).output) ? (resp as any).output.length : null,
      finishReason: (resp as any).status ?? null,
      firstOutput: Array.isArray((resp as any).output) ? (resp as any).output[0] : null,
    });

    const raw =
      String(resp.output_text ?? "").trim() ||
      String(
        (resp as any)?.output?.[0]?.content?.[0]?.text ??
        (resp as any)?.output?.[0]?.content?.[0]?.output_text ??
        ""
      ).trim();

    if (!raw) {
      console.log("[goal_plan empty_response]", {
        id: resp.id,
        resp,
      });

      return new Response(
        "[Observation]\nGoal plan generation failed.\n\n[Assessment]\nThe model returned an empty planning response.\n\n[Action]\nRetry the request.",
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    console.log("[goal_plan] raw", raw);

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      console.log("[goal_plan] invalid_json", {
        message: e?.message,
        raw,
      });

      return new Response(
        "[Observation]\nGoal plan generation failed.\n\n[Assessment]\nThe model did not return valid GoalPlan JSON.\n\n[Action]\nRetry with the dedicated planning contract.",
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    const final = `__GOAL_PLAN__:${JSON.stringify(parsed)}`;

    console.log("[goal_plan persist about to insert]", {
      repoId,
      length: final.length,
      startsWithGoalPlan: final.startsWith("__GOAL_PLAN__:"),
      head: final.slice(0, 160),
    });

const latestPlan = await findLatestGoalPlan(supabase, repoId);

const oldStatus = String(latestPlan?.status ?? "").toLowerCase();
const oldGoalId = String(latestPlan?.goalId ?? "").trim();
const newGoalId = String(parsed?.goalId ?? "").trim();

const shouldCancelPrevious =
  !!oldGoalId &&
  oldGoalId !== newGoalId &&
  oldStatus !== "completed" &&
  oldStatus !== "cancelled";

if (shouldCancelPrevious) {
  const replacedMarker =
    `__GOAL_STATUS__:${JSON.stringify({
      goalId: oldGoalId,
      status: "cancelled",
      currentStepId: null,
      note: "Replaced by a newer goal plan.",
    })}`;

  await supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: userId,
    role: "assistant",
    content: replacedMarker,
  });

  console.log("[goal_plan replaced previous]", {
    repoId,
    oldGoalId,
    newGoalId,
  });
}

    const { error: goalAssistantInsertErr } = await supabase
      .from("repo_messages")
      .insert({
        repo_id: repoId,
        user_id: userId,
        role: "assistant",
        content: final,
      });


      
    if (goalAssistantInsertErr) {
      console.log("[goal_plan persist failed]", {
        repoId,
        message: goalAssistantInsertErr.message,
        details: goalAssistantInsertErr,
      });

      return new Response(
        "[Observation]\nGoal plan persistence failed.\n\n[Assessment]\nThe goal plan was generated but could not be saved to repo_messages.\n\n[Action]\nCheck server logs for [goal_plan persist failed].",
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    console.log("[goal_plan persist ok]", { repoId });

    return new Response(final, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[goal_plan] failed", e?.message);

    return new Response(
      "[Observation]\nGoal plan generation failed.\n\n[Assessment]\nThe dedicated planning branch failed before a valid marker could be created.\n\n[Action]\nCheck server logs for [goal_plan].",
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }
}