"use client";

import {
  useEffect,
  useRef,
  useMemo,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import ArtisticCardView from "@/components/artistic/ArtisticCardView";
import ArtisticClickMenu from "@/components/artistic/ArtisticClickMenu";
import ArtisticSummonPopup from "@/components/artistic/ArtisticSummonPopup";
import {
  clampRect,
  getCardPresetClasses,
  makeCardId,
  viewportPointFromClient,
  viewportPointToWorldAtZoom,
} from "@/lib/artistic/canvasUtils";
import type {
  ArtisticBookImageZone,
  ArtisticBookTextZone,
  ArtisticBridgeKind,
  ArtisticCard,
  ArtisticCardType,
  ArtisticPptImageZone,
  PanOffset,
  ScreenPoint,
} from "@/lib/artistic/types";

type ArtisticMessage = {
  role: "user" | "assistant";
  content: string;
};

type ArtisticCanvasSurfaceProps = {
  repoId: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  canvasPresetUi: {
    viewportBg: string;
    gridClass: string;
  };
  cardPreset: "glass" | "solid" | "obsidian";
  panOffset: PanOffset;
  setPanOffset: Dispatch<SetStateAction<PanOffset>>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  MIN_ZOOM: number;
  MAX_ZOOM: number;
  WORLD_W: number;
  WORLD_H: number;
  MIN_CARD_W: number;
  MIN_CARD_H: number;
  isPanning: boolean;
  dragStart: ScreenPoint | null;
  setDragStart: Dispatch<SetStateAction<ScreenPoint | null>>;
  dragCurrent: ScreenPoint | null;
  setDragCurrent: Dispatch<SetStateAction<ScreenPoint | null>>;
  isDraggingCard: boolean;
  setIsDraggingCard: Dispatch<SetStateAction<boolean>>;
  draggingCardId: string | null;
  setDraggingCardId: Dispatch<SetStateAction<string | null>>;
  resizingCardId: string | null;
  setResizingCardId: Dispatch<SetStateAction<string | null>>;
  selectedCardId: string | null;
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  multiDragStartPositionsRef: RefObject<Record<string, { x: number; y: number }>>;
  editingCardId: string | null;
  setEditingCardId: Dispatch<SetStateAction<string | null>>;
  focusedBodyCardId: string | null;
  setFocusedBodyCardId: Dispatch<SetStateAction<string | null>>;
  setPendingNewCardId: Dispatch<SetStateAction<string | null>>;
  artisticCards: ArtisticCard[];
  setArtisticCards: Dispatch<SetStateAction<ArtisticCard[]>>;
  clickMenu: ScreenPoint | null;
  setClickMenu: Dispatch<SetStateAction<ScreenPoint | null>>;
  clickMenuSubmenu:
  | null
  | "new-card"
  | "outputs"
  | "text-output"
  | "book-output";

setClickMenuSubmenu: React.Dispatch<
  React.SetStateAction<
    null | "new-card" | "outputs" | "text-output" | "book-output"
  >
>;
  artisticMenu: ScreenPoint | null;
  setArtisticMenu: Dispatch<SetStateAction<ScreenPoint | null>>;
  artisticPrompt: string;
  setArtisticPrompt: Dispatch<SetStateAction<string>>;
  artisticMessages: ArtisticMessage[];
  setArtisticMessages: Dispatch<SetStateAction<ArtisticMessage[]>>;
  artisticSending: boolean;
  artisticError: string | null;
  setArtisticError: Dispatch<SetStateAction<string | null>>;
  sendArtisticPrompt: () => Promise<void>;
  connectingFromCardId: string | null;
  setConnectingFromCardId: Dispatch<SetStateAction<string | null>>;
  connectionPreviewPoint: ScreenPoint | null;
  setConnectionPreviewPoint: Dispatch<SetStateAction<ScreenPoint | null>>;
  panStartRef: RefObject<{ x: number; y: number } | null>;
  connectionPulseCardId: string | null;
  setConnectionPulseCardId: Dispatch<SetStateAction<string | null>>;
  cardDragOffsetRef: RefObject<{ x: number; y: number }>;
  resizeStartRef: RefObject<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>;
  hasMovedRef: RefObject<boolean>;
  ignoreNextCanvasClickRef: RefObject<boolean>;
  resetArtisticPopup: () => void;
  bridgeSnapPreviewKey: string | null;
  setBridgeSnapPreviewKey: Dispatch<SetStateAction<string | null>>;
  updatingCardIds: string[];
};

export default function ArtisticCanvasSurface({
  repoId,
  viewportRef,
  canvasPresetUi,
  cardPreset,
  panOffset,
  setPanOffset,
  zoom,
  setZoom,
  MIN_ZOOM,
  MAX_ZOOM,
  WORLD_W,
  WORLD_H,
  MIN_CARD_W,
  MIN_CARD_H,
  isPanning,
  dragStart,
  setDragStart,
  dragCurrent,
  setDragCurrent,
  isDraggingCard,
  setIsDraggingCard,
  draggingCardId,
  setDraggingCardId,
  resizingCardId,
  setResizingCardId,
  selectedCardId,
  setSelectedCardId,
  selectedCardIds,
  setSelectedCardIds,
  editingCardId,
  setEditingCardId,
  focusedBodyCardId,
  setFocusedBodyCardId,
  setPendingNewCardId,
  artisticCards,
  setArtisticCards,
  clickMenu,
  setClickMenu,
  clickMenuSubmenu,
  setClickMenuSubmenu,
  artisticMenu,
  setArtisticMenu,
  artisticPrompt,
  setArtisticPrompt,
  artisticMessages,
  setArtisticMessages,
  artisticSending,
  artisticError,
  setArtisticError,
  sendArtisticPrompt,
  panStartRef,
  cardDragOffsetRef,
  resizeStartRef,
  hasMovedRef,
  ignoreNextCanvasClickRef,
  multiDragStartPositionsRef,
  resetArtisticPopup,
  connectingFromCardId,
  setConnectingFromCardId,
  connectionPreviewPoint,
  setConnectionPreviewPoint,
  connectionPulseCardId,
  setConnectionPulseCardId,
  bridgeSnapPreviewKey,
  setBridgeSnapPreviewKey,
  updatingCardIds,
}: ArtisticCanvasSurfaceProps) {
  function viewportPointToWorld(clientX: number, clientY: number) {
    const viewportPoint = viewportPointFromClient(
      clientX,
      clientY,
      viewportRef.current
    );

    return viewportPointToWorldAtZoom(
      viewportPoint.x,
      viewportPoint.y,
      panOffset,
      zoom
    );
  }

   function isCardActive(cardId: string) {
    return (
      selectedCardId === cardId ||
      selectedCardIds.includes(cardId) ||
      draggingCardId === cardId ||
      resizingCardId === cardId ||
      editingCardId === cardId ||
      focusedBodyCardId === cardId
    );
  }

  const onboardedSoftGroupKeysRef = useRef<Set<string>>(new Set());
  const loadedSoftGroupKeyRef = useRef<string | null>(null);
  const loadedPersistentGroupIdRef = useRef<string | null>(null);
  const [isCutMode, setIsCutMode] = useState(false);
  const [hoveredConnectionKey, setHoveredConnectionKey] = useState<string | null>(null);
  const [recentlyCutConnectionGhost, setRecentlyCutConnectionGhost] = useState<{
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dx: number;
} | null>(null);
  const [pointerWorldPoint, setPointerWorldPoint] = useState<ScreenPoint | null>(null);
  const pointerWorldPointRef = useRef<ScreenPoint | null>(null);
  const [groupSurfaceTitle, setGroupSurfaceTitle] = useState("Untitled group");
  const [groupSurfaceNote, setGroupSurfaceNote] = useState("");
  const [isEditingGroupSurface, setIsEditingGroupSurface] = useState(false);
  const [draggingPersistentGroupId, setDraggingPersistentGroupId] = useState<string | null>(null);
  const persistentGroupDragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    cardPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const [persistentGroups, setPersistentGroups] = useState<
  Array<{
    id: string;
    cardIds: string[];
    title: string;
    note: string;
  }>
>(() => {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem("vestaryn_artistic_persistent_groups");
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
});

function makePersistentGroupId() {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
  const [softGroupSurfaces, setSoftGroupSurfaces] = useState<
  Array<{
    id: string;
    cardIds: string[];
    title: string;
    note: string;
  }>
>([]);

function normalizeGroupCardIds(cardIds: string[]) {
  return Array.from(new Set(cardIds)).sort();
}

function makeSoftGroupKey(cardIds: string[]) {
  return normalizeGroupCardIds(cardIds).join("::");
}

function commitPersistentGroupTitle(groupId: string, title: string) {
  const nextTitle = title.trim() || "Untitled group";

  setPersistentGroups((prev) => {
    const next = prev.map((group) =>
      group.id === groupId
        ? {
            ...group,
            title: nextTitle,
          }
        : group
    );

    try {
      localStorage.setItem(
        "vestaryn_artistic_persistent_groups",
        JSON.stringify(next)
      );
    } catch {
      // ignore
    }

    return next;
  });
}

function commitPersistentGroupNote(groupId: string, note: string) {
  setPersistentGroups((prev) => {
    const next = prev.map((group) =>
      group.id === groupId
        ? {
            ...group,
            note,
          }
        : group
    );

    try {
      localStorage.setItem(
        "vestaryn_artistic_persistent_groups",
        JSON.stringify(next)
      );
    } catch {
      // ignore
    }

    return next;
  });
}

function removeSelectedCardsFromPersistentGroup(groupId: string) {
  const selectedIds = normalizeGroupCardIds(
    selectedCardIds.length > 0
      ? selectedCardIds
      : selectedCardId
      ? [selectedCardId]
      : []
  );

  if (selectedIds.length === 0) return;

  const selectedSet = new Set(selectedIds);

  setPersistentGroups((prev) => {
    const next = prev
      .map((group) => {
        if (group.id !== groupId) return group;

        const nextCardIds = normalizeGroupCardIds(
          group.cardIds.filter((cardId) => !selectedSet.has(cardId))
        );

        return {
          ...group,
          cardIds: nextCardIds,
        };
      })
      .filter((group) => group.cardIds.length >= 2);

    try {
      localStorage.setItem(
        "vestaryn_artistic_persistent_groups",
        JSON.stringify(next)
      );
    } catch {
      // ignore
    }

    return next;
  });

  setArtisticCards((prev) =>
    prev.map((card) =>
      selectedSet.has(card.id) && card.groupId === groupId
        ? {
            ...card,
            groupId: undefined,
          }
        : card
    )
  );

  setSelectedCardIds([]);
  setSelectedCardId(null);
}

function addSelectedCardsToPersistentGroup(groupId: string) {
  const selectedIds = normalizeGroupCardIds(
    selectedCardIds.length > 0
      ? selectedCardIds
      : selectedCardId
      ? [selectedCardId]
      : []
  );

  if (selectedIds.length === 0) return;

  setPersistentGroups((prev) => {
    const next = prev.map((group) => {
      if (group.id !== groupId) return group;

      const nextCardIds = normalizeGroupCardIds([
        ...group.cardIds,
        ...selectedIds,
      ]);

      return {
        ...group,
        cardIds: nextCardIds,
      };
    });

    try {
      localStorage.setItem(
        "vestaryn_artistic_persistent_groups",
        JSON.stringify(next)
      );
    } catch {
      // ignore
    }

    return next;
  });

  setArtisticCards((prev) =>
    prev.map((card) =>
      selectedIds.includes(card.id)
        ? {
            ...card,
            groupId,
          }
        : card
    )
  );
}

function updateCard(
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
  }>
) {
    setArtisticCards((prev) =>
      prev.map((card) =>
        card.id === cardId
          ? {
              ...card,
              ...patch,
            }
          : card
      )
    );
  }
  
  function commitCardTitle(cardId: string, title: string) {
    updateCard(cardId, {
      title: title.trim() || "Untitled card",
    });
  }

  function commitCardBody(cardId: string, body: string) {
    updateCard(cardId, {
      body,
    });
  }

function runPromptCard(promptCard: ArtisticCard) {
  const OUTPUT_OFFSET_X = 360;
  const OUTPUT_OFFSET_Y = 240;

  const roles: Array<{
  role: "summary" | "email" | "report";
  title: string;
}> = [
  { role: "summary", title: "Summary" },
  { role: "email", title: "Email" },
  { role: "report", title: "Report" },
];

  setArtisticCards((prev) => {
    const source = prev.find((c) => c.id === promptCard.id);
    if (!source) return prev;

    const outputCards: ArtisticCard[] = roles.map((entry, index) => ({
      id: makeCardId(),
      type: "output",
      outputKind: "text",
      outputRole: entry.role,
      sourceCardId: source.id,
      x: source.x + OUTPUT_OFFSET_X,
      y: source.y + index * OUTPUT_OFFSET_Y,
      w: 360,
      h: 220,
      title: entry.title,
      body: `${entry.title}\n\nGenerating ${entry.role} output...`,
      links: [],
    }));

    return [...prev, ...outputCards];
  });
}

type ArtisticConnectionSlot =
  | "source"
  | "upstream"
  | "visual"
  | "processor_input"
  | "text_style_input";

function getConnectionSlot(args: {
  source: ArtisticCard | null;
  target: ArtisticCard | null;
}): ArtisticConnectionSlot | null {
  const { source, target } = args;

  if (!source || !target) return null;
  if (source.id === target.id) return null;

  // Image → Image Processor
  if (
    source.type === "output" &&
    source.outputKind === "image" &&
    target.type === "bridge" &&
    target.bridgeKind === "image_processor"
  ) {
    return "processor_input";
  }

// Text Output → Text Style Processor
if (
  source.type === "output" &&
  source.outputKind === "text" &&
  target.type === "bridge" &&
  target.bridgeKind === "text_style_processor"
) {
  return "text_style_input";
}

  // Image → visual composition targets
  if (
    source.type === "output" &&
    source.outputKind === "image" &&
    target.type === "output" &&
    (target.outputKind === "powerpoint" || target.outputKind === "book_page")
  ) {
    return "visual";
  }

  // Image Processor → visual composition targets
  if (
    source.type === "bridge" &&
    source.bridgeKind === "image_processor" &&
    target.type === "output" &&
    (target.outputKind === "powerpoint" || target.outputKind === "book_page")
  ) {
    return "visual";
  }

// Text Style Processor → Book Page story source
if (
  source.type === "bridge" &&
  source.bridgeKind === "text_style_processor" &&
  target.type === "output" &&
  target.outputKind === "book_page"
) {
  return "source";
}

// Text Output → Book Page story source
if (
  source.type === "output" &&
  source.outputKind === "text" &&
  target.type === "output" &&
  target.outputKind === "book_page"
) {
  return "source";
}

// Prompt / bridge / non-output content → output source
if (
  target.type === "output" &&
  source.type !== "output"
) {
  return "source";
}

  // Generic card/bridge → bridge upstream
  if (target.type === "bridge") {
    return "upstream";
  }

  return null;
}

function applyConnectionToTarget(args: {
  target: ArtisticCard;
  sourceId: string;
  slot: ArtisticConnectionSlot;
}): ArtisticCard {
  const { target, sourceId, slot } = args;

  if (slot === "source") {
    if (target.type !== "output") return target;

    return {
      ...target,
      sourceCardId: sourceId,
    };
  }

  if (slot === "upstream") {
    if (target.type !== "bridge") return target;

    return {
      ...target,
      upstreamCardId: sourceId,
    };
  }

  if (slot === "processor_input") {
    if (target.type !== "bridge" || target.bridgeKind !== "image_processor") {
      return target;
    }

    return {
      ...target,
      inputImageCardId: sourceId,
      upstreamCardId: sourceId,
      processedImageUrl: undefined,
      processorStatus: "idle",
      processorError: undefined,
    };
  }

  if (slot === "visual") {
    if (
      target.type !== "output" ||
      (target.outputKind !== "powerpoint" && target.outputKind !== "book_page")
    ) {
      return target;
    }

    const existingIds = Array.from(
      new Set([
        ...(target.linkedImageCardIds ?? []),
        ...(target.linkedImageCardId ? [target.linkedImageCardId] : []),
      ])
    );

    const nextLinkedImageCardIds = existingIds.includes(sourceId)
      ? existingIds
      : [...existingIds, sourceId];

    return {
      ...target,
      linkedImageCardId: undefined,
      linkedImageCardIds: nextLinkedImageCardIds,
    };
  }

  if (slot === "text_style_input") {
    if (target.type !== "bridge" || target.bridgeKind !== "text_style_processor") {
      return target;
    }

    return {
      ...target,
      inputTextCardId: sourceId,
      upstreamCardId: sourceId,
      textStyleProcessorStatus: "idle",
      textStyleProcessorError: undefined,
    };
  }

  return target;
}

const connections = artisticCards
  .flatMap((card) => {
    const out: Array<{ key: string; from: ArtisticCard; to: ArtisticCard }> = [];

    if (card.type === "output" && card.sourceCardId) {
      const source = artisticCards.find((c) => c.id === card.sourceCardId);
      if (source) {
        out.push({ key: `${source.id}-${card.id}`, from: source, to: card });
      }
    }

    if (
      card.type === "output" &&
      (card.outputKind === "powerpoint" || card.outputKind === "book_page")
    ) {
      const linkedImageIds = Array.from(
        new Set([
          ...(card.linkedImageCardIds ?? []),
          ...(card.linkedImageCardId ? [card.linkedImageCardId] : []),
        ])
      );

      for (const imageId of linkedImageIds) {
        const imageSource = artisticCards.find((c) => c.id === imageId);

        if (imageSource) {
          out.push({
            key: `${imageSource.id}-${card.id}-image`,
            from: imageSource,
            to: card,
          });
        }
      }
    }

    if (card.type === "bridge" && card.bridgeKind === "image_processor") {
  const sourceId = card.inputImageCardId ?? card.upstreamCardId;
  const source = sourceId
    ? artisticCards.find((c) => c.id === sourceId)
    : null;

  if (source) {
    out.push({
      key: `${source.id}-${card.id}-processor-input`,
      from: source,
      to: card,
    });
  }
} else if (card.type === "bridge" && card.bridgeKind === "text_style_processor") {
  const sourceId = card.inputTextCardId ?? card.upstreamCardId;
  const source = sourceId
    ? artisticCards.find((c) => c.id === sourceId)
    : null;

  if (source) {
    out.push({
      key: `${source.id}-${card.id}-text-style-input`,
      from: source,
      to: card,
    });
  }
} else if (card.type === "bridge" && card.upstreamCardId) {
  const source = artisticCards.find((c) => c.id === card.upstreamCardId);
  if (source) {
    out.push({ key: `${source.id}-${card.id}`, from: source, to: card });
  }
}

    return out;
  });

const activePersistentGroup = useMemo(() => {
  if (selectedCardIds.length < 2) return null;

  const selectedCards = artisticCards.filter((card) =>
    selectedCardIds.includes(card.id)
  );

  if (selectedCards.length < 2) return null;

  const firstGroupId = selectedCards[0]?.groupId;
  if (!firstGroupId) return null;

  const allSameGroup = selectedCards.every(
    (card) => card.groupId === firstGroupId
  );

  if (!allSameGroup) return null;

  return (
    persistentGroups.find((group) => group.id === firstGroupId) ?? null
  );
}, [artisticCards, selectedCardIds, persistentGroups]);

const persistentGroupBounds = useMemo(() => {
  if (!activePersistentGroup) return null;

  const groupedCards = artisticCards.filter((card) =>
    activePersistentGroup.cardIds.includes(card.id)
  );

  if (groupedCards.length < 2) return null;

  const minX = Math.min(...groupedCards.map((card) => card.x));
  const minY = Math.min(...groupedCards.map((card) => card.y));
  const maxX = Math.max(...groupedCards.map((card) => card.x + card.w));
  const maxY = Math.max(...groupedCards.map((card) => card.y + card.h));

  const PAD_X = 28;
  const PAD_Y = 32;
  const HEADER_H = 132;

  return {
    x: minX - PAD_X,
    y: minY - PAD_Y - HEADER_H,
    w: maxX - minX + PAD_X * 2,
    h: maxY - minY + PAD_Y * 2 + HEADER_H,
    count: groupedCards.length,
  };
}, [artisticCards, activePersistentGroup]);

const selectedGroupBounds = useMemo(() => {
  if (persistentGroupBounds) {
    return persistentGroupBounds;
  }

  if (selectedCardIds.length < 2) return null;

  const selectedCards = artisticCards.filter((card) =>
    selectedCardIds.includes(card.id)
  );

  if (selectedCards.length < 2) return null;

  const minX = Math.min(...selectedCards.map((card) => card.x));
  const minY = Math.min(...selectedCards.map((card) => card.y));
  const maxX = Math.max(...selectedCards.map((card) => card.x + card.w));
  const maxY = Math.max(...selectedCards.map((card) => card.y + card.h));

  const PAD_X = 28;
  const PAD_Y = 32;
  const HEADER_H = 132;

  return {
    x: minX - PAD_X,
    y: minY - PAD_Y - HEADER_H,
    w: maxX - minX + PAD_X * 2,
    h: maxY - minY + PAD_Y * 2 + HEADER_H,
    count: selectedCards.length,
  };
}, [artisticCards, selectedCardIds, persistentGroupBounds]);

const persistentGroupRenderItems = useMemo(() => {
  const PAD_X = 28;
  const PAD_Y = 32;
  const HEADER_H = 132;

  return persistentGroups
    .map((group) => {
      const groupedCards = artisticCards.filter((card) =>
        group.cardIds.includes(card.id)
      );

      if (groupedCards.length < 2) return null;

      const minX = Math.min(...groupedCards.map((card) => card.x));
      const minY = Math.min(...groupedCards.map((card) => card.y));
      const maxX = Math.max(...groupedCards.map((card) => card.x + card.w));
      const maxY = Math.max(...groupedCards.map((card) => card.y + card.h));

      return {
        id: group.id,
        cardIds: group.cardIds,
        title: group.title,
        note: group.note,
        count: groupedCards.length,
        isActive: activePersistentGroup?.id === group.id,
        x: minX - PAD_X,
        y: minY - PAD_Y - HEADER_H,
        w: maxX - minX + PAD_X * 2,
        h: maxY - minY + PAD_Y * 2 + HEADER_H,
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      cardIds: string[];
      title: string;
      note: string;
      count: number;
      isActive: boolean;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
}, [persistentGroups, artisticCards, activePersistentGroup?.id]);

const selectedGroupCardIds = useMemo(() => {
  if (selectedCardIds.length < 2) return [];
  return normalizeGroupCardIds(selectedCardIds);
}, [selectedCardIds]);

const selectedSoftGroupKey = useMemo(() => {
  if (selectedGroupCardIds.length < 2) return null;
  return makeSoftGroupKey(selectedGroupCardIds);
}, [selectedGroupCardIds]);



useEffect(() => {
  try {
    localStorage.setItem(
      "vestaryn_artistic_persistent_groups",
      JSON.stringify(persistentGroups)
    );
  } catch {
    // ignore
  }
}, [persistentGroups]);

useEffect(() => {
  if (!activePersistentGroup) {
    loadedPersistentGroupIdRef.current = null;
    return;
  }

  if (loadedPersistentGroupIdRef.current === activePersistentGroup.id) {
    return;
  }

  loadedPersistentGroupIdRef.current = activePersistentGroup.id;
  loadedSoftGroupKeyRef.current = null;

  setGroupSurfaceTitle(activePersistentGroup.title);
  setGroupSurfaceNote(activePersistentGroup.note);
}, [activePersistentGroup?.id]);

useEffect(() => {
  if (selectedCardIds.length < 2) {
    setIsEditingGroupSurface(false);
    loadedSoftGroupKeyRef.current = null;
    loadedPersistentGroupIdRef.current = null;
  }
}, [selectedCardIds]);

useEffect(() => {
  if (!selectedSoftGroupKey || selectedGroupCardIds.length < 2) {
    loadedSoftGroupKeyRef.current = null;
    return;
  }

  if (activePersistentGroup) {
    return;
  }

  const existing = softGroupSurfaces.find(
    (group) => group.id === selectedSoftGroupKey
  );

  if (!existing) {
    const nextGroup = {
      id: selectedSoftGroupKey,
      cardIds: selectedGroupCardIds,
      title: "Untitled group",
      note: "",
    };

    let didCreate = false;

    setSoftGroupSurfaces((prev) => {
      if (prev.some((group) => group.id === selectedSoftGroupKey)) {
        return prev;
      }
      didCreate = true;
      return [...prev, nextGroup];
    });

    if (loadedSoftGroupKeyRef.current !== selectedSoftGroupKey) {
      setGroupSurfaceTitle("Untitled group");
      setGroupSurfaceNote("");
      loadedSoftGroupKeyRef.current = selectedSoftGroupKey;
    }

    if (
      didCreate &&
      !onboardedSoftGroupKeysRef.current.has(selectedSoftGroupKey)
    ) {
      onboardedSoftGroupKeysRef.current.add(selectedSoftGroupKey);

      setTimeout(() => {
        setIsEditingGroupSurface(true);
      }, 0);
    }

    return;
  }

  if (loadedSoftGroupKeyRef.current !== selectedSoftGroupKey) {
    setGroupSurfaceTitle(existing.title);
    setGroupSurfaceNote(existing.note);
    loadedSoftGroupKeyRef.current = selectedSoftGroupKey;
  }
}, [
  selectedSoftGroupKey,
  selectedGroupCardIds,
  softGroupSurfaces,
  activePersistentGroup?.id,
]);


useEffect(() => {
  if (selectedGroupCardIds.length < 2) return;

  if (activePersistentGroup) {
    const nextTitle = groupSurfaceTitle.trim() || "Untitled group";
    if (nextTitle === activePersistentGroup.title) return;

    commitPersistentGroupTitle(activePersistentGroup.id, groupSurfaceTitle);
    return;
  }

  if (!selectedSoftGroupKey) return;

  setSoftGroupSurfaces((prev) => {
    let changed = false;

    const next = prev.map((group) => {
      if (group.id !== selectedSoftGroupKey) return group;

      const nextTitle = groupSurfaceTitle.trim() || "Untitled group";
      if (group.title === nextTitle) return group;

      changed = true;
      return {
        ...group,
        title: nextTitle,
      };
    });

    return changed ? next : prev;
  });
}, [
  groupSurfaceTitle,
  activePersistentGroup?.id,
  activePersistentGroup?.title,
  selectedSoftGroupKey,
  selectedGroupCardIds,
]);

useEffect(() => {
  if (selectedGroupCardIds.length < 2) return;

  if (activePersistentGroup) {
    if (groupSurfaceNote === activePersistentGroup.note) return;

    commitPersistentGroupNote(activePersistentGroup.id, groupSurfaceNote);
    return;
  }

  if (!selectedSoftGroupKey) return;

  setSoftGroupSurfaces((prev) => {
    let changed = false;

    const next = prev.map((group) => {
      if (group.id !== selectedSoftGroupKey) return group;
      if (group.note === groupSurfaceNote) return group;

      changed = true;
      return {
        ...group,
        note: groupSurfaceNote,
      };
    });

    return changed ? next : prev;
  });
}, [
  groupSurfaceNote,
  activePersistentGroup?.id,
  activePersistentGroup?.note,
  selectedSoftGroupKey,
  selectedGroupCardIds,
]);

useEffect(() => {
  const liveCardIds = new Set(artisticCards.map((card) => card.id));

  setSoftGroupSurfaces((prev) => {
    const filtered = prev.filter(
      (group) =>
        group.cardIds.length >= 2 &&
        group.cardIds.every((id) => liveCardIds.has(id))
    );

    return filtered.length === prev.length ? prev : filtered;
  });
}, [artisticCards]);

useEffect(() => {
  function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const isTypingTarget =
      tag === "input" ||
      tag === "textarea" ||
      target?.isContentEditable;

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "g") {
      if (isTypingTarget) return;

      e.preventDefault();

const idsToGroup =
  selectedCardIds.length > 0
    ? selectedCardIds
    : selectedCardId
    ? [selectedCardId]
    : [];

if (idsToGroup.length < 2) {
  
  return;
}

const groupedCardIds = normalizeGroupCardIds(idsToGroup);

const existingGroup = persistentGroups.find((group) => {
  const existingIds = normalizeGroupCardIds(group.cardIds);
  return (
    existingIds.length === groupedCardIds.length &&
    existingIds.every((id, index) => id === groupedCardIds[index])
  );
});

const nextGroupId = existingGroup?.id ?? makePersistentGroupId();

      const nextTitle = groupSurfaceTitle.trim() || "Untitled group";
      const nextSoftGroupKey = makeSoftGroupKey(groupedCardIds);

      setPersistentGroups((prev) => {
        const next = existingGroup
          ? prev.map((group) =>
              group.id === existingGroup.id
                ? {
                    ...group,
                    cardIds: groupedCardIds,
                    title: nextTitle,
                    note: groupSurfaceNote,
                  }
                : group
            )
          : [
              ...prev,
              {
                id: nextGroupId,
                cardIds: groupedCardIds,
                title: nextTitle,
                note: groupSurfaceNote,
              },
            ];

        try {
          localStorage.setItem(
            "vestaryn_artistic_persistent_groups",
            JSON.stringify(next)
          );
        } catch {
          // ignore
        }

        return next;
      });

      setSoftGroupSurfaces((prev) => {
        const existingSoft = prev.find((group) => group.id === nextSoftGroupKey);

        if (existingSoft) {
          return prev.map((group) =>
            group.id === nextSoftGroupKey
              ? {
                  ...group,
                  cardIds: groupedCardIds,
                  title: nextTitle,
                  note: groupSurfaceNote,
                }
              : group
          );
        }

        return [
          ...prev,
          {
            id: nextSoftGroupKey,
            cardIds: groupedCardIds,
            title: nextTitle,
            note: groupSurfaceNote,
          },
        ];
      });

setArtisticCards((prev) => {
  const next = prev.map((card) =>
    groupedCardIds.includes(card.id)
      ? {
          ...card,
          groupId: nextGroupId,
        }
      : card
  );

  return next;
});

      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "g") {
      if (isTypingTarget) return;

      e.preventDefault();

      const idsToUngroup =
        selectedCardIds.length > 0
          ? selectedCardIds
          : selectedCardId
          ? [selectedCardId]
          : [];

      if (idsToUngroup.length === 0) return;

      const selectedSet = new Set(idsToUngroup);

      const groupIdsToRemove = new Set(
        artisticCards
          .filter((card) => selectedSet.has(card.id) && card.groupId)
          .map((card) => card.groupId!)
      );

      if (groupIdsToRemove.size === 0) return;

      setPersistentGroups((prev) =>
        prev.filter((group) => !groupIdsToRemove.has(group.id))
      );

      setArtisticCards((prev) =>
        prev.map((card) =>
          selectedSet.has(card.id)
            ? {
                ...card,
                groupId: undefined,
              }
            : card
        )
      );

      return;
    }

    if (isTypingTarget) return;

    if (e.key.toLowerCase() === "x") {
      setIsCutMode(true);
      setHoveredConnectionKey(
        findConnectionAtPoint(pointerWorldPointRef.current)
      );
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key.toLowerCase() === "x") {
      setIsCutMode(false);
      setHoveredConnectionKey(null);
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}, [
  connections,
  selectedCardId,
  selectedCardIds,
  persistentGroups,
  artisticCards,
  groupSurfaceTitle,
  groupSurfaceNote,
]);

useEffect(() => {
  if (!isCutMode) return;

  setHoveredConnectionKey(
    findConnectionAtPoint(pointerWorldPointRef.current)
  );
}, [isCutMode, connections]);
const isObsidianGroupUi = cardPreset === "obsidian";
const isPersistentGroupUi = Boolean(activePersistentGroup);
const hoveredConnectionTargetId =
  connectingFromCardId && connectionPreviewPoint
    ? (() => {
        const sourceCard =
          artisticCards.find((card) => card.id === connectingFromCardId) ?? null;

        return (
          artisticCards.find((card) => {
            const slot = getConnectionSlot({
              source: sourceCard,
              target: card,
            });

            if (!slot) return false;

            const cx = card.x;
            const cy = card.y + card.h / 2;

            const dx = cx - connectionPreviewPoint.x;
            const dy = cy - connectionPreviewPoint.y;

            return Math.sqrt(dx * dx + dy * dy) < 40;
          })?.id ?? null
        );
      })()
    : null;

  function createMenuCard(
  worldX: number,
  worldY: number,
  opts?: {
    type?: ArtisticCardType;
    w?: number;
    h?: number;
    title?: string;
    body?: string;
    bridgeKind?: ArtisticBridgeKind;
    contextFileName?: string;
    contextText?: string;
    outputKind?: "text" | "powerpoint" | "image" | "book_page";
    outputRole?: "summary" | "email" | "report";
    imageMode?:
      | "presentation_visual"
      | "book_background"
      | "book_character"
      | "print_illustration";
    imageAspect?: "square" | "portrait" | "landscape";
    bookPageRatio?: "square" | "portrait" | "landscape";
    imageProcessorKind?: "remove_background";
    processorStatus?: "idle" | "processing" | "done" | "error";
    processorAdjustments?: {
      saturation?: number;
      brightness?: number;
      contrast?: number;
    };
    textStyleProcessorStatus?: "idle" | "processing" | "done" | "error";
    textStyleSettings?: ArtisticCard["textStyleSettings"];
      }
  ) {
    const newCardId = makeCardId();

    setArtisticCards((prev) => [
      ...prev,
      {
        id: newCardId,
        type: opts?.type ?? "default",
        x: worldX,
        y: worldY,
        w: opts?.w ?? 240,
        h: opts?.h ?? 160,
        title: opts?.title ?? "Untitled card",
        body: opts?.body ?? "",
        outputKind: opts?.outputKind,
        outputRole: opts?.outputRole,
        imageMode: opts?.imageMode,
        imageAspect: opts?.imageAspect,
        bookPageRatio: opts?.bookPageRatio,
        bridgeKind: opts?.bridgeKind,
        imageProcessorKind: opts?.imageProcessorKind,
        processorStatus: opts?.processorStatus,
        processorAdjustments: opts?.processorAdjustments,
        textStyleProcessorStatus: opts?.textStyleProcessorStatus,
        textStyleSettings: opts?.textStyleSettings,
        summaryBridgeUnlocked:
          opts?.bridgeKind === "summary_bridge" ? false : undefined,
        contextFileName: opts?.contextFileName,
        contextText: opts?.contextText,
        promptGateUnlocked:
          opts?.type === "prompt" ? false : undefined,
      },
    ]);

    setSelectedCardId(newCardId);
    setPendingNewCardId(newCardId);
    setClickMenu(null);
    setClickMenuSubmenu(null);
  }

function startPersistentGroupDrag(
  e: ReactPointerEvent<HTMLElement>,
  groupId: string
) {
  const group = persistentGroups.find((item) => item.id === groupId);
  if (!group) return;

  e.stopPropagation();
  e.preventDefault();

  const cardPositions: Record<string, { x: number; y: number }> = {};

  for (const card of artisticCards) {
    if (!group.cardIds.includes(card.id)) continue;
    cardPositions[card.id] = { x: card.x, y: card.y };
  }

  persistentGroupDragStartRef.current = {
    pointerX: e.clientX,
    pointerY: e.clientY,
    cardPositions,
  };

  setDraggingPersistentGroupId(groupId);
  setSelectedCardIds(group.cardIds);
  setSelectedCardId(group.cardIds[group.cardIds.length - 1] ?? null);

  document.body.style.userSelect = "none";
  document.body.style.webkitUserSelect = "none";
}  
  
function startCanvasDrag(clientX: number, clientY: number) {
  const worldPoint = viewportPointToWorld(clientX, clientY);

  document.body.style.userSelect = "none";
  document.body.style.webkitUserSelect = "none";

  setDragStart(worldPoint);
  setDragCurrent(worldPoint);
  setIsDraggingCard(true);
}

function handlePanMove(clientX: number, clientY: number) {
  const start = panStartRef.current;
  if (!start) return;

  const dx = clientX - start.x;
  const dy = clientY - start.y;

  setPanOffset((prev) => ({
    x: prev.x + dx,
    y: prev.y + dy,
  }));

  panStartRef.current = { x: clientX, y: clientY };
  document.body.style.cursor = "grabbing";
}

function getBookPageAspectRatio(card: ArtisticCard) {
  if (card.outputKind !== "book_page") return null;

  switch (card.bookPageRatio ?? "square") {
    case "landscape":
      return 3 / 2;
    case "portrait":
      return 2 / 3;
    case "square":
    default:
      return 1;
  }
}

function getImageAspectRatio(card: ArtisticCard) {
  if (card.outputKind !== "image") return null;

  switch (card.imageAspect ?? "square") {
    case "landscape":
      return 1536 / 1024;
    case "portrait":
      return 1024 / 1536;
    case "square":
    default:
      return 1;
  }
}

function handleResizeMove(clientX: number, clientY: number) {
  const start = resizeStartRef.current;
  if (!start || !resizingCardId) return;

  const worldPoint = viewportPointToWorld(clientX, clientY);

  const rawW = Math.max(
    MIN_CARD_W,
    start.startW + (worldPoint.x - start.startX)
  );

  const rawH = Math.max(
    MIN_CARD_H,
    start.startH + (worldPoint.y - start.startY)
  );

  setArtisticCards((prev) =>
    prev.map((card) => {
      if (card.id !== resizingCardId) return card;

      const aspectRatio =
        getImageAspectRatio(card) ?? getBookPageAspectRatio(card);

      if (!aspectRatio) {
        return {
          ...card,
          w: rawW,
          h: rawH,
        };
      }

      const deltaW = Math.abs(rawW - start.startW);
      const deltaH = Math.abs(rawH - start.startH);

      if (deltaW >= deltaH) {
        const lockedW = rawW;
        const lockedH = Math.max(MIN_CARD_H, lockedW / aspectRatio);

        return {
          ...card,
          w: lockedW,
          h: lockedH,
        };
      }

      const lockedH = rawH;
      const lockedW = Math.max(MIN_CARD_W, lockedH * aspectRatio);

      return {
        ...card,
        w: lockedW,
        h: lockedH,
      };
    })
  );
}


function startCardDrag(
  e: ReactPointerEvent<HTMLDivElement>,
  card: ArtisticCard
) {
  const isShift = e.shiftKey;

  let effectiveSelectedIds: string[];

  if (isShift) {
    effectiveSelectedIds = selectedCardIds.includes(card.id)
      ? selectedCardIds.filter((id) => id !== card.id)
      : [...selectedCardIds, card.id];

    setSelectedCardIds(effectiveSelectedIds);
    setSelectedCardId(card.id);
  } else {
    effectiveSelectedIds = selectedCardIds.includes(card.id)
      ? selectedCardIds
      : [card.id];

    setSelectedCardIds(effectiveSelectedIds);
    setSelectedCardId(card.id);
  }

  if (!effectiveSelectedIds.includes(card.id)) {
    effectiveSelectedIds = [card.id];
    setSelectedCardIds([card.id]);
    setSelectedCardId(card.id);
  }

  const worldPoint = viewportPointToWorld(e.clientX, e.clientY);
  cardDragOffsetRef.current = {
    x: worldPoint.x - card.x,
    y: worldPoint.y - card.y,
  };

  const next: Record<string, { x: number; y: number }> = {};

  for (const candidate of artisticCards) {
    if (!effectiveSelectedIds.includes(candidate.id)) continue;
    next[candidate.id] = {
      x: candidate.x,
      y: candidate.y,
    };
  }

  multiDragStartPositionsRef.current = next;
  setDraggingCardId(card.id);
}

function handleCardDragMove(clientX: number, clientY: number) {
  if (!draggingCardId) return;

  const worldPoint = viewportPointToWorld(clientX, clientY);
  const nextX = worldPoint.x - cardDragOffsetRef.current.x;
  const nextY = worldPoint.y - cardDragOffsetRef.current.y;

  const selectedSet = new Set(selectedCardIds);

  if (!selectedSet.has(draggingCardId) || selectedSet.size <= 1) {
    setArtisticCards((prev) =>
      prev.map((card) =>
        card.id === draggingCardId
          ? {
              ...card,
              x: nextX,
              y: nextY,
            }
          : card
      )
    );

  const draggedCard = artisticCards.find((c) => c.id === draggingCardId);
  if (draggedCard?.type === "bridge") {
    const snap = findBridgeSnapConnection(draggingCardId);
    setBridgeSnapPreviewKey(snap?.key ?? null);
  } else {
    setBridgeSnapPreviewKey(null);
  }

    return;
  }

  const origin = multiDragStartPositionsRef.current[draggingCardId];
  if (!origin) return;

  const dx = nextX - origin.x;
  const dy = nextY - origin.y;

  setArtisticCards((prev) =>
    prev.map((card) => {
      if (!selectedSet.has(card.id)) return card;

      const start = multiDragStartPositionsRef.current[card.id];
      if (!start) return card;

      return {
        ...card,
        x: start.x + dx,
        y: start.y + dy,
      };
    })
  );
}

  function onDoubleClick(e: ReactPointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;

    if (target.closest("[data-artistic-card]")) return;
    if (target.closest("[data-artistic-popup]")) return;
    if (target.closest("[data-click-menu]")) return;

    const world = viewportPointToWorld(e.clientX, e.clientY);
    const newCardId = makeCardId();

    setArtisticCards((prev) => [
      ...prev,
      {
        id: newCardId,
        type: "default",
        x: world.x,
        y: world.y,
        w: 240,
        h: 160,
        title: "Untitled card",
        body: "",
      },
    ]);

    setSelectedCardId(newCardId);
    setPendingNewCardId(newCardId);
    setClickMenu(null);
    setClickMenuSubmenu(null);
  }

    function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    hasMovedRef.current = false;

    if (isPanning) {
      e.preventDefault();
      panStartRef.current = { x: e.clientX, y: e.clientY };
      document.body.style.cursor = "grabbing";
      return;
    }

    if (e.button !== 0) return;
    if (artisticMenu) return;

    const target = e.target as HTMLElement;
    if (target.closest("[data-artistic-card]")) return;
    if (target.closest("[data-artistic-popup]")) return;
    if (target.closest("[data-click-menu]")) return;

    if (!e.shiftKey) {
      setSelectedCardId(null);
      setSelectedCardIds([]);
      setFocusedBodyCardId(null);
      setEditingCardId(null);
    }

    startCanvasDrag(e.clientX, e.clientY);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const { clientX, clientY } = e;
    const worldPoint = viewportPointToWorld(clientX, clientY);

    pointerWorldPointRef.current = worldPoint;
    setPointerWorldPoint(worldPoint);

    if (isCutMode) {
      setHoveredConnectionKey(findConnectionAtPoint(worldPoint));
    } else if (hoveredConnectionKey !== null) {
      setHoveredConnectionKey(null);
    }

    if (connectingFromCardId) {
      setConnectionPreviewPoint(worldPoint);
    }

  if (dragStart) {
    const worldPoint = viewportPointToWorld(clientX, clientY);
    const dx = Math.abs(worldPoint.x - dragStart.x);
    const dy = Math.abs(worldPoint.y - dragStart.y);

    if (dx > 2 / zoom || dy > 2 / zoom) {
      hasMovedRef.current = true;
    }
  }

  if (isPanning && panStartRef.current) {
    e.preventDefault();
    handlePanMove(clientX, clientY);
    return;
  }

  if (resizingCardId && resizeStartRef.current) {
    e.preventDefault();
    document.body.style.cursor = "se-resize";
    handleResizeMove(clientX, clientY);
    return;
  }

  if (draggingPersistentGroupId && persistentGroupDragStartRef.current) {
    e.preventDefault();

    const start = persistentGroupDragStartRef.current;
    const dx = (clientX - start.pointerX) / zoom;
    const dy = (clientY - start.pointerY) / zoom;

    setArtisticCards((prev) =>
      prev.map((card) => {
        const origin = start.cardPositions[card.id];
        if (!origin) return card;

        return {
          ...card,
          x: origin.x + dx,
          y: origin.y + dy,
        };
      })
    );

    return;
  }

  if (draggingCardId) {
    e.preventDefault();
    handleCardDragMove(clientX, clientY);
    return;
  }

  if (!isDraggingCard || !dragStart) return;

  
  setDragCurrent(worldPoint);
}

  function onWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();

    const viewportPoint = viewportPointFromClient(
      e.clientX,
      e.clientY,
      viewportRef.current
    );
    const zoomFactor = 1.05;

    const nextZoom =
      e.deltaY < 0
        ? Math.min(MAX_ZOOM, zoom * zoomFactor)
        : Math.max(MIN_ZOOM, zoom / zoomFactor);

    if (nextZoom === zoom) return;

    const anchorWorld = viewportPointToWorldAtZoom(
      viewportPoint.x,
      viewportPoint.y,
      panOffset,
      zoom
    );

    setPanOffset({
      x: viewportPoint.x - anchorWorld.x * nextZoom,
      y: viewportPoint.y - anchorWorld.y * nextZoom,
    });

    setZoom(nextZoom);
  }

function cubicBezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x:
      mt3 * p0.x +
      3 * mt2 * t * p1.x +
      3 * mt * t2 * p2.x +
      t3 * p3.x,
    y:
      mt3 * p0.y +
      3 * mt2 * t * p1.y +
      3 * mt * t2 * p2.y +
      t3 * p3.y,
  };
}

function estimateBezierComplexity(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
) {
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const controlNet =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);

  const bendExtra = Math.max(0, controlNet - chord);
  return { chord, controlNet, bendExtra };
}

function distancePointToBezier(
  px: number,
  py: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
) {
  const { chord, controlNet, bendExtra } = estimateBezierComplexity(
    p0,
    p1,
    p2,
    p3
  );

  const approxCurveLength = Math.max(chord, (chord + controlNet) * 0.5);

  const STEPS = Math.max(
    28,
    Math.min(
      120,
      Math.ceil(
        approxCurveLength / 24 +
          bendExtra / 18
      )
    )
  );

  let minDist = Infinity;

  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const pt = cubicBezierPoint(t, p0, p1, p2, p3);
    const dx = px - pt.x;
    const dy = py - pt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minDist) {
      minDist = dist;
    }
  }

  return minDist;
}

function findConnectionAtPoint(point: ScreenPoint | null) {
  if (!point) return null;

  const BASE_HIT_DISTANCE = isCutMode ? 24 : 12;

  for (const { key, from, to } of connections) {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;

    const dx = Math.max(140, Math.abs(x2 - x1) * 0.45);

    const p0 = { x: x1, y: y1 };
    const p1 = { x: x1 + dx, y: y1 };
    const p2 = { x: x2 - dx, y: y2 };
    const p3 = { x: x2, y: y2 };

    const { bendExtra, chord } = estimateBezierComplexity(p0, p1, p2, p3);

    const HIT_DISTANCE = isCutMode
      ? Math.min(32, BASE_HIT_DISTANCE + bendExtra / 120 + chord / 900)
      : BASE_HIT_DISTANCE;

    const dist = distancePointToBezier(point.x, point.y, p0, p1, p2, p3);

    if (dist <= HIT_DISTANCE) {
      return key;
    }
  }

  return null;
}

function findBridgeSnapConnection(bridgeCardId: string) {
  const bridge = artisticCards.find((c) => c.id === bridgeCardId);
  if (!bridge || bridge.type !== "bridge") return null;

  const bridgeAnchors = [
    {
      x: bridge.x,
      y: bridge.y + bridge.h / 2,
    },
    {
      x: bridge.x + bridge.w / 2,
      y: bridge.y + bridge.h / 2,
    },
    {
      x: bridge.x + bridge.w,
      y: bridge.y + bridge.h / 2,
    },
  ];

  const BASE_SNAP_DISTANCE = bridge.bridgeKind === "file_context" ? 58 : 42;

  for (const card of artisticCards) {
    const targetSourceIds =
      card.type === "output"
        ? [
            ...(card.sourceCardId ? [card.sourceCardId] : []),
            ...(card.outputKind === "powerpoint" || card.outputKind === "book_page"
              ? [
                  ...(card.linkedImageCardIds ?? []),
                  ...(card.linkedImageCardId ? [card.linkedImageCardId] : []),
                ]
              : []),
          ]
        : card.type === "bridge"
        ? [
            ...(card.upstreamCardId ? [card.upstreamCardId] : []),
            ...(card.bridgeKind === "image_processor" && card.inputImageCardId
              ? [card.inputImageCardId]
              : []),
          ]
        : [];

    const uniqueTargetSourceIds = Array.from(new Set(targetSourceIds));

    if (uniqueTargetSourceIds.length === 0) continue;

for (const targetSourceId of uniqueTargetSourceIds) {
  const source = artisticCards.find((c) => c.id === targetSourceId);
  if (!source) continue;

    // Allow inserting a bridge into:
    // Prompt → Output
    // Prompt → Bridge
    // Bridge → Output
    // Bridge → Bridge
    // Output → Output
    // Output → Bridge
    if (
      source.type !== "prompt" &&
      source.type !== "bridge" &&
      source.type !== "output"
    ) {
      continue;
    }

    // Avoid snapping a bridge into itself or direct loops.
    if (source.id === bridge.id || card.id === bridge.id) continue;

    const x1 = source.x + source.w;
    const y1 = source.y + source.h / 2;
    const x2 = card.x;
    const y2 = card.y + card.h / 2;

    const dx = Math.max(140, Math.abs(x2 - x1) * 0.45);

    const p0 = { x: x1, y: y1 };
    const p1 = { x: x1 + dx, y: y1 };
    const p2 = { x: x2 - dx, y: y2 };
    const p3 = { x: x2, y: y2 };

    const { bendExtra, chord } = estimateBezierComplexity(p0, p1, p2, p3);

    const SNAP_DISTANCE = Math.min(
      48,
      BASE_SNAP_DISTANCE + bendExtra / 140 + chord / 1100
    );

    const dist = Math.min(
      ...bridgeAnchors.map((anchor) =>
        distancePointToBezier(anchor.x, anchor.y, p0, p1, p2, p3)
      )
    );

    if (dist <= SNAP_DISTANCE) {
      const linkedImageIds =
        card.type === "output" &&
        (card.outputKind === "powerpoint" || card.outputKind === "book_page")
          ? Array.from(
              new Set([
                ...(card.linkedImageCardIds ?? []),
                ...(card.linkedImageCardId ? [card.linkedImageCardId] : []),
              ])
            )
          : [];

      const connectionKey =
        card.type === "output" && linkedImageIds.includes(source.id)
          ? `${source.id}-${card.id}-image`
          : card.type === "bridge" && card.bridgeKind === "image_processor"
          ? `${source.id}-${card.id}-processor-input`
          : card.type === "bridge" && card.bridgeKind === "text_style_processor"
          ? `${source.id}-${card.id}-text-style-input`
          : `${source.id}-${card.id}`;

      return {
        key: connectionKey,
        upstreamId: source.id,
        targetId: card.id,
        targetType: card.type,
      };
    }
  }
}

  return null;
}

function cutConnection(targetKey: string) {
  const match = connections.find((c) => c.key === targetKey);
  if (!match) return;

  const x1 = match.from.x + match.from.w;
  const y1 = match.from.y + match.from.h / 2;
  const x2 = match.to.x;
  const y2 = match.to.y + match.to.h / 2;
  const dx = Math.max(140, Math.abs(x2 - x1) * 0.45);

  setRecentlyCutConnectionGhost({
    key: targetKey,
    x1,
    y1,
    x2,
    y2,
    dx,
  });

  setArtisticCards((prev) =>
    prev.map((card) => {
      if (card.id !== match.to.id) return card;

      if (card.type === "output") {
        if (card.outputKind === "powerpoint" || card.outputKind === "book_page") {
          const linkedIds = Array.from(
            new Set([
              ...(card.linkedImageCardIds ?? []),
              ...(card.linkedImageCardId ? [card.linkedImageCardId] : []),
            ])
          );

          const nextLinkedImageCardIds = linkedIds.filter(
            (id) => id !== match.from.id
          );

          if (nextLinkedImageCardIds.length !== linkedIds.length) {
            return {
              ...card,
              linkedImageCardId:
                card.linkedImageCardId === match.from.id
                  ? undefined
                  : card.linkedImageCardId,
              linkedImageCardIds:
                nextLinkedImageCardIds.length > 0 ? nextLinkedImageCardIds : undefined,
            };
          }
        }

        if (card.sourceCardId === match.from.id) {
          return {
            ...card,
            sourceCardId: undefined,
          };
        }

        return card;
      }

      if (card.type === "bridge") {
        if (
          card.bridgeKind === "image_processor" &&
          (card.inputImageCardId === match.from.id || card.upstreamCardId === match.from.id)
        ) {
          return {
            ...card,
            inputImageCardId: undefined,
            upstreamCardId: undefined,
            processedImageUrl: undefined,
            processorStatus: "idle",
            processorError: undefined,
          };
        }

        if (card.bridgeKind === "summary_bridge" && card.upstreamCardId === match.from.id) {
          return {
            ...card,
            upstreamCardId: undefined,
            summaryBridgeUnlocked: false,
            body:
              "Approved summary gate.\n\nUse the connected upstream output as the source for the next card.",
          };
        }

        if (card.upstreamCardId === match.from.id) {
          return {
            ...card,
            upstreamCardId: undefined,
          };
        }

        return card;
      }

      return card;
    })
  );

  setHoveredConnectionKey(null);

  window.setTimeout(() => {
    setRecentlyCutConnectionGhost((prev) =>
      prev?.key === targetKey ? null : prev
    );
  }, 160);
}

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (connectingFromCardId && connectionPreviewPoint) {
  const SNAP_DISTANCE = 40;

  const sourceCard =
    artisticCards.find((card) => card.id === connectingFromCardId) ?? null;

  const target = artisticCards.find((card) => {
    const slot = getConnectionSlot({
      source: sourceCard,
      target: card,
    });

    if (!slot) return false;

    const cx = card.x;
    const cy = card.y + card.h / 2;

    const dx = cx - connectionPreviewPoint.x;
    const dy = cy - connectionPreviewPoint.y;

    return Math.sqrt(dx * dx + dy * dy) < SNAP_DISTANCE;
  });

  if (target && sourceCard) {
    const slot = getConnectionSlot({
      source: sourceCard,
      target,
    });

    if (slot) {
      setArtisticCards((prev) =>
        prev.map((card) =>
          card.id === target.id
            ? applyConnectionToTarget({
                target: card,
                sourceId: connectingFromCardId,
                slot,
              })
            : card
        )
      );

      setConnectionPulseCardId(target.id);

      window.setTimeout(() => {
        setConnectionPulseCardId((prev) => (prev === target.id ? null : prev));
      }, 220);
    }
  }

  setConnectingFromCardId(null);
  setConnectionPreviewPoint(null);
}

    if (isPanning) {
      panStartRef.current = null;
      document.body.style.cursor = isPanning ? "grab" : "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      return;
    }

    if (resizingCardId) {
      setResizingCardId(null);
      resizeStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      return;
    }

    if (draggingPersistentGroupId) {
      const draggedGroup = persistentGroups.find(
        (group) => group.id === draggingPersistentGroupId
      );

      if (draggedGroup) {
        setSelectedCardIds(draggedGroup.cardIds);
        setSelectedCardId(
          draggedGroup.cardIds[draggedGroup.cardIds.length - 1] ?? null
        );
      }

      ignoreNextCanvasClickRef.current = true;

      setDraggingPersistentGroupId(null);
      persistentGroupDragStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      return;
    }

    if (draggingCardId) {
  const draggedCard = artisticCards.find((c) => c.id === draggingCardId);

  if (draggedCard?.type === "bridge") {
    const snap = findBridgeSnapConnection(draggingCardId);

    if (snap) {
      setArtisticCards((prev) =>
        prev.map((card) => {
          // The dragged bridge receives the original upstream source.
          // For Image Processor bridges, keep both upstreamCardId and inputImageCardId in sync.
          if (card.id === draggingCardId && card.type === "bridge") {
            if (card.bridgeKind === "image_processor") {
              return {
                ...card,
                upstreamCardId: snap.upstreamId,
                inputImageCardId: snap.upstreamId,
                processedImageUrl: undefined,
                processorStatus: "idle",
                processorError: undefined,
              };
            }

            if (card.bridgeKind === "text_style_processor") {
              return {
                ...card,
                upstreamCardId: snap.upstreamId,
                inputTextCardId: snap.upstreamId,
                textStyleProcessorStatus: "idle",
                textStyleProcessorError: undefined,
              };
            }

            return {
              ...card,
              upstreamCardId: snap.upstreamId,
            };
          }

          // If dropping into a visual attachment link:
          // Image → Book Page / PowerPoint
          // becomes:
          // Image → Processor → Book Page / PowerPoint
          if (
            card.id === snap.targetId &&
            card.type === "output" &&
            (card.outputKind === "powerpoint" || card.outputKind === "book_page")
          ) {
            const linkedIds = Array.from(
              new Set([
                ...(card.linkedImageCardIds ?? []),
                ...(card.linkedImageCardId ? [card.linkedImageCardId] : []),
              ])
            );

            const isVisualDropIn = linkedIds.includes(snap.upstreamId);

            if (isVisualDropIn) {
              const nextLinkedImageCardIds = linkedIds.map((id) =>
                id === snap.upstreamId ? draggingCardId : id
              );

              return {
                ...card,
                linkedImageCardId: undefined,
                linkedImageCardIds:
                  nextLinkedImageCardIds.length > 0
                    ? nextLinkedImageCardIds
                    : undefined,
              };
            }
          }

          // If dropping into Image → Image Processor,
          // update the processor input to the dragged bridge.
          if (
            card.id === snap.targetId &&
            card.type === "bridge" &&
            card.bridgeKind === "image_processor" &&
            (card.inputImageCardId === snap.upstreamId ||
              card.upstreamCardId === snap.upstreamId)
          ) {
            return {
              ...card,
              inputImageCardId: draggingCardId,
              upstreamCardId: draggingCardId,
              processedImageUrl: undefined,
              processorStatus: "idle",
              processorError: undefined,
            };
          }

          // Generic output bridge drop-in fallback.
          if (card.id === snap.targetId && card.type === "output") {
            return {
              ...card,
              sourceCardId: draggingCardId,
            };
          }

          // Generic bridge drop-in fallback.
          if (card.id === snap.targetId && card.type === "bridge") {
            return {
              ...card,
              upstreamCardId: draggingCardId,
            };
          }

          return card;
        })
      );
    }
  }

  setBridgeSnapPreviewKey(null);
  setDraggingCardId(null);
  document.body.style.userSelect = "";
  document.body.style.webkitUserSelect = "";
  return;
}

    if (!isDraggingCard || !dragStart || !dragCurrent) {
      setIsDraggingCard(false);
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

        const worldRect = clampRect(dragStart, dragCurrent);
    const threshold = 8 / zoom;

    if (worldRect.w < threshold && worldRect.h < threshold) {
      const clientX = e.clientX;
      const clientY = e.clientY;

      setIsDraggingCard(false);
      setDragStart(null);
      setDragCurrent(null);
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";

      setClickMenu((prev) => {
        if (prev) return null;

        ignoreNextCanvasClickRef.current = true;

        return {
          x: clientX,
          y: clientY,
        };
      });

      return;
    }

    const intersects = (card: ArtisticCard) => {
      const cardLeft = card.x;
      const cardTop = card.y;
      const cardRight = card.x + card.w;
      const cardBottom = card.y + card.h;

      const rectLeft = worldRect.x;
      const rectTop = worldRect.y;
      const rectRight = worldRect.x + worldRect.w;
      const rectBottom = worldRect.y + worldRect.h;

      return !(
        cardRight < rectLeft ||
        cardLeft > rectRight ||
        cardBottom < rectTop ||
        cardTop > rectBottom
      );
    };

    const hitIds = artisticCards
      .filter(intersects)
      .map((card) => card.id);

       if (e.shiftKey) {
      setSelectedCardIds((prev) => Array.from(new Set([...prev, ...hitIds])));
      setSelectedCardId(hitIds[hitIds.length - 1] ?? selectedCardId);
    } else {
      setSelectedCardIds(hitIds);
      setSelectedCardId(hitIds[hitIds.length - 1] ?? null);
    }

    ignoreNextCanvasClickRef.current = true;

    setIsDraggingCard(false);
    setDragStart(null);
    setDragCurrent(null);
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
  }

  function onPointerLeave() {
    document.body.style.cursor = isPanning ? "grab" : "";
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";

    panStartRef.current = null;
    resizeStartRef.current = null;
    pointerWorldPointRef.current = null;
    setPointerWorldPoint(null);
    setHoveredConnectionKey(null);
    setResizingCardId(null);

    if (draggingPersistentGroupId) {
      const draggedGroup = persistentGroups.find(
        (group) => group.id === draggingPersistentGroupId
      );

      if (draggedGroup) {
        setSelectedCardIds(draggedGroup.cardIds);
        setSelectedCardId(
          draggedGroup.cardIds[draggedGroup.cardIds.length - 1] ?? null
        );
      }

      ignoreNextCanvasClickRef.current = true;
    }

    setDraggingPersistentGroupId(null);
    persistentGroupDragStartRef.current = null;
    setDraggingCardId(null);
    setIsDraggingCard(false);
    setDragStart(null);
    setDragCurrent(null);
    setConnectingFromCardId(null);
    setConnectionPreviewPoint(null);
    setBridgeSnapPreviewKey(null);
  }

  function onClick(e: ReactPointerEvent<HTMLDivElement>) {
    if (ignoreNextCanvasClickRef.current) {
      ignoreNextCanvasClickRef.current = false;
      return;
    }

    const target = e.target as HTMLElement;

    const clickedCard = target.closest("[data-artistic-card]");
    const clickedPopup = target.closest("[data-artistic-popup]");
    const clickedClickMenu = target.closest("[data-click-menu]");

    if (!clickedClickMenu) {
      setClickMenu(null);
      setClickMenuSubmenu(null);
    }

    if (artisticMenu) {
      resetArtisticPopup();
    }

       if (!clickedCard && !clickedPopup && !clickedClickMenu) {
      if (editingCardId) {
        setEditingCardId(null);
      }
      setFocusedBodyCardId(null);
      setSelectedCardId(null);
      setSelectedCardIds([]);
      setBridgeSnapPreviewKey(null);
    }
  }

  function onContextMenu(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();

    setClickMenu(null);
    setArtisticMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

const selectionCount = selectedCardIds.length || (selectedCardId ? 1 : 0);

  return (
    <div
      ref={viewportRef}
      className={[
        "relative h-full w-full overflow-hidden",
        isPanning ? "cursor-grab" : "",
      ].join(" ")}
      style={{
        userSelect:
          isPanning || isDraggingCard || !!draggingCardId || !!resizingCardId
            ? "none"
            : undefined,
        WebkitUserSelect:
          isPanning || isDraggingCard || !!draggingCardId || !!resizingCardId
            ? "none"
            : undefined,
      }}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onWheel={onWheel}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className={`absolute inset-0 ${canvasPresetUi.viewportBg}`} />

      <div
        className="absolute left-0 top-0"
        style={{
          width: WORLD_W,
          height: WORLD_H,
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
        <div className={canvasPresetUi.gridClass} />

        {isDraggingCard && dragStart && dragCurrent ? (() => {
          const rect = clampRect(dragStart, dragCurrent);

          return (
            <div
              className="pointer-events-none absolute z-[900] rounded-2xl border border-blue-400/50 bg-blue-500/10 shadow-[0_0_24px_rgba(96,165,250,0.18)]"
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
              }}
            />
          );
        })() : null}

{connectingFromCardId && connectionPreviewPoint ? (() => {
  const source = artisticCards.find((c) => c.id === connectingFromCardId);
  if (!source) return null;

  const x1 = source.x + source.w;
  const y1 = source.y + source.h / 2;
  const x2 = connectionPreviewPoint.x;
  const y2 = connectionPreviewPoint.y;

  const dx = Math.max(140, Math.abs(x2 - x1) * 0.45);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[926] overflow-visible"
      width={WORLD_W}
      height={WORLD_H}
    >
      <g>
        <path
          d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
          fill="none"
            stroke="rgba(96,165,250,0.95)"
            strokeWidth={4}
            style={undefined}
          />
        <circle cx={x1} cy={y1} r="6" fill="rgba(96,165,250,1)" />
        <circle cx={x2} cy={y2} r="5" fill="rgba(96,165,250,0.9)" />
      </g>
    </svg>
  );
})() : null}

<svg
  className={[
    "absolute inset-0 z-[924] overflow-visible",
    isCutMode ? "cursor-crosshair" : "",
  ].join(" ")}
  width={WORLD_W}
  height={WORLD_H}
>
    {connections.map(({ key, from, to }) => {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
const isObsidianGroupUi = cardPreset === "obsidian";
  const dx = Math.max(140, Math.abs(x2 - x1) * 0.45);
  const isHovered = hoveredConnectionKey === key;
  const isCutHovered = isCutMode && isHovered;
  const isBridgeSnapPreview = bridgeSnapPreviewKey === key;

  return (
    <g key={key}>
      <path
        d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke="transparent"
        strokeWidth={isCutMode ? 32 : 20}
        pointerEvents="stroke"
        onPointerDown={(e) => {
          if (!isCutMode) return;
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          if (!isCutMode) return;
          e.stopPropagation();
          e.preventDefault();
          cutConnection(key);
        }}
      />

      <path
        d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
        fill="none"
        pointerEvents="none"
        stroke={
          isCutHovered
            ? "rgba(239,68,68,1)"
            : isBridgeSnapPreview
            ? "rgba(59,130,246,1)"
            : "rgba(96,165,250,0.95)"
        }
        strokeWidth={isCutHovered ? 6 : isBridgeSnapPreview ? 6 : 4}
        strokeLinecap="round"
        strokeDasharray={isCutHovered ? undefined : "10 6"}
        style={{
          filter: isCutHovered
            ? "drop-shadow(0 0 14px rgba(239,68,68,0.85))"
            : isBridgeSnapPreview
            ? "drop-shadow(0 0 14px rgba(59,130,246,0.9))"
            : undefined,
          transition: "stroke 120ms ease, stroke-width 120ms ease, filter 120ms ease",
        }}
      />

      <circle cx={x1} cy={y1} r="6" fill="rgba(96,165,250,1)" pointerEvents="none" />
      <circle cx={x2} cy={y2} r="6" fill="rgba(96,165,250,1)" pointerEvents="none" />
    </g>
  );
})}
</svg>
{recentlyCutConnectionGhost ? (
  <svg
    className="pointer-events-none absolute inset-0 z-[925] overflow-visible"
    width={WORLD_W}
    height={WORLD_H}
  >
    <g>
      <path
        d={`M ${recentlyCutConnectionGhost.x1} ${recentlyCutConnectionGhost.y1} C ${recentlyCutConnectionGhost.x1 + recentlyCutConnectionGhost.dx} ${recentlyCutConnectionGhost.y1}, ${recentlyCutConnectionGhost.x2 - recentlyCutConnectionGhost.dx} ${recentlyCutConnectionGhost.y2}, ${recentlyCutConnectionGhost.x2} ${recentlyCutConnectionGhost.y2}`}
        fill="none"
        stroke="rgba(248,113,113,0.98)"
        strokeWidth={8}
        strokeLinecap="round"
        style={{
          filter: "drop-shadow(0 0 20px rgba(248,113,113,0.95))",
          opacity: 0.95,
          transition: "opacity 160ms ease, stroke-width 160ms ease, filter 160ms ease",
        }}
      />

      <circle
        cx={recentlyCutConnectionGhost.x1}
        cy={recentlyCutConnectionGhost.y1}
        r="7"
        fill="rgba(248,113,113,0.98)"
      />
      <circle
        cx={recentlyCutConnectionGhost.x2}
        cy={recentlyCutConnectionGhost.y2}
        r="7"
        fill="rgba(248,113,113,0.98)"
      />
    </g>
  </svg>
) : null}

{persistentGroupRenderItems.map((group) => (
  <div
    key={group.id}
    className="pointer-events-none absolute z-[760]"
    style={{
      left: group.x,
      top: group.y,
      width: group.w,
      height: group.h,
    }}
  >
    <div
      className={
        isObsidianGroupUi
          ? group.isActive
            ? "absolute inset-0 rounded-[28px] border border-blue-300/45 bg-blue-500/[0.05]"
            : "absolute inset-0 rounded-[28px] border border-blue-400/20 bg-blue-500/[0.025]"
          : group.isActive
            ? "absolute inset-0 rounded-[28px] border border-sky-400 bg-sky-100/80"
            : "absolute inset-0 rounded-[28px] border border-sky-300/80 bg-sky-50/55"
      }
      style={{
        boxShadow: isObsidianGroupUi
          ? group.isActive
            ? "0 0 0 1px rgba(147,197,253,0.18), 0 0 40px rgba(96,165,250,0.16), inset 0 0 36px rgba(96,165,250,0.06)"
            : "0 0 0 1px rgba(96,165,250,0.08), 0 0 20px rgba(96,165,250,0.06), inset 0 0 24px rgba(96,165,250,0.025)"
          : group.isActive
            ? "0 0 0 1px rgba(56,189,248,0.18), 0 0 24px rgba(56,189,248,0.10), inset 0 0 0 1px rgba(255,255,255,0.52)"
            : "0 0 0 1px rgba(56,189,248,0.10), inset 0 0 0 1px rgba(255,255,255,0.36)",
      }}
    />

<div
  className="absolute left-5 top-4 right-5 pointer-events-auto"
  onPointerDown={(e) => e.stopPropagation()}
>
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1">
      <div
        className={
          isObsidianGroupUi
            ? "block max-w-full truncate text-left text-[16px] font-semibold tracking-[0.08em] text-blue-100/80"
            : "block max-w-full truncate text-left text-[16px] font-semibold tracking-[0.08em] text-sky-900/90"
        }
      >
        {group.title.trim() || "Untitled group"}
      </div>

      <div
        className={
          isObsidianGroupUi
            ? "mt-1 text-[10px] uppercase tracking-[0.18em] text-white/32"
            : "mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500"
        }
      >
        Persistent group
      </div>
    </div>

    <div className="flex items-center gap-2 shrink-0">
      <div
        className={
          isObsidianGroupUi
            ? "rounded-full border border-blue-300/20 bg-blue-400/[0.08] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-blue-100/75"
            : "rounded-full border border-sky-300 bg-sky-50/90 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-sky-700 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
        }
      >
        {group.count} cards
      </div>
        <button
          type="button"
          onPointerDown={(e) => startPersistentGroupDrag(e, group.id)}
          className={
            isObsidianGroupUi
              ? "rounded-lg border border-blue-300/20 bg-blue-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-blue-100/75 hover:bg-blue-500/15"
              : "rounded-lg border border-sky-300/70 bg-white/60 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-sky-900/70 hover:bg-white/80"
          }
        >
          Move
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            addSelectedCardsToPersistentGroup(group.id);
          }}
          className={
            isObsidianGroupUi
              ? "rounded-lg border border-emerald-300/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-100/75 hover:bg-emerald-500/15"
              : "rounded-lg border border-emerald-300/70 bg-white/60 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-900/70 hover:bg-white/80"
          }
        >
          + Add selected
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removeSelectedCardsFromPersistentGroup(group.id);
          }}
          className={
            isObsidianGroupUi
              ? "rounded-lg border border-rose-300/20 bg-rose-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-rose-100/75 hover:bg-rose-500/15"
              : "rounded-lg border border-rose-300/70 bg-white/60 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-rose-900/70 hover:bg-white/80"
          }
        >
          − Remove selected
        </button>

      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          e.preventDefault();

          const selectedSet = new Set(group.cardIds);

          setPersistentGroups((prev) =>
            prev.filter((g) => g.id !== group.id)
          );

          setArtisticCards((prev) =>
            prev.map((card) =>
              selectedSet.has(card.id)
                ? { ...card, groupId: undefined }
                : card
            )
          );

          setSelectedCardIds([]);
          setSelectedCardId(null);
          ignoreNextCanvasClickRef.current = true;
        }}
        className={
          isObsidianGroupUi
            ? "rounded-full border border-red-400/30 bg-red-500/[0.08] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-red-300/90 hover:bg-red-500/[0.16]"
            : "rounded-full border border-red-300 bg-red-50/90 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-red-600 hover:bg-red-100"
        }
      >
        Ungroup
      </button>
    </div>
  </div>

  <div
    className={
      isObsidianGroupUi
        ? "mt-6 w-[320px] rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2"
        : "mt-6 w-[320px] rounded-xl border border-slate-300/70 bg-white/80 px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
    }
  >
    <div
      className={
        isObsidianGroupUi
          ? "mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/35"
          : "mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500"
      }
    >
      Group note
    </div>

    <div
      className={
        isObsidianGroupUi
          ? "min-h-[72px] whitespace-pre-wrap text-[11px] leading-5 text-white/60"
          : "min-h-[72px] whitespace-pre-wrap text-[11px] leading-5 text-slate-700"
      }
    >
      {group.note?.trim() || "No note yet"}
    </div>
  </div>
</div>
  </div>
))}

    {selectedGroupBounds ? (
      <div
  className={[
    "absolute z-[923]",
    draggingPersistentGroupId
      ? "cursor-grabbing"
      : isPersistentGroupUi
        ? "cursor-grab"
        : "",
  ].join(" ")}
  style={{
    left: selectedGroupBounds.x,
    top: selectedGroupBounds.y,
    width: selectedGroupBounds.w,
    height: selectedGroupBounds.h,
    pointerEvents: "none",
  }}
>
    <div
      className={
        isObsidianGroupUi
          ? isPersistentGroupUi
            ? "absolute inset-0 rounded-[28px] border border-blue-300/45 bg-blue-500/[0.05]"
            : "absolute inset-0 rounded-[28px] border border-blue-400/25 bg-blue-500/[0.035]"
          : isPersistentGroupUi
            ? "absolute inset-0 rounded-[28px] border border-sky-400 bg-sky-100/80"
            : "absolute inset-0 rounded-[28px] border border-sky-300 bg-sky-100/70"
      }
      style={{
        boxShadow: isObsidianGroupUi
          ? isPersistentGroupUi
            ? "0 0 0 1px rgba(147,197,253,0.18), 0 0 40px rgba(96,165,250,0.16), inset 0 0 36px rgba(96,165,250,0.06)"
            : "0 0 0 1px rgba(96,165,250,0.08), 0 0 32px rgba(96,165,250,0.08), inset 0 0 32px rgba(96,165,250,0.035)"
          : isPersistentGroupUi
            ? "0 0 0 1px rgba(56,189,248,0.18), 0 0 24px rgba(56,189,248,0.10), inset 0 0 0 1px rgba(255,255,255,0.52)"
            : "0 0 0 1px rgba(56,189,248,0.10), inset 0 0 0 1px rgba(255,255,255,0.45)",
      }}
    />

    <div
  className="absolute left-5 top-4 right-5 pointer-events-auto"
  onPointerDown={(e) => e.stopPropagation()}
>
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1">
      {isEditingGroupSurface ? (
        <input
          value={groupSurfaceTitle}
          onChange={(e) => {
            const nextValue = e.target.value;
            setGroupSurfaceTitle(nextValue);

            if (activePersistentGroup) {
              commitPersistentGroupTitle(activePersistentGroup.id, nextValue);
            }
          }}
          onBlur={() => {
            if (activePersistentGroup) {
              commitPersistentGroupTitle(activePersistentGroup.id, groupSurfaceTitle);
            }
            setIsEditingGroupSurface(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setIsEditingGroupSurface(false);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setIsEditingGroupSurface(false);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          autoFocus
          className={
            isObsidianGroupUi
              ? "pointer-events-auto w-full bg-transparent text-[16px] font-semibold tracking-[0.08em] text-blue-100/90 outline-none placeholder:text-white/30"
              : "pointer-events-auto w-full bg-transparent text-[16px] font-semibold tracking-[0.08em] text-sky-900 outline-none placeholder:text-slate-400"
          }
          placeholder="Untitled group"
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditingGroupSurface(true);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={
            isObsidianGroupUi
              ? "pointer-events-auto block max-w-full truncate text-left text-[16px] font-semibold tracking-[0.08em] text-blue-100/88"
              : "pointer-events-auto block max-w-full truncate text-left text-[16px] font-semibold tracking-[0.08em] text-sky-900"
          }
        >
          {groupSurfaceTitle.trim() || "Untitled group"}
        </button>
      )}

      <div
        className={
          isObsidianGroupUi
            ? "mt-1 text-[10px] uppercase tracking-[0.18em] text-white/32"
            : "mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500"
        }
      >
        Selected surface
      </div>

      {isPersistentGroupUi ? (
        <div
          className={
            isObsidianGroupUi
              ? "mt-1 text-[10px] uppercase tracking-[0.18em] text-blue-200/72"
              : "mt-1 text-[10px] uppercase tracking-[0.18em] text-sky-700"
          }
        >
          Persistent group
        </div>
      ) : null}
    </div>

    <div
      className={
        isObsidianGroupUi
          ? isPersistentGroupUi
            ? "shrink-0 rounded-full border border-blue-300/30 bg-blue-400/[0.10] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-blue-100/85"
            : "shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/65"
          : isPersistentGroupUi
            ? "shrink-0 rounded-full border border-sky-300 bg-sky-50/95 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-sky-700 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
            : "shrink-0 rounded-full border border-slate-300/70 bg-white/75 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-700 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      }
    >
      {selectedGroupBounds.count} cards
    </div>
  </div>
</div>

<div
  className={
    isObsidianGroupUi
      ? "absolute left-5 top-[5.2rem] w-[320px] rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2"
      : "absolute left-5 top-[5.2rem] w-[320px] rounded-xl border border-slate-300/70 bg-white/80 px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
  }
  onPointerDown={(e) => e.stopPropagation()}
  onClick={(e) => e.stopPropagation()}
>
  <div
    className={
      isObsidianGroupUi
        ? "mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/35"
        : "mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500"
    }
  >
    Group note
  </div>

  <textarea
    value={groupSurfaceNote}
    onChange={(e) => {
      const nextValue = e.target.value;
      setGroupSurfaceNote(nextValue);

      if (activePersistentGroup) {
        commitPersistentGroupNote(activePersistentGroup.id, nextValue);
      }
    }}
    placeholder="Describe what this grouped surface is for..."
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => e.stopPropagation()}
    onWheel={(e) => e.stopPropagation()}
    onBlur={() => {
      if (activePersistentGroup) {
        commitPersistentGroupNote(activePersistentGroup.id, groupSurfaceNote);
      }
    }}
    className={
      isObsidianGroupUi
        ? "pointer-events-auto min-h-[72px] w-full resize-none bg-transparent text-[11px] leading-5 text-white/60 outline-none placeholder:text-white/28"
        : "pointer-events-auto min-h-[72px] w-full resize-none bg-transparent text-[11px] leading-5 text-slate-700 outline-none placeholder:text-slate-400"
    }
  />
</div>
  </div>
) : null}



        {artisticCards.map((card) => {
          const cardPresetUi = getCardPresetClasses(
            cardPreset,
            isCardActive(card.id)
          );
          const isFrameCard = card.type === "frame";
          const isNotesCard = card.type === "notes";

          return (
            <ArtisticCardView
              repoId={repoId}
              key={card.id}
              card={card}
              artisticCards={artisticCards}
              linkedImageCard={
                card.type === "output" && (card.outputKind === "powerpoint" || card.outputKind === "book_page") && card.linkedImageCardId
                  ? artisticCards.find((candidate) => candidate.id === card.linkedImageCardId) ?? null
                  : null
              }
              isActive={isCardActive(card.id)}
              isPanning={isPanning}
              isDragging={draggingCardId === card.id}
              isResizing={resizingCardId === card.id}
              isEditingTitle={editingCardId === card.id}
              isFrameCard={isFrameCard}
              isNotesCard={isNotesCard}
              cardPresetUi={cardPresetUi}
              viewportPointToWorld={viewportPointToWorld}
              setSelectedCardId={setSelectedCardId}
              setDraggingCardId={setDraggingCardId}
              selectedCardIds={selectedCardIds}
              setSelectedCardIds={setSelectedCardIds}
              multiDragStartPositionsRef={multiDragStartPositionsRef}
              setResizingCardId={setResizingCardId}
              setEditingCardId={setEditingCardId}
              setFocusedBodyCardId={setFocusedBodyCardId}
              setArtisticCards={setArtisticCards}
              updateCard={updateCard}
              commitCardTitle={commitCardTitle}
              commitCardBody={commitCardBody}
              cardDragOffsetRef={cardDragOffsetRef}
              resizeStartRef={resizeStartRef}
              isConnectionPulseActive={connectionPulseCardId === card.id}
              onStartCardDrag={startCardDrag}
              isUpdating={updatingCardIds.includes(card.id)}
              onStartConnection={(card) => {
                setConnectingFromCardId(card.id);
                setConnectionPreviewPoint({
                  x: card.x + card.w,
                  y: card.y + card.h / 2,
                });
              }}
              isConnectionTargetHovered={hoveredConnectionTargetId === card.id}
            />
          );
        })}
      </div>

      <div className="pointer-events-none absolute bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-2 select-none">
        {selectionCount > 0 ? (
          <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-700 backdrop-blur-xl">
            {selectionCount} {selectionCount === 1 ? "card" : "cards"} selected
          </div>
        ) : null}

        <div className="rounded-2xl border border-black/10 bg-white/35 px-4 py-2 text-xs text-black/55 backdrop-blur-xl">
          {isCutMode
            ? "Cut mode active · click a connection to disconnect"
            : "Right-click anywhere on the canvas to summon Vestaryn"}
        </div>
      </div>

      <ArtisticClickMenu
        clickMenu={clickMenu}
        clickMenuSubmenu={clickMenuSubmenu}
        viewportRef={viewportRef}
        setClickMenu={setClickMenu}
        setClickMenuSubmenu={setClickMenuSubmenu}
        viewportPointToWorld={viewportPointToWorld}
        createMenuCard={createMenuCard}
        cardPreset={cardPreset}
      />

      <ArtisticSummonPopup
        artisticMenu={artisticMenu}
        artisticPrompt={artisticPrompt}
        artisticMessages={artisticMessages}
        artisticSending={artisticSending}
        artisticError={artisticError}
        setArtisticMenu={setArtisticMenu}
        setArtisticPrompt={setArtisticPrompt}
        setArtisticMessages={setArtisticMessages}
        setArtisticError={setArtisticError}
        sendArtisticPrompt={sendArtisticPrompt}
        cardPreset={cardPreset}
      />
    </div>
  );
}