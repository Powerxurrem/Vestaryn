"use client";

import type { RefObject } from "react";
import type { ArtisticCardType, ScreenPoint } from "@/lib/artistic/types";

type ArtisticClickMenuProps = {
  clickMenu: ScreenPoint | null;
  clickMenuSubmenu: null | "new-card";
  viewportRef: RefObject<HTMLDivElement | null>;
  setClickMenu: React.Dispatch<React.SetStateAction<ScreenPoint | null>>;
  setClickMenuSubmenu: React.Dispatch<React.SetStateAction<null | "new-card">>;
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
    }
  ) => void;
};

export default function ArtisticClickMenu({
  clickMenu,
  clickMenuSubmenu,
  viewportRef,
  setClickMenu,
  setClickMenuSubmenu,
  viewportPointToWorld,
  createMenuCard,
}: ArtisticClickMenuProps) {
  if (!clickMenu) return null;

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

  return (
    <div
      data-click-menu
      className="absolute z-[10]"
      style={menuStyle}
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
              onClick={createNotesCard}
            >
              Notes
            </button>

            <button
              className="w-full rounded-md px-3 py-2 text-left text-sm text-black/70 hover:bg-black/5"
              onClick={createFrameCard}
            >
              1920×1080 card
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}