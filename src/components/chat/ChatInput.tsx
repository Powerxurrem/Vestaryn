"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Props = {
  onSend: (text: string) => void | Promise<void>;
  repoId: string;
};

export default function ChatInput({ onSend, repoId }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [pathPickerOpen, setPathPickerOpen] = useState(false);
  const [pathQuery, setPathQuery] = useState("");
  const [repoFiles, setRepoFiles] = useState<Array<{ id: string; path: string }>>([]);
  const [pathHighlightIndex, setPathHighlightIndex] = useState(0);
  const [pathPickerMode, setPathPickerMode] = useState<"command" | "shortcut" | null>(null);

  function extractPathCommandQuery(input: string): string | null {
    const match = input.match(/(?:^|\s)\/path(?:\s+([^\n]*))?$/i);
    if (!match) return null;
    return String(match[1] ?? "").trim();
  }

  function replaceTrailingPathCommand(input: string, selectedPath: string): string {
    return input.replace(/(?:^|\s)\/path(?:\s+[^\n]*)?$/i, ` ${selectedPath} `).trimStart();
  }

  const loadRepoFiles = useCallback(async () => {
    if (!repoId) return;

    try {
      const res = await fetch(`/api/repos/${repoId}/files`, {
        cache: "no-store",
        credentials: "include",
      });

      if (!res.ok) return;

      const data = await res.json();
      const files = Array.isArray(data?.files) ? data.files : [];

      setRepoFiles(
        files
          .map((f: any) => ({
            id: String(f.id ?? f.path),
            path: String(f.path ?? "").trim(),
          }))
          .filter((f: { id: string; path: string }) => !!f.path)
      );
    } catch (e) {
      console.error("[path_picker] failed to load repo files", e);
    }
  }, [repoId]);

  function openShortcutPathPicker() {
    setPathPickerOpen(true);
    setPathPickerMode("shortcut");
    setPathQuery("");
    setPathHighlightIndex(0);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function insertSelectedPath(path: string) {
    setValue((prev) => {
      if (pathPickerMode === "command") {
        return replaceTrailingPathCommand(prev, path);
      }

      if (!prev.trim()) {
        return `${path} `;
      }

      return `${prev} ${path} `;
    });

    setPathPickerOpen(false);
    setPathPickerMode(null);
    setPathQuery("");
    setPathHighlightIndex(0);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  const submit = async () => {
    const text = value.trim();
    if (!text) return;

    setValue("");
    setPathPickerOpen(false);
    setPathPickerMode(null);
    setPathQuery("");
    setPathHighlightIndex(0);

    await onSend(text);
  };

  useEffect(() => {
    void loadRepoFiles();
  }, [loadRepoFiles]);

  useEffect(() => {
    if (!pathPickerOpen) return;

    void loadRepoFiles();

    const id = window.setInterval(() => {
      void loadRepoFiles();
    }, 1500);

    return () => window.clearInterval(id);
  }, [pathPickerOpen, loadRepoFiles]);

  useEffect(() => {
    function onWindowKeyDown(e: KeyboardEvent) {
      if (!(e.altKey && e.code === "KeyP")) return;

      const active = document.activeElement;
      const isTypingElsewhere =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);

      if (isTypingElsewhere && active !== textareaRef.current) {
        return;
      }

      e.preventDefault();
      openShortcutPathPicker();
    }

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const activePathQuery = extractPathCommandQuery(value);

  useEffect(() => {
    if (activePathQuery !== null) {
      setPathPickerOpen(true);
      setPathPickerMode("command");
      setPathQuery(activePathQuery ?? "");
      setPathHighlightIndex(0);
      return;
    }

    if (pathPickerMode === "command" && activePathQuery === null) {
      setPathPickerOpen(false);
      setPathPickerMode(null);
      setPathQuery("");
    }
  }, [activePathQuery, pathPickerMode]);

  const filteredRepoFiles = repoFiles
    .filter((f) => {
      const q = pathQuery.trim().toLowerCase();
      if (!q) return true;
      return f.path.toLowerCase().includes(q);
    })
    .slice(0, 30);

  return (
    <div className="flex items-end gap-3 px-4 py-3 border border-blue-500/30">
      <div className="relative min-w-0 flex-1">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);

            if (pathPickerOpen && pathPickerMode === "shortcut") {
              setPathQuery(next.trim());
              setPathHighlightIndex(0);
            }
          }}
          onKeyDown={(e) => {
            if (e.altKey && e.code === "KeyP") {
              e.preventDefault();
              openShortcutPathPicker();
              return;
            }

            if (pathPickerOpen && filteredRepoFiles.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setPathHighlightIndex((prev) =>
                  Math.min(prev + 1, filteredRepoFiles.length - 1)
                );
                return;
              }

              if (e.key === "ArrowUp") {
                e.preventDefault();
                setPathHighlightIndex((prev) => Math.max(prev - 1, 0));
                return;
              }

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const selected = filteredRepoFiles[pathHighlightIndex];
                if (selected) {
                  insertSelectedPath(selected.path);
                }
                return;
              }

              if (e.key === "Escape") {
                e.preventDefault();
                setPathPickerOpen(false);
                setPathPickerMode(null);
                setPathQuery("");
                return;
              }
            }

            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Type… (/path to insert file, Alt+P to open picker)"
          className="w-full min-w-0 max-h-[220px] resize-none overflow-x-hidden overflow-y-auto rounded-md bg-transparent text-blue-200/100 placeholder:text-blue-200/100 outline-none whitespace-pre-wrap break-words"
          style={{ overflowWrap: "anywhere" }}
        />

        {pathPickerOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-full max-h-64 overflow-auto rounded-xl border border-white/10 bg-black/95 shadow-2xl z-20">
            {filteredRepoFiles.length > 0 ? (
              filteredRepoFiles.map((file, index) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => insertSelectedPath(file.path)}
                  className={`block w-full px-3 py-2 text-left text-sm transition ${
                    index === pathHighlightIndex
                      ? "bg-blue-500/20 text-blue-100"
                      : "bg-transparent text-white/80 hover:bg-white/10"
                  }`}
                >
                  {file.path}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-white/50">
                No matching files
              </div>
            )}
          </div>
        )}

        {!pathPickerOpen && (
          <div className="mt-2 text-[11px] text-blue-200/40">
            Type <span className="font-mono">/path</span> or press{" "}
            <span className="font-mono">Alt+P</span> to insert an exact repo file path
          </div>
        )}
      </div>

      <button
        onClick={submit}
        className="shrink-0 rounded-lg px-4 py-2 text-sm text-blue-200 border border-blue-500/40 bg-white/[0.04] hover:bg-white/[0.06] active:bg-white/[0.08] transition"
      >
        Send
      </button>
    </div>
  );
}