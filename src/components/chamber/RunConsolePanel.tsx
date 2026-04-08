"use client";

import { useEffect, useState } from "react";

type RunRow = {
  id: string;
  created_at: string;
  ok?: boolean | null;
  command?: string | null;
  failed_step?: string | null;
  failure_kind?: string | null;
  duration_ms?: number | null;
  timed_out?: boolean | null;
  stdout_preview?: string | null;
  stderr_preview?: string | null;
  log_storage_key?: string | null;
  log_size_bytes?: number | null;
  run_kind?: string | null;
  summary?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  
};

export default function RunConsolePanel({
  repoId,
  onRepairPrompt,
}: {
  repoId: string;
  onRepairPrompt?: (prompt: string) => void;
}) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [fullLog, setFullLog] = useState<string>("");
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingLog, setLoadingLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"verify" | "scan">("verify");

function handleRepair(run: RunRow) {
  console.log("[repair] clicked", run);

  const filePath = String(run.summary ?? "unknown_file");
  const stderr = String(run.stderr ?? "");
  const failedStep = String(run.failed_step ?? "");
  const failureKind = String(run.failure_kind ?? "");

  const prompt = `
Repair "${filePath}" based on the latest scan failure.

Fix ONLY the verified issue and keep the rest of the file unchanged.

Failure details:
- failed_step: ${failedStep}
- failure_kind: ${failureKind}

Error output:
${stderr}
`.trim();

  onRepairPrompt?.(prompt);
}

  async function loadRuns() {
    setLoadingRuns(true);
    setError(null);

    try {
      const res = await fetch(`/api/repo/${repoId}/runs`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      const nextRuns = Array.isArray(json?.runs) ? json.runs : [];
      setRuns(nextRuns);

      if (!selectedRunId && nextRuns[0]?.id) {
        setSelectedRunId(nextRuns[0].id);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load runs");
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadLog(runId: string) {
    setLoadingLog(true);
    setError(null);

    try {
      const res = await fetch(`/api/repo/${repoId}/runs/${runId}/log`, {
        cache: "no-store",
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      setFullLog(text);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load log");
      setFullLog("");
    } finally {
      setLoadingLog(false);
    }
  }

  useEffect(() => {
    loadRuns();
  }, [repoId]);

  useEffect(() => {
    if (!selectedRunId) return;
    loadLog(selectedRunId);
  }, [selectedRunId]);


  
  const isScanRun = (run: RunRow) =>
    String(run.run_kind ?? "").toLowerCase().startsWith("scan");

const isFailingScanRun = (run: RunRow) =>
  isScanRun(run) && run.ok === false;

  const isVerifyRun = (run: RunRow) =>
    !isScanRun(run);

  const visibleRuns = runs.filter((run) => {
    if (activeTab === "verify") {
      return isVerifyRun(run);
    }

    // scan tab: only show meaningful findings
    return isScanRun(run) && run.ok !== true;
  });

useEffect(() => {
  if (visibleRuns.length === 0) {
    setSelectedRunId(null);
    setFullLog("");
    return;
  }

  const stillVisible = visibleRuns.some((r) => r.id === selectedRunId);
  if (!stillVisible) {
    setSelectedRunId(visibleRuns[0].id);
  }
}, [activeTab, selectedRunId, visibleRuns]);

  const selectedRun =
    visibleRuns.find((r) => r.id === selectedRunId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm text-white/80">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-white/90 font-medium">Run Console</div>

          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("verify")}
              className={`rounded px-2 py-1 text-xs ${
                activeTab === "verify"
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:text-white/80"
              }`}
            >
              Verify
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("scan")}
              className={`rounded px-2 py-1 text-xs ${
                activeTab === "scan"
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:text-white/80"
              }`}
            >
              Scan
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={loadRuns}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-rows-[180px_minmax(0,1fr)] gap-3">
        <div className="overflow-auto rounded-xl border border-white/10 bg-black/20">
          {loadingRuns ? (
            <div className="p-3 text-xs text-white/50">Loading runs…</div>
          ) : visibleRuns.length === 0 ? (
          <div className="p-3 text-xs text-white/50">
            {activeTab === "verify" ? "No verify runs yet." : "No scan findings."}
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {visibleRuns.map((run) => {
                const active = run.id === selectedRunId;

                return (
                  <div
  key={run.id}
  className={`w-full px-3 py-2 text-left ${
    active ? "bg-white/10" : "hover:bg-white/5"
  }`}
>
  <div className="flex items-center justify-between gap-2">
    <button
      type="button"
      onClick={() => setSelectedRunId(run.id)}
      className="min-w-0 flex-1 text-left"
    >
      <div className="truncate text-white/90">
        {run.run_kind || "run"} · {run.command || "no command"}
      </div>

      <div className="mt-1 text-[11px] text-white/55">
        {run.ok === true
          ? "PASS"
          : run.ok === false
          ? "FAIL"
          : "UNKNOWN"}
        {run.failed_step ? ` · ${run.failed_step}` : ""}
        {run.failure_kind ? ` · ${run.failure_kind}` : ""}
      </div>
    </button>

    <div className="flex items-center gap-2 shrink-0">
      <div className="text-[11px] text-white/50">
        {run.duration_ms ?? 0}ms
      </div>

      {isFailingScanRun(run) && (
        <button
          type="button"
          onClick={() => {
            handleRepair(run);
          }}
          className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] hover:bg-white/10"
        >
          Repair
        </button>
      )}
    </div>
  </div>
</div>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-hidden rounded-xl border border-white/10 bg-black/20">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-white/60">
            <div className="truncate">
              {selectedRun
                ? `${selectedRun.run_kind || "run"} · ${selectedRun.id}`
                : "No run selected"}
            </div>

            <button
              type="button"
              disabled={!fullLog}
              onClick={() => navigator.clipboard.writeText(fullLog)}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 hover:bg-white/10 disabled:opacity-40"
            >
              Copy log
            </button>
          </div>

          <div className="h-full overflow-auto p-3">
            {loadingLog ? (
              <div className="text-xs text-white/50">Loading log…</div>
            ) : fullLog ? (
              <pre className="whitespace-pre-wrap break-words text-[12px] text-white/80">
                {fullLog}
              </pre>
            ) : (
              <div className="text-xs text-white/50">No log loaded.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}