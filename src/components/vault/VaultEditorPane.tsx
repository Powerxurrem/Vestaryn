"use client";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import type { OpenTab } from "@/components/FileOverlay";

function isTextLike(mime: string) {
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-typescript",
    ].includes(mime)
  );
}

export default function VaultEditorPane({
  repoId,
  tabs,
  activeFileId,
  onActivate,
  onClose,
  sidebar,
  fileStatusById,
  proposalPreviewByFileId = {},
  onFileStatus,    
  rightChamber,
  rightChamberWidth,
  rightChamberOpen,
  fileReloadTokenById,
  
}: {
  repoId: string;
  tabs: OpenTab[];
  activeFileId: string | null;
  onActivate: (fileId: string) => void;
  onClose: (fileId: string) => void;
  sidebar: ReactNode;
  fileReloadTokenById?: Record<string, number>;
   proposalPreviewByFileId?: Record<
    string,
    {
      fileId: string;
      content: string;
      path?: string | null;
      op?: string | null;
      appendPreview?: string | null;
    }
  >;
  fileStatusById: Record<
    string,
    
    { ts: number; status: "ok" | "warn" | "error" | "pending"; reason?: string }
  >;
  onFileStatus: (
    fileId: string,
    status: "ok" | "warn" | "error" | "pending",
    reason?: string
  ) => void;
    rightChamber?: ReactNode;
    rightChamberWidth?: number;
    rightChamberOpen?: boolean;
}) {
  const activeTab = useMemo(
    () => tabs.find((t) => t.fileId === activeFileId) ?? null,
    [tabs, activeFileId]
  );

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadToken = fileReloadTokenById?.[activeFileId ?? ""] ?? 0;   
  useEffect(() => {
  if (!editorScrollRef.current) return;
  if (!activeTab) return;
  if (!content) return;

  // only useful after a file reload completed
  const lines = splitLinesStable(content);
  if (lines.length === 0) return;

  const lineHeight = 20;
  const targetTop = Math.max(0, (lines.length - 6) * lineHeight - 40);

  editorScrollRef.current.scrollTo({
    top: targetTop,
    behavior: "smooth",
  });
}, [reloadToken]);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
// ─────────────────────────────
// Explorer / Engraving layout
// ─────────────────────────────
const [engravingOpen, setEngravingOpen] = useState(false);
const engravingWidth = 320;
const minEditorWidth = 720;      // minimum width of editor
const minExplorerWidth = 330;    // minimum width of explorer
const vaultW = 320;          // fixed Vault list width
const minEngravingW = 0;   // minimum engraving area so it’s usable
const minExplorer = vaultW + minEngravingW;
// Engraving panel sizing (fixed)
const engravingW = 260; // try 260–320
const minVaultW = 260;        // file list usability
const maxEngravingW = 340;    // optional cap (aesthetics)
const minEditorW = 720;       // you already have this (keep one source of truth)
type DiffLine =
  | { kind: "same"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string };

function buildSimpleInlineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= start &&
    newEnd >= start &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd--;
    newEnd--;
  }

  const out: DiffLine[] = [];

  for (let i = 0; i < start; i++) {
    out.push({ kind: "same", text: oldLines[i] ?? "" });
  }

  for (let i = start; i <= oldEnd; i++) {
    out.push({ kind: "remove", text: oldLines[i] ?? "" });
  }

  for (let i = start; i <= newEnd; i++) {
    out.push({ kind: "add", text: newLines[i] ?? "" });
  }

  for (let i = oldEnd + 1; i < oldLines.length; i++) {
    out.push({ kind: "same", text: oldLines[i] ?? "" });
  }

  return out;
}

  const dirty = mode === "edit" && content !== original;
  const canEdit = isTextLike(activeTab?.mime ?? "");
const activeProposal =
  activeTab?.fileId ? proposalPreviewByFileId[activeTab.fileId] ?? null : null;

const hasProposalForActiveFile = !!activeProposal;

const proposalOp = activeProposal?.op ?? null;

console.log("[editorPreview]", {
  activeFileId,
  proposalFileId: activeProposal?.fileId ?? null,
  proposalOp,
  hasProposalForActiveFile,
  contentLen: content.length,
  proposalLen: activeProposal?.content?.length ?? 0,
  startsWithCurrent:
    !!content &&
    !!activeProposal?.content &&
    activeProposal.content.startsWith(content),
});

const isAppendPreview =
  hasProposalForActiveFile &&
  mode === "read" &&
  proposalOp === "append";

const isInlineDiffPreview =
  hasProposalForActiveFile &&
  mode === "read" &&
  proposalOp !== "append";

const displayContent =
  hasProposalForActiveFile && mode === "read"
    ? activeProposal!.content
    : content;

const changedLines = useMemo(() => {
  const changed = new Set<number>();

  if (isAppendPreview && activeProposal) {
    const newLines = splitLinesStable(activeProposal.content);
    const appendLines = splitLinesStable(String(activeProposal.appendPreview ?? ""));

    const start = Math.max(0, newLines.length - appendLines.length);

    for (let i = start; i < newLines.length; i++) {
      changed.add(i);
    }

    console.log("[appendPreview]", {
      newLinesLen: newLines.length,
      appendLinesLen: appendLines.length,
      start,
      appendLines,
    });
  }

  return changed;
}, [isAppendPreview, activeProposal]);

function splitLinesStable(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
const inlineDiff =
  isInlineDiffPreview && activeProposal
    ? buildSimpleInlineDiff(content, activeProposal.content)
    : [];

useEffect(() => {
  if (!editorScrollRef.current) return;
  if (!hasProposalForActiveFile) return;
  if (mode !== "read") return;
  if (loading) return;
  if (!displayContent) return;
  if (changedLines.size === 0) return;

  const firstChanged = Math.min(...Array.from(changedLines));
  if (!Number.isFinite(firstChanged)) return;

  const id = window.setTimeout(() => {
    const lineHeight = 20;
    const targetTop = Math.max(0, firstChanged * lineHeight - 40);

    editorScrollRef.current?.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  }, 30);

  return () => window.clearTimeout(id);
}, [
  hasProposalForActiveFile,
  activeFileId,
  activeProposal,
  mode,
  loading,
  displayContent,
  changedLines,
]);

function computeChangedLineSet(oldText: string, newText: string) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const max = Math.max(oldLines.length, newLines.length);
  const changed = new Set<number>();

  for (let i = 0; i < max; i++) {
    if ((oldLines[i] ?? "") !== (newLines[i] ?? "")) {
      changed.add(i);
    }
  }

  return changed;
}

  // Load active file
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      setContent("");
      setOriginal("");
      setBaseVersion(null);
      setMode("read");

      if (!activeTab) return;
      if (!isTextLike(activeTab.mime)) return;

      setLoading(true);

      try {
        const r = await fetch(`/api/repos/${repoId}/files/${activeTab.fileId}`, {
          cache: "no-store",
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

        const signedUrl: string | undefined = j.signed_url ?? j.signedUrl ?? j.url;
        const version: number | null = j.latest_version ?? null;
        if (!signedUrl) throw new Error("Missing signed_url");

        const raw = await fetch(signedUrl, { cache: "no-store" });
        const text = await raw.text();

        if (!cancelled) {
          setContent(text);
          setOriginal(text);
          setBaseVersion(version);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load file");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    }, [repoId, activeTab?.fileId, activeTab?.mime, reloadToken]);

  async function save() {
    if (!activeTab) return;
    if (!dirty) return;

    setSaving(true);
    setError(null);

    try {
      const r = await fetch(`/api/repos/${repoId}/files/${activeTab.fileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          mime: activeTab.mime,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      setOriginal(content);
      setMode("read");
      onFileStatus(activeTab.fileId, "ok", "Saved from editor");
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

const containerRef = useRef<HTMLDivElement | null>(null);
const draggingRef = useRef(false);
const editorScrollRef = useRef<HTMLDivElement | null>(null);
const storageKey = `vestaryn:ideSplit:explorerW:${repoId ?? "default"}`;

const [explorerW, setExplorerW] = useState(280);

useEffect(() => {
  try {
    const raw = localStorage.getItem(storageKey);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) setExplorerW(Math.max(220, Math.min(700, n)));
  } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [storageKey]);

useEffect(() => {
  try {
    localStorage.setItem(storageKey, String(explorerW));
  } catch {}
}, [storageKey, explorerW]);

function onDividerPointerDown(e: React.PointerEvent) {
  draggingRef.current = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function onDividerPointerMove(e: React.PointerEvent) {
  if (!draggingRef.current) return;

  const el = containerRef.current;
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;

const minExplorer = vaultW + minEngravingW;
const minEditor = minEditorWidth;

const maxExplorer = rect.width - minEditor;

const clamped = Math.max(minExplorer, Math.min(maxExplorer, Math.round(x)));
setExplorerW(clamped);
  setExplorerW(clamped);
}

function onDividerPointerUp() {
  draggingRef.current = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

return (
  <div ref={containerRef} className="h-full w-full flex min-w-0">
    {/* Explorer */}
   <aside
  style={{ width: explorerW }}
  className="shrink-0 border-r border-white/10 bg-black/20 min-w-0 flex flex-col"
>
  <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-white/40 border-b border-white/10">
    Explorer
  </div>

  {/* Left pane body: Vault (scroll) + Engraving (fixed) */}
  <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
    
    {/* Vault list (scrolls) */}
    <div
      className="min-h-0 overflow-auto vault-scroll border-r border-white/10"
      style={{ width: vaultW }}
    >
      {sidebar}
    </div>

{/* Engraving area (fixed, does NOT scroll with vault) */}
<div className="flex-1 min-w-0 min-h-0 overflow-hidden bg-black/15">
  <div className="h-full overflow-auto p-3">
    {rightChamber ? (
      rightChamber
    ) : (
      <>
        <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
          Engraving
        </div>

        <div className="text-xs text-white/55">
          No chamber mounted.
        </div>
      </>
    )}
  </div>
</div>
  </div>
</aside>

{/* Divider (drag handle) */}
<div
  onPointerDown={onDividerPointerDown}
  onPointerMove={onDividerPointerMove}
  onPointerUp={onDividerPointerUp}
  className="group relative w-4 shrink-0 cursor-col-resize select-none touch-none"
  title="Drag to resize"
>
  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-blue-400/40 shadow-[0_0_8px_rgba(96,165,250,0.6)]" />
</div>

{/* Editor column */}
<main className="flex-1 min-w-0 flex flex-col">
        {/* Tabs row */}
        <div className="flex items-center gap-1 px-2 py-2 border-b border-white/10 bg-black/10 overflow-x-auto">
          {tabs.length === 0 ? (
            <div className="text-xs text-white/30 px-2">No file open</div>
          ) : (
            tabs.map((t) => {
              const active = t.fileId === activeFileId;
              const isDirty = active && dirty;
              const st = fileStatusById?.[t.fileId];
              const isRecent = st?.ts && Date.now() - st.ts < 15000;
              const status = st?.status ?? null;
              const reason = st?.reason ?? "";

              return (
                <div
                  key={t.fileId}
                  className={`flex items-center gap-2 px-2 py-1 rounded-md border text-xs ${
                    active
                      ? "bg-white/[0.06] border-white/15 text-white/85"
                      : "bg-transparent border-transparent text-white/55 hover:bg-white/[0.04]"
                  }`}
                >
                  <button
                    onClick={() => onActivate(t.fileId)}
                    className="truncate max-w-[260px]"
                    title={t.path}
                  >
                  <span className="truncate max-w-[260px]">
                    {t.path}
                  </span>

                  {isDirty ? (
                    <span className="ml-1 text-blue-300/70">●</span>
                  ) : null}

                  {isRecent && status ? (
                    <span
                      className={[
                        "ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10px]",
                        status === "ok"
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200/80"
                          : status === "warn"
                          ? "border-amber-400/30 bg-amber-500/10 text-amber-200/80"
                          : status === "error"
                          ? "border-rose-400/30 bg-rose-500/10 text-rose-200/80"
                          : "border-white/15 bg-white/5 text-white/60",
                      ].join(" ")}
                      title={reason || undefined}
                    >
                      <span
                        className={[
                          "h-[6px] w-[6px] rounded-full",
                          status === "ok"
                            ? "bg-emerald-300/80"
                            : status === "warn"
                            ? "bg-amber-300/80"
                            : status === "error"
                            ? "bg-rose-300/80"
                            : "bg-white/40",
                        ].join(" ")}
                      />
                      {status === "ok"
                        ? "updated"
                        : status === "warn"
                        ? "warning"
                        : status === "error"
                        ? "error"
                        : "pending"}
                    </span>
                  ) : null}
                  </button>

                  <button
                    onClick={() => onClose(t.fileId)}
                    className="text-white/40 hover:text-white/80"
                    aria-label="Close tab"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}

          {/* Right-side actions */}
          <div className="ml-auto flex items-center gap-2">
            {canEdit && (
              mode === "read" ? (
                <button
                  className="px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
                  onClick={() => setMode("edit")}
                  disabled={!activeTab || loading}
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    className="px-2 py-1 text-xs rounded-md bg-blue-500/20 border border-blue-400/40 hover:bg-blue-500/30 text-white"
                    onClick={save}
                    disabled={!dirty || saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
                    onClick={() => {
                      setContent(original);
                      setMode("read");
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                </>
              )
            )}
          </div>
        </div>

{/* Editor body */}
<div ref={editorScrollRef} className="flex-1 min-h-0 overflow-auto">
  {!activeTab ? (
    <div className="h-full flex items-center justify-center text-sm text-white/35">
      Open a file from Explorer.
    </div>
  ) : !isTextLike(activeTab.mime) ? (
    <div className="h-full flex items-center justify-center text-sm text-white/35">
      Binary file (no preview).
    </div>
  ) : loading ? (
    <div className="p-4 text-sm text-white/50">Loading…</div>
  ) : error ? (
    <div className="p-4 text-sm text-rose-300">{error}</div>
  ) : mode === "read" ? (
<div className="p-4 text-xs text-white/80 font-mono whitespace-pre-wrap break-words">
  {isInlineDiffPreview ? (
    inlineDiff.map((line, i) => (
      <div
        key={i}
        className={
          line.kind === "add"
            ? "bg-emerald-500/10 border-l-2 border-emerald-400 px-2 -mx-2"
            : line.kind === "remove"
            ? "bg-rose-500/10 border-l-2 border-rose-400 px-2 -mx-2 text-rose-100/80 line-through"
            : ""
        }
      >
        {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
        {line.text || " "}
      </div>
    ))
  ) : (
    displayContent.split("\n").map((line, i) => {
      const isChanged = changedLines.has(i);

      return (
        <div
          key={i}
          className={
            isChanged
              ? "bg-emerald-500/10 border-l-2 border-emerald-400 px-2 -mx-2"
              : ""
          }
        >
          {line || " "}
        </div>
      );
    })
  )}
</div>
  ) : (
    <textarea
      className="w-full h-full resize-none bg-black/40 p-4 text-xs text-white/90 font-mono outline-none"
      value={content}
      onChange={(e) => setContent(e.target.value)}
    />
  )}
</div>

        {/* Status bar */}
        <div className="px-3 py-2 border-t border-white/10 bg-black/20 text-[11px] text-white/45 flex items-center gap-3">
          <span>{activeTab ? activeTab.path : "—"}</span>
          <span className="opacity-60">{activeTab?.mime ?? ""}</span>
          <span className="opacity-60">v{baseVersion ?? "?"}</span>
          {dirty ? <span className="text-blue-200/70">modified</span> : null}
        </div>
      </main>
    </div>
  );
}