export type ChamberSkillLevel = "beginner" | "intermediate" | "advanced";
export type ChamberOperationStyle = "guide" | "balanced" | "direct";
export type ChamberProjectReadiness = "ready" | "partial" | "not_setup";
export type ChamberChangeStyle = "minimal" | "balanced" | "scaffold";

export type ChamberProfile = {
  goal: string;
  skillLevel: ChamberSkillLevel;
  operationStyle: ChamberOperationStyle;
  projectReadiness: ChamberProjectReadiness;
  changeStyle: ChamberChangeStyle;
  calibratedAt: string;
};

export type ChamberBehaviorFlags = {
  explainMore: boolean;
  actDirectly: boolean;
  assumeProjectRuns: boolean;
  allowScaffoldSuggestions: boolean;
};

export function deriveChamberBehavior(
  profile: ChamberProfile
): ChamberBehaviorFlags {
  return {
    explainMore:
      profile.skillLevel === "beginner" ||
      profile.operationStyle === "guide",

    actDirectly:
      profile.operationStyle === "direct" &&
      profile.skillLevel !== "beginner",

    assumeProjectRuns:
      profile.projectReadiness === "ready",

    allowScaffoldSuggestions:
      profile.changeStyle === "scaffold" ||
      profile.projectReadiness === "not_setup",
  };
}

export function formatChamberProfileSection(profile: ChamberProfile): string {
  return [
    "## Calibration Profile",
    `- goal: ${profile.goal || ""}`,
    `- skill_level: ${profile.skillLevel}`,
    `- operation_style: ${profile.operationStyle}`,
    `- project_readiness: ${profile.projectReadiness}`,
    `- change_style: ${profile.changeStyle}`,
    `- calibrated_at: ${profile.calibratedAt}`,
  ].join("\n");
}