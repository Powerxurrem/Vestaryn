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
async function copyRepoId() {
  try {
    await navigator.clipboard.writeText(repoId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  } catch {}
}

async function onLogout() {
  setCoreOpen(false);
  const supabase = supabaseBrowser();
  await supabase.auth.signOut();
  window.location.href = "/";
}

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
  ? "h-35 mb-0 border-blue-400/20 bg-transparent backdrop-blur-none"
  : "h-12 mb-15 border-blue-400/35 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.85),rgba(2,6,23,0.6),transparent)] backdrop-blur-md",
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
  {/* 🔥 Custom bottom border glow */}
<div className="pointer-events-none absolute bottom-0 left-0 w-full h-[11px]">
  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-400/40 to-transparent blur-[100px]" />
  <div className="absolute inset-0 bg-blue-400/10" />
</div>
{/* subtle top edge */}
<div className="pointer-events-none absolute top-0 left-0 w-full h-[17px] bg-gradient-to-r from-transparent bg-blue-400/10 to-transparent blur-[20px]" />
    {/* LEFT STREAK */}
    <div className="pointer-events-none absolute left-0 top-0 h-full w-[120px] bg-gradient-to-r from-black/80 via-black/30 to-transparent" />

    {/* RIGHT STREAK */}
    <div className="pointer-events-none absolute right-0 top-0 h-full w-[120px] bg-gradient-to-l from-black/80 via-black/30 to-transparent" />
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
  className="relative z-10 h-[180px] w-[200px] object-contain mix-blend-screen opacity-90 animate-[float_6s_ease-in-out_infinite]"
  style={{
    maskImage: `
      radial-gradient(circle at center,
        black 0%,
        black 45%,
        rgba(0,0,0,0.9) 55%,
        rgba(0,0,0,0.6) 25%,
        rgba(0,0,0,0.2) 75%,
        transparent 90%
      )
    `,
    WebkitMaskImage: `
      radial-gradient(circle at center,
        black 0%,
        black 25%,
        rgba(0,0,0,0.9) 55%,
        rgba(0,0,0,0.6) 65%,
        rgba(0,0,0,0.2) 75%,
        transparent 30%
      )
    `,
    filter: "drop-shadow(-30 -30 300px rgba(96,165,250,0.35)) saturate(1.15)",
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
            className="relative h-full w-full overflow-hidden bg-[#f4f5f8] "
            onContextMenu={(e) => {
              e.preventDefault();

              const rect = e.currentTarget.getBoundingClientRect();

              setArtisticMenu({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
              });
            }}
            onClick={() => {
              if (artisticMenu) setArtisticMenu(null);
            }}
          >


{/* Bottom chamber bar */}
<div className="pointer-events-none absolute bottom-0 left-0 z-[1] h-[40px] w-full">
  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(4,8,16,0.98),rgba(8,14,26,0.94),rgba(12,20,34,0.88))]" />
  <div className="absolute top-0 left-0 h-px w-full bg-blue-400/22 shadow-[0_0_14px_rgba(96,165,250,0.18)]" />
  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(96,165,250,0.06),transparent_48%)]" />
</div>

            <div
              className="absolute inset-0 transition-opacity duration-700"
              style={{
                backgroundImage: "url('/task_01kn9mmwgkefetfpb2k97syv2c_1775218904_img_1.webp')",
                backgroundSize: "cover",
                backgroundPosition: "center",
                opacity: 0.22,
              }}
            />

            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.20),rgba(255,255,255,0.04)_35%,rgba(0,0,0,0.0)_70%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.10),rgba(255,255,255,0.03),rgba(255,255,255,0.08))]" />
            <div className="pointer-events-none absolute inset-[0px] z-[0] rounded-[28px] shadow-[inset_0_0_80px_rgba(8,14,26,0.14),inset_0_0_160px_rgba(96,165,250,0.03)]" />

            <div className="absolute left-1/2 top-1/2 h-[180vh] w-[180vw] -translate-x-1/2 -translate-y-1/2">
              <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(0,0,0,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.18)_1px,transparent_1px)] [background-size:48px_48px]" />
            </div>


            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 rounded-2xl border border-black/10 bg-white/35 px-4 py-2 text-xs text-black/55 backdrop-blur-xl">
              Right-click anywhere on the canvas to summon Vestaryn
            </div>

            {artisticMenu ? (
              <div
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
                    onClick={() => setArtisticMenu(null)}
                    className="rounded-md px-2 py-1 text-xs text-black/40 hover:bg-black/5 hover:text-black/70"
                  >
                    ✕
                  </button>
                </div>

                <textarea
                  value={artisticPrompt}
                  onChange={(e) => setArtisticPrompt(e.target.value)}
                  placeholder="Shape the chamber..."
                  className="min-h-[110px] w-full resize-none rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-black/80 outline-none placeholder:text-black/30 focus:border-blue-400/40"
                />

                <div className="mt-3 flex items-center justify-between">
                  <div className="text-[11px] text-black/35">
                    Spatial ideation surface
                  </div>

                  <button
                    type="button"
                    className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-900 hover:bg-blue-500/15"
                  >
                    Send
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

      {/* Tier */}
      <span className="text-[11px] rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-white/70 whitespace-nowrap">
        {titleCase(tierDb)}
      </span>

      {/* Credits */}
      <span className="text-[11px] rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-amber-100/80 whitespace-nowrap">
        {shownCredits}
      </span>

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
