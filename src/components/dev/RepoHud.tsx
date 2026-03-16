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

function Sigil() {
  return (
    <div className="relative flex items-center justify-center mt-12">
      {/* glow */}
      <div className="absolute h-20 w-20 rounded-full bg-blue-500/20 blur-2xl opacity-60" />

      {/* border diamond */}
      <div
        className="relative flex items-center justify-center"
        style={{
          clipPath: "polygon(50% 0%,100% 50%,50% 100%,0% 50%)",
        }}
      >
        <div className="h-[92px] w-[92px] bg-blue-400/25 flex items-center justify-center">
          
          {/* inner diamond */}
          <div
            className="h-[86px] w-[86px] overflow-hidden"
            style={{
              clipPath: "polygon(50% 0%,100% 50%,50% 100%,0% 50%)",
            }}
          >
            <img
              src="/vestaryn_avatar.png"
              className="absolute inset-0 h-full w-full object-cover opacity-90"
            />
          </div>

        </div>
      </div>
    </div>
  );
}

export function VestarynFrame({
  repoId,
  repoName,
  right,
  children,
}: {
  repoId: string;
  repoName?: string | null;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative z-[1000] w-full h-full flex flex-col min-w-0">
      {/* Top rail */}
      <div className="relative z-[1000] h-12 shrink-0 px-3 flex items-center gap-3 border-b border-blue-400/35 bg-black/35 backdrop-blur-md overflow-visible  mb-15">
        <RepoHud repoId={repoId} repoName={repoName} />

        {/* Center nav placeholder */}
        <div className="mx-auto flex items-center gap-2">
          <button className="px-3 py-1.5 text-sm rounded-lg text-white/65 hover:text-white hover:bg-white/5">
            Cinematic (WIP)
          </button>
<div className="px-3">
  <Sigil />
</div>
          <button className="px-3 py-1.5 text-sm rounded-lg text-white/65 hover:text-white hover:bg-white/5">
            Serious (WIP)
          </button>
        </div>

        {/* Right slot */}
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 min-w-0">{children}</div>
    </div>
  );
}

export default function RepoHud({
  repoId,
  repoName,
}: {
  repoId: string;
  repoName?: string | null;
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
{titleCaseTier(tierDb)}
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

useEffect(() => {
  function onMaint(e: Event) {
    const ce = e as CustomEvent<any>;
    const detail = ce.detail ?? {};

    console.log("[RepoHud] maintenance event received", detail);

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

async function onLogout() {
  setOpen(false);
  const supabase = supabaseBrowser();
  await supabase.auth.signOut();
  window.location.href = "/";
}

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 max-w-[420px] rounded-lg px-2 py-1 hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-blue-400/40"
        title="Account / Repo menu"
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

        {maintenance && (
          <span
            className="text-[11px] rounded-md border border-blue-400/20 bg-blue-500/10 px-2 py-0.5 text-blue-100/80 whitespace-nowrap"
            title="Chamber maintenance recommended"
          >
            resummarize
            {maintenance.count && maintenance.cap ? ` ${maintenance.count}/${maintenance.cap}` : ""}
          </span>
        )}

        <span className="ml-1 text-white/30 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-[260px] rounded-xl border border-white/10 bg-black/95 backdrop-blur-md shadow-[0_20px_50px_rgba(0,0,0,0.55)] p-1 z-50 ring-1 ring-white/10 border border-white/15" >
<div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-white/40">
  Account
</div>

<MenuItem
  onClick={() => {
    setOpen(false);
    // later: route to account/profile page
  }}
>
  Profile (soon)
</MenuItem>

<MenuItem
  onClick={() => {
    setOpen(false);
    // later: route to usage/billing
  }}
>
  Usage (soon)
</MenuItem>

<MenuItem
  onClick={() => {
    setOpen(false);
    window.location.href = "/pricing";
  }}
>
  Pricing
</MenuItem>

          <div className="my-1 h-px bg-white/10" />

          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-white/40">
            Repo
          </div>

          <MenuItem
            onClick={() => {
              copyRepoId();
              setOpen(false);
            }}
          >
            {copied ? "Copied ✓" : "Copy repo id"}
          </MenuItem>

          <div className="my-1 h-px bg-white/10" />

          <MenuItem danger onClick={onLogout}>
            Log out
          </MenuItem>
        </div>
      )}
    </div>
  );
}