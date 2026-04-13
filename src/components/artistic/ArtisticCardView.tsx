"use client";

import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ArtisticCard, CardPresetUi } from "@/lib/artistic/types";

type ArtisticCardViewProps = {
  card: ArtisticCard;
  isActive: boolean;
  isPanning: boolean;
  isDragging: boolean;
  isResizing: boolean;
  isEditingTitle: boolean;
  isFrameCard: boolean;
  isNotesCard: boolean;
  isConnectionTargetHovered: boolean;
  cardPresetUi: CardPresetUi;
  isConnectionPulseActive: boolean;
  viewportPointToWorld: (
    clientX: number,
    clientY: number
  ) => { x: number; y: number };
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  setDraggingCardId: Dispatch<SetStateAction<string | null>>;
selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  multiDragStartPositionsRef: RefObject<Record<string, { x: number; y: number }>>;
  setResizingCardId: Dispatch<SetStateAction<string | null>>;
  setEditingCardId: Dispatch<SetStateAction<string | null>>;
  setFocusedBodyCardId: Dispatch<SetStateAction<string | null>>;
  setArtisticCards: Dispatch<SetStateAction<ArtisticCard[]>>;
  onStartConnection: (card: ArtisticCard) => void;
    onStartCardDrag: (
    e: ReactPointerEvent<HTMLDivElement>,
    card: ArtisticCard
  ) => void;
  updateCard: (
    cardId: string,
    patch: Partial<{
      title: string;
      body: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>
  ) => void;
  commitCardTitle: (cardId: string, title: string) => void;
  commitCardBody: (cardId: string, body: string) => void;
  cardDragOffsetRef: RefObject<{ x: number; y: number }>;
  resizeStartRef: RefObject<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>;
};

export default function ArtisticCardView({
  card,
  isActive,
  isPanning,
  isDragging,
  isResizing,
  isEditingTitle,
  isFrameCard,
  isNotesCard,
  isConnectionTargetHovered,
  cardPresetUi,
  viewportPointToWorld,
  setSelectedCardId,
  setDraggingCardId,
  selectedCardIds,
  setSelectedCardIds,
  multiDragStartPositionsRef,
  setResizingCardId,
  setEditingCardId,
  setFocusedBodyCardId,
  setArtisticCards,
  updateCard,
  commitCardTitle,
  commitCardBody,
  onStartCardDrag,
  cardDragOffsetRef,
  resizeStartRef,
  onStartConnection,
  isConnectionPulseActive,
}: ArtisticCardViewProps) {
   function onCardPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (isPanning || isResizing) return;

    const target = e.target as HTMLElement;
    if (target.closest("[data-card-resize-handle]")) return;
    if (target.closest("input")) return;
    if (target.closest("textarea")) return;

    e.stopPropagation();
    e.preventDefault();

    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    const worldPoint = viewportPointToWorld(e.clientX, e.clientY);

    if (cardDragOffsetRef.current) {
      cardDragOffsetRef.current = {
        x: worldPoint.x - card.x,
        y: worldPoint.y - card.y,
      };
    }

        onStartCardDrag(e, card);
  }

  function onResizePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (isPanning) return;

    e.stopPropagation();
    e.preventDefault();

    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    const worldPoint = viewportPointToWorld(e.clientX, e.clientY);

    resizeStartRef.current = {
      startX: worldPoint.x,
      startY: worldPoint.y,
      startW: card.w,
      startH: card.h,
    };

    setSelectedCardId(card.id);
    setResizingCardId(card.id);
  }

  function parsePowerPointBody(body: string) {
  const titleMatch = body.match(/TITLE:\s*(.*)/i);
  const hookMatch = body.match(/HOOK:\s*(.*)/i);
  const visualMatch = body.match(/VISUAL:\s*(.*)/i);

  const bulletsSectionMatch = body.match(/BULLETS:\s*([\s\S]*?)(?:VISUAL:|$)/i);

  const bullets =
    bulletsSectionMatch?.[1]
      ?.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-+\s*/, "").trim()) ?? [];

  return {
    title: titleMatch?.[1]?.trim() || card.title,
    hook: hookMatch?.[1]?.trim() || "",
    bullets,
    visual: visualMatch?.[1]?.trim() || "",
    raw: body,
  };
}

  return (
    <div
      data-artistic-card
      onPointerDown={onCardPointerDown}
      className={[
        "absolute overflow-hidden backdrop-blur-xl transition-[box-shadow,border-color,background-color] duration-150",
        isFrameCard ? "rounded-[28px]" : "rounded-2xl",
        cardPresetUi.shell,
        isFrameCard ? "border-blue-400/20" : "",
        isActive ? "z-[980]" : "z-[850]",
        isResizing
          ? "cursor-se-resize"
          : isDragging
            ? "cursor-grabbing"
            : "cursor-move",
      ].join(" ")}
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
      }}
    >
<div
  className={[
    "flex items-center justify-between px-3 py-2 transition-colors duration-150",
    cardPresetUi.header,
  ].join(" ")}
>
  <div className="flex min-w-0 items-center gap-2">
    {card.type === "output" && card.outputKind && (
      <span className="rounded-md border border-blue-400/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-blue-200/85">
        {card.outputKind === "text" ? "TEXT" : "PPT"}
      </span>
    )}

    {isEditingTitle ? (
      <input
        autoFocus
        spellCheck={false}
        value={card.title}
        onFocus={(e) => {
          setSelectedCardId(card.id);
          e.target.select();
        }}
        onChange={(e) => updateCard(card.id, { title: e.target.value })}
        onBlur={() => {
          commitCardTitle(card.id, card.title);
          setEditingCardId(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitCardTitle(card.id, card.title);
            setEditingCardId(null);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditingCardId(null);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={`w-full rounded-md border border-black/10 bg-white/80 px-2 py-1 text-[11px] font-medium tracking-[0.12em] outline-none ${cardPresetUi.input}`}
      />
    ) : (
      <button
        type="button"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setSelectedCardId(card.id);
          setEditingCardId(card.id);
        }}
        className={`min-w-0 flex-1 truncate text-left text-[11px] font-medium tracking-[0.16em] cursor-text ${cardPresetUi.title}`}
      >
        {isFrameCard ? `Frame · ${card.title}` : card.title}
      </button>
    )}
  </div>

  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      setArtisticCards((prev) => prev.filter((c) => c.id !== card.id));
      setEditingCardId((prev) => (prev === card.id ? null : prev));
      setFocusedBodyCardId((prev) => (prev === card.id ? null : prev));
      setSelectedCardId((prev) => (prev === card.id ? null : prev));
    }}
    className="ml-2 rounded-md px-2 py-1 text-[11px] text-black/35 hover:bg-black/5 hover:text-black/65"
  >
    ✕
  </button>
</div>

      <div className="h-[calc(100%-41px)] p-3">
  {card.type === "output" && card.outputKind === "powerpoint" ? (
    (() => {
      const ppt = parsePowerPointBody(card.body);

      return (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="h-full w-full rounded-xl border border-white/10 bg-white/[0.04] p-3"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
              16:9 Slide
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/30">
              1920×1080 target
            </div>
          </div>

          <div className="flex h-[calc(100%-28px)] min-h-0 flex-col">
            <div className="mb-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                Title
              </div>
              <div className={`mt-1 text-lg font-semibold leading-snug ${cardPresetUi.body}`}>
                {ppt.title}
              </div>

              {ppt.hook ? (
                <div className="mt-2 text-sm leading-6 text-white/60">
                  {ppt.hook}
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/35">
                Slide Content
              </div>

              {ppt.bullets.length > 0 ? (
                <ul className={`space-y-2 text-sm leading-6 ${cardPresetUi.body}`}>
                  {ppt.bullets.map((bullet, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="mt-[2px] text-blue-300/70">•</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div
                  className={`h-[calc(100%-24px)] overflow-auto whitespace-pre-wrap text-sm leading-6 ${cardPresetUi.body}`}
                >
                  {ppt.raw}
                </div>
              )}

              {ppt.visual ? (
                <div className="mt-4 rounded-lg border border-blue-400/15 bg-blue-500/[0.04] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-blue-200/40">
                    Visual Direction
                  </div>
                  <div className="mt-1 text-sm leading-6 text-white/65">
                    {ppt.visual}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      );
    })()
  ) : card.type === "output" ? (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className={`h-full w-full overflow-auto whitespace-pre-wrap text-sm leading-7 ${cardPresetUi.body}`}
    >
      {card.body}
    </div>
  ) : (
    <textarea
      spellCheck={false}
      value={card.body}
      onFocus={() => {
        setSelectedCardId(card.id);
        setFocusedBodyCardId(card.id);
      }}
      onBlur={() => {
        setFocusedBodyCardId((prev) => (prev === card.id ? null : prev));
      }}
      onChange={(e) => commitCardBody(card.id, e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      placeholder={
        isFrameCard
          ? "Frame surface..."
          : isNotesCard
          ? "Notes..."
          : "Write here..."
      }
      className={`h-full w-full resize-none bg-transparent text-sm outline-none ${cardPresetUi.body}`}
    />
  )}
</div>



{card.type === "prompt" && (
  <button
    type="button"
    onPointerDown={(e) => {
      e.stopPropagation();
      e.preventDefault();
      onStartConnection(card);
    }}
    className="absolute right-[-6px] top-1/2 z-[990] h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.85)] transition hover:scale-125"
    title="Start connection"
  />
)}

{card.type === "output" && (
  <div
    className={[
      "absolute left-[-6px] top-1/2 z-[990] h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-blue-400 transition duration-150",
      isConnectionPulseActive
        ? "scale-175 shadow-[0_0_26px_rgba(96,165,250,1)]"
        : isConnectionTargetHovered
        ? "scale-150 shadow-[0_0_18px_rgba(96,165,250,1)]"
        : "shadow-[0_0_10px_rgba(96,165,250,0.85)]",
    ].join(" ")}
    title="Input"
  />
)}

      <button
        type="button"
        data-card-resize-handle
        onPointerDown={onResizePointerDown}
        className={[
          "absolute bottom-2 right-2 z-[980] flex h-5 w-5 items-center justify-center rounded-md bg-white/80 transition hover:bg-white cursor-se-resize",
          isActive
            ? "border border-blue-400/30 shadow-[0_0_14px_rgba(96,165,250,0.14)]"
            : "border border-black/10 shadow-sm",
        ].join(" ")}
        title="Resize card"
      >
        <div className="h-2.5 w-2.5 rounded-[2px] border-r border-b border-black/35" />
      </button>
    </div>
  );
}