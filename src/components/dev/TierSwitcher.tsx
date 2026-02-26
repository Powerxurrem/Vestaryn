"use client";

import { useEffect, useState } from "react";

type Tier = "free" | "builder" | "pro" | "elite";

const STORAGE_KEY = "vestaryn.tier";

function isTier(v: any): v is Tier {
  return v === "free" || v === "builder" || v === "pro" || v === "elite";
}

export default function TierSwitcher() {
  const [tier, setTier] = useState<Tier>("free");
  const [mounted, setMounted] = useState(false);
console.log("NODE_ENV:", process.env.NODE_ENV);
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTier(stored)) setTier(stored);
  }, []);

  function update(next: Tier) {
    setTier(next);
    localStorage.setItem(STORAGE_KEY, next);
    // Optional: refresh to ensure any server-rendered bits reflect it (usually not needed)
    // window.location.reload();
  }

  // Dev-only gate (also allow explicit env flag)
const [show, setShow] = useState(false);

useEffect(() => {
  setMounted(true);
  setShow(
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_VESTARYN_ADMIN_UI === "1"
  );
}, []);

if (!mounted || !show) return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="opacity-60">Tier</span>
      <select
        value={tier}
        onChange={(e) => update(e.target.value as Tier)}
        className="rounded-md border border-white/10 bg-white/5 px-2 py-1"
        title="Dev-only membership tier simulator"
      >
        <option value="free">Free</option>
        <option value="builder">Builder</option>
        <option value="pro">Pro</option>
        <option value="elite">Elite</option>
      </select>
    </div>
  );
}