"use client";

import type { Dispatch, SetStateAction } from "react";

type ArtisticCanvasControlsProps = {
  canvasPreset: "soft" | "grid" | "obsidian";
  setCanvasPreset: Dispatch<SetStateAction<"soft" | "grid" | "obsidian">>;
  cardPreset: "glass" | "solid" | "obsidian";
  setCardPreset: Dispatch<SetStateAction<"glass" | "solid" | "obsidian">>;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetView: () => void;
  titleCase: (s: string) => string;
};

export default function ArtisticCanvasControls({
  canvasPreset,
  setCanvasPreset,
  cardPreset,
  setCardPreset,
  zoom,
  onZoomOut,
  onZoomIn,
  onResetView,
  titleCase,
}: ArtisticCanvasControlsProps) {
  return (
    <div className="relative z-[990] shrink-0 border-b border-blue-400/15 bg-[linear-gradient(to_right,rgba(5,10,18,0.96),rgba(9,16,28,0.92),rgba(5,10,18,0.96))] px-4 py-2 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/38">
            Canvas
          </div>

          <select
            value={canvasPreset}
            onChange={(e) =>
              setCanvasPreset(e.target.value as "soft" | "grid" | "obsidian")
            }
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/78 outline-none"
          >
            <option value="soft">Soft</option>
            <option value="grid">Grid</option>
            <option value="obsidian">Obsidian</option>
          </select>

          <div className="text-[10px] uppercase tracking-[0.22em] text-white/30">
            Cards
          </div>

          <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.06] p-1">
            {(["glass", "solid", "obsidian"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCardPreset(preset)}
                className={[
                  "rounded-md px-3 py-1.5 text-xs transition",
                  cardPreset === preset
                    ? "bg-blue-500/18 text-blue-100 border border-blue-400/25"
                    : "text-white/55 hover:text-white/85",
                ].join(" ")}
              >
                {titleCase(preset)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onZoomOut}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/78 hover:bg-white/[0.10]"
          >
            −
          </button>

          <div className="min-w-[64px] text-center text-xs font-medium text-white/60">
            {Math.round(zoom * 100)}%
          </div>

          <button
            type="button"
            onClick={onZoomIn}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/78 hover:bg-white/[0.10]"
          >
            +
          </button>

          <button
            type="button"
            onClick={onResetView}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/62 hover:bg-white/[0.10]"
          >
            Reset view
          </button>
        </div>
      </div>
    </div>
  );
}