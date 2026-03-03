"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  repoId: string;
  left: React.ReactNode;  // Explorer
  right: React.ReactNode; // Editor
};

const keyFor = (repoId: string) => `vestaryn:ideSplit:${repoId}`;

export default function IdeSplit({ repoId, left, right }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // px width of explorer
  const [leftW, setLeftW] = useState(320);

  // hydrate saved width
  useEffect(() => {
    if (!repoId) return;
    try {
      const raw = localStorage.getItem(keyFor(repoId));
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n >= 220 && n <= 700) setLeftW(n);
    } catch {}
  }, [repoId]);

  // persist
  useEffect(() => {
    if (!repoId) return;
    try {
      localStorage.setItem(keyFor(repoId), String(leftW));
    } catch {}
  }, [repoId, leftW]);

  function onPointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left; // px inside container

    // clamp explorer width
    const min = 240;
    const max = Math.min(720, rect.width - 320); // ensure editor has room
    const clamped = Math.max(min, Math.min(max, Math.round(x)));

    setLeftW(clamped);
  }

  function onPointerUp() {
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  return (
    <div ref={containerRef} className="flex w-full h-[70vh] min-w-0">
      {/* Explorer */}
      <div style={{ width: leftW }} className="min-w-0 shrink-0">
        {left}
      </div>

      {/* Drag handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="group relative w-2 cursor-col-resize select-none"
        title="Drag to resize"
      >
        {/* thin line */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-white/10 group-hover:bg-blue-400/50" />
        {/* bigger hitbox without visual bulk */}
        <div className="absolute inset-y-0 left-0 right-0" />
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0">
        {right}
      </div>
    </div>
  );
}