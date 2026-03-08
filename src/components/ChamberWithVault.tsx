"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import ChatFrame from "@/components/chat/ChatFrame";
import RepoVault from "@/components/RepoVault";
import type { OpenTab } from "@/components/FileOverlay";
import VaultEditorPane from "@/components/vault/VaultEditorPane";
import { VestarynFrame } from "@/components/dev/RepoHud";
import type { RepoVaultHandle } from "@/components/RepoVault"; // adjust path if needed



type RepoFile = { id: string; path: string; mime: string };
const storageKeyFor = (repoId: string) => `vestaryn:split:${repoId}`;

type FileStatus = {
  ts: number;
  status: "ok" | "warn" | "error" | "pending";
  reason?: string;
};

export default function ChamberWithVault({
  repoId,
  repoName,
}: {
  repoId: string;
  repoName?: string | null;
}) {
  useEffect(() => {
    localStorage.setItem("vestaryn:lastRepoId", repoId);
  }, [repoId]);

  useEffect(() => {
  console.log("[ChamberWithVault] mounted");
  return () => console.log("[ChamberWithVault] unmounted");
}, []);

  console.log("[ChamberWithVault] render", { repoId });
  const [msgStats, setMsgStats] = useState({ total: 0, user: 0, assistant: 0, system: 0 });
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const vaultRef = useRef<RepoVaultHandle | null>(null);
  // ✅ splitter percent (left = chat)
  const [leftPct, setLeftPct] = useState(50);
  // near top of file
  const [maintenance, setMaintenance] = useState<any>(null);
  const [fileStatusById, setFileStatusById] = useState<Record<string, FileStatus>>({});
type ProposalPreview = {
  fileId: string;
  content: string;
  path?: string | null;
  op?: string | null;
  appendPreview?: string | null;
};

const [proposalPreviewByFileId, setProposalPreviewByFileId] = useState<
  Record<string, ProposalPreview>
>({});
  const MAINTENANCE_CAP = 40;
  const [fileReloadTokenById, setFileReloadTokenById] = useState<Record<string, number>>({});
  const bumpFileReload = useCallback((fileId: string) => {
    setFileReloadTokenById((prev) => ({
      ...prev,
      [fileId]: (prev[fileId] ?? 0) + 1,
    }));
  }, []);
const onFileStatus = useCallback(
  (fileId: string, status: FileStatus["status"], reason?: string) => {
    const ts = Date.now();
    setFileStatusById((prev) => {
      const cur = prev[fileId];
      console.log("[fileStatus]", { fileId, status, reason });


      // Pending is "stronger" than a generic Updated ok.
      if (cur?.status === "pending") {
        const canResolvePending =
          status === "ok" || status === "warn" || status === "error";

        if (!canResolvePending) {
          return prev;
        }
      }

      return { ...prev, [fileId]: { ts, status, reason } };
    });
  },
  []
);
  // ─────────────────────────────────────────────
  // Auto-verify after apply (Option A)
  // ─────────────────────────────────────────────
  const VERIFY_DEBOUNCE_MS = 1200;

  const verifyTimerRef = useRef<number | null>(null);
  const verifyAbortRef = useRef<AbortController | null>(null);

  const verifyInFlightRef = useRef(false);
  const verifyQueuedRef = useRef(false);

  // files touched since last verify started
  const pendingTouchedRef = useRef<Set<string>>(new Set());
  type ChamberMode = "vault" | "memory" | "handover" | "sql";

  const CHAMBER_WIDTH = 360; // px
  const [chamberMode, setChamberMode] = useState<ChamberMode | null>("vault");
  
  const chamberOpen = chamberMode !== null;
const [chatReloadToken, setChatReloadToken] = useState(0);
  // clicking the same mode toggles it off (close chamber)
const toggleMode = (m: ChamberMode) =>
  setChamberMode((cur) => {
    const next = cur === m ? null : m;
    console.log("[toggleMode]", { cur, m, next });
    return next;
  });

const effectiveMaintenance =
  maintenance ??
  (msgStats.total >= MAINTENANCE_CAP
    ? {
        type: "recommend_resummarize",
        reason: "message_cap_ui",
        count: msgStats.total,
        cap: MAINTENANCE_CAP,
      }
    : null);

  // optional UI state if you want to show it somewhere later
  const [verifyState, setVerifyState] = useState<
    "idle" | "scheduled" | "running" | "ok" | "error"
  >("idle");
  const [lastVerify, setLastVerify] = useState<any | null>(null);

  function makeRunId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function consumeVerifyStream(
    body: ReadableStream<Uint8Array>,
    onMarker: (v: any) => void
  ) {
    const reader = body.getReader();
    const dec = new TextDecoder("utf-8");
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);

        const t = line.trim();
        if (t.startsWith("__VERIFY__:")) {
          const raw = t.slice("__VERIFY__:".length);
          try {
            onMarker(JSON.parse(raw));
          } catch {
            // ignore malformed marker
          }
        }
      }
    }

    // flush last line if it contains a marker without newline (rare)
    const t = buf.trim();
    if (t.startsWith("__VERIFY__:")) {
      const raw = t.slice("__VERIFY__:".length);
      try {
        onMarker(JSON.parse(raw));
      } catch {}
    }
  }

  async function runVerifyNow() {
    if (verifyInFlightRef.current) {
      verifyQueuedRef.current = true;
      return;
    }

    verifyInFlightRef.current = true;
    verifyQueuedRef.current = false;

    // cancel previous stream
    verifyAbortRef.current?.abort();
    const ac = new AbortController();
    verifyAbortRef.current = ac;

    setVerifyState("running");

    // snapshot touched files for this run
    const touched = Array.from(pendingTouchedRef.current);
    pendingTouchedRef.current.clear();

    // if somehow we got called with nothing touched, don’t waste runner cycles
    if (touched.length === 0) {
      setVerifyState("idle");
      verifyInFlightRef.current = false;
      return;
    }

    const runId = makeRunId();

    try {
      const res = await fetch(`/api/repo/${repoId}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          runId,
          commandId: "node_verify",
          touchedFileIds: touched,
        }),
      });

      if (!res.ok || !res.body) {
        touched.forEach((fid) =>
          onFileStatus(fid, "error", `Verify request failed (${res.status})`)
        );
        setVerifyState("error");
        return;
      }

      let marker: any | null = null;

await consumeVerifyStream(res.body, (verify) => {
  const ok = Boolean(verify?.ok);

  const reason = !ok
    ? (
        String(
          verify?.stderr ||
          verify?.stdout ||
          verify?.error ||
          "Verify failed"
        )
          .split("\n")
          .map((line: string) => line.trim())
          .find((line: string) =>
            line.length > 0 &&
            !line.startsWith("[") &&
            !line.startsWith(">") &&
            !line.startsWith("at ")
          ) || "Verify failed"
      )
    : undefined;

  const fileIds: string[] = Array.isArray(verify?.touchedFileIds)
    ? verify.touchedFileIds
    : [];

  setFileStatusById((prev) => {
    const next = { ...prev };
    for (const fileId of fileIds) {
      next[fileId] = {
        ts: Date.now(),
        status: ok ? "ok" : "error",
        reason,
      };
    }
    return next;
  });
});

      setLastVerify(marker);
      const ok = !!marker?.ok;

      touched.forEach((fid) =>
        onFileStatus(
          
          fid,
          ok ? "ok" : "error",
          ok
            ? "Verified"
            : marker?.failedStep
              ? `Verify failed (${marker.failedStep})`
              : marker?.failureKind
                ? `Verify failed (${marker.failureKind})`
                : (marker?.error ? `Verify failed: ${marker.error}` : "Verify failed")
        )
      );

      setVerifyState(ok ? "ok" : "error");
      
    } catch (e) {
      if (!ac.signal.aborted) {
        touched.forEach((fid) => onFileStatus(fid, "error", "Verify crashed"));
        setVerifyState("error");
      }
    } finally {
      verifyInFlightRef.current = false;

      // if updates came in while verifying, run once more immediately
      if (verifyQueuedRef.current) {
        verifyQueuedRef.current = false;
        await runVerifyNow();
      }
    }
  }

  function scheduleVerify() {
    if (verifyTimerRef.current) window.clearTimeout(verifyTimerRef.current);
    setVerifyState((s) => (s === "running" ? "running" : "scheduled"));
    verifyTimerRef.current = window.setTimeout(() => {
      void runVerifyNow();
    }, VERIFY_DEBOUNCE_MS);
  }


  
const markFileUpdated = useCallback(
  (fileId: string) => {
    bumpFileReload(fileId);
    onFileStatus(fileId, "pending", "Verifying…");
  },
  [onFileStatus, bumpFileReload]
);

  // load saved split
  useEffect(() => {
    const raw = localStorage.getItem(storageKeyFor(repoId));
    const v = raw ? Number(raw) : NaN;
    if (!Number.isNaN(v)) setLeftPct(Math.min(75, Math.max(25, v)));
  }, [repoId]);

  // persist split
  useEffect(() => {
    localStorage.setItem(storageKeyFor(repoId), String(leftPct));
  }, [repoId, leftPct]);

  // ✅ cleanup verify timers/streams when repoId changes or component unmounts
  useEffect(() => {
    return () => {
      if (verifyTimerRef.current) window.clearTimeout(verifyTimerRef.current);
      verifyAbortRef.current?.abort();
    };
  }, [repoId]);

  function openFile(f: RepoFile) {
    const next: OpenTab = { fileId: f.id, path: f.path, mime: f.mime };

    setTabs((prev) => {
      if (prev.some((t) => t.fileId === f.id)) return prev;
      return [next, ...prev];
    });

    setActiveFileId(f.id);
  }

  function closeTab(fileId: string) {
    setTabs((prev) => {
      const nextTabs = prev.filter((t) => t.fileId !== fileId);
      setActiveFileId((cur) => (cur !== fileId ? cur : nextTabs[0]?.fileId ?? null));
      return nextTabs;
    });
  }

  function onSplitterMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();

    const startX = e.clientX;
    const startPct = leftPct;

    const parent = (e.currentTarget.parentElement as HTMLDivElement) || null;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const deltaPct = (dx / rect.width) * 100;
      const next = Math.min(75, Math.max(25, startPct + deltaPct));
      setLeftPct(next);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

 return (
  <VestarynFrame
    repoId={repoId}
    repoName={repoName}
    right={
      <div className="absolute left-[275px] top-[13px] z-40">
        <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/60 backdrop-blur">
          msgs {msgStats.total}
        </div>
      </div>
    }
  >
    <div className="w-full h-[70vh] flex min-w-0">
      {/* Left: Chat */}
<div className="min-w-0" style={{ width: `${leftPct}%` }}>
  <ChatFrame
    repoId={repoId}
    reloadToken={chatReloadToken}
    onFileUpdated={markFileUpdated}
    onFileStatus={onFileStatus}
    refreshFiles={() => vaultRef.current?.refresh()}
    openFileById={(id) => vaultRef.current?.openFileById(id)}
    onMessageStats={setMsgStats}
    onMaintenance={setMaintenance}
    
     
onProposalPreview={(proposals) => {
  if (!proposals) {
    setProposalPreviewByFileId({});
    return;
  }

  setProposalPreviewByFileId(proposals);
}}
    />
</div>

      {/* Splitter */}
      <div
        onMouseDown={onSplitterMouseDown}
        className="w-[10px] shrink-0 cursor-col-resize relative group"
        title="Drag to resize"
      >
        <div className="absolute inset-0 pointer-events-none" />
        <div className="absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-white/10 group-hover:bg-blue-400/40" />
      </div>

      {/* Right: Editor */}
      <div className="min-w-0 flex-1 relative rounded-xl overflow-hidden ring-1 ring-white/10 bg-black/25 backdrop-blur-md">
        <VaultEditorPane
          repoId={repoId}
          tabs={tabs}
          activeFileId={activeFileId}
          onActivate={setActiveFileId}
          onClose={closeTab}
          fileReloadTokenById={fileReloadTokenById}
          proposalPreviewByFileId={proposalPreviewByFileId}
          sidebar={
            <RepoVault
              ref={vaultRef}
              repoId={repoId}
              onOpenFile={openFile}
              fileStatusById={fileStatusById}
            />
          }
          fileStatusById={fileStatusById}
          onFileStatus={onFileStatus}
          rightChamber={
            <HiddenChamber
              repoId={repoId}
              mode={chamberMode}
              onToggleMode={toggleMode}
              fileStatusById={fileStatusById}
              maintenance={effectiveMaintenance}
              onResummarizeDone={() => {
                setMaintenance(null);
                setChatReloadToken((v) => v + 1);
              }}
            />
          }
          rightChamberWidth={CHAMBER_WIDTH}
          rightChamberOpen={true}
        />
      </div>
    </div>
  </VestarynFrame>
);
}
// ─────────────────────────────────────────────────────────────
// HiddenChamber (top-level, outside ChamberWithVault)
// ─────────────────────────────────────────────────────────────
function HiddenChamber(props: {
  repoId: string;
  mode: "vault" | "memory" | "handover" | "sql" | null;
  onToggleMode: (m: "vault" | "memory" | "handover" | "sql") => void;
  fileStatusById: Record<
    string,
    { ts: number; status: "ok" | "warn" | "error" | "pending"; reason?: string }
  >;
  maintenance?: any;
  onResummarizeDone?: () => void;
}) {
  const { repoId, mode, onToggleMode, fileStatusById, maintenance,onResummarizeDone, } = props;

  // debug: confirm mode actually changes and chamber renders
  useEffect(() => {
    console.log("[HiddenChamber]", { mode, repoId });
  }, [mode, repoId]);
  const bootstrappedRef = useRef(false);
  type MemoryKey = "master-summary" | "chamber-state" | "path-tree" | "ledger";
  const [memoryKey, setMemoryKey] = useState<MemoryKey>("master-summary");
  const [memoryDoc, setMemoryDoc] = useState<{
    content: string;
    updated_at?: string | null;
  } | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [resummarizing, setResummarizing] = useState(false);

  // Bootstrap memory docs when Memory opens
useEffect(() => {
  if (mode !== "memory") return;
  if (bootstrappedRef.current) return;

  bootstrappedRef.current = true;

  console.log("[memory] bootstrap firing (once)", repoId);
  fetch(`/api/repo/${repoId}/memory/bootstrap`, { method: "POST" })
    .then((r) => console.log("[memory] bootstrap status", r.status))
    .catch((e) => console.log("[memory] bootstrap error", e));
}, [mode, repoId]);

  // Load selected memory doc
  useEffect(() => {
    if (mode !== "memory") return;

    setMemoryLoading(true);
    fetch(`/api/repo/${repoId}/memory?key=${encodeURIComponent(memoryKey)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => setMemoryDoc(j?.doc ?? null))
      .catch(() => setMemoryDoc(null))
      .finally(() => setMemoryLoading(false));
  }, [mode, repoId, memoryKey]);

  const total = Object.keys(fileStatusById).length;
  const counts = Object.values(fileStatusById).reduce((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const ok = counts.ok ?? 0;
  const pending = counts.pending ?? 0;
  const warn = counts.warn ?? 0;
  const error = counts.error ?? 0;

  const allGreen = total > 0 && ok === total;

const btn = (m: string) =>
  mode === m
    ? "bg-blue-500/20 border border-blue-400/40 text-white"
    : "bg-white/5 hover:bg-white/10 text-white/70";

return (
  <div className="h-full w-full p-3 flex flex-col gap-3">
    <div className="text-[10px] uppercase tracking-widest text-white/40">
      Chamber
    </div>
      {/* Mode bar */}
      <div className="flex items-center gap-2 p-2 rounded-xl bg-black/20 ring-1 ring-white/10">
        <button
          className={`px-3 py-1.5 rounded-lg text-sm ${btn("vault")}`}
          onClick={() => onToggleMode("vault")}
        >
          Vault
        </button>
        <button
          className={`px-3 py-1.5 rounded-lg text-sm ${btn("memory")}`}
          onClick={() => onToggleMode("memory")}
        >
          Memory
        </button>
        <button
          className={`px-3 py-1.5 rounded-lg text-sm ${btn("handover")}`}
          onClick={() => onToggleMode("handover")}
        >
          Handover
        </button>
        <button
          className={`px-3 py-1.5 rounded-lg text-sm ${btn("sql")}`}
          onClick={() => onToggleMode("sql")}
        >
          SQL
        </button>

        <div className="ml-auto text-xs text-white/50">
          {mode ? `Mode: ${mode}` : "Closed"}
        </div>
      </div>

{maintenance && (
  <div className="rounded-lg border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-100/80">
    <div className="flex items-center justify-between gap-3">
      <div>
        {(() => {
          const cap = Number(maintenance.cap ?? 0) || 0;
          const rawCount = Number(maintenance.count ?? 0) || 0;
          const count = cap > 0 ? Math.min(rawCount, cap) : rawCount;

          return (
            <>
              Chamber memory nearing limit
              {cap > 0 ? ` (${count}/${cap})` : ""}
            </>
          );
        })()}
      </div>

      <button
        type="button"
        disabled={resummarizing}
        onClick={async () => {
          try {
            setResummarizing(true);

            const res = await fetch(`/api/repo/${repoId}/maintenance/resummarize`, {
              method: "POST",
            });

            const j = await res.json().catch(() => null);

            if (!res.ok) {
              throw new Error(j?.error || `resummarize failed (${res.status})`);
            }

          setMemoryKey("master-summary");
          setMemoryLoading(true);

          fetch(`/api/repo/${repoId}/memory?key=${encodeURIComponent("master-summary")}`, {
            cache: "no-store",
          })
            .then((r) => r.json())
            .then((j) => setMemoryDoc(j?.doc ?? null))
            .catch(() => setMemoryDoc(null))
            .finally(() => setMemoryLoading(false));

          onResummarizeDone?.();

          } catch (e) {
            console.error("[resummarize] failed", e);
          } finally {
            setResummarizing(false);
          }
        }}
        className="shrink-0 rounded-md border border-blue-300/20 bg-blue-400/10 px-2 py-1 text-[11px] text-blue-100 hover:bg-blue-400/15 disabled:opacity-50"
      >
        {resummarizing ? "Running..." : "Re-summarize now"}
      </button>
    </div>
  </div>
)}

      {/* Content */}
      <div className="flex-1 rounded-xl bg-black/30 ring-1 ring-white/10 p-3 overflow-auto">
        {mode === null && (
          <div className="text-sm text-white/70">
            <div className="text-white/90 font-medium mb-2">Vault Status</div>
            <div className="space-y-1">
              <div>Files tracked: {total}</div>
              <div className="text-emerald-200/80">ok: {ok}</div>
              <div className="text-white/60">pending: {pending}</div>
              <div className="text-amber-200/80">warn: {warn}</div>
              <div className="text-rose-200/80">error: {error}</div>
            </div>
            <div className="mt-3 text-[11px] text-white/45">Pick a mode above.</div>
          </div>
        )}

        {mode === "vault" && (
          <div className="text-sm text-white/70">
            <div className="text-white/90 font-medium mb-2">Vault</div>
            <div className="space-y-1">
              <div>Files tracked: {total}</div>
              <div className="text-emerald-200/80">ok: {ok}</div>
              <div className="text-white/60">pending: {pending}</div>
              <div className="text-amber-200/80">warn: {warn}</div>
              <div className="text-rose-200/80">error: {error}</div>
            </div>

            <div className="mt-3 text-[11px] text-white/45">
              {allGreen ? "Ready to commit." : "Waiting for verify to finish / pass."}
            </div>

            <button
              className={[
                "mt-3 w-full px-3 py-2 rounded-lg border text-white",
                allGreen
                  ? "bg-emerald-500/20 border-emerald-400/40 hover:bg-emerald-500/30"
                  : "bg-white/5 border-white/10 text-white/40 cursor-not-allowed",
              ].join(" ")}
              disabled={!allGreen}
              title="Future: git commit"
            >
              Commit (future)
            </button>
          </div>
        )}

        {mode === "memory" && (
          <div className="text-sm text-white/70">
            <div className="text-white/90 font-medium mb-2">Memory</div>

            {/* Tabs */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                className={`px-2 py-1.5 rounded-lg text-xs ${
                  memoryKey === "master-summary"
                    ? "bg-white/10 ring-1 ring-white/15"
                    : "bg-white/5 hover:bg-white/10"
                }`}
                onClick={() => setMemoryKey("master-summary")}
              >
                Master
              </button>

              <button
                className={`px-2 py-1.5 rounded-lg text-xs ${
                  memoryKey === "chamber-state"
                    ? "bg-white/10 ring-1 ring-white/15"
                    : "bg-white/5 hover:bg-white/10"
                }`}
                onClick={() => setMemoryKey("chamber-state")}
              >
                Chamber
              </button>

              <button
                className={`px-2 py-1.5 rounded-lg text-xs ${
                  memoryKey === "path-tree"
                    ? "bg-white/10 ring-1 ring-white/15"
                    : "bg-white/5 hover:bg-white/10"
                }`}
                onClick={() => setMemoryKey("path-tree")}
              >
                Tree
              </button>

              <button
                className={`px-2 py-1.5 rounded-lg text-xs ${
                  memoryKey === "ledger"
                    ? "bg-white/10 ring-1 ring-white/15"
                    : "bg-white/5 hover:bg-white/10"
                }`}
                onClick={() => setMemoryKey("ledger")}
              >
                Ledger
              </button>
            </div>

            {/* Content */}
            <div className="rounded-xl bg-black/30 ring-1 ring-white/10 p-3">
              {memoryLoading ? (
                <div className="text-xs text-white/40">Loading…</div>
              ) : (
                <>
                  <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
                    {memoryKey}
                  </div>

                  <pre className="whitespace-pre-wrap text-[12px] text-white/75">
                    {(memoryDoc?.content ?? "").trim() ||
                      "Empty. Will be filled after prune."}
                  </pre>

                  <div className="mt-3 text-[11px] text-white/35">
                  {memoryDoc?.updated_at
                    ? `Updated: ${new Date(memoryDoc.updated_at).toLocaleString()}`
                    : ""}
                </div>
                </>
              )}
            </div>
          </div>
        )}

        {mode === "handover" && (
          <div className="text-sm text-white/70">
            <div className="text-white/90 font-medium mb-2">Handover</div>
            <div className="text-xs text-white/50">Placeholder.</div>
          </div>
        )}

        {mode === "sql" && (
          <div className="text-sm text-white/70">
            <div className="text-white/90 font-medium mb-2">SQL</div>
            <div className="text-xs text-white/50">Placeholder.</div>
          </div>
        )}
      </div>

      <div className="text-[11px] text-white/40">
        Click a mode to open; click it again to close.
      </div>
    </div>

    
  );
}