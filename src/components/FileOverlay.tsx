"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * @file FileOverlay.tsx
 * @purpose Tabbed file overlay: read-only preview + text edit/save for active file.
 * @exports FileOverlay
 *
 * @sections
 * - Types
 * - Helpers (text-like detection)
 * - Derived state (activeTab, dirty)
 * - Effect: load active text file via signed URL
 * - Action: save (PUT overwrite v1)
 * - Render: tab strip + content pane
 *
 * @invariants
 * - Signed URLs are fetched on-demand per open/read (never persisted).
 * - v1 save model: PUT overwrites the same storage_key (no version bump yet).
 * - UI trusts DB route response for metadata, then fetches blob via signed_url.
 *
 * @touchpoints
 * - GET /api/repos/[repoId]/files/[fileId]   -> { file, latest_version, signed_url }
 * - PUT /api/repos/[repoId]/files/[fileId]   -> { file }
 *
 * @notes
 * - baseVersion is captured but not enforced yet (conflict detection/versioning disabled).
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export type OpenTab = {
  fileId: string;
  path: string;
  mime: string;
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function FileOverlay({
  repoId,
  tabs,
  activeFileId,
  onActivate,
  onClose,
}: {
  repoId: string;
  tabs: OpenTab[];
  activeFileId: string | null;
  onActivate: (fileId: string) => void;
  onClose: (fileId: string) => void;
}) {
  // ─────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────
  const activeTab = useMemo(
    () => tabs.find((t) => t.fileId === activeFileId) ?? null,
    [tabs, activeFileId]
  );

  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"read" | "edit">("read");

  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [baseVersion, setBaseVersion] = useState<number | null>(null);

  const dirty = mode === "edit" && content !== original;

  // ─────────────────────────────────────────────────────────────
  // Effect: load active file (text-like only)
  // ─────────────────────────────────────────────────────────────
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
        // 1) Ask API for canonical metadata + signed_url
        const r = await fetch(`/api/repos/${repoId}/files/${activeTab.fileId}`, {
          cache: "no-store",
        });

        const j = await r.json();
        console.log("FILE GET RESPONSE", r.status, j);
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

        const signedUrl: string | undefined =
          j.signed_url ?? j.signedUrl ?? j.url;

        const version: number | null = j.latest_version ?? null;

        if (!signedUrl) throw new Error("Missing signed_url");

        // 2) Fetch blob directly via signed URL
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
  }, [repoId, activeTab?.fileId, activeTab?.mime]);

  // ─────────────────────────────────────────────────────────────
  // Action: save (PUT overwrite v1)
  // ─────────────────────────────────────────────────────────────
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
      // baseVersion stays as-is for now (v1 save doesn't version bump)
      setMode("read");
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  if (tabs.length === 0) return null;

  return (
    <div className="rounded-xl overflow-hidden ring-1 ring-blue-500/20 bg-black/30 backdrop-blur-md shadow-[0_12px_30px_rgba(0,0,0,0.5)]">
      {/* Tab Strip */}
      <div className="flex items-center gap-2 px-2 py-2 border-b border-white/10">
        <div className="flex items-center gap-2 overflow-auto flex-1">
          {tabs.map((t) => {
            const active = t.fileId === activeFileId;

            return (
              <div
                key={t.fileId}
                className={[
                  "flex items-center gap-2 px-2 py-1 rounded-md border",
                  active
                    ? "bg-white/10 border-blue-400/30"
                    : "bg-white/5 border-white/10 hover:bg-white/10",
                ].join(" ")}
              >
                <button
                  className="text-xs text-white/80 truncate max-w-[240px]"
                  onClick={() => onActivate(t.fileId)}
                  title={t.path}
                >
                  {t.path}
                </button>

                <button
                  className="text-xs text-white/50 hover:text-white/80"
                  onClick={() => onClose(t.fileId)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* Edit controls (text-like only) */}
        {isTextLike(activeTab?.mime ?? "") && (
          <>
            {mode === "read" ? (
              <button
                className="px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
                onClick={() => setMode("edit")}
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
                >
                  Cancel
                </button>
              </>
            )}
          </>
        )}

        <button
          className="px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {/* Content pane */}
      {!collapsed && (
        <div className="p-3">
          {!activeTab ? (
            <div className="text-sm text-white/50">Select a tab.</div>
          ) : !isTextLike(activeTab.mime) ? (
            <div className="text-sm text-white/50">Binary file (no preview).</div>
          ) : loading ? (
            <div className="text-sm text-white/50">Loading…</div>
          ) : error ? (
            <div className="text-sm text-red-300">{error}</div>
          ) : mode === "read" ? (
            <pre className="text-xs text-white/80 whitespace-pre-wrap break-words max-h-[32vh] overflow-auto">
              {content}
            </pre>
          ) : (
            <textarea
              className="w-full max-h-[32vh] min-h-[200px] resize-none bg-black/40 border border-white/10 rounded-md p-3 text-xs text-white/90 font-mono outline-none focus:border-blue-400/40"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  );
}