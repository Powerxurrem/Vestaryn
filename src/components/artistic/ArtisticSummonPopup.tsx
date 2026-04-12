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
  setArtisticMenu,
  setArtisticPrompt,
  setArtisticMessages,
  setArtisticError,
  sendArtisticPrompt,
}: ArtisticSummonPopupProps) {
  if (!artisticMenu) return null;

  function closePopup() {
    setArtisticMenu(null);
    setArtisticPrompt("");
    setArtisticMessages([]);
    setArtisticError(null);
  }

  return (
    <div
      data-artistic-popup
      className="absolute z-[1200] w-[320px] rounded-2xl border border-black/10 bg-white/75 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl"
      style={{
        left: artisticMenu.x,
        top: artisticMenu.y,
        transform: "translate(8px, 8px)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-medium tracking-[0.18em] text-black/50">
          VESTARYN
        </div>
        <button
          type="button"
          onClick={closePopup}
          className="rounded-md px-2 py-1 text-xs text-black/40 hover:bg-black/5 hover:text-black/70"
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
                m.role === "user"
                  ? "bg-black/5 text-black/70"
                  : "bg-white/70 text-black/80 border border-black/10",
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
        className="min-h-[110px] w-full resize-none rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-black/80 outline-none placeholder:text-black/30 focus:border-blue-400/40"
      />

      {artisticError ? (
        <div className="mt-3 rounded-xl border border-rose-300/40 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
          {artisticError}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <div className="text-[11px] text-black/35">
          Spatial ideation surface
        </div>

        <button
          type="button"
          onClick={() => void sendArtisticPrompt()}
          disabled={artisticSending || !artisticPrompt.trim()}
          className={[
            "rounded-xl border px-3 py-2 text-xs transition",
            artisticSending || !artisticPrompt.trim()
              ? "border-black/10 bg-black/5 text-black/25 cursor-not-allowed"
              : "border-blue-400/20 bg-blue-500/10 text-blue-900 hover:bg-blue-500/15",
          ].join(" ")}
        >
          {artisticSending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}