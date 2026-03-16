export function hasValidAssistantContract(text: string) {
  const s = String(text ?? "").trim();

  const triplet =
    s.startsWith("[Observation]") ||
    (s.includes("[Observation]") &&
     s.includes("[Assessment]") &&
     s.includes("[Action]"));

  const proposal =
    s.includes("__PROPOSAL__:") ||
    s.includes("__PROPOSAL_SET__:") ||
    s.includes("__APPLY__:") ||
    s.includes("__APPLY_SET__:");

  const goal =
    s.startsWith("__GOAL_PLAN__:") ||
    s.startsWith("__GOAL_STATUS__:") ||
    s.startsWith("__GOAL_DONE__:");

  return triplet || proposal || goal;
}