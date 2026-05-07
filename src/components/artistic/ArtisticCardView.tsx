"use client";

import {
  useMemo,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  ArtisticCard,
  ArtisticPptImageZone,
  CardPresetUi,
} from "@/lib/artistic/types";


type ArtisticCardViewProps = {
  card: ArtisticCard;
  artisticCards: ArtisticCard[];
  linkedImageCard?: ArtisticCard | null;
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
  isUpdating: boolean;
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
        pptImageX: number;
        pptImageY: number;
        pptImageW: number;
        pptImageH: number;
        pptImageZones: ArtisticPptImageZone[];
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
  artisticCards,
  linkedImageCard,
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
  isUpdating,
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

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

async function loadContextFile(file: File) {
  try {
    const text = await readFileAsText(file);

    setArtisticCards((prev) =>
      prev.map((c) =>
        c.id === card.id
          ? {
              ...c,
              contextFileName: file.name,
              contextText: text,
            }
          : c
      )
    );

    setShowFilePreview(true);
  } catch (err) {
    console.error(err);
  }
}

  function onResizePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (isPanning) return;
    if (card.type === "output" && card.outputKind === "powerpoint") return;

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
  const takeawayMatch = body.match(/TAKEAWAY:\s*(.*)/i);
  const visualMatch = body.match(/VISUAL:\s*(.*)/i);

  const bulletsSectionMatch = body.match(
  /BULLETS:\s*([\s\S]*?)(?:TAKEAWAY:|VISUAL:|$)/i
);

  const bullets =
    bulletsSectionMatch?.[1]
      ?.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-+\s*/, "").trim()) ?? [];

  function clampWords(value: string, maxWords: number) {
    const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);

    if (words.length <= maxWords) return String(value ?? "").trim();

    return `${words.slice(0, maxWords).join(" ")}...`;
  }

const cleanTitle = clampWords(titleMatch?.[1]?.trim() || card.title, 10);
const cleanHook = clampWords(hookMatch?.[1]?.trim() || "", 24);
const cleanBullets = bullets
  .map((bullet) => clampWords(bullet, 18))
  .slice(0, 4);
const cleanTakeaway = clampWords(takeawayMatch?.[1]?.trim() || "", 22);
const cleanVisual = clampWords(visualMatch?.[1]?.trim() || "", 18);

  return {
    title: cleanTitle,
    hook: cleanHook,
    bullets: cleanBullets,
    takeaway: cleanTakeaway,
    visual: cleanVisual,
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

const [isFileDragOver, setIsFileDragOver] = useState(false);
const [showFilePreview, setShowFilePreview] = useState(false);

const [pptImageDrag, setPptImageDrag] = useState<null | {
  imageCardId: string;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
}>(null);

function clampPptImagePlacement(next: {
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const slideW = Math.max(1, card.w - 24);
  const slideH = Math.max(1, card.h - 84);

  const minW = 120;
  const minH = 90;

  const w = Math.max(minW, Math.min(next.w, slideW));
  const h = Math.max(minH, Math.min(next.h, slideH));

  return {
    x: Math.max(0, Math.min(next.x, slideW - w)),
    y: Math.max(0, Math.min(next.y, slideH - h)),
    w,
    h,
  };
}

function getDefaultZoneForIndex(index: number): ArtisticPptImageZone {
  const defaultW = 300;
  const defaultH = 210;

  const columnX = Math.max(0, card.w - 24 - defaultW - 70);
  const firstY = 70;
  const gap = 18;

  return {
    imageCardId: "",
    x: columnX,
    y: firstY + index * (defaultH + gap),
    w: defaultW,
    h: defaultH,
  };
}

function getZoneForImage(imageCardId: string, index: number): ArtisticPptImageZone {
  const existing = card.pptImageZones?.find(
    (zone) => zone.imageCardId === imageCardId
  );

  if (existing) return existing;

  const fallback = getDefaultZoneForIndex(index);

  return {
    ...fallback,
    imageCardId,
  };
}

function upsertPptImageZone(nextZone: ArtisticPptImageZone) {
  const existing = card.pptImageZones ?? [];
  const withoutCurrent = existing.filter(
    (zone) => zone.imageCardId !== nextZone.imageCardId
  );

  updateCard(card.id, {
    pptImageZones: [...withoutCurrent, nextZone],
  });
}

function startPptImageMove(
  e: ReactPointerEvent<HTMLDivElement>,
  imageCardId: string,
  index: number
) {
  e.stopPropagation();
  e.preventDefault();

  const zone = getZoneForImage(imageCardId, index);

  setPptImageDrag({
    imageCardId,
    mode: "move",
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: zone.x,
    startY: zone.y,
    startW: zone.w,
    startH: zone.h,
  });
}

function startPptImageResize(
  e: ReactPointerEvent<HTMLButtonElement>,
  imageCardId: string,
  index: number
) {
  e.stopPropagation();
  e.preventDefault();

  const zone = getZoneForImage(imageCardId, index);

  setPptImageDrag({
    imageCardId,
    mode: "resize",
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: zone.x,
    startY: zone.y,
    startW: zone.w,
    startH: zone.h,
  });
}

function movePptImage(e: ReactPointerEvent<HTMLDivElement>) {
  if (!pptImageDrag) return;

  e.stopPropagation();
  e.preventDefault();

  const dx = e.clientX - pptImageDrag.startClientX;
  const dy = e.clientY - pptImageDrag.startClientY;

  const next =
    pptImageDrag.mode === "move"
      ? clampPptImagePlacement({
          x: pptImageDrag.startX + dx,
          y: pptImageDrag.startY + dy,
          w: pptImageDrag.startW,
          h: pptImageDrag.startH,
        })
      : clampPptImagePlacement({
          x: pptImageDrag.startX,
          y: pptImageDrag.startY,
          w: pptImageDrag.startW + dx,
          h: pptImageDrag.startH + dy,
        });

  upsertPptImageZone({
    imageCardId: pptImageDrag.imageCardId,
    x: next.x,
    y: next.y,
    w: next.w,
    h: next.h,
  });
}

function stopPptImageInteraction(e: ReactPointerEvent<HTMLDivElement>) {
  if (!pptImageDrag) return;

  e.stopPropagation();
  e.preventDefault();

  setPptImageDrag(null);
}

const filePreviewText = useMemo(() => {
  if (!card.contextText) return "";
  return card.contextText.split(/\r?\n/).slice(0, 10).join("\n");
}, [card.contextText]);

const linkedImageCards = useMemo(() => {
  const ids = Array.from(
    new Set([
      ...(card.linkedImageCardIds ?? []),
      ...(card.linkedImageCardId ? [card.linkedImageCardId] : []),
    ])
  );

  return ids
    .map((id) => artisticCards.find((candidate) => candidate.id === id) ?? null)
    .filter((candidate): candidate is ArtisticCard => {
      if (!candidate) return false;
      return candidate.type === "output" && candidate.outputKind === "image";
    });
}, [artisticCards, card.linkedImageCardId, card.linkedImageCardIds]);

  return (
    <div
      data-artistic-card
      onPointerDown={onCardPointerDown}
      onDragLeave={() => setIsFileDragOver(false)}
      onDrop={() => setIsFileDragOver(false)}
      className={[
        "absolute overflow-hidden backdrop-blur-xl transition-[box-shadow,border-color,background-color] duration-150",
        isFrameCard ? "rounded-[28px]" : "rounded-2xl",
        cardPresetUi.shell,
        isFrameCard ? "border-blue-400/20" : "",
        isUpdating
          ? "ring-2 ring-blue-400/40 shadow-[0_0_34px_rgba(96,165,250,0.32)] animate-pulse"
          : "",
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
          {card.outputKind === "text"
            ? "TEXT"
            : card.outputKind === "powerpoint"
            ? "PPT"
            : "IMAGE"}
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
                {email.subject ? (
                  <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                      Subject
                    </div>

                    <div className={`mt-1 text-base font-semibold leading-snug ${cardPresetUi.body}`}>
                      {email.subject}
                    </div>

                    <div className="mt-1 text-xs text-white/40">
                      Draft email
                    </div>
                  </div>
                ) : null}

                <div className="mb-3 h-px bg-white/10" />

                <div
                  className="h-[calc(100%-72px)] min-h-0 overflow-auto"
                  onWheel={(e) => e.stopPropagation()}
                >
                  <div className={`whitespace-pre-wrap text-[14px] leading-7 ${cardPresetUi.body}`}>
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
        ) : card.type === "output" && card.outputKind === "image" ? (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="flex h-full flex-col rounded-xl border border-black/10 bg-white p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-black/45">
                Image
              </div>

              <div className="flex items-center gap-2">
                {card.imageStatus === "error" ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();

                      window.dispatchEvent(
                        new CustomEvent("vestaryn:retry_artistic_output", {
                          detail: { outputId: card.id },
                        })
                      );
                    }}
                    className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-rose-600 hover:bg-rose-100"
                  >
                    Retry
                  </button>
                ) : null}



                  <div className="text-[11px] text-black/40">
                    {card.imageStatus === "generating"
                      ? "Generating..."
                      : card.imageStatus === "error"
                      ? "Error"
                      : card.imageStatus === "done"
                      ? "Ready"
                      : "Idle"}
                  </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-black/10 bg-white">
              {card.imageUrl ? (
                <img
                  src={card.imageUrl}
                  alt={card.title || "Generated image"}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : card.imageStatus === "generating" ? (
                <div className="relative flex h-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 to-slate-100 px-6 text-center">
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent blur-xl animate-[vestarynFlow_3s_linear_infinite]" />
                  </div>

                  <div className="absolute inset-0 bg-blue-200/10 animate-pulse" />

                  <div className="relative z-10 text-sm text-black/45">
                    Generating image preview...
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-black/45">
                  {card.imageStatus === "error"
                    ? "Image generation failed."
                    : "Awaiting connected prompt..."}
                </div>
              )}
            </div>
          </div>
        ) : card.type === "output" && card.outputKind === "powerpoint" ? (
          (() => {
            const ppt = parsePowerPointBody(card.body);
            const linkedImageCards = Array.from(
              new Set([
                ...(card.linkedImageCardIds ?? []),
                ...(card.linkedImageCardId ? [card.linkedImageCardId] : []),
              ])
            )
              .map((id) => artisticCards.find((candidate) => candidate.id === id) ?? null)
              .filter((candidate): candidate is ArtisticCard => {
                if (!candidate) return false;
                return candidate.type === "output" && candidate.outputKind === "image";
              });
            

            return (
                            <div
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={movePptImage}
                onPointerUp={stopPptImageInteraction}
                onPointerLeave={stopPptImageInteraction}
                className="h-full w-full overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-3"
                onWheel={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-black/35">
                    Slide preview
                  </div>

                  <div className="flex items-center gap-2">
                    {linkedImageCards.length > 0 ? (
                      <div className="rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-blue-600">
                        {linkedImageCards.length > 1
                          ? `${linkedImageCards.length} image zones linked`
                          : "Image zone linked"}
                      </div>
                    ) : null}

                    <div className="rounded-md border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-black/40">
                      16:9 · {Math.round(card.w)}×{Math.round(card.h)}
                    </div>
                  </div>
                </div>

                <div className="relative h-[calc(100%-28px)] overflow-hidden rounded-xl border border-black/10 bg-white">
                  <div className="absolute left-[44px] top-[56px] w-[52%]">
                    <div className="text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-black/82">
                      {ppt.title}
                    </div>

                    {ppt.hook ? (
                      <div className="mt-5 max-w-[560px] text-[15px] leading-7 text-black/58">
                        {ppt.hook}
                      </div>
                    ) : null}

                    {ppt.bullets.length > 0 ? (
                      <div className="mt-7 space-y-4">
                        {ppt.bullets.map((bullet, i) => (
                          <div key={i} className="flex gap-4 text-[13px] leading-6 text-black/70">
                            <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                            <span>{bullet}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {ppt.visual ? (
                      <div className="mt-7 max-w-[520px] rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-blue-500">
                          Takeaway
                        </div>
                        <div className="mt-2 text-[13px] leading-6 text-black/68">
                          {ppt.visual}
                        </div>
                      </div> 
                    ) : null}
                  </div>

                  {linkedImageCards.length > 0 ? (
                    <>
                      {linkedImageCards.slice(0, 4).map((imageCard, index) => {
                        const zone = getZoneForImage(imageCard.id, index);
                        const isDraggingThisZone = pptImageDrag?.imageCardId === imageCard.id;

                        return (
                          <div
                            key={imageCard.id}
                            onPointerDown={(e) => startPptImageMove(e, imageCard.id, index)}
                            className={[
                              "absolute cursor-move overflow-hidden rounded-2xl border bg-white shadow-[0_24px_70px_rgba(0,0,0,0.14)]",
                              isDraggingThisZone || isActive
                                ? "border-blue-300 ring-2 ring-blue-300/40"
                                : "border-black/10",
                            ].join(" ")}
                            style={{
                              left: zone.x,
                              top: zone.y,
                              width: zone.w,
                              height: zone.h,
                            }}
                          >
                            {imageCard.imageUrl ? (
                              <img
                                src={imageCard.imageUrl}
                                alt={imageCard.title || `Linked slide visual ${index + 1}`}
                                className="h-full w-full object-cover"
                                draggable={false}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center px-5 text-center text-[11px] leading-5 text-blue-500/75">
                                Linked image has no preview yet.
                              </div>
                            )}

                            <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-white/40 bg-white/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-black/45 backdrop-blur">
                              Image {index + 1}
                            </div>

                            <button
                              type="button"
                              data-card-resize-handle
                              onPointerDown={(e) => startPptImageResize(e, imageCard.id, index)}
                              className="absolute bottom-2 right-2 h-4 w-4 rounded-md border border-blue-300 bg-white/85 shadow-sm hover:bg-blue-50"
                              title="Resize slide image"
                            />
                          </div>
                        );
                      })}
                    </>
                  ) : null}
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
            {card.type === "bridge" && card.bridgeKind === "file_context" ? (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded-lg border border-black/10 bg-white/70 px-2 py-2 backdrop-blur-sm"
              >
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-black/45">
                  Source file
                </div>

                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsFileDragOver(true);
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsFileDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsFileDragOver(false);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsFileDragOver(false);

                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;

                    await loadContextFile(file);
                  }}
                  className={[
                    "flex min-h-[78px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-3 text-center transition",
                    isFileDragOver
                      ? "border-blue-400/50 bg-blue-500/10 text-blue-700"
                      : "border-black/15 bg-white/75 text-black/60 hover:bg-white hover:text-black",
                  ].join(" ")}
                >
                  <div className="text-[11px] font-medium">
                    {isFileDragOver ? "Drop file to load context" : "Drag & drop file here"}
                  </div>
                  <div className="mt-1 text-[10px] opacity-70">
                    or click to browse
                  </div>

                  <input
                    type="file"
                    className="hidden"
                    accept=".txt,.md,.csv,.json,.html"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      await loadContextFile(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                {card.contextText ? (
                  <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-medium text-emerald-700">
                          {card.contextFileName ?? "Unnamed file"}
                        </div>
                        <div className="mt-1 text-[10px] text-emerald-700/75">
                          {card.contextText.length.toLocaleString()} characters · Context loaded
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowFilePreview((v) => !v);
                        }}
                        className="shrink-0 rounded-md border border-emerald-600/20 bg-white/60 px-2 py-1 text-[10px] font-medium text-emerald-700 transition hover:bg-white/90"
                      >
                        {showFilePreview ? "Hide" : "Preview"}
                      </button>
                    </div>

                    {showFilePreview ? (
                      <div
                        onPointerDown={(e) => e.stopPropagation()}
                        onWheel={(e) => e.stopPropagation()}
                        className="mt-2 max-h-[140px] overflow-auto rounded-md border border-emerald-600/15 bg-white/55 px-2 py-2"
                      >
                        <pre className="whitespace-pre-wrap break-words text-[10px] leading-5 text-black/65">
                          {filePreviewText}
                          {card.contextText.split(/\r?\n/).length > 10 ? "\n..." : ""}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-black/35">
                    No file loaded yet
                  </div>
                )}
              </div>
            ) : null}

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

            {card.type === "bridge" && card.bridgeKind === "summary_bridge" ? (
  <div
    onPointerDown={(e) => e.stopPropagation()}
    className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/80 px-2 py-2 backdrop-blur-sm"
  >
    <div className="flex flex-col">
      <div className="text-[10px] uppercase tracking-[0.16em] text-blue-700/70">
        {card.summaryBridgeUnlocked ? "Gate unlocked" : "Gate locked"}
      </div>

      <div className="mt-0.5 text-[10px] text-blue-700/55">
        {card.summaryBridgeUnlocked
          ? "Downstream outputs may continue"
          : "Review and approve summary first"}
      </div>
    </div>

    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();

        const nextUnlocked = !card.summaryBridgeUnlocked;

        setArtisticCards((prev) =>
          prev.map((c) =>
            c.id === card.id
              ? {
                  ...c,
                  summaryBridgeUnlocked: nextUnlocked,
                }
              : c
          )
        );

        if (nextUnlocked) {
          window.dispatchEvent(
            new CustomEvent("vestaryn:continue_artistic_flow", {
              detail: { bridgeId: card.id },
            })
          );
        }
      }}
      className={[
        "rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] transition",
        card.summaryBridgeUnlocked
          ? "border border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          : "border border-blue-300/80 bg-white/80 text-blue-700 hover:bg-white hover:text-blue-900",
      ].join(" ")}
    >
      {card.summaryBridgeUnlocked ? "Lock Gate" : "Unlock & Continue"}
    </button>
  </div>
) : null}

            {card.type === "prompt" ? (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-2 py-2 backdrop-blur-sm">
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
                      {length === "short"
                        ? "Polish S"
                        : length === "medium"
                        ? "Polish M"
                        : "Polish L"}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/80 px-2 py-2 backdrop-blur-sm">
                  <div className="flex flex-col">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-blue-700/70">
                      {card.promptGateUnlocked ? "Prompt gate unlocked" : "Prompt gate locked"}
                    </div>

                    <div className="mt-0.5 text-[10px] text-blue-700/55">
                      {card.promptGateUnlocked
                        ? "Connected image outputs may run"
                        : "Review prompt before image flow"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();

                      const nextUnlocked = !card.promptGateUnlocked;

                      setArtisticCards((prev) =>
                        prev.map((c) =>
                          c.id === card.id
                            ? {
                                ...c,
                                promptGateUnlocked: nextUnlocked,
                              }
                            : c
                        )
                      );

                      if (nextUnlocked) {
                        window.dispatchEvent(
                          new CustomEvent("vestaryn:continue_artistic_flow", {
                            detail: { promptId: card.id },
                          })
                        );
                      }
                    }}
                    className={[
                      "rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] transition",
                      card.promptGateUnlocked
                        ? "border border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                        : "border border-blue-300/80 bg-white/80 text-blue-700 hover:bg-white hover:text-blue-900",
                    ].join(" ")}
                  >
                    {card.promptGateUnlocked ? "Lock Gate" : "Unlock & Run"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>



{(card.type === "prompt" ||
  card.type === "bridge" ||
  (card.type === "output" && card.outputKind === "image")) && (
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

      {!(card.type === "output" && card.outputKind === "powerpoint") ? (
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
      ) : null}
    </div>
  );
}