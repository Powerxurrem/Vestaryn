"use client";

import { GoalPlan, GoalStep } from "@/types/goalPlan";

type Props = {
  goal: GoalPlan;
  continueDisabled?: boolean;
  onApprove?: () => void;
  onContinue?: () => void;
  onRepair?: () => void;
  onStop?: () => void;
};

function statusIcon(status: GoalStep["status"]) {
  switch (status) {
    case "pending":
      return "○";
    case "running":
      return "⟳";
    case "verified":
      return "✔";
    case "failed":
      return "✖";
    case "repairing":
      return "⚒";
    case "skipped":
      return "—";
    default:
      return "○";
  }
}

export default function GoalPlanCard({
  goal,
  onApprove,
  onContinue,
  onRepair,
  onStop,
  continueDisabled = false,
}: Props) {
  console.log("[GoalPlanCard render]", {
    goalId: goal.goalId,
    status: goal.status,
    currentStepId: goal.currentStepId ?? null,
    stepCount: goal.steps.length,
  });

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-4">

      {/* Title */}
      <div>
        <div className="text-sm text-white/50">Goal Plan</div>
        <div className="text-lg text-white font-semibold">{goal.title}</div>

        {goal.summary && (
          <div className="text-sm text-white/60 mt-1">{goal.summary}</div>
        )}
      </div>

 {/* Steps */}
<div className="space-y-2">
  {goal.steps.map((step) => {
    const goalCompleted = goal.status === "completed";
    const goalCancelled = goal.status === "cancelled";

    const isDone = goalCompleted || step.status === "verified";
    const isActive =
      !goalCompleted &&
      !goalCancelled &&
      step.id === goal.currentStepId;

    return (
      <div
        key={step.id}
        className={`flex items-start gap-2 rounded-md px-2 py-1 text-sm transition ${
          isActive
            ? "bg-blue-500/10 text-blue-200 shadow-[0_0_18px_rgba(59,130,246,0.15)]"
            : isDone
            ? "text-emerald-200"
            : "text-white/80"
        }`}
      >
        <div className="w-5">
          {goalCompleted && step.status !== "verified"
            ? statusIcon("verified")
            : statusIcon(step.status)}
        </div>

        <div>
          <div className={isActive ? "font-semibold" : ""}>
            {step.title}
          </div>

          {step.description && (
            <div className="text-xs text-white/50">
              {step.description}
            </div>
          )}
        </div>
      </div>
    );
  })}
</div>

      {goal.status === "completed" && (
        <div className="text-sm text-emerald-300 pt-1">
          Goal completed.
        </div>
      )}

      {goal.status === "cancelled" && (
        <div className="text-sm text-red-300 pt-1">
          Goal stopped.
        </div>
      )}

      {/* Note */}
      {goal.note && (
        <div className="text-xs text-white/50">
          {goal.note}
        </div>
      )}

      {/* Failure */}
      {goal.failure && (
        <div className="text-xs text-red-400">
          {goal.failure.reason}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-3">
        {goal.status === "awaiting_approval" && onApprove && (
          <button
            onClick={onApprove}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
          >
            Approve Plan
          </button>
        )}

          {goal.status === "running" && (
            <>
              {onContinue && (
                <button
                  onClick={onContinue}
                  disabled={continueDisabled}
                  className={`rounded-md px-3 py-1.5 text-sm text-white ${
                    continueDisabled
                      ? "bg-emerald-900/40 opacity-50 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  Continue
                </button>
              )}

            {onRepair && (
              <button
                onClick={onRepair}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-500"
              >
                Repair
              </button>
            )}

            {onStop && (
              <button
                onClick={onStop}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
              >
                Stop
              </button>
            )}
          </>
        )}
      </div>
        
      </div>
  );
}