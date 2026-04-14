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

function parseTextOutputBody(body: string) {
  const titleMatch = body.match(/TITLE:\s*(.*)/i);
  const bodyMatch = body.match(/BODY:\s*([\s\S]*)/i);

  return {
    title: titleMatch?.[1]?.trim() || "",
    body: bodyMatch?.[1]?.trim() || body.trim(),
  };
}

function parseEmailOutputBody(body: string) {
  const subjectMatch = body.match(/SUBJECT:\s*(.*)/i);

  // Everything after BODY: OR fallback to full text
  const bodyMatch = body.match(/BODY:\s*([\s\S]*)/i);

  const subject = subjectMatch?.[1]?.trim() || "";
  const message = bodyMatch?.[1]?.trim() || body.trim();

  return {
    subject,
    message,
  };
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

function stripPreviousPolish(raw: string) {
  return raw
    .replace(/^(Task\s*)+/i, "")
    .replace(
      /^Write a polished (short|medium|long) version of the following request:\s*/i,
      ""
    )
    .replace(/Output guidance[\s\S]*/i, "")
    .replace(/\n+\s*Make the intent clearer[\s\S]*/i, "")
    .replace(/\n+\s*Keep it concise and direct\.?\s*$/i, "")
    .replace(/\n+\s*Keep it balanced in detail and readability\.?\s*$/i, "")
    .replace(/\n+\s*Make it more detailed, richer, and longer\.?\s*$/i, "")
    .trim();
}

function polishPromptBody(
  raw: string,
  length: "short" | "medium" | "long"
) {
  const base = stripPreviousPolish(raw);

  if (!base) return raw;

  const lengthInstruction =
    length === "short"
      ? "Keep it concise and direct."
      : length === "long"
      ? "Make it more detailed, richer, and longer."
      : "Keep it balanced in detail and readability.";

  return `${base}\n\n${lengthInstruction}`;
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
      <div className="flex items-center gap-1.5">
        <span className="rounded-md border border-blue-400/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-blue-200/85">
          {card.outputKind === "text" ? "TEXT" : "PPT"}
        </span>

        {card.outputRole ? (
          <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-white/55">
            {card.outputRole}
          </span>
        ) : null}
      </div>
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
        {card.type === "bridge"
          ? `Bridge · ${card.title}`
          : isFrameCard
          ? `Frame · ${card.title}`
          : card.title}
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
        {card.type === "output" && card.outputKind === "text" && card.outputRole === "email" ? (
        (() => {
          const email = parseEmailOutputBody(card.body);

          return (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="h-full w-full rounded-xl border border-white/10 bg-white/[0.035] p-4"
            >
              {/* Subject */}
              {email.subject ? (
                <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                    Subject
                  </div>

                  <div className={`mt-1 text-base font-semibold leading-snug ${cardPresetUi.body}`}>
                    {email.subject}
                  </div>

                  {/* 👇 THIS is the new line */}
                  <div className="mt-1 text-xs text-white/40">
                    Draft email
                  </div>
                </div>
              ) : null}

              {/* Divider */}
              <div className="mb-3 h-px bg-white/10" />

              {/* Email Body */}
              <div
                className="h-[calc(100%-72px)] min-h-0 overflow-auto"
                onWheel={(e) => e.stopPropagation()}
              >
                <div 
                  className={`whitespace-pre-wrap text-[14px] leading-7 ${cardPresetUi.body}`}
                >
                  {email.message.split("\n").map((line, i) => (
                    <div key={i} className="mb-2">
                      {line || <div className="h-2" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()
      ) : card.type === "output" && card.outputKind === "text" ? (
  (() => {
    const parsed = parseTextOutputBody(card.body);

    return (
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="h-full w-full rounded-xl border border-white/10 bg-white/[0.04] p-3"
      >
        {parsed.title ? (
          <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">
              Title
            </div>
            <div className={`mt-1 text-base font-semibold leading-snug ${cardPresetUi.body}`}>
              {parsed.title}
            </div>
          </div>
        ) : null}

        <div
          className="h-[calc(100%-0px)] min-h-0 overflow-auto rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/35">
            Content
          </div>
          <div className={`whitespace-pre-wrap text-sm leading-6 ${cardPresetUi.body}`}>
            {parsed.body}
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
  <div className="flex h-full flex-col gap-3">
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
      onWheel={(e) => e.stopPropagation()}
      placeholder={
        isFrameCard
          ? "Frame surface..."
          : isNotesCard
          ? "Notes..."
          : "Write here..."
      }
      className={`min-h-0 flex-1 resize-none bg-transparent text-sm outline-none ${cardPresetUi.body}`}
    />

    {card.type === "prompt" ? (
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-2 py-2 backdrop-blur-sm"
      >
        <div className="text-[10px] uppercase tracking-[0.18em] text-black/45">
          Polish prompt
        </div>

        {(["short", "medium", "long"] as const).map((length) => (
          <button
            key={length}
            type="button"
            onClick={() => {
              const nextBody = polishPromptBody(card.body, length);
              commitCardBody(card.id, nextBody);
              setSelectedCardId(card.id);
              setFocusedBodyCardId(card.id);
            }}
            className="rounded-md border border-black/10 bg-white/80 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-black/65 transition hover:bg-white hover:text-black"
          >
            {length === "short" ? "Polish S" : length === "medium" ? "Polish M" : "Polish L"}
          </button>
        ))}
      </div>
    ) : null}
  </div>
)}
</div>



{(card.type === "prompt" || card.type === "bridge") && (
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

{(card.type === "output" || card.type === "bridge") && (
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