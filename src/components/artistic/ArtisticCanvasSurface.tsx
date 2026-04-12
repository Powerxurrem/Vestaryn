"use client";

import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
  WheelEvent as ReactWheelEvent,
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
  ArtisticCard,
  ArtisticCardType,
  PanOffset,
  ScreenPoint,
} from "@/lib/artistic/types";

type ArtisticMessage = {
  role: "user" | "assistant";
  content: string;
};

type ArtisticCanvasSurfaceProps = {
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
  editingCardId: string | null;
  setEditingCardId: Dispatch<SetStateAction<string | null>>;
  focusedBodyCardId: string | null;
  setFocusedBodyCardId: Dispatch<SetStateAction<string | null>>;
  setPendingNewCardId: Dispatch<SetStateAction<string | null>>;
  artisticCards: ArtisticCard[];
  setArtisticCards: Dispatch<SetStateAction<ArtisticCard[]>>;
  clickMenu: ScreenPoint | null;
  setClickMenu: Dispatch<SetStateAction<ScreenPoint | null>>;
  clickMenuSubmenu: null | "new-card";
  setClickMenuSubmenu: Dispatch<SetStateAction<null | "new-card">>;
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
  panStartRef: RefObject<{ x: number; y: number } | null>;
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
};

export default function ArtisticCanvasSurface({
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
  resetArtisticPopup,
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
      draggingCardId === cardId ||
      resizingCardId === cardId ||
      editingCardId === cardId ||
      focusedBodyCardId === cardId
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

  function createMenuCard(
    worldX: number,
    worldY: number,
    opts?: {
      type?: ArtisticCardType;
      w?: number;
      h?: number;
      title?: string;
      body?: string;
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
      },
    ]);

    setSelectedCardId(newCardId);
    setPendingNewCardId(newCardId);
    setClickMenu(null);
    setClickMenuSubmenu(null);
  }

function startCanvasDrag(clientX: number, clientY: number) {
  const worldPoint = viewportPointToWorld(clientX, clientY);

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

function handleResizeMove(clientX: number, clientY: number) {
  const start = resizeStartRef.current;
  if (!start || !resizingCardId) return;

  const worldPoint = viewportPointToWorld(clientX, clientY);

  const nextW = Math.max(
    MIN_CARD_W,
    start.startW + (worldPoint.x - start.startX)
  );
  const nextH = Math.max(
    MIN_CARD_H,
    start.startH + (worldPoint.y - start.startY)
  );

  setArtisticCards((prev) =>
    prev.map((card) =>
      card.id === resizingCardId
        ? { ...card, w: nextW, h: nextH }
        : card
    )
  );
}

function handleCardDragMove(clientX: number, clientY: number) {
  if (!draggingCardId) return;

  const worldPoint = viewportPointToWorld(clientX, clientY);

  setArtisticCards((prev) =>
    prev.map((card) =>
      card.id === draggingCardId
        ? {
            ...card,
            x: worldPoint.x - cardDragOffsetRef.current.x,
            y: worldPoint.y - cardDragOffsetRef.current.y,
          }
        : card
    )
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

    startCanvasDrag(e.clientX, e.clientY);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
  const { clientX, clientY } = e;

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

  if (draggingCardId) {
    e.preventDefault();
    handleCardDragMove(clientX, clientY);
    return;
  }

  if (!isDraggingCard || !dragStart) return;

  const worldPoint = viewportPointToWorld(clientX, clientY);
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

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
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

    if (draggingCardId) {
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

    if (worldRect.w >= 80 && worldRect.h >= 60) {
      const newCardId = makeCardId();

      setArtisticCards((prev) => [
        ...prev,
        {
          id: newCardId,
          type: "default",
          x: worldRect.x,
          y: worldRect.y,
          w: worldRect.w,
          h: worldRect.h,
          title: "Untitled card",
          body: "Floating canvas card",
        },
      ]);

      setPendingNewCardId(newCardId);
    }

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
    setResizingCardId(null);
    setDraggingCardId(null);
    setIsDraggingCard(false);
    setDragStart(null);
    setDragCurrent(null);
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

  return (
    <div
      ref={viewportRef}
      className={[
        "relative h-full w-full overflow-hidden",
        isPanning ? "cursor-grab" : "",
      ].join(" ")}
      style={{
        userSelect:
          isPanning || !!draggingCardId || !!resizingCardId
            ? "none"
            : undefined,
        WebkitUserSelect:
          isPanning || !!draggingCardId || !!resizingCardId
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

        {artisticCards.map((card) => {
          const cardPresetUi = getCardPresetClasses(
            cardPreset,
            isCardActive(card.id)
          );
          const isFrameCard = card.type === "frame";
          const isNotesCard = card.type === "notes";

          return (
            <ArtisticCardView
              key={card.id}
              card={card}
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
              setResizingCardId={setResizingCardId}
              setEditingCardId={setEditingCardId}
              setFocusedBodyCardId={setFocusedBodyCardId}
              setArtisticCards={setArtisticCards}
              updateCard={updateCard}
              commitCardTitle={commitCardTitle}
              commitCardBody={commitCardBody}
              cardDragOffsetRef={cardDragOffsetRef}
              resizeStartRef={resizeStartRef}
            />
          );
        })}
      </div>

      <div className="pointer-events-none absolute bottom-12 left-1/2 select-none -translate-x-1/2 rounded-2xl border border-black/10 bg-white/35 px-4 py-2 text-xs text-black/55 backdrop-blur-xl">
        Right-click anywhere on the canvas to summon Vestaryn
      </div>

      <ArtisticClickMenu
        clickMenu={clickMenu}
        clickMenuSubmenu={clickMenuSubmenu}
        viewportRef={viewportRef}
        setClickMenu={setClickMenu}
        setClickMenuSubmenu={setClickMenuSubmenu}
        viewportPointToWorld={viewportPointToWorld}
        createMenuCard={createMenuCard}
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
      />
    </div>
  );
}