import type { ArtisticCardType, ScreenPoint } from "@/lib/artistic/types";

export function clampRect(
  start: ScreenPoint,
  end: ScreenPoint
) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  return { x, y, w, h };
}

export function makeCardId() {
  return `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function viewportPointFromClient(
  clientX: number,
  clientY: number,
  viewportEl: HTMLDivElement | null
) {
  const rect = viewportEl?.getBoundingClientRect();
  if (!rect) {
    return { x: 0, y: 0 };
  }

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function viewportPointToWorldAtZoom(
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

export function getCanvasPresetClasses(
  preset: "soft" | "grid" | "obsidian"
) {
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

export function getCardPresetClasses(
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