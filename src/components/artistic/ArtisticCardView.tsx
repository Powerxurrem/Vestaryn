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
  cardPresetUi: CardPresetUi;
  viewportPointToWorld: (
    clientX: number,
    clientY: number
  ) => { x: number; y: number };
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  setDraggingCardId: Dispatch<SetStateAction<string | null>>;
  setResizingCardId: Dispatch<SetStateAction<string | null>>;
  setEditingCardId: Dispatch<SetStateAction<string | null>>;
  setFocusedBodyCardId: Dispatch<SetStateAction<string | null>>;
  setArtisticCards: Dispatch<SetStateAction<ArtisticCard[]>>;
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
  cardPresetUi,
  viewportPointToWorld,
  setSelectedCardId,
  setDraggingCardId,
  setResizingCardId,
  setEditingCardId,
  setFocusedBodyCardId,
  setArtisticCards,
  updateCard,
  commitCardTitle,
  commitCardBody,
  cardDragOffsetRef,
  resizeStartRef,
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

    setSelectedCardId(card.id);
    setDraggingCardId(card.id);
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
      </div>

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