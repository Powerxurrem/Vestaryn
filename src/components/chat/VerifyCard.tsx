"use client";

export type VerifyMeta = {
  command: string | null;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  error: string | null;

  jobId?: string | null;
  fingerprint?: string | null;
  failedStep?: "install" | "exec" | null;
  failureKind?: string | null;
  timedOut?: boolean;
  skipped?: boolean;
  reason?: string | null;
};

function formatVerifySummary(v: VerifyMeta): string {
  if (v.skipped) {
    return "PASS · verify skipped";
  }

  const parts: string[] = [];
  parts.push(v.ok ? "PASS" : "FAIL");

  if (!v.ok && v.failedStep) {
    parts.push(v.failedStep);
  }

  if (typeof v.exitCode === "number") {
    parts.push(`exit ${v.exitCode}`);
  }

  const safeDuration =
    typeof v.durationMs === "number" && Number.isFinite(v.durationMs)
      ? Math.max(0, v.durationMs)
      : 0;

  parts.push(`${safeDuration}ms`);

  return parts.join(" · ");
}

function formatCommandLabel(v: VerifyMeta): string {
  if (v.skipped) return "Verification skipped";
  return v.command?.trim() || "Verification";
}

export default function VerifyCard({ v }: { v: VerifyMeta }) {
  const isSkipped = !!v.skipped;

  const badge = isSkipped
    ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30"
    : v.ok
    ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30"
    : "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/30";

  const badgeLabel = isSkipped
    ? "VERIFIED: SKIPPED"
    : v.ok
    ? "VERIFIED: PASS"
    : "VERIFIED: FAIL";

  const summary = formatVerifySummary(v);
  const commandLabel = formatCommandLabel(v);

  return (
    <div className="mt-3 rounded-xl bg-black/30 backdrop-blur-md ring-1 ring-blue-500/15 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-2 py-1 rounded-md text-xs ${badge}`}>
            {badgeLabel}
          </span>

          <span className="text-xs text-white/70 truncate">
            {commandLabel}
          </span>
        </div>

        <div className="text-xs text-white/60 shrink-0">
          {summary}
        </div>
      </div>

      {!v.ok && !isSkipped && (
        <div className="mt-2 text-xs text-white/75">
          <div>
            <span className="text-white/50">Failure:</span>{" "}
            {v.failureKind ?? "unknown"}
            {v.failedStep ? ` (${v.failedStep})` : ""}
            {v.timedOut ? " · timed out" : ""}
          </div>
        </div>
      )}

      {isSkipped && v.reason ? (
        <div className="mt-2 text-xs text-white/75">
          <span className="text-white/50">Reason:</span> {v.reason}
        </div>
      ) : null}

      <div className="mt-2 text-[11px] text-white/50 flex flex-wrap gap-x-3 gap-y-1">
        {v.fingerprint ? <span>runner: {v.fingerprint}</span> : null}
        {v.jobId ? <span>job: {v.jobId}</span> : null}
      </div>

      {!isSkipped && (
        <>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-white/70">
              stdout
            </summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs text-white/80">
              {v.stdout || "(empty)"}
            </pre>
          </details>

          <details className="mt-2" open={!v.ok}>
            <summary className="cursor-pointer text-xs text-white/70">
              stderr
            </summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs text-white/80">
              {v.stderr || "(empty)"}
            </pre>
          </details>
        </>
      )}

      {v.error ? (
        <div className="mt-2 text-xs text-rose-200/90">
          {v.error}
        </div>
      ) : null}
    </div>
  );
}