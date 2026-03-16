export type GoalStatus =
  | "awaiting_approval"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type GoalStepStatus =
  | "pending"
  | "running"
  | "verified"
  | "failed"
  | "repairing"
  | "skipped";

export type GoalStep = {
  id: string;
  title: string;
  description?: string;
  status: GoalStepStatus;
  files?: string[];
};

export type GoalFailure = {
  failedStep?: string | null;
  reason?: string | null;
  fileIds?: string[];
};

export type GoalPlan = {
  goalId: string;
  title: string;
  summary?: string;

  status: GoalStatus;

  scope?: "small" | "medium" | "large";

  estimatedTouchedFiles?: string[];

  currentStepId?: string | null;

  steps: GoalStep[];

  note?: string;

  failure?: GoalFailure;

  actions?: ("repair" | "stop" | "continue")[];
};