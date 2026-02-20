"use client";

import { useMemo, useState } from "react";
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

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function ChamberWithVault({ repoId }: { repoId: string }) {
  // ─────────────────────────────────────────────────────────────
  // Tab state authority
  // ─────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  // Derived: quick lookup map (fileId -> tab)
  const tabIndex = useMemo(() => {
    const m = new Map<string, OpenTab>();
    for (const t of tabs) m.set(t.fileId, t);
    return m;
  }, [tabs]);

  // ─────────────────────────────────────────────────────────────
  // Actions: open file (add tab if missing, activate)
  // ─────────────────────────────────────────────────────────────
  function openFile(f: RepoFile) {
    const next: OpenTab = { fileId: f.id, path: f.path, mime: f.mime };

    setTabs((prev) => {
      if (tabIndex.has(f.id)) return prev;
      return [next, ...prev];
    });

    setActiveFileId(f.id);
  }

  // ─────────────────────────────────────────────────────────────
  // Actions: close tab (remove + choose next active)
  // ─────────────────────────────────────────────────────────────
  function closeTab(fileId: string) {
    setTabs((prev) => prev.filter((t) => t.fileId !== fileId));

    setActiveFileId((cur) => {
      if (cur !== fileId) return cur;
      const remaining = tabs.filter((t) => t.fileId !== fileId);
      return remaining[0]?.fileId ?? null;
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