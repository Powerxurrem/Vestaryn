"use client";

import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useImperativeHandle,
  forwardRef,
  type ReactNode,
} from "react";
import type { OpenTab } from "@/components/FileOverlay";

export type VaultEditorPaneHandle = {
  saveActiveIfDirty: () => Promise<boolean>;
};

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

function inferPreviewMimeFromPath(path: string) {
  const p = String(path ?? "").toLowerCase();

  if (p.endsWith(".html")) return "text/html";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".js")) return "application/javascript";
  if (p.endsWith(".jsx")) return "application/javascript";
  if (p.endsWith(".ts")) return "application/typescript";
  if (p.endsWith(".tsx")) return "application/typescript";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".md")) return "text/markdown";
  if (p.endsWith(".txt")) return "text/plain";

  return "text/plain";
}

const VaultEditorPane = forwardRef<VaultEditorPaneHandle, {
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
    {
      status: "ok" | "warn" | "error" | "pending";
      reason: string | null;
      source: "preverify" | "verify" | "manual" | "scan" | null;
      updated_at: string | null;
    }
  >;
  onFileStatus: (
    fileId: string,
    status: "ok" | "warn" | "error" | "pending",
    reason?: string,
    source?: "preverify" | "verify" | "manual" | "scan"
  ) => void;
  rightChamber?: ReactNode;
  rightChamberWidth?: number;
  rightChamberOpen?: boolean;
  errorLinesByFileId?: Record<string, number[]>;
}>(function VaultEditorPane(
  {
    repoId,
    tabs,
    activeFileId,
    onActivate,
    onClose,
    sidebar,
    fileStatusById,
    errorLinesByFileId = {},
    proposalPreviewByFileId = {},
    onFileStatus,
    rightChamber,
    rightChamberWidth,
    rightChamberOpen,
    fileReloadTokenById,
  },
  ref
) {
  const activeTab = useMemo(
    () => tabs.find((t) => t.fileId === activeFileId) ?? null,
    [tabs, activeFileId]
  );

const proposalEntries = useMemo(
  () => Object.values(proposalPreviewByFileId ?? {}),
  [proposalPreviewByFileId]
);

const fallbackProposal = useMemo(() => {
  if (activeTab) return null;
  if (proposalEntries.length === 0) return null;

  const preferred =
    proposalEntries.find((p) => String(p.path ?? "").toLowerCase() === "index.html") ??
    proposalEntries[0] ??
    null;

  return preferred;
}, [activeTab, proposalEntries]);

const effectiveFileId = activeTab?.fileId ?? fallbackProposal?.fileId ?? null;
const effectivePath = activeTab?.path ?? fallbackProposal?.path ?? "New staged file";
const effectiveMime =
  activeTab?.mime ?? inferPreviewMimeFromPath(fallbackProposal?.path ?? "");
const effectiveOp = fallbackProposal?.op ?? null;
const isVirtualCreatePreview = !activeTab && !!fallbackProposal;
const activeErrorLines = useMemo(
  () => new Set(errorLinesByFileId?.[effectiveFileId ?? ""] ?? []),
  [errorLinesByFileId, effectiveFileId]
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
const minEditorWidth = 300;      // minimum width of editor
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
  const canEdit = isTextLike(effectiveMime);
const activeProposal =
  effectiveFileId ? proposalPreviewByFileId[effectiveFileId] ?? fallbackProposal ?? null : null;

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

const previewDisplayContent =
  mode === "read" ? normalizeLeadingPreviewNewline(displayContent) : displayContent;

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

function normalizeLeadingPreviewNewline(text: string) {
  const raw = String(text ?? "").replace(/\r/g, "");

  if (raw.startsWith("\n") && !raw.startsWith("\n\n")) {
    return raw.slice(1);
  }

  return raw;
}

function splitPreviewLines(text: string) {
  const raw = String(text ?? "").replace(/\r/g, "");

  if (raw.startsWith("\n") && !raw.startsWith("\n\n")) {
    return splitLinesStable(raw.slice(1));
  }

  return splitLinesStable(raw);
}

const inlineDiff =
  isInlineDiffPreview && activeProposal
    ? buildSimpleInlineDiff(
        normalizeLeadingPreviewNewline(content),
        normalizeLeadingPreviewNewline(activeProposal.content)
      )
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

useEffect(() => {
  if (!editorScrollRef.current) return;
  if (activeErrorLines.size === 0) return;
  if (loading) return;

  const firstError = Math.min(...Array.from(activeErrorLines));
  if (!Number.isFinite(firstError)) return;

  const id = window.setTimeout(() => {
    const lineHeight = 20;
    const targetTop = Math.max(0, firstError * lineHeight - 40);

    editorScrollRef.current?.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  }, 30);

  return () => window.clearTimeout(id);
}, [activeErrorLines, loading, activeFileId]);

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
      throw e;
    } finally {
      setSaving(false);
    }
  }

useImperativeHandle(ref, () => ({
  async saveActiveIfDirty() {
    if (!activeTab) return false;
    if (!dirty) return false;

    await save();
    return true;
  },
}));

const containerRef = useRef<HTMLDivElement | null>(null);
const draggingRef = useRef(false);
const editorScrollRef = useRef<HTMLDivElement | null>(null);
const storageKey = `vestaryn:ideSplit:explorerW:${repoId ?? "default"}`;
const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
const lineNumberScrollRef = useRef<HTMLDivElement | null>(null);
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
}

function onDividerPointerUp() {
  draggingRef.current = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

function lineNumberCell(n: number, isError = false) {
  return (
    <div
      key={`ln-${n}`}
      className={[
        "h-5 leading-5 pr-3 text-right select-none tabular-nums",
        isError ? "text-rose-300" : "text-white/25",
      ].join(" ")}
    >
      {n}
    </div>
  );
}

function syncEditorScroll() {
  if (!editorTextareaRef.current || !lineNumberScrollRef.current) return;
  lineNumberScrollRef.current.scrollTop = editorTextareaRef.current.scrollTop;
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
        <div className="flex items-center gap-2 px-2 py-2 border-b border-white/10 bg-black/10">
  <div className="min-w-0 flex-1 overflow-x-auto">
    <div className="flex items-center gap-1 w-max">
          {tabs.length === 0 ? (
            <div className="text-xs text-white/30 px-2">No file open</div>
          ) : (
            tabs.map((t) => {
              const active = t.fileId === activeFileId;
              const isDirty = active && dirty;
              const st = fileStatusById?.[t.fileId];
              const updatedAtMs = st?.updated_at ? new Date(st.updated_at).getTime() : null;
              const isRecent = !!updatedAtMs && Date.now() - updatedAtMs < 15000;
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
    </div>
  </div>
          {/* Right-side actions */}
          <div className="shrink-0 flex items-center gap-2 relative z-100">
            {canEdit && (
              mode === "read" ? (
                <button
                  className="shrink-0 inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/5 px-3 text-xs text-white/70 hover:bg-white/10"
                  onClick={() => setMode("edit")}
                  disabled={!activeTab || loading}
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    className="inline-flex h-8 items-center justify-center px-3 text-xs rounded-md bg-blue-500/20 border border-blue-400/40 hover:bg-blue-500/30 text-white"
                    onClick={save}
                    disabled={!dirty || saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="inline-flex h-8 items-center justify-center px-3 text-xs rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
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
  {!activeTab && !fallbackProposal ? (
  <div className="h-full flex items-center justify-center text-sm text-white/35">
    Open a file from Explorer.
  </div>
) : !isTextLike(effectiveMime) ? (
    <div className="h-full flex items-center justify-center text-sm text-white/35">
      Binary file (no preview).
    </div>
  ) : loading ? (
    <div className="p-4 text-sm text-white/50">Loading…</div>
  ) : error ? (
    <div className="p-4 text-sm text-rose-300">{error}</div>
  ) : mode === "read" ? (
<div className="p-4 text-xs text-white/80 font-mono">
  {isVirtualCreatePreview ? (
    <div className="mb-3 rounded-md border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-100/80">
      Previewing staged new file: <span className="font-mono">{effectivePath}</span>
    </div>
  ) : null}

  {isInlineDiffPreview ? (
    <div className="flex items-start">
      <div className="shrink-0 border-r border-white/8 mr-3">
        {inlineDiff.map((_, i) => lineNumberCell(i + 1, activeErrorLines.has(i)))}
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto">
        {inlineDiff.map((line, i) => (
          <div
            key={i}
            className={[
              "h-5 leading-5 whitespace-pre",
              line.kind === "add"
                ? "bg-emerald-500/10 border-l-2 border-emerald-400 px-2 -mx-2"
                : line.kind === "remove"
                ? "bg-rose-500/10 border-l-2 border-rose-400 px-2 -mx-2 text-rose-100/80 line-through"
                : "",
              activeErrorLines.has(i) ? "bg-rose-500/10" : "",
            ].join(" ")}
          >
            {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
            {line.text || " "}
          </div>
        ))}
      </div>
    </div>
  ) : (
    <div className="flex items-start">
      <div className="shrink-0 border-r border-white/8 mr-3">
        {splitPreviewLines(previewDisplayContent).map((_, i) => lineNumberCell(i + 1, activeErrorLines.has(i)))}
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto">
        {splitPreviewLines(previewDisplayContent).map((line, i) => {
          const isChanged = changedLines.has(i);

          return (
            <div
              key={i}
              className={[
                "h-5 leading-5 whitespace-pre",
                isChanged
                  ? "bg-emerald-500/10 border-l-2 border-emerald-400 px-2 -mx-2"
                  : "",
                activeErrorLines.has(i)
                  ? "bg-rose-500/10 border-l-2 border-rose-400 px-2 -mx-2"
                  : "",
              ].join(" ")}
            >
              {line || " "}
            </div>
          );
        })}
      </div>
    </div>
  )}
</div>
  ) : (
    <div className="flex h-full min-h-0 bg-black/40 font-mono text-xs text-white/90">
  <div
    ref={lineNumberScrollRef}
    className="shrink-0 border-r border-white/8 pl-4 pr-3 py-4 text-right text-white/25 select-none tabular-nums overflow-hidden"
  >
    {content.split("\n").map((_, i) => (
      <div
        key={i}
        className={[
          "h-5 leading-5",
          activeErrorLines.has(i) ? "text-rose-300" : "",
        ].join(" ")}
      >
        {i + 1}
      </div>
    ))}
  </div>

  <textarea
    ref={editorTextareaRef}
    className="flex-1 h-full resize-none overflow-auto bg-transparent px-4 py-4 text-xs text-white/90 font-mono leading-5 outline-none"
    value={content}
    onChange={(e) => setContent(e.target.value)}
    onScroll={syncEditorScroll}
    spellCheck={false}
  />
</div>
  )}
</div>

        {/* Status bar */}
        <div className="px-3 py-2 border-t border-white/10 bg-black/20 text-[11px] text-white/45 flex items-center gap-3">
          <span>{effectivePath || "—"}</span>
<span className="opacity-60">{effectiveMime}</span>
          <span className="opacity-60">v{baseVersion ?? "?"}</span>
          {dirty ? <span className="text-blue-200/70">modified</span> : null}
          {isVirtualCreatePreview ? <span className="text-blue-200/70">staged create</span> : null}
        </div>
      </main>
    </div>
  );
});

VaultEditorPane.displayName = "VaultEditorPane";
export default VaultEditorPane;