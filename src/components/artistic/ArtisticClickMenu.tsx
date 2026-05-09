"use client";

import type { RefObject } from "react";
import type { ArtisticCardType, ScreenPoint } from "@/lib/artistic/types";

type ArtisticClickMenuProps = {
  clickMenu: ScreenPoint | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  setClickMenu: React.Dispatch<React.SetStateAction<ScreenPoint | null>>;
  clickMenuSubmenu:
  | null
  | "new-card"
  | "outputs"
  | "text-output"
  | "book-output";
  setClickMenuSubmenu: React.Dispatch<
    React.SetStateAction<null | "new-card" | "outputs" | "text-output" | "book-output">
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
      outputKind?: "text" | "powerpoint" | "image" | "book_page";
      outputRole?: "summary" | "email" | "report";
      imageMode?:
        | "presentation_visual"
        | "book_background"
        | "book_character"
        | "print_illustration";
      imageAspect?: "square" | "portrait" | "landscape";
      bookPageRatio?: "square" | "portrait" | "landscape";
      bridgeKind?: "file_context" | "summary_bridge" | "image_processor";
      imageProcessorKind?: "remove_background";
      processorStatus?: "idle" | "processing" | "done" | "error";
      contextFileName?: string;
      contextText?: string;
      processorAdjustments?: {
      saturation?: number;
      brightness?: number;
      contrast?: number;
    };
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

  function createFileContextCard() {
    if (!clickMenu) return;

    const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

    createMenuCard(world.x, world.y, {
      type: "bridge",
      w: 340,
      h: 220,
      title: "File Context",
      body: "Describe what to use from the file...",
      bridgeKind: "file_context",
      contextFileName: "",
      contextText: "",
    });
  }

function createImageProcessorCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "bridge",
    w: 520,
    h: 360,
    title: "Image Processor",
    body: "Adjust and process the connected image before passing it downstream.",
    bridgeKind: "image_processor",
    imageProcessorKind: "remove_background",
    processorStatus: "idle",
    processorAdjustments: {
      saturation: 100,
      brightness: 100,
      contrast: 100,
    },
  });
}

  function createSummaryBridgeCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "bridge",
    w: 340,
    h: 180,
    title: "Summary Bridge",
    body: "Approved summary gate.\n\nUse the connected upstream output as the source for the next card.",
    bridgeKind: "summary_bridge",
  });
}

  function createPromptCard() {
    if (!clickMenu) return;

    const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

    createMenuCard(world.x, world.y, {
      type: "prompt",
      w: 320,
      h: 270,
      title: "Prompt",
      body: "Describe what you want...",
    });
  }

  function createSummaryOutputCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 360,
    h: 220,
    title: "Summary",
    body: "Awaiting connected prompt...\n\nRun the chamber to generate a concise summary.",
    outputKind: "text",
    outputRole: "summary",
  });
}

function createEmailOutputCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 420,
    h: 260,
    title: "Email",
    body: "Awaiting connected prompt...\n\nRun the chamber to generate an email-ready draft.",
    outputKind: "text",
    outputRole: "email",
  });
}

function createReportOutputCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 420,
    h: 280,
    title: "Report",
    body: "Awaiting connected prompt...\n\nRun the chamber to generate a report-style output.",
    outputKind: "text",
    outputRole: "report",
  });
}

  function createPowerPointOutputCard() {
    if (!clickMenu) return;

    const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

    createMenuCard(world.x, world.y, {
      type: "output",
      w: 1200,
      h: 675,
      title: "PowerPoint",
      body: "Slide concept\n\nAwaiting connected prompt...\n\nRun the chamber to generate a PowerPoint-oriented result.",
      outputKind: "powerpoint",
    });
  }

function createBookPageSquareCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 720,
    h: 720,
    title: "Book Page Square",
    body: "Book page layout\n\nConnect book images and story text to compose a square page.",
    outputKind: "book_page",
    bookPageRatio: "square",
  });
}

function createBookPagePortraitCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 560,
    h: 840,
    title: "Book Page Portrait",
    body: "Book page layout\n\nConnect book images and story text to compose a portrait page.",
    outputKind: "book_page",
    bookPageRatio: "portrait",
  });
}

function createBookPageLandscapeCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 840,
    h: 560,
    title: "Book Page Landscape",
    body: "Book page layout\n\nConnect book images and story text to compose a landscape page.",
    outputKind: "book_page",
    bookPageRatio: "landscape",
  });
}

function createBookBackgroundCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 520,
    h: 340,
    title: "Book Background",
    body: "Awaiting connected prompt...\n\nRun the chamber to generate a book background.",
    outputKind: "image",
    imageMode: "book_background",
    imageAspect: "landscape",
  });
}

function createBookCharacterCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 360,
    h: 460,
    title: "Book Character",
    body: "Awaiting connected prompt...\n\nRun the chamber to generate a reusable book character.",
    outputKind: "image",
    imageMode: "book_character",
    imageAspect: "portrait",
  });
}

function createBookIllustrationCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 520,
    h: 420,
    title: "Book Illustration",
    body: "Awaiting connected prompt...\n\nRun the chamber to generate a print-style book illustration.",
    outputKind: "image",
    imageMode: "print_illustration",
    imageAspect: "landscape",
  });
}

function createImageOutputCard() {
  if (!clickMenu) return;

  const world = viewportPointToWorld(clickMenu.x + 8, clickMenu.y + 8);

  createMenuCard(world.x, world.y, {
    type: "output",
    w: 420,
    h: 340,
    title: "Image",
    body: "Awaiting connected prompt...\n\nRun the chamber to generate an image.",
    outputKind: "image",
    imageMode: "presentation_visual",
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
            onMouseEnter={() => setClickMenuSubmenu("new-card")}
          >
            <span>Bridge</span>
            <span className={menuPresetUi.subtle}>›</span>
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
              "absolute left-full top-[44px] ml-2 w-[210px] rounded-xl p-2",
              menuPresetUi.shell,
            ].join(" ")}
            onMouseLeave={() => setClickMenuSubmenu(null)}
          >
            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createFileContextCard}
            >
              File Context
            </button>

            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createSummaryBridgeCard}
            >
              Summary Bridge
            </button>

            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createImageProcessorCard}
            >
              Image Processor
            </button>

          </div>
        ) : null}

        {clickMenuSubmenu === "outputs" ||
        clickMenuSubmenu === "text-output" ||
        clickMenuSubmenu === "book-output" ? (
          <div
            className={[
              "absolute left-full top-[44px] ml-2 w-[220px] rounded-xl p-2",
              menuPresetUi.shell,
            ].join(" ")}
          >
        <div
          className={`px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${menuPresetUi.subtle}`}
        >
          Outputs
        </div>

    <button
      className={[
        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm",
        menuPresetUi.item,
      ].join(" ")}
      onMouseEnter={() => setClickMenuSubmenu("text-output")}
    >
      <span>Text Output</span>
      <span className={menuPresetUi.subtle}>›</span>
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

<button
  className={[
    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm",
    menuPresetUi.item,
  ].join(" ")}
  onMouseEnter={() => setClickMenuSubmenu("book-output")}
>
  <span>Books</span>
  <span className={menuPresetUi.subtle}>›</span>
</button>
    
    <button
  className={[
    "w-full rounded-md px-3 py-2 text-left text-sm",
    menuPresetUi.item,
  ].join(" ")}
  onClick={createImageOutputCard}
>
  Image Creation
</button>
  </div>
) : null}
{clickMenuSubmenu === "book-output" ? (
  <div
    className={[
      "absolute left-[calc(100%+232px)] top-[116px] ml-2 w-[230px] rounded-xl p-2",
      menuPresetUi.shell,
    ].join(" ")}
    onMouseLeave={() => setClickMenuSubmenu(null)}
  >
    <div
      className={`px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${menuPresetUi.subtle}`}
    >
      Book Outputs
    </div>

    <button
      className={[
        "w-full rounded-md px-3 py-2 text-left text-sm",
        menuPresetUi.item,
      ].join(" ")}
      onClick={createBookBackgroundCard}
    >
      Book Background
    </button>

    <button
      className={[
        "w-full rounded-md px-3 py-2 text-left text-sm",
        menuPresetUi.item,
      ].join(" ")}
      onClick={createBookCharacterCard}
    >
      Book Character
    </button>

    <button
      className={[
        "w-full rounded-md px-3 py-2 text-left text-sm",
        menuPresetUi.item,
      ].join(" ")}
      onClick={createBookIllustrationCard}
    >
      Book Illustration
    </button>
    <div className="my-2 h-px bg-black/10" />

<button
  className={[
    "w-full rounded-md px-3 py-2 text-left text-sm",
    menuPresetUi.item,
  ].join(" ")}
  onClick={createBookPageSquareCard}
>
  Book Page Square
</button>

<button
  className={[
    "w-full rounded-md px-3 py-2 text-left text-sm",
    menuPresetUi.item,
  ].join(" ")}
  onClick={createBookPagePortraitCard}
>
  Book Page Portrait
</button>

<button
  className={[
    "w-full rounded-md px-3 py-2 text-left text-sm",
    menuPresetUi.item,
  ].join(" ")}
  onClick={createBookPageLandscapeCard}
>
  Book Page Landscape
</button>
  </div>
  
) : null}
        {clickMenuSubmenu === "text-output" ? (
          <div
            className={[
              "absolute left-[calc(100%+232px)] top-[44px] ml-2 w-[220px] rounded-xl p-2",
              menuPresetUi.shell,
            ].join(" ")}
            onMouseLeave={() => setClickMenuSubmenu("outputs")}
          >
            <div
              className={`px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${menuPresetUi.subtle}`}
            >
              Text Output
            </div>

            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createSummaryOutputCard}
            >
              Summary
            </button>

            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createEmailOutputCard}
            >
              Email
            </button>

            <button
              className={[
                "w-full rounded-md px-3 py-2 text-left text-sm",
                menuPresetUi.item,
              ].join(" ")}
              onClick={createReportOutputCard}
            >
              Report
            </button>
          </div>
        ) : null}



      </div>
    </div>
  );
}