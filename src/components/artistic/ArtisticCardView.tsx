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
  ArtisticBookImageZone,
  ArtisticBookTextZone,
  ArtisticCard,
  ArtisticPptImageZone,
  CardPresetUi,
} from "@/lib/artistic/types";

type ArtisticCardViewProps = {
  repoId: string;
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
    imageMode:
      | "presentation_visual"
      | "book_background"
      | "book_character"
      | "print_illustration";
    pptImageX: number;
    pptImageY: number;
    pptImageW: number;
    pptImageH: number;
    pptImageZones: ArtisticPptImageZone[];
    bookImageZones: ArtisticBookImageZone[];
    bookTextZone: ArtisticBookTextZone;
    promptIntent: ArtisticCard["promptIntent"];
    textStyleSettings: ArtisticCard["textStyleSettings"];
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
  repoId,
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
    if (target.closest("[data-card-no-drag]")) return;
    if (target.closest("input")) return;
    if (target.closest("textarea")) return;
    if (target.closest("select")) return;
    if (target.closest("button")) return;

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

async function persistProcessedImageAsset(dataUrl: string) {
  const res = await fetch(`/api/repo/${repoId}/artistic-assets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dataUrl,
      kind: "processed",
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.storagePath || !data?.signedUrl) {
    throw new Error(
      data?.error || `Processed asset upload failed (${res.status})`
    );
  }

  return {
    storagePath: String(data.storagePath),
    signedUrl: String(data.signedUrl),
  };
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

const [bookImageDrag, setBookImageDrag] = useState<null | {
  visualCardId: string;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
}>(null);

const [bookTextDrag, setBookTextDrag] = useState<null | {
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

function getBookPageCompositionSize() {
  const pageW = Math.max(1, card.w - 24);
  const pageH = Math.max(1, card.h - 84);

  return {
    w: pageW,
    h: pageH,
  };
}

function clampBookImagePlacement<T extends {
  x: number;
  y: number;
  w: number;
  h: number;
}>(next: T): T {
  const page = getBookPageCompositionSize();

  const minW = 70;
  const minH = 70;

  const w = Math.max(minW, Math.min(next.w, page.w));
  const h = Math.max(minH, Math.min(next.h, page.h));

  return {
    ...next,
    x: Math.max(0, Math.min(next.x, page.w - w)),
    y: Math.max(0, Math.min(next.y, page.h - h)),
    w,
    h,
  };
}

function getDefaultBookZoneForVisual(
  visualCard: ReturnType<typeof resolveVisualSource>,
  index: number
): ArtisticBookImageZone {
  const page = getBookPageCompositionSize();

  if (visualCard.imageMode === "book_background") {
    return {
      visualCardId: visualCard.id,
      x: 0,
      y: 0,
      w: page.w,
      h: page.h,
      role: "background",
      objectFit: "cover",
    };
  }

  if (visualCard.imageMode === "book_character") {
    const w = Math.min(page.w * 0.24, 150);
    const h = Math.min(page.h * 0.34, 240);

    return {
      visualCardId: visualCard.id,
      x: page.w * 0.46 + index * 18,
      y: page.h * 0.62,
      w,
      h,
      role: "character",
      objectFit: "contain",
    };
  }

  const w = Math.min(page.w * 0.56, 320);
  const h = Math.min(page.h * 0.42, 240);

  return {
    visualCardId: visualCard.id,
    x: page.w * 0.22 + index * 24,
    y: page.h * 0.42 + index * 18,
    w,
    h,
    role: "overlay",
    objectFit: "cover",
  };
}

function getBookZoneForVisual(
  visualCard: ReturnType<typeof resolveVisualSource>,
  index: number
): ArtisticBookImageZone {
  const defaultZone = getDefaultBookZoneForVisual(visualCard, index);

  const existing = card.bookImageZones?.find(
    (zone) => zone.visualCardId === visualCard.id
  );

  if (!existing) {
    return clampBookImagePlacement(defaultZone);
  }

  const shouldForceCharacter =
    visualCard.imageMode === "book_character" ||
    defaultZone.role === "character";

  return clampBookImagePlacement({
    ...defaultZone,
    ...existing,
    role: shouldForceCharacter ? "character" : existing.role ?? defaultZone.role,
    objectFit: shouldForceCharacter
      ? "contain"
      : existing.objectFit ?? defaultZone.objectFit,
  });
}

function upsertBookImageZone(nextZone: ArtisticBookImageZone) {
  const existing = card.bookImageZones ?? [];
  const withoutCurrent = existing.filter(
    (zone) => zone.visualCardId !== nextZone.visualCardId
  );

  updateCard(card.id, {
    bookImageZones: [...withoutCurrent, nextZone],
  });
}

function startBookImageMove(
  e: ReactPointerEvent<HTMLDivElement>,
  visualCardId: string,
  zone: ArtisticBookImageZone
) {
  e.stopPropagation();
  e.preventDefault();

  setBookImageDrag({
    visualCardId,
    mode: "move",
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: zone.x,
    startY: zone.y,
    startW: zone.w,
    startH: zone.h,
  });
}

function startBookImageResize(
  e: ReactPointerEvent<HTMLButtonElement>,
  visualCardId: string,
  zone: ArtisticBookImageZone
) {
  e.stopPropagation();
  e.preventDefault();

  setBookImageDrag({
    visualCardId,
    mode: "resize",
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: zone.x,
    startY: zone.y,
    startW: zone.w,
    startH: zone.h,
  });
}

function moveBookImage(e: ReactPointerEvent<HTMLDivElement>) {
  if (!bookImageDrag) return;

  e.stopPropagation();
  e.preventDefault();

  const dx = e.clientX - bookImageDrag.startClientX;
  const dy = e.clientY - bookImageDrag.startClientY;

  const next =
    bookImageDrag.mode === "move"
      ? clampBookImagePlacement({
          x: bookImageDrag.startX + dx,
          y: bookImageDrag.startY + dy,
          w: bookImageDrag.startW,
          h: bookImageDrag.startH,
        })
      : clampBookImagePlacement({
          x: bookImageDrag.startX,
          y: bookImageDrag.startY,
          w: bookImageDrag.startW + dx,
          h: bookImageDrag.startH + dy,
        });

  const currentZone = card.bookImageZones?.find(
    (zone) => zone.visualCardId === bookImageDrag.visualCardId
  );

  upsertBookImageZone({
    visualCardId: bookImageDrag.visualCardId,
    x: next.x,
    y: next.y,
    w: next.w,
    h: next.h,
    role: currentZone?.role,
    objectFit: currentZone?.objectFit ?? "cover",
  });
}

function stopBookImageInteraction(e: ReactPointerEvent<HTMLDivElement>) {
  if (!bookImageDrag) return;

  e.stopPropagation();
  e.preventDefault();

  setBookImageDrag(null);
}

function clampBookTextZone(next: ArtisticBookTextZone): ArtisticBookTextZone {
  const page = getBookPageCompositionSize();

  const minW = 120;
  const minH = 54;

  const w = Math.max(minW, Math.min(next.w, page.w));
  const h = Math.max(minH, Math.min(next.h, page.h));

  return {
    ...next,
    x: Math.max(0, Math.min(next.x, page.w - w)),
    y: Math.max(0, Math.min(next.y, page.h - h)),
    w,
    h,
  };
}

function getDefaultBookTextZone(): ArtisticBookTextZone {
  const page = getBookPageCompositionSize();

  return {
    x: page.w * 0.08,
    y: page.h * 0.08,
    w: page.w * 0.84,
    h: Math.max(72, page.h * 0.14),
    fontSize: card.bookPageRatio === "landscape" ? 16 : 15,
    fontFamily: "storybook",
    align: "left",
    color: "#2f2418",
    background: "soft_panel",
  };
}

function getBookTextZone(): ArtisticBookTextZone {
  return clampBookTextZone(card.bookTextZone ?? getDefaultBookTextZone());
}

function updateBookTextZone(patch: Partial<ArtisticBookTextZone>) {
  updateCard(card.id, {
    bookTextZone: clampBookTextZone({
      ...getBookTextZone(),
      ...patch,
    }),
  });
}

function startBookTextMove(
  e: ReactPointerEvent<HTMLDivElement>,
  zone: ArtisticBookTextZone
) {
  e.stopPropagation();
  e.preventDefault();

  setBookTextDrag({
    mode: "move",
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: zone.x,
    startY: zone.y,
    startW: zone.w,
    startH: zone.h,
  });
}

function startBookTextResize(
  e: ReactPointerEvent<HTMLButtonElement>,
  zone: ArtisticBookTextZone
) {
  e.stopPropagation();
  e.preventDefault();

  setBookTextDrag({
    mode: "resize",
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: zone.x,
    startY: zone.y,
    startW: zone.w,
    startH: zone.h,
  });
}

function moveBookText(e: ReactPointerEvent<HTMLDivElement>) {
  if (!bookTextDrag) return;

  e.stopPropagation();
  e.preventDefault();

  const dx = e.clientX - bookTextDrag.startClientX;
  const dy = e.clientY - bookTextDrag.startClientY;

  const next =
    bookTextDrag.mode === "move"
      ? {
          ...getBookTextZone(),
          x: bookTextDrag.startX + dx,
          y: bookTextDrag.startY + dy,
          w: bookTextDrag.startW,
          h: bookTextDrag.startH,
        }
      : {
          ...getBookTextZone(),
          x: bookTextDrag.startX,
          y: bookTextDrag.startY,
          w: bookTextDrag.startW + dx,
          h: bookTextDrag.startH + dy,
        };

  updateCard(card.id, {
    bookTextZone: clampBookTextZone(next),
  });
}

function stopBookTextInteraction(e: ReactPointerEvent<HTMLDivElement>) {
  if (!bookTextDrag) return;

  e.stopPropagation();
  e.preventDefault();

  setBookTextDrag(null);
}

function getBookFontFamilyClass(
  fontFamily?:
    | ArtisticBookTextZone["fontFamily"]
    | NonNullable<ArtisticCard["textStyleSettings"]>["fontFamily"]
) {
  switch (fontFamily) {
    case "serif":
      return "font-serif";
    case "sans":
      return "font-sans";
    case "handwritten":
      return "font-serif italic";
    case "display":
      return "font-serif tracking-wide";
    case "storybook":
    default:
      return "font-serif";
  }
}

function getTextStyleInputCard() {
  if (card.type !== "bridge" || card.bridgeKind !== "text_style_processor") {
    return null;
  }

  const sourceId = card.inputTextCardId ?? card.upstreamCardId;
  if (!sourceId) return null;

  return artisticCards.find((candidate) => candidate.id === sourceId) ?? null;
}

function updateTextStyleSettings(
  patch: Partial<NonNullable<ArtisticCard["textStyleSettings"]>>
) {
  updateCard(card.id, {
    textStyleSettings: {
      fontFamily: "storybook",
      fontSize: 24,
      color: "#2f2418",
      opacity: 100,
      rotation: 0,
      letterSpacing: 0,
      lineHeight: 1.15,
      textShadow: "soft",
      textOutline: "none",
      fontWeight: "semibold",
      ...(card.textStyleSettings ?? {}),
      ...patch,
    },
  });
}

function cycleTextStyleValue<T extends string>(
  current: T | undefined,
  values: readonly T[],
  fallback: T
) {
  const active = current ?? fallback;
  const index = values.indexOf(active);
  return values[(index + 1) % values.length] ?? fallback;
}

function getBookTextPanelClass(background?: ArtisticBookTextZone["background"]) {
  switch (background) {
    case "none":
      return "border-transparent bg-transparent shadow-none backdrop-blur-0";
    case "paper_panel":
      return "border-amber-200/80 bg-[#fff7df]/78 shadow-sm backdrop-blur-sm";
    case "soft_panel":
    default:
      return "border-amber-200/80 bg-white/55 shadow-sm backdrop-blur-sm";
  }
}

function getBookTextShadowStyle(
  shadow?: ArtisticCard["textStyleSettings"] extends infer T
    ? T extends { textShadow?: infer S }
      ? S
      : never
    : never
) {
  switch (shadow) {
    case "soft":
      return "0 2px 8px rgba(0,0,0,0.22)";
    case "strong":
      return "0 3px 12px rgba(0,0,0,0.42)";
    case "glow":
      return "0 0 10px rgba(255,255,255,0.72), 0 2px 10px rgba(0,0,0,0.18)";
    case "none":
    default:
      return undefined;
  }
}

function getBookTextOutlineStyle(
  outline?: ArtisticCard["textStyleSettings"] extends infer T
    ? T extends { textOutline?: infer S }
      ? S
      : never
    : never
) {
  switch (outline) {
    case "light":
      return "0 0 1px rgba(255,255,255,0.95), 0 0 2px rgba(255,255,255,0.85)";
    case "dark":
      return "0 0 1px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.75)";
    case "none":
    default:
      return undefined;
  }
}

function getBookTextWeightClass(
  fontWeight?: ArtisticCard["textStyleSettings"] extends infer T
    ? T extends { fontWeight?: infer W }
      ? W
      : never
    : never
) {
  switch (fontWeight) {
    case "normal":
      return "font-normal";
    case "medium":
      return "font-medium";
    case "semibold":
      return "font-semibold";
    case "bold":
      return "font-bold";
    default:
      return "font-medium";
  }
}

function getBookVisualZoneClass(zone: ArtisticBookImageZone) {
  if (zone.role === "background") {
    return "absolute overflow-hidden border-transparent bg-transparent rounded-none";
  }

  if (zone.role === "character") {
    return "absolute overflow-visible border-transparent bg-transparent shadow-none";
  }

  return "absolute overflow-hidden rounded-2xl border border-white/45 bg-white/70 shadow-[0_18px_50px_rgba(0,0,0,0.14)]";
}

const filePreviewText = useMemo(() => {
  if (!card.contextText) return "";
  return card.contextText.split(/\r?\n/).slice(0, 10).join("\n");
}, [card.contextText]);

function resolveVisualSource(cardOrProcessor: ArtisticCard) {
  if (
    cardOrProcessor.type === "bridge" &&
    cardOrProcessor.bridgeKind === "image_processor"
  ) {
    const inputImage = cardOrProcessor.inputImageCardId
      ? artisticCards.find(
          (candidate) => candidate.id === cardOrProcessor.inputImageCardId
        )
      : null;

    const adjustments = cardOrProcessor.processorAdjustments ?? {
      saturation: 100,
      brightness: 100,
      contrast: 100,
    };

    return {
      id: cardOrProcessor.id,
      title: cardOrProcessor.title || "Processed image",
      imageMode: inputImage?.imageMode ?? "book_character",
      imageUrl: cardOrProcessor.processedImageUrl || inputImage?.imageUrl,
      sourceCard: inputImage ?? cardOrProcessor,
      isProcessed: Boolean(cardOrProcessor.processedImageUrl),
      processorKind: cardOrProcessor.imageProcessorKind,
      processorFilter: [
        cardOrProcessor.processorFlipX ? "scaleX(-1)" : "",
        cardOrProcessor.processorFlipY ? "scaleY(-1)" : "",
        `saturate(${adjustments.saturation ?? 100}%)`,
        `brightness(${adjustments.brightness ?? 100}%)`,
        `contrast(${adjustments.contrast ?? 100}%)`,
      ].filter(Boolean).join(" "),
    };
  }

  return {
    id: cardOrProcessor.id,
    title: cardOrProcessor.title || "Image",
    imageMode: cardOrProcessor.imageMode,
    imageUrl: cardOrProcessor.imageUrl,
    sourceCard: cardOrProcessor,
    isProcessed: false,
    processorKind: undefined,
    processorFilter: undefined,
  };
}

const linkedVisualCards = useMemo(() => {
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

      const isImage =
        candidate.type === "output" && candidate.outputKind === "image";

      const isImageProcessor =
        candidate.type === "bridge" && candidate.bridgeKind === "image_processor";

      return isImage || isImageProcessor;
    })
    .map(resolveVisualSource);
}, [artisticCards, card.linkedImageCardId, card.linkedImageCardIds]);

const bookPageTextSource = useMemo(() => {
  if (card.type !== "output" || card.outputKind !== "book_page") {
    return null;
  }

  if (!card.sourceCardId) return null;

  return (
    artisticCards.find((candidate) => candidate.id === card.sourceCardId) ??
    null
  );
}, [artisticCards, card.outputKind, card.sourceCardId, card.type]);

function cleanBookPageStoryText(source: ArtisticCard | null) {
  if (!source) return "";

  if (source.type === "bridge" && source.bridgeKind === "file_context") {
    return (
      source.contextText?.trim() ||
      source.body?.trim() ||
      ""
    );
  }

  if (source.type === "output" && source.outputKind === "text") {
    const parsed = parseTextOutputBody(source.body);
    return parsed.body || parsed.title || source.body.trim();
  }

  return source.body?.trim() || "";
}

const bookPageStoryText = useMemo(() => {
  return cleanBookPageStoryText(bookPageTextSource);
}, [bookPageTextSource]);

const bookPageTextStyleSource = useMemo(() => {
  if (
    bookPageTextSource?.type === "bridge" &&
    bookPageTextSource.bridgeKind === "text_style_processor"
  ) {
    return bookPageTextSource;
  }

  return null;
}, [bookPageTextSource]);

const bookPageTextInputSource = useMemo(() => {
  if (!bookPageTextStyleSource) return bookPageTextSource;

  const sourceId =
    bookPageTextStyleSource.inputTextCardId ??
    bookPageTextStyleSource.upstreamCardId;

  if (!sourceId) return null;

  return (
    artisticCards.find((candidate) => candidate.id === sourceId) ??
    null
  );
}, [artisticCards, bookPageTextSource, bookPageTextStyleSource]);

const bookPageResolvedTextStyle =
  bookPageTextStyleSource?.textStyleSettings ?? null;

const bookPageResolvedStoryText = useMemo(() => {
  return cleanBookPageStoryText(bookPageTextInputSource);
}, [bookPageTextInputSource]);

function getProcessorAdjustmentValue(
  key: "saturation" | "brightness" | "contrast",
  fallback = 100
) {
  return card.processorAdjustments?.[key] ?? fallback;
}

function updateProcessorAdjustment(
  key: "saturation" | "brightness" | "contrast",
  value: number
) {
  setArtisticCards((prev) =>
    prev.map((candidate) =>
      candidate.id === card.id
        ? {
            ...candidate,
            processorAdjustments: {
              saturation: candidate.processorAdjustments?.saturation ?? 100,
              brightness: candidate.processorAdjustments?.brightness ?? 100,
              contrast: candidate.processorAdjustments?.contrast ?? 100,
              [key]: value,
            },
            processorStatus:
              candidate.processedImageUrl || candidate.processorStatus === "done"
                ? "idle"
                : candidate.processorStatus,
          }
        : candidate
    )
  );
}

const processorFilter = [
  `saturate(${getProcessorAdjustmentValue("saturation")}%)`,
  `brightness(${getProcessorAdjustmentValue("brightness")}%)`,
  `contrast(${getProcessorAdjustmentValue("contrast")}%)`,
].join(" ");

function ProcessorSliderRow({
  label,
  value,
  min,
  max,
  step = 5,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-black/10 bg-white/45 px-3 py-2">
      <div className="w-[92px] shrink-0">
        <div className="text-xs font-medium text-black/65">{label}</div>
        <div className="mt-0.5 text-[10px] text-black/35">{value}%</div>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 accent-purple-500"
      />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(100);
        }}
        className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-black/35 hover:bg-black/[0.06]"
      >
        Reset
      </button>
    </div>
  );
}

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
    "relative z-[25] flex items-center justify-between px-3 py-2 transition-colors duration-150",
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
            : card.outputKind === "book_page"
            ? "BOOK"
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

        setArtisticCards((prev) =>
          prev
            .filter((c) => c.id !== card.id)
            .map((c) => ({
              ...c,
              links: c.links?.filter((id) => id !== card.id),
              sourceCardId: c.sourceCardId === card.id ? undefined : c.sourceCardId,
              upstreamCardId: c.upstreamCardId === card.id ? undefined : c.upstreamCardId,
              linkedImageCardId:
                c.linkedImageCardId === card.id ? undefined : c.linkedImageCardId,
              linkedImageCardIds: c.linkedImageCardIds?.filter((id) => id !== card.id),
              inputImageCardId:
                c.inputImageCardId === card.id ? undefined : c.inputImageCardId,
              inputTextCardId:
                c.inputTextCardId === card.id ? undefined : c.inputTextCardId,
              pptImageZones: c.pptImageZones?.filter(
                (zone) => zone.imageCardId !== card.id
              ),
              bookImageZones: c.bookImageZones?.filter(
                (zone) => zone.visualCardId !== card.id
              ),
            }))
        );

        setEditingCardId((prev) => (prev === card.id ? null : prev));
        setFocusedBodyCardId((prev) => (prev === card.id ? null : prev));
        setSelectedCardId((prev) => (prev === card.id ? null : prev));
        setSelectedCardIds((prev) => prev.filter((id) => id !== card.id));
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

          ) : card.type === "output" && card.outputKind === "book_page" ? (
  <div
    onPointerDown={(e) => e.stopPropagation()}
    className="flex h-full flex-col rounded-xl border border-black/10 bg-white p-3"
  >
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-black/45">
          Book Page
        </div>

        <div className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-black/45">
          {(card.bookPageRatio ?? "square").toUpperCase()}
        </div>
      </div>

      <div className="text-[11px] text-black/40">
        Composition
      </div>
    </div>

    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-black/10 bg-[#fffaf0]"
      onPointerMove={(e) => {
        moveBookImage(e);
        moveBookText(e);
      }}
      onPointerUp={(e) => {
        stopBookImageInteraction(e);
        stopBookTextInteraction(e);
      }}
      onPointerLeave={(e) => {
        stopBookImageInteraction(e);
        stopBookTextInteraction(e);
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(251,191,36,0.16),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(254,243,199,0.35))]" />

    {(() => {
  const textZone = getBookTextZone();
  const processorStyle = bookPageResolvedTextStyle;

  const textAlign = textZone.align ?? "left";
  const fontSize = processorStyle?.fontSize ?? textZone.fontSize ?? 15;
  const background = textZone.background ?? "soft_panel";
  const fontFamily = processorStyle?.fontFamily ?? textZone.fontFamily ?? "storybook";
  const fontWeight = processorStyle?.fontWeight ?? "medium";
  const letterSpacing = processorStyle?.letterSpacing ?? 0;
  const lineHeight = processorStyle?.lineHeight ?? 1.15;
  const opacity = processorStyle?.opacity ?? 100;
  const rotation = processorStyle?.rotation ?? 0;
  const textShadow = processorStyle?.textShadow ?? "none";
  const textOutline = processorStyle?.textOutline ?? "none";
  const textColor = processorStyle?.color ?? textZone.color ?? "#2f2418";

  const storyText =
    bookPageResolvedStoryText ||
    bookPageStoryText ||
    "Connect story text and book images here.";

  return (
    <div
      className={[
        "absolute z-[20] overflow-hidden rounded-2xl border px-5 py-4 transition-[box-shadow,border-color,background-color]",
        getBookTextPanelClass(background),
        bookTextDrag
          ? "ring-2 ring-blue-400/45 shadow-[0_0_34px_rgba(96,165,250,0.24)]"
          : "hover:ring-2 hover:ring-amber-300/50",
      ].join(" ")}
      style={{
        left: textZone.x,
        top: textZone.y,
        width: textZone.w,
        height: textZone.h,
        color: textColor,
        textAlign,
        opacity: opacity / 100,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center center",
      }}
      onPointerDown={(e) => startBookTextMove(e, textZone)}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-amber-700/55">
          Story text area
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              updateBookTextZone({
                fontSize: Math.max(9, fontSize - 1),
              });
            }}
            className="rounded-md border border-black/10 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-black/45 hover:bg-white"
            title="Smaller text"
          >
            A−
          </button>

          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              updateBookTextZone({
                fontSize: Math.min(34, fontSize + 1),
              });
            }}
            className="rounded-md border border-black/10 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-black/45 hover:bg-white"
            title="Larger text"
          >
            A+
          </button>

          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();

              const nextAlign =
                textAlign === "left"
                  ? "center"
                  : textAlign === "center"
                  ? "right"
                  : "left";

              updateBookTextZone({
                align: nextAlign,
              });
            }}
            className="rounded-md border border-black/10 bg-white/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-black/45 hover:bg-white"
            title="Cycle alignment"
          >
            {textAlign}
          </button>

          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();

              const nextBackground =
                background === "soft_panel"
                  ? "paper_panel"
                  : background === "paper_panel"
                  ? "none"
                  : "soft_panel";

              updateBookTextZone({
                background: nextBackground,
              });
            }}
            className="rounded-md border border-black/10 bg-white/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-black/45 hover:bg-white"
            title="Cycle text panel style"
          >
            {background === "soft_panel"
              ? "Soft"
              : background === "paper_panel"
              ? "Paper"
              : "None"}
          </button>
        </div>
      </div>

      <div
        className={[
          "h-[calc(100%-26px)] overflow-hidden whitespace-pre-wrap",
          getBookFontFamilyClass(fontFamily),
          getBookTextWeightClass(fontWeight),
          bookPageResolvedStoryText || bookPageStoryText ? "" : "opacity-65",
        ].join(" ")}
        style={{
          fontSize,
          letterSpacing,
          lineHeight,
          textShadow: [
            getBookTextShadowStyle(textShadow),
            getBookTextOutlineStyle(textOutline),
          ]
            .filter(Boolean)
            .join(", ") || undefined,
        }}
      >
        {storyText}
      </div>

      <button
        type="button"
        data-card-resize-handle
        onPointerDown={(e) => startBookTextResize(e, textZone)}
        className="absolute bottom-1 right-1 h-4 w-4 rounded-md border border-black/10 bg-white/80 text-[9px] text-black/35 shadow-sm hover:bg-white"
        title="Resize story text area"
      >
        ◢
      </button>
    </div>
  );
})()}

      {linkedVisualCards.length > 0 ? (
        <div className="absolute inset-0 z-[5]">
          {linkedVisualCards.slice(0, 6).map((imageCard, index) => {
            const zone = getBookZoneForVisual(imageCard, index);
            const isBackground = zone.role === "background";
            const isCharacter = zone.role === "character";
            const isDraggingThis = bookImageDrag?.visualCardId === imageCard.id;

            return (
              <div
                key={imageCard.id}
                className={[
                  getBookVisualZoneClass(zone),
                  "transition-[box-shadow,border-color]",
                  zone.role === "character"
                  ? isDraggingThis
                    ? "ring-2 ring-blue-400/45"
                    : ""
                  : isDraggingThis
                  ? "ring-2 ring-blue-400/45 shadow-[0_0_34px_rgba(96,165,250,0.28)]"
                  : "hover:ring-2 hover:ring-amber-300/50",
                ].join(" ")}
                style={{
                  left: zone.x,
                  top: zone.y,
                  width: zone.w,
                  height: zone.h,
                  zIndex:
                    zone.role === "background"
                      ? 1
                      : zone.role === "character"
                      ? 12
                      : 8 + index,
                }}
                onPointerDown={(e) => startBookImageMove(e, imageCard.id, zone)}
              >
                {imageCard.imageUrl ? (
                  <img
                    src={imageCard.imageUrl}
                    alt={imageCard.title || `Book visual ${index + 1}`}
                    className={[
                      "h-full w-full",
                      zone.role === "character" ? "drop-shadow-[0_10px_16px_rgba(0,0,0,0.22)]" : "",
                    ].join(" ")}
                    style={{
                      objectFit: zone.objectFit ?? (zone.role === "character" ? "contain" : "cover"),
                      filter: imageCard.processorFilter,
                    }}
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-[11px] leading-5 text-amber-800/45">
                    Linked book image has no preview yet.
                  </div>
                )}

                <>
                  {!isCharacter ? (
                    <div className="absolute left-2 top-2 flex items-center gap-1">
                      <div className="pointer-events-none rounded-md border border-white/40 bg-white/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-black/45 backdrop-blur">
                        {zone.role === "background"
                          ? "Background"
                          : zone.role === "character"
                          ? "Character"
                          : zone.role === "overlay"
                          ? "Overlay"
                          : `Image ${index + 1}`}
                      </div>

                      <button
                        type="button"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();

                          upsertBookImageZone({
                            ...zone,
                            objectFit: zone.objectFit === "contain" ? "cover" : "contain",
                          });
                        }}
                        className="rounded-md border border-white/50 bg-white/75 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-black/45 backdrop-blur hover:bg-white"
                        title="Toggle cover / contain"
                      >
                        {(zone.objectFit ?? "cover").toUpperCase()}
                      </button>
                    </div>
                  ) : null}

                  {!isBackground ? (
                    <button
                      type="button"
                      data-card-resize-handle
                      onPointerDown={(e) => startBookImageResize(e, imageCard.id, zone)}
                      className="absolute bottom-1 right-1 h-4 w-4 rounded-md border border-black/10 bg-white/80 text-[9px] text-black/35 shadow-sm hover:bg-white"
                      title="Resize book image"
                    >
                      ◢
                    </button>
                  ) : null}
                </>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="absolute bottom-[8%] left-[8%] right-[8%] z-[6] h-[46%] overflow-hidden rounded-3xl border border-dashed border-amber-300/80 bg-white/35">
          <div className="flex h-full items-center justify-center px-6 text-center text-sm leading-6 text-amber-800/45">
            Connect Book Background, Book Character, or Book Illustration cards here.
          </div>
        </div>
      )}
    </div>
  </div>
        ) : card.type === "output" && card.outputKind === "text" ? (
          (() => {
            const parsed = parseTextOutputBody(card.body);

            return (
              <div
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
            className="flex h-full flex-col rounded-xl border border-black/10 bg-white p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-black/45">
                  Image
                </div>

                <div className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-black/45">
                  {(card.imageMode ?? "presentation_visual")
                    .replace("presentation_visual", "Image Creation")
                    .replace("book_background", "Book Background")
                    .replace("book_character", "Book Character")
                    .replace("print_illustration", "Book Illustration")}
                </div>

                <div className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-black/35">
                  {(card.imageAspect ?? "square").toUpperCase()}
                </div>
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
                  alt=""
                  draggable={false}
                  className="pointer-events-none h-full w-full object-contain"
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
            className={`h-full w-full overflow-auto whitespace-pre-wrap text-sm leading-7 ${cardPresetUi.body}`}
            onWheel={(e) => e.stopPropagation()}
          >
            {card.body}
          </div>
        ) : card.type === "bridge" && card.bridgeKind === "text_style_processor" ? (
          (() => {
            const inputCard = getTextStyleInputCard();
            const settings = {
              fontFamily: card.textStyleSettings?.fontFamily ?? "storybook",
              fontSize: card.textStyleSettings?.fontSize ?? 24,
              color: card.textStyleSettings?.color ?? "#2f2418",
              opacity: card.textStyleSettings?.opacity ?? 100,
              rotation: card.textStyleSettings?.rotation ?? 0,
              letterSpacing: card.textStyleSettings?.letterSpacing ?? 0,
              lineHeight: card.textStyleSettings?.lineHeight ?? 1.15,
              textShadow: card.textStyleSettings?.textShadow ?? "soft",
              textOutline: card.textStyleSettings?.textOutline ?? "none",
              fontWeight: card.textStyleSettings?.fontWeight ?? "semibold",
            } satisfies Required<NonNullable<ArtisticCard["textStyleSettings"]>>;

            const previewText =
              inputCard?.body?.trim() ||
              "Connect a Book Story Text card to preview typography.";

            return (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="flex h-full min-h-0 flex-col gap-3 overflow-auto rounded-xl border border-purple-200 bg-white/70 px-3 py-3 backdrop-blur-sm"
              >
                <div className="rounded-xl border border-purple-200 bg-purple-50/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-purple-700">
                        Text Style Processor
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-purple-900/55">
                        Typography styling bridge for Book Pages.
                      </div>
                    </div>

                    <div className="rounded-full border border-purple-200 bg-white/70 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-purple-700/70">
                      {inputCard ? "Connected" : "Idle"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTextStyleSettings({
                        fontFamily: cycleTextStyleValue(
                          settings.fontFamily,
                          ["storybook", "serif", "sans", "handwritten", "display"] as const,
                          "storybook"
                        ),
                      });
                    }}
                    className="rounded-lg border border-black/10 bg-white/75 px-3 py-2 text-left text-[11px] text-black/60 hover:bg-white"
                  >
                    <div className="text-[9px] uppercase tracking-[0.16em] text-black/35">
                      Font
                    </div>
                    <div className="mt-1 capitalize">{settings.fontFamily}</div>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTextStyleSettings({
                        fontWeight: cycleTextStyleValue(
                          settings.fontWeight,
                          ["normal", "medium", "semibold", "bold"] as const,
                          "semibold"
                        ),
                      });
                    }}
                    className="rounded-lg border border-black/10 bg-white/75 px-3 py-2 text-left text-[11px] text-black/60 hover:bg-white"
                  >
                    <div className="text-[9px] uppercase tracking-[0.16em] text-black/35">
                      Weight
                    </div>
                    <div className="mt-1 capitalize">{settings.fontWeight}</div>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();

                      const colors = ["#2f2418", "#fff7df", "#5a3212", "#1f2937", "#7c2d12"];
                      const currentIndex = colors.indexOf(settings.color ?? "#2f2418");

                      updateTextStyleSettings({
                        color: colors[(currentIndex + 1) % colors.length] ?? "#2f2418",
                      });
                    }}
                    className="rounded-lg border border-black/10 bg-white/75 px-3 py-2 text-left text-[11px] text-black/60 hover:bg-white"
                  >
                    <div className="text-[9px] uppercase tracking-[0.16em] text-black/35">
                      Color
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full border border-black/10"
                        style={{ background: settings.color }}
                      />
                      <span>{settings.color}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTextStyleSettings({
                        textShadow: cycleTextStyleValue(
                          settings.textShadow,
                          ["none", "soft", "strong", "glow"] as const,
                          "soft"
                        ),
                      });
                    }}
                    className="rounded-lg border border-black/10 bg-white/75 px-3 py-2 text-left text-[11px] text-black/60 hover:bg-white"
                  >
                    <div className="text-[9px] uppercase tracking-[0.16em] text-black/35">
                      Shadow
                    </div>
                    <div className="mt-1 capitalize">{settings.textShadow}</div>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTextStyleSettings({
                        textOutline: cycleTextStyleValue(
                          settings.textOutline,
                          ["none", "light", "dark"] as const,
                          "none"
                        ),
                      });
                    }}
                    className="rounded-lg border border-black/10 bg-white/75 px-3 py-2 text-left text-[11px] text-black/60 hover:bg-white"
                  >
                    <div className="text-[9px] uppercase tracking-[0.16em] text-black/35">
                      Outline
                    </div>
                    <div className="mt-1 capitalize">{settings.textOutline}</div>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();

                      const nextRotation = settings.rotation >= 12 ? -12 : settings.rotation + 3;

                      updateTextStyleSettings({
                        rotation: nextRotation,
                      });
                    }}
                    className="rounded-lg border border-black/10 bg-white/75 px-3 py-2 text-left text-[11px] text-black/60 hover:bg-white"
                  >
                    <div className="text-[9px] uppercase tracking-[0.16em] text-black/35">
                      Rotation
                    </div>
                    <div className="mt-1">{settings.rotation}°</div>
                  </button>
                </div>

                <div className="space-y-2 rounded-xl border border-black/10 bg-white/65 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                      Size
                    </span>
                    <span className="text-[10px] text-black/40">{settings.fontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={54}
                    value={settings.fontSize}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateTextStyleSettings({ fontSize: Number(e.target.value) })
                    }
                    className="w-full accent-purple-500"
                  />

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                      Opacity
                    </span>
                    <span className="text-[10px] text-black/40">{settings.opacity}%</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={settings.opacity}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateTextStyleSettings({ opacity: Number(e.target.value) })
                    }
                    className="w-full accent-purple-500"
                  />

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                      Letter spacing
                    </span>
                    <span className="text-[10px] text-black/40">
                      {settings.letterSpacing}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={8}
                    step={0.5}
                    value={settings.letterSpacing}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateTextStyleSettings({ letterSpacing: Number(e.target.value) })
                    }
                    className="w-full accent-purple-500"
                  />

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                      Line height
                    </span>
                    <span className="text-[10px] text-black/40">
                      {settings.lineHeight}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.9}
                    max={2}
                    step={0.05}
                    value={settings.lineHeight}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateTextStyleSettings({ lineHeight: Number(e.target.value) })
                    }
                    className="w-full accent-purple-500"
                  />
                </div>

                <div className="min-h-[80px] rounded-xl border border-purple-200 bg-[#fffaf0] px-4 py-3">
                  <div className="mb-2 text-[9px] uppercase tracking-[0.18em] text-purple-700/50">
                    Preview
                  </div>
                  <div
                    className={[
                      getBookFontFamilyClass(settings.fontFamily),
                      getBookTextWeightClass(settings.fontWeight),
                      "line-clamp-3",
                    ].join(" ")}
                    style={{
                      fontSize: settings.fontSize,
                      color: settings.color,
                      opacity: settings.opacity / 100,
                      letterSpacing: settings.letterSpacing,
                      lineHeight: settings.lineHeight,
                      transform: `rotate(${settings.rotation}deg)`,
                      transformOrigin: "left center",
                      textShadow:
                        [
                          getBookTextShadowStyle(settings.textShadow),
                          getBookTextOutlineStyle(settings.textOutline),
                        ]
                          .filter(Boolean)
                          .join(", ") || undefined,
                    }}
                  >
                    {previewText}
                  </div>
                </div>
              </div>
            );
          })()
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

{card.type === "bridge" && card.bridgeKind === "image_processor" ? (
  <div
    onPointerDown={(e) => e.stopPropagation()}
    className="flex h-full flex-col gap-3 rounded-xl border border-black/10 bg-white/70 p-3 backdrop-blur-sm"
  >
    <div className="flex items-center justify-between gap-2">
      <div className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-purple-700/70">
        Image Processor
      </div>

      <div className="text-[11px] text-black/40">
        {card.processorStatus === "processing"
          ? "Processing..."
          : card.processorStatus === "error"
          ? "Error"
          : card.processorStatus === "done"
          ? "Ready"
          : "Idle"}
      </div>
    </div>

    <div className="space-y-2 rounded-xl border border-black/10 bg-white/55 p-2">
      <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();

        const nextKind =
          card.imageProcessorKind === "remove_background"
            ? undefined
            : "remove_background";

        setArtisticCards((prev) =>
          prev.map((candidate) =>
            candidate.id === card.id
              ? {
                  ...candidate,
                  imageProcessorKind: nextKind,
                  processorStatus: "idle",
                  processedImageUrl: undefined,
                  processorError: undefined,
                }
              : candidate
          )
        );
      }}
      className={[
        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition",
        card.imageProcessorKind === "remove_background"
          ? "border-purple-300 bg-purple-50 text-purple-800"
          : "border-black/10 bg-white/70 text-black/60 hover:bg-white",
      ].join(" ")}
    >
      <span className="text-xs font-medium">Remove background</span>
      <span className="text-[10px] uppercase tracking-[0.14em] opacity-60">
        {card.imageProcessorKind === "remove_background" ? "Active" : "Off"}
      </span>
    </button>

  <div className="flex items-center justify-between rounded-lg border border-black/10 bg-white/45 px-3 py-2">
    <div>
      <div className="text-xs font-medium text-black/65">Input image</div>
      <div className="mt-0.5 text-[10px] text-black/35">
        {card.inputImageCardId ? "Connected" : "Awaiting image card"}
      </div>
    </div>

    <div className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-black/35">
      Source
    </div>
  </div>



  <div className="flex items-center justify-between rounded-lg border border-black/10 bg-white/45 px-3 py-2">
    <div>
      <div className="text-xs font-medium text-black/65">Output</div>
      <div className="mt-0.5 text-[10px] text-black/35">
        {card.processedImageUrl
          ? "Processed image ready"
          : "Uses original until processed"}
      </div>
    </div>

    <div className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-black/35">
      PNG
    </div>
  </div>

  <div className="my-2 h-px bg-black/10" />

  <ProcessorSliderRow
    label="Saturation"
    value={getProcessorAdjustmentValue("saturation")}
    min={0}
    max={200}
    onChange={(value) => updateProcessorAdjustment("saturation", value)}
  />

  <ProcessorSliderRow
    label="Brightness"
    value={getProcessorAdjustmentValue("brightness")}
    min={50}
    max={150}
    onChange={(value) => updateProcessorAdjustment("brightness", value)}
  />

  <ProcessorSliderRow
    label="Contrast"
    value={getProcessorAdjustmentValue("contrast")}
    min={50}
    max={150}
    onChange={(value) => updateProcessorAdjustment("contrast", value)}
  />
</div>

    <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
      {(() => {
        const inputImage = card.inputImageCardId
          ? artisticCards.find((candidate) => candidate.id === card.inputImageCardId)
          : null;

        const originalUrl = inputImage?.imageUrl;
        const processedUrl = card.processedImageUrl;

        if (!originalUrl) {
          return (
            <div className="col-span-2 flex h-full items-center justify-center rounded-xl border border-black/10 bg-white px-5 text-center text-sm leading-6 text-black/40">
              Connect an Image card to this processor.
            </div>
          );
        }

        return (
          <>
            <div className="relative min-h-0 overflow-hidden rounded-xl border border-black/10 bg-white">
              <img
                src={originalUrl}
                alt="Original image"
                className="h-full w-full object-contain"
                draggable={false}
              />

              <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-white/50 bg-white/75 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-black/45 backdrop-blur">
                Original
              </div>
            </div>

            <div
              className="relative min-h-0 overflow-hidden rounded-xl border border-purple-200"
              style={{
                backgroundImage:
                  "linear-gradient(45deg, rgba(0,0,0,0.06) 25%, transparent 25%), linear-gradient(-45deg, rgba(0,0,0,0.06) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.06) 75%), linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.06) 75%)",
                backgroundSize: "18px 18px",
                backgroundPosition: "0 0, 0 9px, 9px -9px, -9px 0px",
              }}
            >
              {processedUrl ? (
                <img
                  src={processedUrl}
                  alt="Processed image"
                  className="h-full w-full object-contain"
                  style={{ filter: processorFilter }}
                  draggable={false}
                />
              ) : card.processorStatus === "processing" ? (
                <div className="relative flex h-full items-center justify-center overflow-hidden px-4 text-center text-[11px] leading-5 text-purple-700/55">
                  <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-purple-100/80 to-transparent blur-xl animate-[vestarynFlow_3s_linear_infinite]" />
                  <div className="relative z-10">Removing background...</div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-[11px] leading-5 text-purple-700/45">
                  Processed preview will appear here.
                </div>
              )}

              <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-purple-200 bg-purple-50/90 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-purple-700/60 backdrop-blur">
                Processed
              </div>

              {!processedUrl ? (
                <div className="absolute bottom-2 left-2 right-2 rounded-lg border border-amber-200 bg-amber-50/90 px-2 py-1 text-[10px] leading-4 text-amber-800/70">
                  Not processed yet.
                </div>
              ) : null}
            </div>
          </>
        );
      })()}
    </div>

  <button
  type="button"
  onClick={async (e) => {
    e.stopPropagation();

    const inputImage = card.inputImageCardId
      ? artisticCards.find((candidate) => candidate.id === card.inputImageCardId)
      : null;

    if (!inputImage?.imageUrl) {
      setArtisticCards((prev) =>
        prev.map((candidate) =>
          candidate.id === card.id
            ? {
                ...candidate,
                processorStatus: "error",
                processorError: "No input image connected.",
              }
            : candidate
        )
      );

      return;
    }

    const adjustments = {
      saturation: card.processorAdjustments?.saturation ?? 100,
      brightness: card.processorAdjustments?.brightness ?? 100,
      contrast: card.processorAdjustments?.contrast ?? 100,
    };

    // No operation selected = passthrough processor.
    if (!card.imageProcessorKind) {
      setArtisticCards((prev) =>
        prev.map((candidate) =>
          candidate.id === card.id
            ? {
                ...candidate,
                processorStatus: "done",
                processedImageUrl: inputImage.imageUrl,
                processorError: undefined,
                processorAdjustments: adjustments,
              }
            : candidate
        )
      );

      return;
    }

    setArtisticCards((prev) =>
      prev.map((candidate) =>
        candidate.id === card.id
          ? {
              ...candidate,
              processorStatus: "processing",
              processorError: undefined,
              processedImageUrl: undefined,
              processorAdjustments: adjustments,
            }
          : candidate
      )
    );

    try {
      const res = await fetch("/api/artistic/image/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: inputImage.imageUrl,
          operation: card.imageProcessorKind,
          adjustments: card.processorAdjustments,
          imageAspect: inputImage.imageAspect ?? "square",
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Image processing failed (${res.status})`);
      }

      const data = await res.json();

      const processedImageUrl =
        typeof data?.processedImageUrl === "string"
          ? data.processedImageUrl
          : inputImage.imageUrl;

      let durableProcessed = {
        storagePath: inputImage.processedImageStoragePath ?? inputImage.imageStoragePath ?? "",
        signedUrl: processedImageUrl,
      };

      if (processedImageUrl.startsWith("data:image/")) {
        durableProcessed = await persistProcessedImageAsset(processedImageUrl);
      }

      setArtisticCards((prev) =>
        prev.map((candidate) =>
          candidate.id === card.id
            ? {
                ...candidate,
                processorStatus: "done",
                processedImageUrl: durableProcessed.signedUrl,
                processedImageStoragePath:
                  durableProcessed.storagePath || candidate.processedImageStoragePath,
                processorError: undefined,
                processorAdjustments: adjustments,
              }
            : candidate
        )
      );
    } catch (err) {
      setArtisticCards((prev) =>
        prev.map((candidate) =>
          candidate.id === card.id
            ? {
                ...candidate,
                processorStatus: "error",
                processorError:
                  err instanceof Error
                    ? err.message
                    : "Image processing failed.",
              }
            : candidate
        )
      );
    }
  }}
  disabled={card.processorStatus === "processing"}
  className={[
    "rounded-xl border px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] transition",
    card.processorStatus === "processing"
      ? "cursor-wait border-purple-200 bg-purple-50/70 text-purple-400"
      : "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100",
  ].join(" ")}
>
  {card.processorStatus === "processing" ? "Processing..." : "Apply Processor"}
</button>

{card.processorError ? (
  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700">
    {card.processorError}
  </div>
) : null}

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

                <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-2 py-2 backdrop-blur-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-amber-800/60">
                      Prompt mode
                    </div>

                    <div className="text-[10px] uppercase tracking-[0.14em] text-amber-800/35">
                      {card.promptIntent ?? "general"}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: "general", label: "General" },
                      { id: "book_title", label: "Book Title" },
                      { id: "book_page_text", label: "Page Text" },
                      { id: "book_character", label: "Character" },
                      { id: "book_background", label: "Background" },
                      { id: "book_illustration", label: "Illustration" },
                    ].map((intent) => {
                      const active = (card.promptIntent ?? "general") === intent.id;

                      return (
                        <button
                          key={intent.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();

                            updateCard(card.id, {
                              promptIntent: intent.id as ArtisticCard["promptIntent"],
                            });

                            setSelectedCardId(card.id);
                            setFocusedBodyCardId(card.id);
                          }}
                          className={[
                            "rounded-md border px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] transition",
                            active
                              ? "border-amber-400 bg-amber-100 text-amber-900 shadow-sm"
                              : "border-black/10 bg-white/70 text-black/45 hover:bg-white hover:text-black/65",
                          ].join(" ")}
                        >
                          {intent.label}
                        </button>
                      );
                    })}
                  </div>
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



{(
  card.type === "prompt" ||
  card.type === "bridge" ||
  (card.type === "output" &&
    (card.outputKind === "text" || card.outputKind === "image"))
) && (
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