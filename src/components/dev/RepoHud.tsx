"use client";

import { useEffect, useState } from "react";

type Tier = "free" | "builder" | "pro" | "elite";

const TIER_KEY = "vestaryn.tier";

function getTier(): Tier {
  const v = typeof window !== "undefined" ? localStorage.getItem(TIER_KEY) : null;
  return v === "builder" || v === "pro" || v === "elite" ? v : "free";
}

function titleCase(s: string) {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

export default function RepoHud({
  repoId,
  repoName,
}: {
  repoId: string;
  repoName?: string | null;
}) {
  const [tier, setTier] = useState<Tier>("free");

  useEffect(() => {
    // initial
    setTier(getTier());

    // dev switcher updates localStorage; we can poll-on-focus cheaply
    const onFocus = () => setTier(getTier());
    window.addEventListener("focus", onFocus);

    // cross-tab changes
    const onStorage = (e: StorageEvent) => {
      if (e.key === TIER_KEY) setTier(getTier());
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // placeholder credits for now (we’ll wire real accounting later)
  const credits =
    tier === "free"
      ? 50_000
      : tier === "builder"
      ? 200_000
      : tier === "pro"
      ? 600_000
      : 1_500_000;

return (
  <div className="w-full">
    <div className="relative w-full rounded-xl overflow-hidden bg-gradient-to-b from-[#0a0f14] via-[#05080c] to-[#020304] shadow-[0_20px_40px_rgba(0,0,0,0.55),0_0_40px_rgba(59,130,246,0.12)] ring-1 ring-blue-500/25">
      {/* subtle grid like chamber */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(circle at 30% 20%, black 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(circle at 30% 20%, black 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 p-4">
        <div className="text-white/90 text-sm font-semibold leading-tight">
          {repoName?.trim() ? repoName : "Repo"}
        </div>

        <div className="mt-1 text-[11px] text-white/55 font-mono leading-tight break-all">
          {repoId}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-white/70">
            Tier: {titleCase(tier)}
          </span>

          <span className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-amber-100/80">
            Credits: {credits.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  </div>
);
}