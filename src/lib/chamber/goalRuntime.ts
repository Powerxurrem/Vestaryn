import { extractGoalExecute} from "@/lib/chamber/intent";

export function extractGoalPlan(text: string) {
  const marker = "__GOAL_PLAN__:";
  const s = String(text ?? "");

  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  const after = s.slice(start);

  const endIdx = after.indexOf("\n__");
  const json = (endIdx === -1 ? after : after.slice(0, endIdx)).trim();

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function extractGoalStatus(text: string) {
  const marker = "__GOAL_STATUS__:";
  const s = String(text ?? "");

  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  const after = s.slice(start);

  const endIdx = after.indexOf("\n");
  const json = (endIdx === -1 ? after : after.slice(0, endIdx)).trim();

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function findLatestGoalPlan(
  supabase: any,
  repoId: string
) {
  const { data: rows, error } = await supabase
    .from("repo_messages")
    .select("content, created_at")
    .eq("repo_id", repoId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to load goal history: ${error.message}`);
  }

  for (const row of rows ?? []) {
    const txt = String(row.content ?? "");
    const parsed = extractGoalPlan(txt);

    if (parsed) {
      console.log("[findLatestGoalPlan] found", {
        goalId: parsed.goalId,
        title: parsed.title,
      });
      return parsed;
    }
  }

  return null;
}

export async function findLatestGoalStatus(
  supabase: any,
  repoId: string,
  goalId: string
) {
  const { data: rows, error } = await supabase
    .from("repo_messages")
    .select("content, created_at")
    .eq("repo_id", repoId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to load goal status history: ${error.message}`);
  }

  for (const row of rows ?? []) {
    const txt = String(row.content ?? "");
    const parsed = extractGoalStatus(txt);
    if (parsed && String(parsed.goalId ?? "") === goalId) {
      return parsed;
    }
  }

  return null;
}

export async function findLatestGoalExecute(
  supabase: any,
  repoId: string,
  goalId?: string | null
) {
  const { data: rows, error } = await supabase
    .from("repo_messages")
    .select("content, created_at")
    .eq("repo_id", repoId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to load goal execute history: ${error.message}`);
  }

  for (const row of rows ?? []) {
    const txt = String(row.content ?? "");
    const parsed = extractGoalExecute(txt);
    if (!parsed) continue;

    if (!goalId || String(parsed.goalId ?? "") === String(goalId)) {
      return parsed;
    }
  }

  return null;
}

export async function persistGoalStatusMessage(args: {
  supabase: any;
  repoId: string;
  userId: string;
  payload: any;
}) {
  const { supabase, repoId, userId, payload } = args;
  const content = `__GOAL_STATUS__:${JSON.stringify(payload)}`;

  await supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: userId,
    role: "assistant",
    content,
  });

  return content;
}

export async function persistGoalDoneMessage(args: {
  supabase: any;
  repoId: string;
  userId: string;
  payload: any;
}) {
  const { supabase, repoId, userId, payload } = args;
  const content = `__GOAL_DONE__:${JSON.stringify(payload)}`;

  await supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: userId,
    role: "assistant",
    content,
  });

  return content;
}

export async function advanceGoalAfterStepSuccess(args: {
  supabase: any;
  repoId: string;
  userId: string;
  goalId: string;
  stepId: string;
}) {
  const { supabase, repoId, userId, goalId, stepId } = args;

  const plan = await findLatestGoalPlan(supabase, repoId);
  if (!plan || String(plan.goalId ?? "") !== String(goalId)) {
    return null;
  }

  const latestStatus = await findLatestGoalStatus(supabase, repoId, goalId);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const idx = steps.findIndex((s: any) => String(s.id) === String(stepId));

  if (idx < 0) return null;

  const alreadyCompleted = Array.isArray(latestStatus?.completedStepIds)
    ? latestStatus.completedStepIds.map((x: any) => String(x))
    : [];

  const completedStepIds = Array.from(
    new Set([...alreadyCompleted, String(stepId)])
  );

  const nextStep = steps[idx + 1] ?? null;
  const done = !nextStep;

  if (done) {
    const donePayload = {
      goalId,
      status: "completed",
      currentStepId: null,
      completedStepIds,
    };

    const content = await persistGoalDoneMessage({
      supabase,
      repoId,
      userId,
      payload: donePayload,
    });

    return {
      done: true,
      nextStepId: null,
      completedStepIds,
      content,
      payload: donePayload,
    };
  }

  const statusPayload = {
    goalId,
    status: "running",
    currentStepId: String(nextStep.id),
    completedStepIds,
  };

  const content = await persistGoalStatusMessage({
    supabase,
    repoId,
    userId,
    payload: statusPayload,
  });

  return {
    done: false,
    nextStepId: String(nextStep.id),
    completedStepIds,
    content,
    payload: statusPayload,
  };
}