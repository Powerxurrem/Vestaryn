// ─────────────────────────────────────────────
// Vestaryn Diagnostics — Core Types
// ─────────────────────────────────────────────

// 🔥 Minimal high-value fallback reasons (Phase 1)
export type FallbackReason =
  | "none"
  | "advisory_question_misclassified"
  | "explicit_path_overrode_advisory"
  | "short_followup_lost_target"
  | "short_followup_resumed_previous_task"
  | "multi_file_followup_not_promoted"
  | "followup_creation_intent_not_resumed"
  | "chapter_sequence_request_missed"
  | "ambiguous_followup_should_resume_last_creation"
  | "model_rewrite_used_after_fastpath_miss"
  | "python_dependency_missing"
  | "python_install_failed";

// 🎯 What the turn ultimately resulted in
export type TurnOutcome =
  | "advisory_response"
  | "proposal_created"
  | "proposal_not_needed"
  | "apply_completed"
  | "verify_completed"
  | "execute_download_completed"
  | "blocked"
  | "failed";

// 🧭 Routing decision
export type RouteDecisionKind =
  | "advisory"
  | "incremental"
  | "surgical"
  | "bootstrap"
  | "create_missing"
  | "early_orchestration"
  | "goal_plan"
  | "internal_control";

// 🧠 Where things went wrong (or degraded)
export type FailureSurface =
  | "none"
  | "routing"
  | "continuity"
  | "surgical"
  | "orchestration"
  | "snapshot"
  | "runner_install"
  | "runner_exec"
  | "proposal"
  | "apply"
  | "verify"
  | "artifact";

// ─────────────────────────────────────────────
// 🧾 Chat Turn Summary
// ─────────────────────────────────────────────

export type ChatTurnSummary = {
  kind: "chat_turn_summary";

  repoId: string;
  userId?: string | null;

  contentHead: string;

  rawMode: string;
  finalMode: RouteDecisionKind;

  rawMentionedPaths: string[];
  effectiveMentionedPaths: string[];

  targetPath: string | null;
  referencePaths: string[];

  continuityMatched: boolean;
  continuityReason: string | null;

  routeDecisionReason: string[];

  fallbackReason: FallbackReason;
  failureSurface: FailureSurface;

  outcome: TurnOutcome;

  hadTools: boolean;
  toolRounds: number;

  proposedFileId: string | null;
  appliedFileId: string | null;

  verifyAttempted: boolean;
  verifyOk: boolean | null;

  responseLen: number;
  durationMs?: number;
};

// ─────────────────────────────────────────────
// 🛠️ Surgical Summary
// ─────────────────────────────────────────────

export type SurgicalSummary = {
  kind: "surgical_summary";

  repoId: string;
  path: string;

  strategy: string;
  effectiveStrategy: string;

  usedFastPath: boolean;
  fastPathKind: string | null;
  fastPathRecipeId: string | null;

  rewriteSource: "fast_path" | "model_path" | "none";

  noOpDetected: boolean;
  largeChangeDetected: boolean;

  proposalCreated: boolean;
  proposedFileId: string | null;

  fallbackReason: FallbackReason;
  failureSurface: FailureSurface;
};

// ─────────────────────────────────────────────
// 📦 Execute Download Summary
// ─────────────────────────────────────────────

export type ExecuteDownloadSummary = {
  kind: "execute_download_summary";

  repoId: string;
  fileId: string;

  snapshotOk: boolean;
  runnerOk: boolean;

  failedStep: string | null;
  failureKind: string | null;

  fallbackReason: FallbackReason;

  hasArtifactFile: boolean;
  artifactBytes: number | null;

  durationMs?: number;
};

// ─────────────────────────────────────────────
// 🧰 Logging Helpers (keep consistent output)
// ─────────────────────────────────────────────

export function logChatTurnSummary(summary: ChatTurnSummary) {
  console.log("[chat_turn_summary]", summary);
}

export function logSurgicalSummary(summary: SurgicalSummary) {
  console.log("[surgical_summary]", summary);
}

export function logExecuteDownloadSummary(summary: ExecuteDownloadSummary) {
  console.log("[execute_download_summary]", summary);
}