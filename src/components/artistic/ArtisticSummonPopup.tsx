"use client";

import type { Dispatch, SetStateAction } from "react";
import type { ScreenPoint } from "@/lib/artistic/types";

type ArtisticMessage = {
  role: "user" | "assistant";
  content: string;
};

type ArtisticSummonPopupProps = {
  artisticMenu: ScreenPoint | null;
  artisticPrompt: string;
  artisticMessages: ArtisticMessage[];
  artisticSending: boolean;
  artisticError: string | null;
  cardPreset: "glass" | "solid" | "obsidian";
  setArtisticMenu: Dispatch<SetStateAction<ScreenPoint | null>>;
  setArtisticPrompt: Dispatch<SetStateAction<string>>;
  setArtisticMessages: Dispatch<SetStateAction<ArtisticMessage[]>>;
  setArtisticError: Dispatch<SetStateAction<string | null>>;
  sendArtisticPrompt: () => Promise<void>;
};

export default function ArtisticSummonPopup({
  artisticMenu,
  artisticPrompt,
  artisticMessages,
  artisticSending,
  artisticError,
  cardPreset,
  setArtisticMenu,
  setArtisticPrompt,
  setArtisticMessages,
  setArtisticError,
  sendArtisticPrompt,
}: ArtisticSummonPopupProps) {
  if (!artisticMenu) return null;

  const popupPresetUi =
    cardPreset === "obsidian"
      ? {
          shell:
            "border border-blue-400/15 bg-[rgba(5,10,20,0.75)] text-white shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-2xl",
          label: "text-blue-100/55",
          close: "text-white/35 hover:bg-white/5 hover:text-white/70",
          userBubble: "bg-white/[0.05] text-white/72 border border-white/10",
          assistantBubble: "bg-blue-500/10 text-white/88 border border-blue-400/15",
          input:
            "border border-white/10 bg-white/[0.04] text-white/85 placeholder:text-white/30 focus:border-blue-400/35",
          meta: "text-white/35",
          sendIdle:
            "border-blue-400/20 bg-blue-500/10 text-blue-100 hover:bg-blue-500/15",
          sendDisabled:
            "border-white/10 bg-white/[0.04] text-white/25 cursor-not-allowed",
          error:
            "border border-rose-400/30 bg-rose-500/10 text-rose-200",
        }
            : cardPreset === "solid"
      ? {
          shell:
            "border border-black/10 bg-white/[0.72] text-black shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur-2xl",
          label: "text-black/45",
          close: "text-black/35 hover:bg-black/5 hover:text-black/70",
          userBubble: "bg-black/[0.04] text-black/70 border border-black/10",
          assistantBubble: "bg-white/[0.72] text-black/80 border border-black/10",
          input:
            "border border-black/10 bg-white/[0.65] text-black/80 placeholder:text-black/30 focus:border-blue-400/35",
          meta: "text-black/35",
          sendIdle:
            "border-blue-400/20 bg-blue-500/10 text-blue-900 hover:bg-blue-500/15",
          sendDisabled:
            "border-black/10 bg-black/[0.04] text-black/25 cursor-not-allowed",
          error:
            "border border-rose-300/40 bg-rose-50/80 text-rose-700",
        }
            : {
          shell:
            "border border-black/10 bg-white/[0.72] text-black shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur-2xl",
          label: "text-black/45",
          close: "text-black/35 hover:bg-black/5 hover:text-black/70",
          userBubble: "bg-black/[0.04] text-black/70 border border-black/10",
          assistantBubble: "bg-white/[0.72] text-black/80 border border-black/10",
          input:
            "border border-black/10 bg-white/[0.65] text-black/80 placeholder:text-black/30 focus:border-blue-400/35",
          meta: "text-black/35",
          sendIdle:
            "border-blue-400/20 bg-blue-500/10 text-blue-900 hover:bg-blue-500/15",
          sendDisabled:
            "border-black/10 bg-black/[0.04] text-black/25 cursor-not-allowed",
          error:
            "border border-rose-300/40 bg-rose-50/80 text-rose-700",
        };

  function closePopup() {
    setArtisticMenu(null);
    setArtisticPrompt("");
    setArtisticMessages([]);
    setArtisticError(null);
  }

  return (
    <div
      data-artistic-popup
      className={[
        "absolute z-[1200] w-[320px] rounded-2xl p-3",
        popupPresetUi.shell,
      ].join(" ")}
      style={{
        left: artisticMenu.x,
        top: artisticMenu.y,
        transform: "translate(8px, 8px)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className={`text-[11px] font-medium tracking-[0.18em] ${popupPresetUi.label}`}>
          VESTARYN
        </div>
        <button
          type="button"
          onClick={closePopup}
          className={`rounded-md px-2 py-1 text-xs ${popupPresetUi.close}`}
        >
          ✕
        </button>
      </div>

      {artisticMessages.length > 0 ? (
        <div
          id="artistic-scroll"
          className="mb-3 max-h-[260px] overflow-auto space-y-2"
        >
          {artisticMessages.map((m, i) => (
            <div
              key={i}
              className={[
                "rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user" ? popupPresetUi.userBubble : popupPresetUi.assistantBubble,
              ].join(" ")}
            >
              {m.content}
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        value={artisticPrompt}
        onChange={(e) => {
          setArtisticPrompt(e.target.value);
          if (artisticError) setArtisticError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendArtisticPrompt();
          }
        }}
        placeholder="Shape the chamber..."
        className={[
          "min-h-[110px] w-full resize-none rounded-xl px-3 py-3 text-sm outline-none",
          popupPresetUi.input,
        ].join(" ")}
      />

      {artisticError ? (
        <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${popupPresetUi.error}`}>
          {artisticError}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <div className={`text-[11px] ${popupPresetUi.meta}`}>
          Spatial ideation surface
        </div>

        <button
          type="button"
          onClick={() => void sendArtisticPrompt()}
          disabled={artisticSending || !artisticPrompt.trim()}
          className={[
            "rounded-xl border px-3 py-2 text-xs transition",
            artisticSending || !artisticPrompt.trim()
              ? popupPresetUi.sendDisabled
              : popupPresetUi.sendIdle,
          ].join(" ")}
        >
          {artisticSending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}