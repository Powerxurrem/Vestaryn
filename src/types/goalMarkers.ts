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

export function extractGoalPlan(raw: string) {
  const marker = "__GOAL_PLAN__:";
  const s = String(raw ?? "");
  const idx = s.indexOf(marker);

  if (idx === -1) return null;

  const after = s.slice(idx + marker.length).trimStart();

  let started = false;
  let braceBalance = 0;
  let inString = false;
  let escaped = false;
  let json = "";

  for (let i = 0; i < after.length; i++) {
    const ch = after[i];
    json += ch;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === "{") {
        braceBalance++;
        started = true;
      } else if (ch === "}") {
        braceBalance--;
        if (started && braceBalance === 0) {
          break;
        }
      }
    }
  }

  const trimmed = json.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
console.log("[extractGoalPlan candidate length]", trimmed.length);
console.log("[extractGoalPlan candidate tail]", trimmed.slice(-400));
  try {
    return JSON.parse(trimmed);
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

export function containsGoalMarker(text: string) {
  const s = String(text ?? "");
  return (
    s.includes("__GOAL_PLAN__:") ||
    s.includes("__GOAL_STATUS__:") ||
    s.includes("__GOAL_DONE__:") ||
    s.includes("__GOAL_EXECUTE__:")
  );
}

export function extractRawGoalMarkerBlock(text: string, marker: string) {
  const s = String(text ?? "");
  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  const after = s.slice(idx + marker.length);
  let started = false;
  let braceBalance = 0;
  let inString = false;
  let escaped = false;
  let json = "";

  for (let i = 0; i < after.length; i++) {
    const ch = after[i];
    json += ch;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === "{") {
        braceBalance++;
        started = true;
      } else if (ch === "}") {
        braceBalance--;
        if (started && braceBalance === 0) {
          break;
        }
      }
    }
  }

  const trimmed = json.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  return `${marker}${trimmed}`;
}