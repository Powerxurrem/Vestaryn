"use client";

import { useEffect, useMemo, useState } from "react";
import ChatFrame from "@/components/chat/ChatFrame";
import RepoVault from "@/components/RepoVault";
import FileOverlay, { OpenTab } from "@/components/FileOverlay";

/**
 * @file ChamberWithVault.tsx
 * @purpose Compose the Obsidian chamber UI:
 *          - Left: RepoVault (file list/actions)
 *          - Right: ChatFrame (cognition stream)
 *          - Overlay: FileOverlay tabs (read/edit/save for text-like files)
 *
 * @exports ChamberWithVault
 *
 * @sections
 * - Types
 * - Tab state authority (tabs + activeFileId)
 * - Actions: openFile, closeTab
 * - Render: 2-column layout + overlay plane
 *
 * @invariants
 * - This component is the single source-of-truth for open tabs + active tab selection.
 * - RepoVault emits file metadata; FileOverlay handles content fetch/save via API routes.
 * - Visual planes: ChatFrame is base layer; FileOverlay floats above as an overlay.
 *
 * @touchpoints
 * - RepoVault -> onOpenFile()
 * - FileOverlay -> onActivate(), onClose()
 *
 * @notes
 * - tabIndex is derived from `tabs`. If tab operations become flaky, prefer computing
 *   membership inside the setTabs updater to avoid stale closure issues.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type RepoFile = {
  id: string;
  path: string;
  mime: string;
};
const storageKeyFor = (repoId: string) => `vestaryn:vaultTabs:${repoId}`;

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function ChamberWithVault({ repoId }: { repoId: string }) {
  // ─────────────────────────────────────────────────────────────
  // Tab state authority
  // ─────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Derived: quick lookup map (fileId -> tab)
  useEffect(() => {
  if (!repoId || repoId === "undefined") return;

  const saved = safeJsonParse<{ tabs: OpenTab[]; activeFileId: string | null }>(
    localStorage.getItem(storageKeyFor(repoId))
  );

  if (saved?.tabs?.length) {
    setTabs(saved.tabs);
    setActiveFileId(saved.activeFileId ?? saved.tabs[0]?.fileId ?? null);
  } else {
    setTabs([]);
    setActiveFileId(null);
  }

  setHydrated(true);
}, [repoId]);
  // ─────────────────────────────────────────────────────────────
  // Actions: open file (add tab if missing, activate)
  // ─────────────────────────────────────────────────────────────
  function openFile(f: RepoFile) {
    const next: OpenTab = { fileId: f.id, path: f.path, mime: f.mime };

    setTabs((prev) => {
      if (prev.some((t) => t.fileId === f.id)) return prev;
      return [next, ...prev];
    });

    setActiveFileId(f.id);
  }
  useEffect(() => {
    if (!hydrated) return;
    if (!repoId || repoId === "undefined") return;

    localStorage.setItem(
      storageKeyFor(repoId),
      JSON.stringify({ tabs, activeFileId })
    );
  }, [hydrated, repoId, tabs, activeFileId]);
  // ─────────────────────────────────────────────────────────────
  // Actions: close tab (remove + choose next active)
  // ─────────────────────────────────────────────────────────────
  function closeTab(fileId: string) {
    setTabs((prev) => {
      const nextTabs = prev.filter((t) => t.fileId !== fileId);

      setActiveFileId((cur) => {
        if (cur !== fileId) return cur;
        return nextTabs[0]?.fileId ?? null;
      });

      return nextTabs;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Render: 2-column layout + overlay plane
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex w-full gap-4">
      {/* Left: Vault */}
      <div className="w-[320px] shrink-0">
        <div className="h-[70vh] rounded-xl overflow-hidden ring-1 ring-blue-500/20 bg-black/25 backdrop-blur-md">
          <RepoVault repoId={repoId} onOpenFile={openFile} />
        </div>
      </div>

      {/* Right: Chat + overlay */}
      <div className="flex-1 min-w-0 relative">
        {/* Base plane: cognition stream */}
        <ChatFrame repoId={repoId} />

        {/* Overlay plane: file tabs + viewer/editor */}
        <div className="absolute left-4 right-4 top-4 z-30">
          <FileOverlay
            repoId={repoId}
            tabs={tabs}
            activeFileId={activeFileId}
            onActivate={setActiveFileId}
            onClose={closeTab}
          />
        </div>
      </div>
    </div>
  );
}