"use client";

import type { RefObject } from "react";
import type { ArtisticCardType, ScreenPoint } from "@/lib/artistic/types";

type ArtisticClickMenuProps = {
  clickMenu: ScreenPoint | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  setClickMenu: React.Dispatch<React.SetStateAction<ScreenPoint | null>>;
  clickMenuSubmenu: null | "new-card" | "outputs";
  setClickMenuSubmenu: React.Dispatch<
    React.SetStateAction<null | "new-card" | "outputs">
  >;
  cardPreset: "glass" | "solid" | "obsidian";
  viewportPointToWorld: (
    clientX: number,
    clientY: number
  ) => { x: number; y: number };
  createMenuCard: (
    worldX: number,
    worldY: number,
    opts?: {
      type?: ArtisticCardType;
      w?: number;
      h?: number;
      title?: string;
      body?: string;
      outputKind?: "text" | "powerpoint";
    }
  ) => void;
};

export default function ArtisticClickMenu({
  clickMenu,
  clickMenuSubmenu,
  viewportRef,
  setClickMenu,
  setClickMenuSubmenu,
  cardPreset,
  viewportPointToWorld,
  createMenuCard,
}: ArtisticClickMenuProps) {
  if (!clickMenu) return null;

  const menuPresetUi =
    cardPreset === "glass"
      ? {
          shell:
            "border border-black/10 bg-white/[0.78] text-black shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl",
          item: "text-black/70 hover:bg-black/5",
          subtle: "text-black/35",
        }
      : {
          shell:
            "border border-white/10 bg-[rgba(12,18,30,0.88)] text-white shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl",
          item: "text-white/75 hover:bg-white/5",
          subtle: "text-white/35",
        };

  const rect = viewportRef.current?.getBoundingClientRect();

  const menuStyle = !rect
    ? {
        left: 0,
        top: 0,
        transform: "translate(8px, 8px)",
      }
    : {
        left: clickMenu.x - rect.left,
        top: clickMenu.y - rect.top,
        transform: "translate(8px, 8px)",
      };

  function createNotesCard() {
    if (!clickMenu) return;

    const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

    createMenuCard(world.x, world.y, {
      type: "notes",
      w: 260,
      h: 180,
      title: "Notes",
      body: "",
    });
  }

  function createFrameCard() {
    if (!clickMenu) return;

    const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

    createMenuCard(world.x, world.y, {
      type: "frame",
      w: 1920,
      h: 1080,
      title: "1920×1080",
      body: "",
    });
  }

  function createPromptCard() {
    if (!clickMenu) return;

    const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

    createMenuCard(world.x, world.y, {
      type: "prompt",
      w: 300,
      h: 180,
      title: "Prompt",
      body: "Describe what you want...",
    });
  }

  function createTextOutputCard() {
    if (!clickMenu) return;

    const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

    createMenuCard(world.x, world.y, {
      type: "output",
      w: 360,
      h: 220,
      title: "Output",
      body: "Summary\n\nAwaiting connected prompt...\n\nRun the chamber to generate a regular text result.",
      outputKind: "text",
    });
  }

  function createPowerPointOutputCard() {
    if (!clickMenu) return;

    const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

    createMenuCard(world.x, world.y, {
      type: "output",
      w: 640,
      h: 360,
      title: "PowerPoint",
      body: "Slide concept\n\nAwaiting connected prompt...\n\nRun the chamber to generate a PowerPoint-oriented result.",
      outputKind: "powerpoint",
    });
  }

  return (
    <div
      data-click-menu
      className="absolute z-[10]"
      style={menuStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative">
        <div
          className={[
            "w-[190px] rounded-xl p-2",
            menuPresetUi.shell,
          ].join(" ")}
        >
          <button
            className={[
              "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm",
              menuPresetUi.item,
            ].join(" ")}
            onMouseEnter={() => setClickMenuSubmenu("new-card")}
          >
            <span>New Card</span>
            <span className={menuPresetUi.subtle}>›</span>
          </button>

          <button
            className={[
              "w-full rounded-md px-3 py-2 text-left text-sm",
              menuPresetUi.item,
            ].join(" ")}
            onClick={createPromptCard}
          >
            Prompt Card
          </button>

          <button
            className={[
              "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm",
              menuPresetUi.item,
            ].join(" ")}
            onMouseEnter={() => setClickMenuSubmenu("outputs")}
          >
            <span>Outputs</span>
            <span className={menuPresetUi.subtle}>›</span>
          </button>
        </div>

        {clickMenuSubmenu === "new-card" ? (
          <div
            className={[
              "absolute left-full top-0 ml-2 w-[210px] rounded-xl p-2",
              menuPresetUi.shell,
            ].join(" ")}
            onMouseLeave={() => setClickMenuSubmenu(null)}
          >
            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createNotesCard}
            >
              Notes
            </button>

            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createFrameCard}
            >
              1920×1080 card
            </button>
          </div>
        ) : null}

        {clickMenuSubmenu === "outputs" ? (
          <div
            className={[
              "absolute left-full top-[44px] ml-2 w-[220px] rounded-xl p-2",
              menuPresetUi.shell,
            ].join(" ")}
            onMouseLeave={() => setClickMenuSubmenu(null)}
          >
            <div
              className={`px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${menuPresetUi.subtle}`}
            >
              Outputs
            </div>

            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createTextOutputCard}
            >
              Text Output
            </button>

            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createPowerPointOutputCard}
            >
              PowerPoint Output
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}