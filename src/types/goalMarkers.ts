import { GoalPlan } from "@/types/goalPlan";

function extractMarkerJson(text: string, marker: string): string | null {
  const s = String(text ?? "");
  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  const after = s.slice(start);

  const nextMarkerIdx = after.indexOf("\n__");
  const json = (nextMarkerIdx === -1 ? after : after.slice(0, nextMarkerIdx)).trim();

  return json || null;
}

export function extractGoalPlan(text: string): GoalPlan | null {
  const json = extractMarkerJson(text, "__GOAL_PLAN__:");
  if (!json) return null;

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function extractGoalStatus(text: string): Partial<GoalPlan> | null {
  const json = extractMarkerJson(text, "__GOAL_STATUS__:");
  if (!json) return null;

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function extractGoalDone(text: string): Partial<GoalPlan> | null {
  const json = extractMarkerJson(text, "__GOAL_DONE__:");
  if (!json) return null;

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function extractGoalExecute(text: string): {
  goalId: string;
  stepId: string;
  instruction: string;
} | null {
  const marker = "__GOAL_EXECUTE__:";
  const s = String(text ?? "");

  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  const after = s.slice(start);

  const nextMarkerIdx = after.indexOf("\n__");
  const json = (nextMarkerIdx === -1 ? after : after.slice(0, nextMarkerIdx)).trim();

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}