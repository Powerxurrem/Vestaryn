"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/client";


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

function getCanvasPresetClasses(preset: "soft" | "grid" | "obsidian") {
  switch (preset) {
    case "obsidian":
      return {
        viewportBg: "bg-[#0b1017]",
        gridClass:
          "absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] [background-size:48px_48px]",
      };
    case "grid":
      return {
        viewportBg: "bg-[#edf2f8]",
        gridClass:
          "absolute inset-0 opacity-[0.09] [background-image:linear-gradient(rgba(15,23,42,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.14)_1px,transparent_1px)] [background-size:48px_48px]",
      };
    default:
      return {
        viewportBg: "bg-[#f3f5f9]",
        gridClass:
          "absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(15,23,42,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.12)_1px,transparent_1px)] [background-size:48px_48px]",
      };
  }
}

function getCardPresetClasses(
  preset: "glass" | "solid" | "obsidian",
  active: boolean
) {
  switch (preset) {
    case "obsidian":
      return active
        ? {
            shell:
              "border border-blue-400/40 bg-[#0f1724]/88 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.20),0_0_30px_rgba(96,165,250,0.18),0_24px_70px_rgba(0,0,0,0.30)]",
            header:
              "border-b border-blue-400/20 bg-blue-500/[0.05]",
            title: "text-blue-100/85 hover:text-blue-50",
            body: "text-white/72 placeholder:text-white/30",
            input: "text-blue-100/90",
          }
        : {
            shell:
              "border border-white/10 bg-[#111827]/84 text-white shadow-[0_18px_50px_rgba(0,0,0,0.28)]",
            header:
              "border-b border-white/10",
            title: "text-white/70 hover:text-white/90",
            body: "text-white/68 placeholder:text-white/28",
            input: "text-white/85",
          };

    case "solid":
      return active
        ? {
            shell:
              "border border-blue-400/40 bg-white text-black shadow-[0_0_0_1px_rgba(96,165,250,0.18),0_0_30px_rgba(96,165,250,0.16),0_24px_70px_rgba(0,0,0,0.20)]",
            header:
              "border-b border-blue-400/20 bg-blue-500/[0.03]",
            title: "text-black/60 hover:text-black/80",
            body: "text-black/60 placeholder:text-black/25",
            input: "text-black/65",
          }
        : {
            shell:
              "border border-black/10 bg-white text-black shadow-[0_18px_50px_rgba(0,0,0,0.14)]",
            header:
              "border-b border-black/8",
            title: "text-black/45 hover:text-black/65",
            body: "text-black/55 placeholder:text-black/25",
            input: "text-black/60",
          }; 

    default:
      return active
        ? {
            shell:
              "border border-blue-400/40 bg-white/80 text-black shadow-[0_0_0_1px_rgba(96,165,250,0.18),0_0_30px_rgba(96,165,250,0.16),0_24px_70px_rgba(0,0,0,0.22)]",
            header:
              "border-b border-blue-400/20 bg-blue-500/[0.03]",
            title: "text-black/55 hover:text-black/75",
            body: "text-black/55 placeholder:text-black/25",
            input: "text-black/60",
          }
        : {
            shell:
              "border border-black/10 bg-white/72 text-black shadow-[0_18px_50px_rgba(0,0,0,0.16)]",
            header:
              "border-b border-black/8",
            title: "text-black/45 hover:text-black/65",
            body: "text-black/55 placeholder:text-black/25",
            input: "text-black/60",
          };
  }
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
const [appMode, setAppMode] = useState<"engineering" | "artistic">("engineering");
const [artisticMenu, setArtisticMenu] = useState<{ x: number; y: number } | null>(null);
const [artisticPrompt, setArtisticPrompt] = useState("");
const [editingCardId, setEditingCardId] = useState<string | null>(null);
const [artisticMessages, setArtisticMessages] = useState<
  { role: "user" | "assistant"; content: string }[]
>([]);
const [artisticCards, setArtisticCards] = useState<
  {
    id: string;
    type: "default" | "notes" | "frame";
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    body: string;
  }[]
>([]);

const [clickMenu, setClickMenu] = useState<{ x: number; y: number } | null>(null);
const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
const [isDraggingCard, setIsDraggingCard] = useState(false);

async function copyRepoId() {
  try {
    await navigator.clipboard.writeText(repoId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  } catch {}
}

function cleanArtisticReply(text: string) {
  const actionMatch = text.match(/\[Action\]\s*([\s\S]*)$/i);
  if (actionMatch?.[1]?.trim()) {
    return actionMatch[1].trim();
  }

  const observationMatch = text.match(/\[Observation\]\s*([\s\S]*?)(?:\n\[Assessment\]|\n\[Action\]|$)/i);
  if (observationMatch?.[1]?.trim()) {
    return observationMatch[1].trim();
  }

  return text
    .replace(/\[(Observation|Assessment|Action)\]\s*/gi, "")
    .trim();
}

function clampRect(
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  return { x, y, w, h };
}

function createMenuCard(
  worldX: number,
  worldY: number,
  opts?: {
    type?: "default" | "notes" | "frame";
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

function makeCardId() {
  return `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
const cardDragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({
  x: 2400,
  y: 2400,
});
const [clickMenuSubmenu, setClickMenuSubmenu] = useState<null | "new-card">(null);
const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
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

function viewportPointFromClient(clientX: number, clientY: number) {
  const rect = viewportRef.current?.getBoundingClientRect();
  if (!rect) {
    return { x: 0, y: 0 };
  }

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function viewportPointToWorldAtZoom(
  viewportX: number,
  viewportY: number,
  pan: { x: number; y: number },
  zoomLevel: number
) {
  return {
    x: (viewportX - pan.x) / zoomLevel,
    y: (viewportY - pan.y) / zoomLevel,
  };
}

function viewportPointToWorld(clientX: number, clientY: number) {
  const viewportPoint = viewportPointFromClient(clientX, clientY);

  return viewportPointToWorldAtZoom(
    viewportPoint.x,
    viewportPoint.y,
    panOffset,
    zoom
  );
}

useEffect(() => {
  function onKeyDown(e: KeyboardEvent) {
    if (e.code === "Space") {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();

      if (
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable
      ) {
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
}, []);

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
          `Creative ideation request. Favor vivid, imaginative language in the response content.\n\n` +
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

    const cleaned = cleanArtisticReply(reply || "Vestaryn returned no visible reply.");

    setArtisticMessages((prev) => [
      ...prev,
      { role: "user", content: prompt },
      { role: "assistant", content: cleaned },
    ]);

    setArtisticPrompt("");
  } catch (err) {
    setArtisticError(err instanceof Error ? err.message : "Failed to send prompt.");
  } finally {
    setArtisticSending(false);
  }
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
  src="/vestaryn_artistic.png"
  alt="Vestaryn"
  className="relative z-[2] h-[180px] w-[200px] object-contain mix-blend-screen opacity-90 animate-[float_6s_ease-in-out_infinite]"
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
    filter: "drop-shadow(0 0 300px rgba(96,165,250,0.35)) saturate(1.15)",
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
  <div className="relative z-[990] shrink-0 border-b border-blue-400/15 bg-[linear-gradient(to_right,rgba(5,10,18,0.96),rgba(9,16,28,0.92),rgba(5,10,18,0.96))] px-4 py-2 backdrop-blur-md">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/38">
          Canvas
        </div>

        <select
          value={canvasPreset}
          onChange={(e) =>
            setCanvasPreset(e.target.value as "soft" | "grid" | "obsidian")
          }
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/78 outline-none"
        >
          <option value="soft">Soft</option>
          <option value="grid">Grid</option>
          <option value="obsidian">Obsidian</option>
        </select>

        <div className="text-[10px] uppercase tracking-[0.22em] text-white/30">
          Cards
        </div>

        <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.06] p-1">
          {(["glass", "solid", "obsidian"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setCardPreset(preset)}
              className={[
                "rounded-md px-3 py-1.5 text-xs transition",
                cardPreset === preset
                  ? "bg-blue-500/18 text-blue-100 border border-blue-400/25"
                  : "text-white/55 hover:text-white/85",
              ].join(" ")}
            >
              {titleCase(preset)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const rect = viewportRef.current?.getBoundingClientRect();
            if (!rect) return;

            const viewportX = rect.width / 2;
            const viewportY = rect.height / 2;
            const nextZoom = Math.max(MIN_ZOOM, zoom / 1.08);
            if (nextZoom === zoom) return;

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
          }}
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/78 hover:bg-white/[0.10]"
        >
          −
        </button>

        <div className="min-w-[64px] text-center text-xs font-medium text-white/60">
          {Math.round(zoom * 100)}%
        </div>

        <button
          type="button"
          onClick={() => {
            const rect = viewportRef.current?.getBoundingClientRect();
            if (!rect) return;

            const viewportX = rect.width / 2;
            const viewportY = rect.height / 2;
            const nextZoom = Math.min(MAX_ZOOM, zoom * 1.08);
            if (nextZoom === zoom) return;

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
          }}
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/78 hover:bg-white/[0.10]"
        >
          +
        </button>

        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPanOffset({ x: 2400, y: 2400 });
          }}
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/62 hover:bg-white/[0.10]"
        >
          Reset view
        </button>
      </div>
    </div>
  </div>
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
          <div
            ref={viewportRef}
            className={[
              "relative h-full w-full overflow-hidden",
              isPanning ? "cursor-grab" : "",
            ].join(" ")}
            style={{
              userSelect: isPanning || !!draggingCardId || !!resizingCardId ? "none" : undefined,
              WebkitUserSelect:
                isPanning || !!draggingCardId || !!resizingCardId ? "none" : undefined,
            }}

            onDoubleClick={(e) => {
              const target = e.target as HTMLElement;

              // ignore if clicking on UI elements
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
                }
              ]);

              setSelectedCardId(newCardId);
              setPendingNewCardId(newCardId);

              // close menu if open
              setClickMenu(null);
              setClickMenuSubmenu(null);
            }}

            onPointerDown={(e) => {
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

              const worldPoint = viewportPointToWorld(e.clientX, e.clientY);

              setDragStart(worldPoint);
              setDragCurrent(worldPoint);
              setIsDraggingCard(true);
            }}

            onPointerMove={(e) => {
              if (dragStart) {
                const worldPoint = viewportPointToWorld(e.clientX, e.clientY);

                const dx = Math.abs(worldPoint.x - dragStart.x);
                const dy = Math.abs(worldPoint.y - dragStart.y);

                if (dx > 2 / zoom || dy > 2 / zoom) {
                  hasMovedRef.current = true;
                }
              }
              if (isPanning && panStartRef.current) {
                e.preventDefault();

                const start = panStartRef.current;
                const dx = e.clientX - start.x;
                const dy = e.clientY - start.y;

                setPanOffset((prev) => ({
                  x: prev.x + dx,
                  y: prev.y + dy,
                }));

                panStartRef.current = { x: e.clientX, y: e.clientY };
                document.body.style.cursor = "grabbing";
                return;
              }

              if (resizingCardId && resizeStartRef.current) {
                e.preventDefault();
                document.body.style.cursor = "se-resize";

                const worldPoint = viewportPointToWorld(e.clientX, e.clientY);
                const start = resizeStartRef.current;

                const nextW = Math.max(MIN_CARD_W, start.startW + (worldPoint.x - start.startX));
                const nextH = Math.max(MIN_CARD_H, start.startH + (worldPoint.y - start.startY));

                setArtisticCards((prev) =>
                  prev.map((card) =>
                    card.id === resizingCardId
                      ? {
                          ...card,
                          w: nextW,
                          h: nextH,
                        }
                      : card
                  )
                );
                return;
              }

              if (draggingCardId) {
                e.preventDefault();

                const worldPoint = viewportPointToWorld(e.clientX, e.clientY);

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
                return;
              }

              if (!isDraggingCard || !dragStart) return;

              const worldPoint = viewportPointToWorld(e.clientX, e.clientY);
              setDragCurrent(worldPoint);
            }}

            onWheel={(e) => {
              e.preventDefault();

              const viewportPoint = viewportPointFromClient(e.clientX, e.clientY);
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
            }}

            onPointerUp={(e) => {
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
console.log("CLICK MENU", hasMovedRef.current);
              const worldRect = clampRect(dragStart, dragCurrent);
              const rect = e.currentTarget.getBoundingClientRect();


              // tiny drag = treat as click menu
              const threshold = 8 / zoom;

              if (!hasMovedRef.current) {
                const clientX = e.clientX;
                const clientY = e.clientY;

                setIsDraggingCard(false);
                setDragStart(null);
                setDragCurrent(null);
                document.body.style.userSelect = "";
                document.body.style.webkitUserSelect = "";

                setClickMenu((prev) => {
                // If already open → close (second click)
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
                  }
                ]);

                setPendingNewCardId(newCardId);
              }

              setIsDraggingCard(false);
              setDragStart(null);
              setDragCurrent(null);
              document.body.style.userSelect = "";
              document.body.style.webkitUserSelect = "";
            }}

            onPointerLeave={() => {
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
            }}

            onClick={(e) => {
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
                setArtisticMenu(null);
                setArtisticPrompt("");
                setArtisticMessages([]);
                setArtisticError(null);
              }

              if (!clickedCard && !clickedPopup && !clickedClickMenu) {
                if (editingCardId) {
                  setEditingCardId(null);
                }
                setFocusedBodyCardId(null);
                setSelectedCardId(null);
              }
            }}

            onContextMenu={(e) => {
              e.preventDefault();

              const rect = e.currentTarget.getBoundingClientRect();

              setClickMenu(null);
              setArtisticMenu({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
              });
            }}
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
                const cardPresetUi = getCardPresetClasses(cardPreset, isCardActive(card.id));
                const isFrameCard = card.type === "frame";
                const isNotesCard = card.type === "notes";

                return (
                  <div
                  key={card.id}
                  data-artistic-card
                  onPointerDown={(e) => {
                    if (isPanning || resizingCardId) return;

                    const target = e.target as HTMLElement;
                      if (target.closest("[data-card-resize-handle]")) return;
                      if (target.closest("input")) return;
                      if (target.closest("textarea")) return;

                    e.stopPropagation();
                    e.preventDefault();

                    document.body.style.userSelect = "none";
                    document.body.style.webkitUserSelect = "none";

                    const worldPoint = viewportPointToWorld(e.clientX, e.clientY);

                    cardDragOffsetRef.current = {
                      x: worldPoint.x - card.x,
                      y: worldPoint.y - card.y,
                    };

                    setSelectedCardId(card.id);
                    setDraggingCardId(card.id);
                  }}
                  className={[
                    "absolute overflow-hidden backdrop-blur-xl transition-[box-shadow,border-color,background-color] duration-150",
                    isFrameCard ? "rounded-[28px]" : "rounded-2xl",
                    cardPresetUi.shell,
                    isFrameCard ? "border-blue-400/20" : "",
                    isCardActive(card.id) ? "z-[980]" : "z-[850]",
                    resizingCardId === card.id
                      ? "cursor-se-resize"
                      : draggingCardId === card.id
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
                    {editingCardId === card.id ? (
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
                        if (editingCardId === card.id) {
                          setEditingCardId(null);
                        }
                      }}
                      className="ml-2 rounded-md px-2 py-1 text-[11px] text-black/35 hover:bg-black/5 hover:text-black/65"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="p-3 h-[calc(100%-41px)]">
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
                    onPointerDown={(e) => {
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
                    }}
                    className={[
                      "absolute bottom-2 right-2 z-[980] flex h-5 w-5 items-center justify-center rounded-md bg-white/80 hover:bg-white cursor-se-resize transition",
                      isCardActive(card.id)
                        ? "border border-blue-400/30 shadow-[0_0_14px_rgba(96,165,250,0.14)]"
                        : "border border-black/10 shadow-sm",
                    ].join(" ")}
                    title="Resize card"
                  >
                    <div className="h-2.5 w-2.5 rounded-[2px] border-r border-b border-black/35" />
                  </button>
                    </div>
                  );
                })}
            </div>


            <div className="pointer-events-none select-none absolute bottom-12 left-1/2 -translate-x-1/2 rounded-2xl border border-black/10 bg-white/35 px-4 py-2 text-xs text-black/55 backdrop-blur-xl">
            Right-click anywhere on the canvas to summon Vestaryn
          </div>

            {clickMenu ? (
              <div
                data-click-menu
                className="absolute z-[10]"
                style={(() => {
                  const rect = viewportRef.current?.getBoundingClientRect();

                  if (!rect) {
                    return {
                      left: 0,
                      top: 0,
                      transform: "translate(8px, 8px)",
                    };
                  }

                  return {
                    left: clickMenu.x - rect.left,
                    top: clickMenu.y - rect.top,
                    transform: "translate(8px, 8px)",
                  };
                })()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="relative">
                  <div className="w-[190px] rounded-xl border border-black/10 bg-white/80 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl">
                    <button
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-black/70 hover:bg-black/5"
                      onMouseEnter={() => setClickMenuSubmenu("new-card")}
                    >
                      <span>New Card</span>
                      <span className="text-black/35">›</span>
                    </button>

                    <button
                      className="w-full rounded-md px-3 py-2 text-left text-sm text-black/40 hover:bg-black/5"
                      disabled
                    >
                      Prompt Card (soon)
                    </button>

                    <button
                      className="w-full rounded-md px-3 py-2 text-left text-sm text-black/40 hover:bg-black/5"
                      disabled
                    >
                      Output Card (soon)
                    </button>
                  </div>

                  {clickMenuSubmenu === "new-card" ? (
                    <div
                      className="absolute left-full top-0 ml-2 w-[210px] rounded-xl border border-black/10 bg-white/88 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl"
                      onMouseLeave={() => setClickMenuSubmenu(null)}
                    >
                      <button
                        className="w-full rounded-md px-3 py-2 text-left text-sm text-black/70 hover:bg-black/5"
                        onClick={() => {
                          const world = viewportPointToWorld(
                            clickMenu.x + 8,
                            clickMenu.y + 8
                          );

                          createMenuCard(world.x, world.y, {
                            type: "notes",
                            w: 260,
                            h: 180,
                            title: "Notes",
                            body: "",
                          });
                        }}
                      >
                        Notes
                      </button>

                      <button
                        className="w-full rounded-md px-3 py-2 text-left text-sm text-black/70 hover:bg-black/5"
                        onClick={() => {
                          const world = viewportPointToWorld(
                            clickMenu.x + 8,
                            clickMenu.y + 8
                          );

                          createMenuCard(world.x, world.y, {
                            type: "frame",
                            w: 1920,
                            h: 1080,
                            title: "1920×1080",
                            body: "",
                          });
                        }}
                      >
                        1920×1080 card
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {artisticMenu ? (
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
                    onClick={() => {
                      setArtisticMenu(null);
                      setArtisticPrompt("");
                      setArtisticMessages([]);
                      setArtisticError(null);
                    }}
                    className="rounded-md px-2 py-1 text-xs text-black/40 hover:bg-black/5 hover:text-black/70"
                  >
                    ✕
                  </button>
                </div>

                {artisticMessages.length > 0 ? (
                  <div id="artistic-scroll" className="mb-3 max-h-[260px] overflow-auto space-y-2">
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
            ) : null}
          </div>
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
