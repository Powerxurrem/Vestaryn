"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import ArtisticCanvasControls from "@/components/artistic/ArtisticCanvasControls";
import ArtisticCanvasSurface from "@/components/artistic/ArtisticCanvasSurface";
import type {
  ArtisticCard,
  ArtisticCardType,
  PanOffset,
  ScreenPoint,
} from "@/lib/artistic/types";
import {
  clampRect,
  getCanvasPresetClasses,
  getCardPresetClasses,
  makeCardId,
  viewportPointFromClient,
  viewportPointToWorldAtZoom,
} from "@/lib/artistic/canvasUtils";


type Tier = "free" | "early_access" | "builder" | "pro" | "elite";

const TIER_KEY = "vestaryn.tier";

function getTier(): Tier {
  const v =
    typeof window !== "undefined" ? localStorage.getItem(TIER_KEY) : null;
  return v === "early_access" || v === "builder" || v === "pro" || v === "elite"
    ? v
    : "free";
}
function titleCaseTier(tier: Tier) {
  if (tier === "early_access") return "Early Access";
  return tier.slice(0, 1).toUpperCase() + tier.slice(1);
}
function titleCase(s: string) {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2 rounded-lg text-sm",
        danger
          ? "text-rose-200/90 hover:bg-rose-500/10"
          : "text-white/75 hover:bg-white/5",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Sigil({
  active = false,
  onClick,
}: {
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center justify-center mt-12 group cursor-pointer"
    >
      {/* glow */}
<div
  className={[
    "absolute h-20 w-20 rounded-full bg-blue-500/20 blur-2xl transition-all duration-200",
    active
      ? "opacity-90 scale-110"
      : "opacity-60 group-hover:opacity-90 group-hover:scale-110",
  ].join(" ")}
/>

      {/* border diamond */}
      <div
        className="relative flex items-center justify-center"
        style={{
          clipPath: "polygon(50% 0%,100% 50%,50% 100%,0% 50%)",
        }}
      >
<div
  className={[
    "h-[92px] w-[92px] flex items-center justify-center transition-all duration-200",
    active
      ? "bg-blue-400/50"
      : "bg-blue-400/35 group-hover:bg-blue-400/45",
  ].join(" ")}
>
          <div
            className="relative h-[86px] w-[86px] overflow-hidden transition-transform duration-200 group-hover:scale-[1.04]"
            style={{
              clipPath: "polygon(50% 0%,100% 50%,50% 100%,0% 50%)",
            }}
          >
            <img
              src="/vestaryn_avatar.png"
              alt="Vestaryn Sigil"
              className="absolute inset-0 h-full w-full object-cover opacity-90"
            />
          </div>
        </div>
      </div>

      {/* tooltip */}
      <div className="pointer-events-none absolute top-full mt-2 rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[10px] uppercase tracking-wide text-white/70 opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 backdrop-blur-md">
        Chamber Core
      </div>
    </button>
  );
}

export function VestarynFrame({
  repoId,
  repoName,
  messageCount = 0,
  right,
  children,
}: {
  repoId: string;
  repoName?: string | null;
  messageCount?: number;
  right?: ReactNode;
  children: ReactNode;
}) {

  const [coreOpen, setCoreOpen] = useState(false);
  type CoreView = "menu" | "capabilities" | "calibration";
  const [coreView, setCoreView] = useState<CoreView>("menu");
  const coreRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [appMode, setAppMode] = useState<"engineering" | "artistic">("artistic");
  const [artisticMenu, setArtisticMenu] = useState<{ x: number; y: number } | null>(null);
  const [artisticPrompt, setArtisticPrompt] = useState("");
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [artisticMessages, setArtisticMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [artisticCards, setArtisticCards] = useState<ArtisticCard[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("vestaryn_artistic_canvas");
      if (!raw) return;
      setArtisticCards(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "vestaryn_artistic_canvas",
        JSON.stringify(artisticCards)
      );
    } catch (e) {
      console.warn("Failed to persist canvas", e);
    }
  }, [artisticCards]);
  const [clickMenu, setClickMenu] = useState<ScreenPoint | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [connectionPulseCardId, setConnectionPulseCardId] = useState<string | null>(null);
  const [updatingCardIds, setUpdatingCardIds] = useState<string[]>([]);

useEffect(() => {
  setArtisticCards((prev) => {
    let changed = false;

    const next = prev.map((card) => {
      if (card.type !== "output" || card.outputKind !== "powerpoint") {
        return card;
      }

      if (card.w === PPT_CARD_W && card.h === PPT_CARD_H) {
        return card;
      }

      changed = true;

      return {
        ...card,
        w: PPT_CARD_W,
        h: PPT_CARD_H,
      };
    });

    return changed ? next : prev;
  });
}, [artisticCards]);

  async function copyRepoId() {
    try {
      await navigator.clipboard.writeText(repoId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  type ArtisticOutputKind = ArtisticCard["outputKind"];

  type ArtisticPresentationPayload = {
    title?: string;
    subject?: string;
    body: string;
  };

  function resolveArtisticInputChain(
  cards: ArtisticCard[],
  output: ArtisticCard
): {
  prompt: ArtisticCard | null;
  bridge: ArtisticCard | null;
} {
  const direct = cards.find((c) => c.id === output.sourceCardId) ?? null;
  if (!direct) return { prompt: null, bridge: null };

  if (direct.type === "prompt") {
    return { prompt: direct, bridge: null };
  }

  if (direct.type === "output") {
    return { prompt: direct, bridge: null };
  }

  if (direct.type === "bridge") {
    const upstream =
      cards.find((c) => c.id === direct.upstreamCardId) ?? null;

    if (!upstream) return { prompt: null, bridge: direct };

    if (upstream.type === "prompt" || upstream.type === "output") {
      return { prompt: upstream, bridge: direct };
    }

    return { prompt: null, bridge: direct };
  }

  return { prompt: null, bridge: null };
}

  function stripSystemArtifacts(input: string) {
    return input
      .replace(/__PROPOSAL__[\s\S]*/gi, "")
      .replace(/__VERIFY__[\s\S]*/gi, "")
      .replace(/__APPLY__[\s\S]*/gi, "")
      .trim();
  }

  function buildArtisticPresentationPayload(
    raw: string,
    outputKind: ArtisticOutputKind,
    outputRole?: ArtisticCard["outputRole"]
  ): ArtisticPresentationPayload {
    const source = stripSystemArtifacts(String(raw ?? "").trim());

    const obsMatch = source.match(
      /\[Observation\]\s*([\s\S]*?)(?=\[Assessment\]|\[Action\]|$)/i
    );
    const assMatch = source.match(
      /\[Assessment\]\s*([\s\S]*?)(?=\[Action\]|$)/i
    );
    const actMatch = source.match(
      /\[Action\]\s*([\s\S]*?)(?=\n\[|$)/i
    );

    const observation = obsMatch?.[1]?.trim() ?? "";
    const assessment = assMatch?.[1]?.trim() ?? "";
    const action = actMatch?.[1]?.trim() ?? "";

    const preferred = action || assessment || observation || source;

    if (outputKind === "powerpoint") {
      return {
        body: preferred,
      };
    }

    if (outputKind !== "text") {
      return {
        body: preferred,
      };
    }

    if (outputRole === "email") {
      const subjectMatch = preferred.match(/SUBJECT:\s*(.*)/i);
      const bodyMatch = preferred.match(/BODY:\s*([\s\S]*)/i);

      if (subjectMatch || bodyMatch) {
        const cleanedBody = (
          bodyMatch?.[1]?.trim() ||
          preferred.replace(/^SUBJECT:\s*.*(?:\r?\n)+/i, "").trim()
        );

        return {
          subject: subjectMatch?.[1]?.trim() || "",
          body: cleanedBody,
        };
      }

      return {
        subject: "",
        body: preferred.replace(/^SUBJECT:\s*.*(?:\r?\n)+/i, "").trim(),
      };
    }

  const titleMatch = preferred.match(/TITLE:\s*(.*)/i);
  const bodyMatch = preferred.match(/BODY:\s*([\s\S]*)/i);

  if (titleMatch || bodyMatch) {
    return {
      title: titleMatch?.[1]?.trim() || "",
      body: bodyMatch?.[1]?.trim() || preferred,
    };
  }

  return {
    title: "",
    body: preferred,
  };
}

  function formatArtisticPayloadForCard(
    payload: ArtisticPresentationPayload,
    outputKind: ArtisticOutputKind,
    outputRole?: ArtisticCard["outputRole"]
  ) {
    if (outputKind !== "text") {
      return payload.body;
    }

    if (outputRole === "email") {
      return payload.subject
        ? `SUBJECT: ${payload.subject}\nBODY: ${payload.body}`
        : payload.body;
    }

    return payload.title
      ? `TITLE: ${payload.title}\nBODY: ${payload.body}`
      : payload.body;
  }

  function resetArtisticPopup() {
    setArtisticMenu(null);
    setArtisticPrompt("");
    setArtisticMessages([]);
    setArtisticError(null);
  }

  const [focusedBodyCardId, setFocusedBodyCardId] = useState<string | null>(null);
  const [artisticSending, setArtisticSending] = useState(false);
  const [artisticError, setArtisticError] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [pendingNewCardId, setPendingNewCardId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 3; 
  const [draggingCardId, setDraggingCardId] = useState<string |   null>(null);
  const cardDragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const multiDragStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const [panOffset, setPanOffset] = useState<PanOffset>({
    x: 2400,
    y: 2400,
  });
  const [isRunningArtisticOutputs, setIsRunningArtisticOutputs] =
    useState(false);
  const [bridgeSnapPreviewKey, setBridgeSnapPreviewKey] =   useState<string | null>(null);
  const [connectingFromCardId, setConnectingFromCardId] =   useState<string | null>(null);
  const [connectionPreviewPoint, setConnectionPreviewPoint] =   useState<ScreenPoint | null>(null);
  const [clickMenuSubmenu, setClickMenuSubmenu] = useState<
    null | "new-card" | "outputs" | "text-output"
  >(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [canvasPreset, setCanvasPreset] = useState<"soft" | "grid" | "obsidian">("soft");
  const [cardPreset, setCardPreset] = useState<"glass" | "solid" | "obsidian">("glass");
  const WORLD_W = 8000;
  const WORLD_H = 8000;
  const hasMovedRef = useRef(false);
  const ignoreNextCanvasClickRef = useRef(false);
  const [resizingCardId, setResizingCardId] = useState<string | null>(null);
  const resizeStartRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const MIN_CARD_W = 140;
  const MIN_CARD_H = 90;

  const PPT_CARD_W = 960;
  const PPT_CARD_H = 540;

  function zoomFromViewportCenter(nextZoom: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportX = rect.width / 2;
    const viewportY = rect.height / 2;

    const anchorWorld = viewportPointToWorldAtZoom(
      viewportX,
      viewportY,
      panOffset,
      zoom
    );

    setPanOffset({
      x: viewportX - anchorWorld.x * nextZoom,
      y: viewportY - anchorWorld.y * nextZoom,
    });
    setZoom(nextZoom);
  }



  function handleZoomOut() {
    const nextZoom = Math.max(MIN_ZOOM, zoom / 1.08);
    if (nextZoom === zoom) return;
    zoomFromViewportCenter(nextZoom);
  }

  function handleZoomIn() {
    const nextZoom = Math.min(MAX_ZOOM, zoom * 1.08);
    if (nextZoom === zoom) return;
    zoomFromViewportCenter(nextZoom);
  }

  function handleResetView() {
    setZoom(1);
    setPanOffset({ x: 2400, y: 2400 });
  }

useEffect(() => {
  function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const isTypingTarget =
      tag === "input" ||
      tag === "textarea" ||
      target?.isContentEditable;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      if (isTypingTarget) return;

      e.preventDefault();

      const selectedSet = new Set(
        selectedCardIds.length > 0
          ? selectedCardIds
          : selectedCardId
            ? [selectedCardId]
            : []
      );

      if (selectedSet.size === 0) return;

      const DUPLICATE_OFFSET_X = 36;
      const DUPLICATE_OFFSET_Y = 36;

      const duplicatedIds: string[] = [];

      setArtisticCards((prev) => {
        const cardsToDuplicate = prev.filter((card) => selectedSet.has(card.id));
        if (cardsToDuplicate.length === 0) return prev;

        const idMap = new Map<string, string>();

        for (const card of cardsToDuplicate) {
          idMap.set(card.id, makeCardId());
        }

        const duplicatedCards = cardsToDuplicate.map((card) => {
          const nextId = idMap.get(card.id)!;
          duplicatedIds.push(nextId);

          const duplicatedCard: ArtisticCard = {
            ...card,
            id: nextId,
            x: card.x + DUPLICATE_OFFSET_X,
            y: card.y + DUPLICATE_OFFSET_Y,
          };

          if (card.links?.length) {
            duplicatedCard.links = card.links
              .filter((linkedId) => idMap.has(linkedId))
              .map((linkedId) => idMap.get(linkedId)!);
          }

          if (card.sourceCardId && idMap.has(card.sourceCardId)) {
            duplicatedCard.sourceCardId = idMap.get(card.sourceCardId)!;
          } else if (card.sourceCardId) {
            duplicatedCard.sourceCardId = undefined;
          }

          if (card.upstreamCardId && idMap.has(card.upstreamCardId)) {
            duplicatedCard.upstreamCardId = idMap.get(card.upstreamCardId)!;
          } else if (card.upstreamCardId) {
            duplicatedCard.upstreamCardId = undefined;
          }

          return duplicatedCard;
        });

        return [...prev, ...duplicatedCards];
      });

      if (duplicatedIds.length > 0) {
        setSelectedCardId(duplicatedIds[duplicatedIds.length - 1] ?? null);
        setSelectedCardIds(duplicatedIds);
        setEditingCardId(null);
        setFocusedBodyCardId(null);
        setDraggingCardId(null);
        setResizingCardId(null);
        setConnectingFromCardId(null);
        setConnectionPreviewPoint(null);
        setConnectionPulseCardId(null);
        setBridgeSnapPreviewKey(null);
        setClickMenu(null);
        setClickMenuSubmenu(null);
        setArtisticMenu(null);
      }

      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (isTypingTarget) return;

      const idsToDelete =
        selectedCardIds.length > 0
          ? selectedCardIds
          : selectedCardId
            ? [selectedCardId]
            : [];

      if (idsToDelete.length === 0) return;

      e.preventDefault();

      const deleteSet = new Set(idsToDelete);

      setArtisticCards((prev) =>
        prev
          .filter((card) => !deleteSet.has(card.id))
          .map((card) => ({
            ...card,
            links: card.links?.filter((id) => !deleteSet.has(id)),
            sourceCardId:
              card.sourceCardId && deleteSet.has(card.sourceCardId)
                ? undefined
                : card.sourceCardId,
            upstreamCardId:
              card.upstreamCardId && deleteSet.has(card.upstreamCardId)
                ? undefined
                : card.upstreamCardId,
          }))
      );

      setSelectedCardId(null);
      setSelectedCardIds([]);
      setEditingCardId(null);
      setFocusedBodyCardId(null);
      setDraggingCardId(null);
      setResizingCardId(null);
      setConnectingFromCardId(null);
      setConnectionPreviewPoint(null);
      setConnectionPulseCardId(null);
      setBridgeSnapPreviewKey(null);
      setClickMenu(null);
      setClickMenuSubmenu(null);
      setArtisticMenu(null);
      return;
    }

    if (e.key === "Escape") {
      if (isTypingTarget) return;

      setSelectedCardId(null);
      setSelectedCardIds([]);
      setEditingCardId(null);
      setFocusedBodyCardId(null);
      setDraggingCardId(null);
      setResizingCardId(null);
      setConnectingFromCardId(null);
      setConnectionPreviewPoint(null);
      setConnectionPulseCardId(null);
      setBridgeSnapPreviewKey(null);
      setClickMenu(null);
      setClickMenuSubmenu(null);
      setArtisticMenu(null);
      return;
    }

    if (e.code === "Space") {
      if (isTypingTarget) {
        return;
      }

      e.preventDefault();

      setClickMenu(null);
      setClickMenuSubmenu(null);
      setArtisticMenu(null);
      setArtisticPrompt("");
      setArtisticMessages([]);
      setArtisticError(null);
      setEditingCardId(null);

      document.body.style.cursor = "grab";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      setIsPanning(true);
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.code === "Space") {
      setIsPanning(false);
      panStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    }
  }

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
  };
}, [
  selectedCardId,
  selectedCardIds,
  setArtisticCards,
  setSelectedCardId,
  setSelectedCardIds,
  setEditingCardId,
  setFocusedBodyCardId,
  setDraggingCardId,
  setResizingCardId,
  setConnectingFromCardId,
  setConnectionPreviewPoint,
  setConnectionPulseCardId,
  setBridgeSnapPreviewKey,
  setClickMenu,
  setClickMenuSubmenu,
  setArtisticMenu,
  setArtisticPrompt,
  setArtisticMessages,
  setArtisticError,
]);

async function onLogout() {
  setCoreOpen(false);
  const supabase = supabaseBrowser();
  await supabase.auth.signOut();
  window.location.href = "/";
}

async function sendArtisticPrompt() {
  const prompt = artisticPrompt.trim();
  if (!prompt || artisticSending) return;

  setArtisticSending(true);
  setArtisticError(null);

  try {
    const res = await fetch(`/api/repo/${repoId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content:
          `[Artistic Mode]\n` +
          `Creative ideation request. Favor vivid, imaginative language in the response content.\n` +
          `Inside [Action], return ONLY the final result.\n` +
          `Do not explain the request unless necessary.\n\n` +
          prompt,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Request failed (${res.status})`);
    }

    const raw = await res.text();
    console.log("[artistic send] raw response", raw);

    let reply = "";
    const trimmed = raw.trim();

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const data = JSON.parse(trimmed);
        console.log("[artistic send] parsed response", data);

        reply =
          typeof data?.assistant === "string"
            ? data.assistant
            : typeof data?.content === "string"
            ? data.content
            : typeof data?.message === "string"
            ? data.message
            : typeof data?.reply === "string"
            ? data.reply
            : typeof data?.text === "string"
            ? data.text
            : typeof data?.output_text === "string"
            ? data.output_text
            : typeof data?.raw === "string"
            ? data.raw
            : typeof data?.assistantText === "string"
            ? data.assistantText
            : "";
      } catch {
        reply = trimmed;
      }
    } else {
      reply = trimmed;
    }

    const payload = buildArtisticPresentationPayload(
      reply || "Vestaryn returned no visible reply.",
      "text"
    );

    const formatted = formatArtisticPayloadForCard(payload, "text");

    setArtisticMessages((prev) => [
      ...prev,
      { role: "user", content: prompt },
      { role: "assistant", content: formatted },
    ]);

    setArtisticPrompt("");
  } catch (err) {
    setArtisticError(err instanceof Error ? err.message : "Failed to send prompt.");
  } finally {
    setArtisticSending(false);
  }
}

function mapToVisualConcept(raw: string) {
  const text = raw.toLowerCase();

  if (text.includes("growth") || text.includes("sales")) {
    return "rising bars and upward arrow";
  }

  if (text.includes("decline") || text.includes("drop")) {
    return "descending bars or downward curve";
  }

  if (text.includes("performance")) {
    return "dashboard-style abstract panels";
  }

  return raw;
}

function buildVisualPrompt(raw: string) {
  const cleaned = String(raw ?? "").replace(/\s+/g, " ").trim();

  return `
A modern, minimal, professional presentation-style illustration.

Style:
- clean corporate design
- soft gradients
- blue and teal color palette
- subtle depth and shadows
- high quality, minimal composition

Rules:
- no text
- no letters or numbers
- no logos
- no people
- no faces
- no realistic scenes
- no brands

Visual metaphor:
${cleaned}

Output:
abstract, symbolic, presentation-ready visual
`.trim();
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

useEffect(() => {
  if (!pendingNewCardId) return;

  setEditingCardId(pendingNewCardId);
  setPendingNewCardId(null);
}, [pendingNewCardId]);

useEffect(() => {
  function onDown(e: PointerEvent) {
    if (!coreOpen) return;
    const el = coreRef.current;
    if (!el) return;
    if (!el.contains(e.target as Node)) {
      setCoreOpen(false);
      setCoreView("menu");
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      setCoreOpen(false);
      setCoreView("menu");
    }
  }



  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
  };
}, [coreOpen]);

function isUnfilledSummaryBridge(card: ArtisticCard | null) {
  if (!card) return false;

  return (
    card.type === "bridge" &&
    card.bridgeKind === "summary_bridge" &&
    (
      !card.body.trim() ||
      card.body.includes("Approved summary gate.")
    )
  );
}

function isSummaryBridge(card: ArtisticCard | null) {
  return card?.type === "bridge" && card.bridgeKind === "summary_bridge";
}

function markArtisticCardUpdating(cardId: string) {
  setUpdatingCardIds((prev) =>
    prev.includes(cardId) ? prev : [...prev, cardId]
  );
}

function clearArtisticCardUpdating(cardId: string) {
  setUpdatingCardIds((prev) => prev.filter((id) => id !== cardId));
}

async function runArtisticOutputs(targetOutputIds?: string[]) {

if (isRunningArtisticOutputs) return;

setIsRunningArtisticOutputs(true);


 try {
  const targetSet = targetOutputIds?.length
    ? new Set(targetOutputIds)
    : null;

  const runnableOutputs = artisticCards
    .filter((card) => {
      if (card.type !== "output" || !card.sourceCardId) return false;
      if (targetSet && !targetSet.has(card.id)) return false;
      return true;
    })
    .map((output) => {
      const { prompt, bridge } = resolveArtisticInputChain(artisticCards, output);
      if (!prompt) return null;
      return { output, prompt, bridge };
    })
    .filter(
      (
        item
      ): item is {
        output: ArtisticCard;
        prompt: ArtisticCard;
        bridge: ArtisticCard | null;
      } => item !== null
    );

  if (runnableOutputs.length === 0) return;

  setArtisticCards((prev) =>
    prev.map((card) =>
      runnableOutputs.some((item) => item.output.id === card.id)
        ? {
            ...card,
            body: "Generating...",
            imageStatus:
              card.outputKind === "image" ? "generating" : card.imageStatus,
            imageUrl: card.outputKind === "image" ? undefined : card.imageUrl,
          }
        : card
    )
  );

  for (const item of runnableOutputs) {
    markArtisticCardUpdating(item.output.id);

    if (item.bridge?.id) {
      markArtisticCardUpdating(item.bridge.id);
    }

    try {
      const role = item.output.outputRole ?? "summary";

      const roleToneBlock =
        role === "email"
          ? `Tone: professional, persuasive, confident.\n` +
            `Style: structured communication, clear paragraphs, strong opening and closing.\n`
          : role === "report"
          ? `Tone: informative and thorough.\n` +
            `Style: structured, readable, and clear.\n`
          : `Tone: clear and balanced.\n` +
            `Style: concise but informative.\n`;

      const roleFocusBlock =
        role === "report"
          ? `Expand with supporting explanations and context where useful.\n`
          : role === "summary"
          ? `Prioritize clarity and brevity.\n`
          : "";

      let sourceBody = item.prompt.body;

const isSummaryGate = isSummaryBridge(item.bridge);

// Summary Bridge behavior:
// LOCKED   = fill/update the bridge summary only, then stop.
// UNLOCKED = use the approved bridge body as downstream source.
if (isSummaryGate) {
  if (!item.bridge!.summaryBridgeUnlocked) {
    const res = await fetch(`/api/repo/${repoId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content:
          `[Artistic Mode]\n` +
          `Create a readable approved brief from the upstream content.\n\n` +

          `Write AS the content itself.\n` +
          `NOT ABOUT the content.\n\n` +

          `Do NOT describe what should be created.\n` +
          `Do NOT give instructions.\n` +
          `Do NOT speak about "the requested content".\n` +
          `Do NOT explain the task.\n\n` +

          `Format the result with this exact structure:\n\n` +
          `Core message:\n` +
          `One clear sentence capturing the main point.\n\n` +
          `Key points:\n` +
          `- Point one\n` +
          `- Point two\n` +
          `- Point three\n\n` +
          `Implication:\n` +
          `One clear sentence explaining why it matters.\n\n` +

          `Rules:\n` +
          `- Use short, readable sentences.\n` +
          `- Avoid dense paragraphs.\n` +
          `- Keep it executive-readable.\n` +
          `- Preserve the actual meaning of the upstream content.\n\n` +

          `Inside [Action], return ONLY the approved brief itself.\n` +
          `Do not create PowerPoint content yet.\n` +
          `Do not include internal markers.\n\n` +

          `${sourceBody}`,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Summary bridge failed (${res.status})`);
    }

    const raw = await res.text();

    const payload = buildArtisticPresentationPayload(
      raw || "No summary returned.",
      "text",
      "summary"
    );

    setArtisticCards((prev) =>
      prev.map((card) =>
        card.id === item.bridge!.id
          ? {
              ...card,
              body: payload.body,
            }
          : card
      )
    );

    // Important: locked gate stops here.
    // It updates the bridge, but does NOT run the downstream output.
    continue;
  }

  // Gate is unlocked: downstream output uses the approved bridge body.
  sourceBody = item.bridge!.body;
}


      
      const bridgeContext =
        item.bridge?.bridgeKind === "file_context"
          ? `\n\nFile context instruction:\n${item.bridge.body}\n\nContext source: ${
              item.bridge.contextFileName ?? "Unnamed file"
            }\n\nContext content:\n${item.bridge.contextText ?? ""}`
            : item.bridge?.bridgeKind === "summary_bridge"
            ? `\n\nSummary bridge instruction:
            Use the Summary Bridge body as the approved source material.
            Do not invent a new topic.
            Convert only the approved summary into the requested downstream format.`
            : "";

      if (item.output.outputKind === "image") {
        const concept = mapToVisualConcept(sourceBody);
        const imagePrompt = buildVisualPrompt(concept);

        const imageRes = await fetch(`/api/artistic/image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: imagePrompt,
          }),
        });

        if (!imageRes.ok) {
          const text = await imageRes.text().catch(() => "");
          throw new Error(text || `Image request failed (${imageRes.status})`);
        }

        const imageData = await imageRes.json();

        setArtisticCards((prev) =>
          prev.map((card) =>
            card.id === item.output.id
              ? {
                  ...card,
                  body: imagePrompt,
                  imageStatus: "done",
                  imageUrl:
                    typeof imageData?.imageUrl === "string"
                      ? imageData.imageUrl
                      : undefined,
                }
              : card
          )
        );

        continue;
      }

      const res = await fetch(`/api/repo/${repoId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content:
            item.output.outputKind === "text"
              ? `[Artistic Mode]\n` +
                `Generate a clean text output card response.\n` +
                `Keep the normal system response format if required.\n` +
                `Output role: ${role}.\n` +
                roleToneBlock +
                roleFocusBlock +
                `Inside [Action], return ONLY the final result.
Do NOT include any markers, labels, or system-style sections.
Do NOT include __PROPOSAL__, __VERIFY__, or any internal steps.
Return clean output only.\n` +
                `Do not explain the request.\n` +
                `Do not restate what the user asked for.\n` +
                (role === "email"
                  ? `For email output, use exactly:\nSUBJECT: ...\nBODY: ...\nDo not include SUBJECT inside BODY.\n`
                  : role === "report"
                  ? `For report output, prefer:\nTITLE: ...\nBODY: ...\n`
                  : `For summary output, prefer:\nTITLE: ...\nBODY: ...\n`) +
                `The [Observation] and [Assessment] sections may stay brief if required, but [Action] must contain the actual deliverable.\n\n` +
                `${sourceBody}${bridgeContext}`
              : item.output.outputKind === "powerpoint"
              ? `[Artistic Mode]\n` +
                `Generate a PowerPoint slide concept.\n` +
                `Prefer this structure when possible:\n\n` +
                `TITLE: ...\n` +
                `HOOK: ...\n` +
                `BULLETS:\n` +
                `- ...\n` +
                `- ...\n` +
                `- ...\n` +
                `VISUAL: ...\n\n` +
                `Keep it concise, presentation-ready, and visually strong.\n` +
                `System formatting may be applied.\n\n` +
                `${sourceBody}${bridgeContext}`
              : `[Artistic Mode]\n\n${`${sourceBody}${bridgeContext}`}`,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed (${res.status})`);
      }

      const raw = await res.text();
      const trimmed = raw.trim();

      let reply = "";

      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const data = JSON.parse(trimmed);
          reply =
            typeof data?.assistant === "string"
              ? data.assistant
              : typeof data?.content === "string"
              ? data.content
              : typeof data?.message === "string"
              ? data.message
              : typeof data?.reply === "string"
              ? data.reply
              : typeof data?.text === "string"
              ? data.text
              : typeof data?.output_text === "string"
              ? data.output_text
              : typeof data?.raw === "string"
              ? data.raw
              : typeof data?.assistantText === "string"
              ? data.assistantText
              : trimmed;
        } catch {
          reply = trimmed;
        }
      } else {
        reply = trimmed;
      }

      const payload = buildArtisticPresentationPayload(
        reply || "Vestaryn returned no visible reply.",
        item.output.outputKind,
        item.output.outputRole
      );

      const nextBody = formatArtisticPayloadForCard(
        payload,
        item.output.outputKind,
        item.output.outputRole
      );

      setArtisticCards((prev) =>
        prev.map((card) =>
          card.id === item.output.id
            ? {
                ...card,
                body: nextBody,
              }
            : card
        )
      );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to generate output.";

          setArtisticCards((prev) =>
            prev.map((card) =>
              card.id === item.output.id
                ? {
                    ...card,
                    body: `Generation failed.\n\n${message}`,
                    imageStatus:
                      item.output.outputKind === "image" ? "error" : card.imageStatus,
                  }
                : card
            )
          );
        } finally {
          clearArtisticCardUpdating(item.output.id);

          if (item.bridge?.id) {
            clearArtisticCardUpdating(item.bridge.id);
          }
        }
      }
  } finally {
    setIsRunningArtisticOutputs(false);
  }
}

useEffect(() => {
  function onRetryArtisticOutput(e: Event) {
    const detail = (e as CustomEvent<{ outputId?: string }>).detail;
    const outputId = detail?.outputId;
    if (!outputId) return;

    void runArtisticOutputs([outputId]);
  }

  window.addEventListener("vestaryn:retry_artistic_output", onRetryArtisticOutput);

  return () => {
    window.removeEventListener(
      "vestaryn:retry_artistic_output",
      onRetryArtisticOutput
    );
  };
}, [artisticCards, repoId]);

const canvasPresetUi = getCanvasPresetClasses(canvasPreset);
  return (
    <div
  className={[
    "relative z-[1000] w-full h-full flex flex-col min-w-0 transition-colors duration-500",
    appMode === "artistic"
      ? "bg-transparent"
      : "bg-transparent",
  ].join(" ")}
>
      {/* Top rail */}
      <div
        className={[
  "relative z-[1000] shrink-0 px-3 flex items-center overflow-visible transition-all duration-500",
  appMode === "artistic"
  ? "h-[132px] mb-0 border-blue-400/20 bg-transparent backdrop-blur-none"
  : "h-[132px] mb-0 border-blue-400/35 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.85),rgba(2,6,23,0.6),transparent)] backdrop-blur-md",
].join(" ")}

style={
  appMode === "artistic"
    ? {
        background:
          "linear-gradient(to right, rgba(4,8,16,0.98), rgba(8,14,26,0.90), rgba(4,8,16,0.98))",
        boxShadow:
          "inset 0 -1px 0 rgba(96,165,250,0.18), inset 0 -18px 40px rgba(20,28,48,0.22)",
      }
    : undefined
}
      >{appMode === "artistic" && (
      <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-[linear-gradient(to_right,transparent,rgba(96,165,250,0.10),transparent)] blur-xl animate-[vestarynFlow_7s_linear_infinite]" />
      </div>
    
  {/* 🔥 Custom bottom border glow */}
<div className="pointer-events-none absolute bottom-0 left-0 w-full h-[11px]">
  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-400/40 to-transparent blur-[20px]" />
  <div className="absolute inset-0 bg-black/20" />
</div>
{/* subtle top edge */}
<div className="pointer-events-none absolute top-0 left-0 w-full h-[30px] bg-gradient-to-r from-transparent via-black/80 to-transparent blur-[10px]" />
    {/* LEFT STREAK */}
    <div className="pointer-events-none absolute left-0 top-0 h-full w-[120px] bg-gradient-to-r from-black/80 via-black/80 to-transparent" />

    {/* RIGHT STREAK */}
    <div className="pointer-events-none absolute right-0 top-0 h-full w-[120px] bg-gradient-to-l from-black/80 via-black/80 to-transparent" />
  </>
)}
        <RepoHud repoId={repoId} repoName={repoName} messageCount={messageCount} />

{/* Center nav / Chamber Core */}
<div className="mx-auto flex items-center gap-3">

<div className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 p-1 backdrop-blur-md">
  <button
    type="button"
    onClick={() => setAppMode("engineering")}
    className={[
      "px-3 py-1.5 text-xs rounded-lg transition",
      appMode === "engineering"
        ? "bg-white/10 text-white"
        : "text-white/55 hover:text-white/85",
    ].join(" ")}
  >
    Engineering
  </button>

  <button
    type="button"
    onClick={() => setAppMode("artistic")}
    className={[
      "px-3 py-1.5 text-xs rounded-lg transition",
      appMode === "artistic"
        ? "bg-blue-500/20 text-blue-100 border border-blue-400/30"
        : "text-white/55 hover:text-white/85",
    ].join(" ")}
  >
    Artistic
  </button>
</div>

<button
  type="button"
  disabled={isRunningArtisticOutputs}
  onClick={() => void runArtisticOutputs()}
  className={[
    "ml-4 rounded-md border px-3 py-1.5 text-xs transition-all duration-200",
    isRunningArtisticOutputs
      ? "border-blue-400/30 bg-blue-500/20 text-blue-100 animate-pulse cursor-wait"
      : "border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]",
  ].join(" ")}
>
  {isRunningArtisticOutputs ? "⟳ Running..." : "▶ Run"}
</button>
  {/* Sigil + Chamber Core menu */}
  <div ref={coreRef} className="relative px-3">
    {appMode === "artistic" ? (
  <button
  type="button"
  onClick={() =>
    setCoreOpen((v) => {
      const next = !v;
      if (!next) setCoreView("menu");
      return next;
    })
  }
  className="relative flex items-center justify-center"
>
  <div className="relative flex items-center justify-center h-[200px] w-[180px] overflow-visible">

  {/* 🔵 Aura glow - deepest layer */}
  <div className="absolute -inset-6 z-0 rounded-full blur-3xl bg-blue-500/25 opacity-70 animate-pulse" />

  {/* ✨ Cosmic particle layer - behind sigil */}
  <div
    className="absolute inset-0 z-[1] opacity-[0.05] pointer-events-none"
    style={{
      maskImage: "radial-gradient(circle at center, black 0%, black 42%, transparent 78%)",
      WebkitMaskImage: "radial-gradient(circle at center, black 0%, black 42%, transparent 78%)",
      backgroundImage: "radial-gradient(rgba(255,255,255,0.75) 1px, transparent 1.2px)",
      backgroundSize: "18px 18px",
    }}
  />

  {/* 🧠 Sigil */}
  <img
  src="/vestaryn_final_candidate.png"
  alt="Vestaryn"
  className="relative z-[2] h-[180px] w-[200px] object-contain mix-blend-screen opacity-90 animate-[float_6s_ease-in-out_infinite] "
  style={{
    maskImage: `
      radial-gradient(circle at center,
        black 0%,
        black 45%,
        rgba(0,0,0,0.9) 55%,
        rgba(0,0,0,0.6) 25%,
        rgba(0,0,0,0.2) 75%,
        transparent 10%
      )
    `,
    WebkitMaskImage: `
      radial-gradient(circle at center,
        black 0%,
        black 25%,
        rgba(0,0,0,0.9) 55%,
        rgba(0,0,0,0.6) 65%,
        rgba(0,0,0,0.2) 75%,
        transparent 20%
      )
    `,
    filter: "drop-shadow(0 0 300px rgba(96,165,250,0.35)) saturate(1.15) brightness(1.5) contrast(1)",
  }}
/>
</div>
</button>
) : (
  <Sigil
    active={coreOpen}
    onClick={() =>
      setCoreOpen((v) => {
        const next = !v;
        if (!next) setCoreView("menu");
        return next;
      })
    }
  />
)}

    {coreOpen && (
      <div className="absolute left-1/2 top-full z-50 mt-6 w-[760px] -translate-x-1/2 rounded-2xl border border-white/10 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-md ring-1 ring-white/10 bg-black">
        <div className="grid grid-cols-2 gap-3">
          {/* Left column */}
          <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-white/40">
              Account / Repo
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setCoreOpen(false);
                }}
                className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
              >
                Profile (soon)
              </button>

              <button
                type="button"
                onClick={() => {
                  setCoreOpen(false);
                }}
                className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
              >
                Usage (soon)
              </button>

              <button
                type="button"
                onClick={() => {
                  setCoreOpen(false);
                  setCoreView("menu");
                  window.location.href = "/pricing";
                }}
                className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
              >
                Pricing
              </button>

              <div className="my-2 h-px bg-white/10" />

              <button
                type="button"
                  onClick={() => {
                    setCoreOpen(false);
                    setCoreView("menu");
                    window.location.href = "/";
                  }}
                className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
              >
                Switch repo
              </button>

              <button
                type="button"
                  onClick={() => {
                    copyRepoId();
                    setCoreOpen(false);
                    setCoreView("menu");
                  }}
                className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
              >
                {copied ? "Copied ✓" : "Copy repo id"}
              </button>

              <button
                type="button"
                onClick={onLogout}
                className="w-full rounded-xl border border-rose-400/20 bg-rose-500/[0.06] px-3 py-2 text-left text-sm text-rose-200/85 hover:bg-rose-500/12"
              >
                Log out
              </button>
            </div>
          </div>

          {/* Right column */}
          <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
            {coreView === "menu" && (
              <>
                <div className="mb-2 text-[10px] uppercase tracking-widest text-white/40">
                  Chamber Core
                </div>

                <div className="space-y-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                    <div className="text-sm text-white/85">EA Field Guide</div>
                    <div className="mt-1 text-xs leading-5 text-white/45">
                      Current capabilities, execution model, useful tips, and known limitations.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCoreView("capabilities")}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>Current Capabilities</span>
                      <span className="text-[10px] uppercase tracking-wide text-emerald-300/70">
                        Live
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCoreView("calibration")}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>First Repo Calibration</span>
                      <span className="text-[10px] uppercase tracking-wide text-blue-300/70">
                        Next
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>Goal Plan Flow</span>
                      <span className="text-[10px] uppercase tracking-wide text-blue-300/70">
                        Next
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>Chamber Evolution</span>
                      <span className="text-[10px] uppercase tracking-wide text-white/45">
                        Planned
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.12] hover:text-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>Known Limitations</span>
                      <span className="text-[10px] uppercase tracking-wide text-amber-300/70">
                        EA
                      </span>
                    </div>
                  </button>
                </div>
              </>
            )}

            {coreView === "capabilities" && (
              <div className="flex flex-col">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-white/40">
                      Chamber Core
                    </div>
                    <div className="mt-1 text-sm text-white/90">
                      Current Capabilities
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCoreView("menu")}
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/70 hover:bg-white/[0.12] hover:text-white"
                  >
                    Back
                  </button>
                </div>

                <div className="space-y-3 text-sm text-white/72">
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.08] px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/85">
                      Live
                    </div>
                    <div className="mt-2 space-y-2">
                      <div>• Read repository files and inspect project structure.</div>
                      <div>• Propose deterministic file changes before applying them.</div>
                      <div>• Preview file rewrites inside the editor flow.</div>
                      <div>• Run pre-verify and verify through the runner pipeline.</div>
                      <div>• Apply approved changes through server-controlled mutation.</div>
                      <div>• Track file-level verification state: ok, pending, warn, error.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-blue-400/20 bg-blue-500/[0.08] px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-300/85">
                      Execution Model
                    </div>
                    <div className="mt-2 space-y-2 text-white/68">
                      <div>• Chamber reasons about the repo and drafts proposed edits.</div>
                      <div>• Server remains execution authority for apply, verify, and status updates.</div>
                      <div>• Storage is derived state; database metadata remains canonical.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/85">
                      Early Access Limits
                    </div>
                    <div className="mt-2 space-y-2 text-white/68">
                      <div>• Multi-file autonomy still needs stronger reliability.</div>
                      <div>• Some control-center actions are surfaced before full activation.</div>
                      <div>• Calibration, goal planning, and deeper workflow orchestration are not fully wired yet.</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {coreView === "calibration" && (
              <div className="flex flex-col">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-white/40">
                      Chamber Core
                    </div>
                    <div className="mt-1 text-sm text-white/90">
                      First Repo Calibration
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCoreView("menu")}
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/70 hover:bg-white/[0.12] hover:text-white"
                  >
                    Back
                  </button>
                </div>

                <div className="space-y-3 text-sm text-white/72">
                  <div className="rounded-xl border border-blue-400/20 bg-blue-500/[0.08] px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-300/85">
                      Purpose
                    </div>
                    <div className="mt-2 space-y-2 text-white/68">
                      <div>• Establish how Vestaryn should behave before deeper repo work begins.</div>
                      <div>• Separate user skill, preference, readiness, and edit style into explicit signals.</div>
                      <div>• Reduce guesswork before setup help, scaffolding, and guided execution.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-white/80">
                      Proposed Questions
                    </div>
                    <div className="mt-2 space-y-3 text-white/72">
                      <div>1. What do you want to create or improve in this repository?</div>
                      <div>2. How comfortable are you with this tech stack?</div>
                      <div>3. Do you want Vestaryn to explain steps, or act directly?</div>
                      <div>4. Is this project already set up and runnable on your machine?</div>
                      <div>5. Should Vestaryn make minimal changes, or help fill in missing structure when needed?</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.08] px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/85">
                      Behavioral Output
                    </div>
                    <div className="mt-2 space-y-2 text-white/68">
                      <div>• Goal defines repo intent and targeting.</div>
                      <div>• Skill level adjusts explanation depth.</div>
                      <div>• Operation style controls guide vs direct behavior.</div>
                      <div>• Project readiness controls setup assumptions.</div>
                      <div>• Change style controls minimal edits vs scaffold suggestions.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/85">
                      Guardrail
                    </div>
                    <div className="mt-2 text-white/68">
                      • Even when calibration suggests scaffolding, Vestaryn should still propose foundational files before applying them.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )}
  </div>

  {/* Right mode */}
</div>
            {/* Right slot */}
            <div className="ml-auto flex items-center gap-2">{right}</div>
          </div>

          {/* Artistic sub-rail */}
{appMode === "artistic" && (
  <ArtisticCanvasControls
    canvasPreset={canvasPreset}
    setCanvasPreset={setCanvasPreset}
    cardPreset={cardPreset}
    setCardPreset={setCardPreset}
    zoom={zoom}
    onZoomOut={handleZoomOut}
    onZoomIn={handleZoomIn}
    onResetView={handleResetView}
    titleCase={titleCase}
  />
)}

{/* Body */}
<div
  className={[
    "flex-1 min-h-0 min-w-0 transition-colors duration-500",
    appMode === "artistic" ? "bg-transparent" : "bg-black/10",
  ].join(" ")}
>

        {appMode === "engineering" ? (
          children
        ) : (
         <ArtisticCanvasSurface
            viewportRef={viewportRef}
            canvasPresetUi={canvasPresetUi}
            cardPreset={cardPreset}
            panOffset={panOffset}
            setPanOffset={setPanOffset}
            zoom={zoom}
            setZoom={setZoom}
            MIN_ZOOM={MIN_ZOOM}
            MAX_ZOOM={MAX_ZOOM}
            WORLD_W={WORLD_W}
            WORLD_H={WORLD_H}
            MIN_CARD_W={MIN_CARD_W}
            MIN_CARD_H={MIN_CARD_H}
            isPanning={isPanning}
            dragStart={dragStart}
            setDragStart={setDragStart}
            dragCurrent={dragCurrent}
            setDragCurrent={setDragCurrent}
            isDraggingCard={isDraggingCard}
            setIsDraggingCard={setIsDraggingCard}
            draggingCardId={draggingCardId}
            setDraggingCardId={setDraggingCardId}
            resizingCardId={resizingCardId}
            setResizingCardId={setResizingCardId}
            selectedCardId={selectedCardId}
            setSelectedCardId={setSelectedCardId}
            selectedCardIds={selectedCardIds}
            setSelectedCardIds={setSelectedCardIds}
            multiDragStartPositionsRef={multiDragStartPositionsRef}
            editingCardId={editingCardId}
            setEditingCardId={setEditingCardId}
            focusedBodyCardId={focusedBodyCardId}
            setFocusedBodyCardId={setFocusedBodyCardId}
            setPendingNewCardId={setPendingNewCardId}
            artisticCards={artisticCards}
            setArtisticCards={setArtisticCards}
            clickMenu={clickMenu}
            setClickMenu={setClickMenu}
            clickMenuSubmenu={clickMenuSubmenu}
            setClickMenuSubmenu={setClickMenuSubmenu}
            artisticMenu={artisticMenu}
            setArtisticMenu={setArtisticMenu}
            artisticPrompt={artisticPrompt}
            setArtisticPrompt={setArtisticPrompt}
            artisticMessages={artisticMessages}
            setArtisticMessages={setArtisticMessages}
            artisticSending={artisticSending}
            artisticError={artisticError}
            setArtisticError={setArtisticError}
            sendArtisticPrompt={sendArtisticPrompt}
            connectingFromCardId={connectingFromCardId}
            setConnectingFromCardId={setConnectingFromCardId}
            connectionPreviewPoint={connectionPreviewPoint}
            setConnectionPreviewPoint={setConnectionPreviewPoint}
            panStartRef={panStartRef}
            cardDragOffsetRef={cardDragOffsetRef}
            resizeStartRef={resizeStartRef}
            hasMovedRef={hasMovedRef}
            ignoreNextCanvasClickRef={ignoreNextCanvasClickRef}
            resetArtisticPopup={resetArtisticPopup}
            connectionPulseCardId={connectionPulseCardId}
            setConnectionPulseCardId={setConnectionPulseCardId}
            bridgeSnapPreviewKey={bridgeSnapPreviewKey}
            setBridgeSnapPreviewKey={setBridgeSnapPreviewKey}
            updatingCardIds={updatingCardIds}
          />
        )}
      </div>
    </div>
  );
}

export default function RepoHud({
  repoId,
  repoName,
  messageCount = 0,
}: {
  repoId: string;
  repoName?: string | null;
  messageCount?: number;
}) {
  const supabase = supabaseBrowser();

  const [tierDb, setTierDb] = useState<Tier>("free");
  const [credits, setCredits] = useState<number | null>(null);
  const shownCredits = credits === null ? "…" : credits.toLocaleString();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [maintenance, setMaintenance] = useState<null | { count?: number; cap?: number; reason?: string }>(null);
  const maintTimerRef = useRef<number | null>(null);

useEffect(() => {
  let cancelled = false;

  async function load() {
    try {
      const res = await fetch(`/api/credits/balance?repoId=${encodeURIComponent(repoId)}`, {
        cache: "no-store",
        headers: {
          // optional but useful to keep tier consistent with what you’re using elsewhere
          "x-vestaryn-tier": tierDb,
        },
      });
      if (!res.ok) return;

      const j = await res.json();
      if (cancelled) return;

setTierDb(
  j.tier === "early_access" || j.tier === "builder" || j.tier === "pro" || j.tier === "elite"
    ? j.tier
    : "free"
);
      setCredits(typeof j.credits === "number" ? j.credits : Number(j.credits));
    } catch {
      // ignore for now
    }
  }

  load();
  window.addEventListener("focus", load);
  return () => {
    cancelled = true;
    window.removeEventListener("focus", load);
  };
}, []);

useEffect(() => {
  function onMaint(e: Event) {
    const ce = e as CustomEvent<any>;
    const detail = ce.detail ?? {};
    setMaintenance({
      count: Number(detail.count) || undefined,
      cap: Number(detail.cap) || undefined,
      reason: String(detail.reason ?? ""),
    });

    if (maintTimerRef.current) window.clearTimeout(maintTimerRef.current);
    maintTimerRef.current = window.setTimeout(() => setMaintenance(null), 6000);
  }

  window.addEventListener("vestaryn:maintenance", onMaint as any);
  return () => {
    window.removeEventListener("vestaryn:maintenance", onMaint as any);
    if (maintTimerRef.current) window.clearTimeout(maintTimerRef.current);
  };
}, []);

const [copied, setCopied] = useState(false);

async function copyRepoId() {
  try {
    await navigator.clipboard.writeText(repoId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  } catch {}
}



useEffect(() => {
  function onDown(e: PointerEvent) {
    if (!open) return;
    const el = rootRef.current;
    if (!el) return;
    if (!el.contains(e.target as Node)) setOpen(false);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
  }

  document.addEventListener("pointerdown", onDown, true); // capture
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
  };
}, [open]);

useEffect(() => {
  function onCredits(e: Event) {
    const ce = e as CustomEvent<any>;
    const remaining = Number(ce.detail?.remaining);
    if (Number.isFinite(remaining)) setCredits(remaining);
  }

  window.addEventListener("vestaryn:credits", onCredits as any);
  return () => window.removeEventListener("vestaryn:credits", onCredits as any);
}, []);



async function onLogout() {
  setOpen(false);
  const supabase = supabaseBrowser();
  await supabase.auth.signOut();
  window.location.href = "/";
}



return (
  <div ref={rootRef} className="relative">
    <div
      className="flex items-center gap-3 max-w-[420px] rounded-lg px-2 py-1"
      title="Repo status"
    >
      {/* Repo identity */}
      <div className="flex flex-col leading-tight min-w-0 text-left">
        <div className="text-sm font-semibold text-white truncate">
          {repoName?.trim() ? repoName : "Repo"}
        </div>
        <div className="text-[10px] font-mono text-white/40 truncate">
          {repoId.slice(0, 8)}…
        </div>
      </div>

      {/* Divider */}
      <div className="h-6 w-px bg-white/10" />



            {/* Messages */}
      <span className="text-[11px] rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-white/70 whitespace-nowrap">
        msgs {messageCount.toLocaleString()}
      </span>

      {maintenance && (
        <span
          className="text-[11px] rounded-md border border-blue-400/20 bg-blue-500/10 px-2 py-0.5 text-blue-100/80 whitespace-nowrap"
          title="Chamber maintenance recommended"
        >
          resummarize
          {maintenance.count && maintenance.cap
            ? ` ${maintenance.count}/${maintenance.cap}`
            : ""}
        </span>
      )}
    </div>
  </div>
);}
