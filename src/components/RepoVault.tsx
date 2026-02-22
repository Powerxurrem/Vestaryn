"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * @file RepoVault.tsx
 * @purpose Vault sidebar UI for repo files: list, upload, create, export, soft-delete.
 * @exports RepoVault
 *
 * @sections
 * - Types
 * - Component state & refs
 * - Data ops: refresh, uploadOne, createFile, exportFile, deleteFile
 * - Context menu: open/close, clamp to viewport
 * - Render: header actions, file list, portals (menu + create modal)
 *
 * @invariants
 * - This UI trusts the DB-backed API list; soft-deletes are filtered server-side.
 * - Signed URLs are requested on-demand (export/open flows), never persisted client-side.
 * - Storage key format + RLS invariants are enforced server-side; UI only calls routes.
 *
 * @touchpoints
 * - GET    /api/repos/[repoId]/files
 * - POST   /api/repos/[repoId]/files/upload
 * - POST   /api/repos/[repoId]/files/create
 * - GET    /api/repos/[repoId]/files/[fileId]         (signed_url)
 * - DELETE /api/repos/[repoId]/files/[fileId]         (soft-delete)
 *
 * @notes
 * - There is a duplicate DELETE call in deleteFile() (flagged below). Keep or remove intentionally.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type RepoFile = {
  id: string;
  repo_id: string;
  path: string;
  name: string;
  mime: string;
  size_bytes: number;
  updated_at: string;
  created_at: string;
};
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function RepoVault({
  repoId,
  onOpenFile,
}: {
  repoId: string;
  onOpenFile: (file: RepoFile) => void;
}) {
  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Portals must only render after mount (client-only)
  const [mounted, setMounted] = useState(false);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("untitled.md");
  const [creating, setCreating] = useState(false);
  const validRepoId = isUuid(repoId);

  // ─────────────────────────────────────────────────────────────
  // Refs
  // ─────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Context menu state (raw requested position)
  const [menu, setMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    file: RepoFile | null;
  }>({ open: false, x: 0, y: 0, file: null });

  // Context menu: measured/clamped position
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // ─────────────────────────────────────────────────────────────
  // Effects: mount gate for portals
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Data ops: refresh list
  // ─────────────────────────────────────────────────────────────
async function refresh() {
  if (!validRepoId) {
    setError(`invalid repoId: ${repoId}`);
    return;
  }

  setLoading(true);
  setError(null);

  try {
    const r = await fetch(`/api/repos/${repoId}/files`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));

    if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

    // only update files on success (prevents "disappear on refresh")
    setFiles(j.files ?? []);
  } catch (e: any) {
    setError(e?.message ?? "Failed to load files");
    // IMPORTANT: do NOT clear files here
  } finally {
    setLoading(false);
  }
}

  // ─────────────────────────────────────────────────────────────
  // Data ops: create file (empty v1)
  // ─────────────────────────────────────────────────────────────
  async function createFile() {
    if (!validRepoId) {
    setError(`invalid repoId: ${repoId}`);
    return;
}
    setCreating(true);
    setError(null);

    try {
      const name = createName.trim();
      if (!name) throw new Error("File name required");

      const r = await fetch(`/api/repos/${repoId}/files/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          content: "", // v1: empty
        }),
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      setCreateOpen(false);
      await refresh();

      // Optional: auto-open the newly created file if API returns it
      if (j?.file) {
        setSelectedId(j.file.id);
        onOpenFile(j.file);
      }
    } catch (e: any) {
      setError(e?.message ?? "Create failed");
    } finally {
      setCreating(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Data ops: upload one file
  // ─────────────────────────────────────────────────────────────
  async function uploadOne(file: File) {
    if (!validRepoId) {
    setError(`invalid repoId: ${repoId}`);
    return;
}
    setUploading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const r = await fetch(`/api/repos/${repoId}/files/upload`, {
        method: "POST",
        body: form,
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Data ops: export/download via signed URL
  // ─────────────────────────────────────────────────────────────
  async function exportFile(f: RepoFile) {
    if (!validRepoId) {
    setError(`invalid repoId: ${repoId}`);
    return;
}
    setError(null);

    try {
      const r = await fetch(`/api/repos/${repoId}/files/${f.id}`, {
        cache: "no-store",
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      const signedUrl: string | undefined = j.signed_url;
      if (!signedUrl) throw new Error("Missing signed_url");

      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Data ops: delete (soft-delete via API)
  // ─────────────────────────────────────────────────────────────
  async function deleteFile(f: RepoFile) {
    if (!validRepoId) {
    setError(`invalid repoId: ${repoId}`);
    return;
}
    setError(null);

    try {
      const r = await fetch(`/api/repos/${repoId}/files/${f.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      setMenu({ open: false, x: 0, y: 0, file: null });
      await refresh();

      // NOTE: There is a second DELETE call here in the original code.
      // If this was intentional (e.g., legacy endpoint mismatch), keep it.
      // Otherwise, remove to avoid double-hit and confusing logs.
      await fetch(`/api/repos/${repoId}/files/${f.id}`, { method: "DELETE" });
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Menu helpers: open at point
  // ─────────────────────────────────────────────────────────────
  function openMenuAt(x: number, y: number, file: RepoFile) {
    // slight offset so cursor doesn’t sit on top of menu (if you want it)
    const ox = x + 0;
    const oy = y + 0;

    setMenu({ open: true, x: ox, y: oy, file });
    setMenuPos({ x: ox, y: oy });
  }

  // ─────────────────────────────────────────────────────────────
  // Effects: load files on repoId change
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  // ─────────────────────────────────────────────────────────────
  // Effects: close menu on outside click / scroll
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function closeMenu() {
      setMenu((m) => (m.open ? { open: false, x: 0, y: 0, file: null } : m));
    }

    function onGlobalPointerDown(e: PointerEvent) {
      if (e.button === 2) return; // ignore right click

      // If clicking inside the menu, do nothing
      const el = menuRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;

      closeMenu();
    }

    function onGlobalScroll() {
      closeMenu();
    }

    window.addEventListener("pointerdown", onGlobalPointerDown);
    window.addEventListener("scroll", onGlobalScroll, true);

    return () => {
      window.removeEventListener("pointerdown", onGlobalPointerDown);
      window.removeEventListener("scroll", onGlobalScroll, true);
    };
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Effects: clamp menu position inside viewport after it renders
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!menu.open) return;
    const el = menuRef.current;
    if (!el) return;

    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const rect = el.getBoundingClientRect();

    let x = menu.x;
    let y = menu.y;

    if (x + rect.width > vw - pad) x = Math.max(pad, vw - pad - rect.width);
    if (y + rect.height > vh - pad) y = Math.max(pad, vh - pad - rect.height);

    setMenuPos({ x, y });
  }, [menu.open, menu.x, menu.y, menu.file?.id]);

  // ─────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────
  const prettyFiles = useMemo(() => files, [files]);



  
  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="w-[320px] shrink-0 h-full border-r border-white/10 bg-black/20 backdrop-blur-md relative">
      {/* Header */}
      <div className="p-3 border-b border-white/10">
        <div className="text-xs uppercase tracking-wider text-white/60">
          Vault
        </div>

        {/* Actions */}
        <div className="mt-2 flex gap-2">
          <button
            disabled={uploading || !validRepoId}
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>

          <button
            className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 text-sm text-white"
            onClick={() => {
              setCreateName("untitled.md");
              setCreateOpen(true);
            }}
            disabled={creating || !validRepoId}
          >
            {creating ? "Creating..." : "+ Create"}
          </button>

          <button
            className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 text-sm text-white"
            onClick={refresh}
            disabled={loading || !validRepoId}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              await uploadOne(f);
              e.currentTarget.value = "";
            }}
          />
        </div>

        {/* Drop zone */}
        <div
          className="mt-2 rounded-md border border-dashed border-white/20 p-3 text-xs text-white/60"
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) await uploadOne(f);
          }}
          
        >
          Drop a file here
        </div>
            {!validRepoId && (
              <div className="mt-2 text-xs text-red-300">
                invalid repoId: {String(repoId)}
              </div>
            )}
        {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
      </div>

      {/* File list */}
      <div className="h-full overflow-auto">
        {prettyFiles.length === 0 ? (
          <div className="p-3 text-sm text-white/50">No files yet.</div>
        ) : (
          <ul className="p-2 space-y-1">
            {prettyFiles.map((f) => (
              <li key={f.id}>
                <div className="flex items-stretch gap-1">
                  <button
                    className={[
                      "flex-1 text-left px-2 py-2 rounded-md",
                      "hover:bg-white/10",
                      selectedId === f.id ? "bg-white/12" : "bg-transparent",
                    ].join(" ")}
                    onClick={() => {
                      setSelectedId(f.id);
                      onOpenFile(f);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedId(f.id);
                      openMenuAt(e.clientX, e.clientY, f);
                    }}
                  >
                    <div className="text-sm text-white truncate">{f.path}</div>
                    <div className="text-xs text-white/50 truncate">
                      {f.mime} • {Math.round((f.size_bytes || 0) / 1024)} KB
                    </div>
                  </button>

                  {/* Fallback menu button (works everywhere) */}
                  <button
                    className="px-2 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setSelectedId(f.id);
                      openMenuAt(
                        Math.round(rect.left),
                        Math.round(rect.bottom + 6),
                        f
                      );
                    }}
                  >
                    ⋯
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Context menu (portal) */}
      {mounted &&
        menu.open &&
        menu.file &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] w-44 rounded-md border border-white/10 bg-black/80 backdrop-blur-md shadow-[0_12px_30px_rgba(0,0,0,0.6)]"
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10"
              onClick={() => {
                onOpenFile(menu.file!);
                setMenu({ open: false, x: 0, y: 0, file: null });
              }}
            >
              Open
            </button>

            <button
              className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10"
              onClick={async () => {
                await exportFile(menu.file!);
                setMenu({ open: false, x: 0, y: 0, file: null });
              }}
            >
              Export / Download
            </button>

            <div className="h-px bg-white/10" />

            <button
              className="w-full text-left px-3 py-2 text-sm text-red-200 hover:bg-white/10"
              onClick={async () => {
                const ok = confirm(`Delete ${menu.file!.path}?`);
                if (!ok) return;
                await deleteFile(menu.file!);
              }}
            >
              Delete
            </button>
          </div>,
          document.body
        )}

      {/* Create modal (portal) */}
      {mounted &&
        createOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => !creating && setCreateOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-lg border border-white/10 bg-black/80 backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.7)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-white/10">
                <div className="text-sm text-white/80">Create file</div>
                <div className="text-xs text-white/50 mt-1">
                  Creates an empty file in this repo.
                </div>
              </div>

              <div className="p-4 space-y-2">
                <label className="block text-xs text-white/60">File name</label>
                <input
                  className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm text-white outline-none focus:border-white/20"
                  value={createName}
                  autoFocus
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createFile();
                    if (e.key === "Escape" && !creating) setCreateOpen(false);
                  }}
                  placeholder="e.g. notes.md"
                  disabled={creating}
                />
              </div>

              <div className="p-4 pt-0 flex justify-end gap-2">
                <button
                  className="px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 text-sm text-white/80"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  className="px-3 py-2 rounded-md bg-white/15 hover:bg-white/20 text-sm text-white"
                  onClick={createFile}
                  disabled={creating}
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}