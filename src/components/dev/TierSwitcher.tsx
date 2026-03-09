"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Tier = "early_access" | "free" | "builder" | "pro" | "elite";

const STORAGE_KEY = "vestaryn.tier";
const ADMIN_EMAILS = ["powerxurremss@gmail.com"];

function isTier(v: unknown): v is Tier {
  return (
    v === "early_access" ||
    v === "free" ||
    v === "builder" ||
    v === "pro" ||
    v === "elite"
  );
}

function canAccessAdminUi(email?: string | null) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

export default function TierSwitcher() {
  const [tier, setTier] = useState<Tier>("early_access");
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;

    async function boot() {
      setMounted(true);

      const stored = localStorage.getItem(STORAGE_KEY);
      if (isTier(stored)) setTier(stored);

      if (process.env.NODE_ENV !== "production") {
        if (active) setShow(true);
        return;
      }

      const supabase = supabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const email = user?.email?.toLowerCase() ?? "";
      if (active) setShow(canAccessAdminUi(email));
    }

    boot();
    return () => {
      active = false;
    };
  }, []);

  function update(next: Tier) {
    setTier(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

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
        <option value="early_access">Early Access</option>
        <option value="free">Free</option>
        <option value="builder">Builder</option>
        <option value="pro">Pro</option>
        <option value="elite">Elite</option>
      </select>
    </div>
  );
}