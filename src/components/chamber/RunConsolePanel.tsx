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
};

export default function RunConsolePanel({ repoId }: { repoId: string }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [fullLog, setFullLog] = useState<string>("");
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingLog, setLoadingLog] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm text-white/80">
      <div className="flex items-center justify-between">
        <div className="text-white/90 font-medium">Run Console</div>
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
          ) : runs.length === 0 ? (
            <div className="p-3 text-xs text-white/50">No runs yet.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {runs.map((run) => {
                const active = run.id === selectedRunId;

                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={`w-full px-3 py-2 text-left hover:bg-white/5 ${
                      active ? "bg-white/10" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-white/90">
                        {run.run_kind || "run"} · {run.command || "no command"}
                      </div>
                      <div className="text-[11px] text-white/50">
                        {run.duration_ms ?? 0}ms
                      </div>
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