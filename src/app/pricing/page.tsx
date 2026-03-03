// app/pricing/page.tsx
import Link from "next/link";
import { TIER_POLICIES, type VestarynTier, type TierPolicy } from "@/lib/membership/tiers";
import { supabaseServerComponent } from "@/lib/supabase/server";

type PublicTier = Exclude<VestarynTier, "admin">;

const ORDER: PublicTier[] = ["free", "builder", "pro", "elite"];

function fmt(n: number) {
  return n.toLocaleString();
}

function modelLabel(p: TierPolicy) {
  // e.g. "gpt-5.2 (premium)"
  return `${p.model} (${p.modelClass})`;
}

function graceLabel(p: TierPolicy) {
  if (p.budget.graceMode === "clamp") return "Clamp limits";
  if (p.budget.graceMode === "downgrade") return "Downgrade tier";
  return "Block";
}

function yesNo(v: boolean) {
  return v ? "✅" : "—";
}

function tagline(tier: PublicTier) {
  switch (tier) {
    case "free":
      return "Try the chamber with tight limits.";
    case "builder":
      return "Daily building with exports + more headroom.";
    case "pro":
      return "Serious work: multi-file ops + higher caps.";
    case "elite":
      return "Full power: architecture mode + multi-export + trees.";
  }
}

function bestFor(tier: PublicTier) {
  switch (tier) {
    case "free":
      return "Best for: exploration + light edits.";
    case "builder":
      return "Best for: consistent iteration + sharing outputs.";
    case "pro":
      return "Best for: production velocity + broader automation.";
    case "elite":
      return "Best for: deep systems work + maximal tooling.";
  }
}

function primaryBullets(p: TierPolicy) {
  const caps = p.capabilities;
  const out = p.output;
  const tools = p.tools;
  const budget = p.budget;

  // Keep these “marketing bullets” stable + readable.
  const bullets: string[] = [];

  bullets.push(`Credits / month: ${fmt(budget.creditsPerPeriod)}`);
  bullets.push(`Model: ${modelLabel(p)}`);
  bullets.push(`Max output tokens: ${fmt(out.maxOutputTokens)}`);
  bullets.push(`Tooling: ${tools.maxToolRounds} rounds × ${tools.maxToolCallsPerRound} calls`);
  bullets.push(`Vault: ${caps.allowCreateFiles ? "Create files" : "Edit existing"} (tools)`);
  bullets.push(`Exports: ${caps.allowExport ? "Enabled" : "Disabled"}`);

  if (caps.allowArchitectureMode) bullets.push("Architecture mode: Enabled");
  if (caps.allowMultiExport) bullets.push("Multi-export: Enabled");
  if (caps.allowCreateTrees) bullets.push("Project trees: Enabled");

  return bullets;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
      {children}
    </div>
  );
}

function Card({
  tier,
  p,
  current,
}: {
  tier: PublicTier;
  p: TierPolicy;
  current?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border border-white/10 bg-black/35 backdrop-blur-md shadow-[0_20px_70px_rgba(0,0,0,0.55)]",
        "p-5 flex flex-col gap-4",
        current ? "ring-1 ring-emerald-400/30" : "hover:border-white/15",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-white">{p.label}</div>
          <div className="text-sm text-white/55 mt-1">{tagline(tier)}</div>
          <div className="text-xs text-white/45 mt-2">{bestFor(tier)}</div>
        </div>

        {current ? (
          <span className="text-[11px] px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-400/20 text-emerald-100/80 whitespace-nowrap">
            Current
          </span>
        ) : null}
      </div>

      <div className="rounded-xl bg-black/25 border border-white/10 p-3">
        <div className="grid gap-2">
          {primaryBullets(p).map((b) => (
            <div key={b} className="text-sm text-white/70">
              • {b}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2">
        {tier === "free" ? (
          <Link
            href="/"
            className="w-full text-center px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/85"
          >
            Use Free
          </Link>
        ) : (
          <button
            className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/85"
            type="button"
            title="Hook this to billing later"
          >
            Upgrade (soon)
          </button>
        )}
      </div>

      <div className="text-[11px] text-white/40">
        Grace mode when low: <span className="text-white/55">{graceLabel(p)}</span> (reserve {fmt(p.budget.softReserveCredits)})
      </div>
    </div>
  );
}

function ComparisonTable({ tiers }: { tiers: Record<PublicTier, TierPolicy> }) {
  const rows: { label: string; value: (t: TierPolicy) => React.ReactNode }[] = [
    { label: "Credits / month", value: (t) => fmt(t.budget.creditsPerPeriod) },
    { label: "Model", value: (t) => modelLabel(t) },
    { label: "Max output tokens", value: (t) => fmt(t.output.maxOutputTokens) },
    { label: "Verbosity ceiling", value: (t) => t.output.verbosityCeiling },
    { label: "Code detail ceiling", value: (t) => t.output.codeDetailCeiling },
    { label: "Tool rounds", value: (t) => t.tools.maxToolRounds },
    { label: "Tool calls / round", value: (t) => t.tools.maxToolCallsPerRound },
    { label: "Vault enabled", value: (t) => yesNo(t.tools.allowVault) },
    { label: "Multi-file ops", value: (t) => yesNo(t.tools.allowMultiFileOps) },
    { label: "User profile edits", value: (t) => yesNo(t.tools.allowUserProfileEdits) },
    { label: "Export", value: (t) => yesNo(t.capabilities.allowExport) },
    { label: "Multi-export", value: (t) => yesNo(t.capabilities.allowMultiExport) },
    { label: "Create files (assistant)", value: (t) => yesNo(t.capabilities.allowCreateFiles) },
    { label: "Create trees", value: (t) => yesNo(t.capabilities.allowCreateTrees) },
    { label: "Architecture mode", value: (t) => yesNo(t.capabilities.allowArchitectureMode) },
    { label: "Grace mode", value: (t) => graceLabel(t) },
    { label: "Soft reserve", value: (t) => fmt(t.budget.softReserveCredits) },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 backdrop-blur-md overflow-hidden">
      <div className="p-4 border-b border-white/10">
        <div className="text-base font-semibold text-white">Full comparison</div>
        <div className="text-sm text-white/50 mt-1">
          This table is generated from <span className="text-white/70 font-mono">TIER_POLICIES</span>.
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="sticky top-0 bg-black/60 backdrop-blur-md border-b border-white/10">
            <tr>
              <th className="text-left px-4 py-3 text-white/50 font-medium">Feature</th>
              {ORDER.map((k) => (
                <th key={k} className="text-left px-4 py-3 text-white/80 font-medium">
                  {tiers[k].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-white/10 last:border-b-0">
                <td className="px-4 py-3 text-white/55">{r.label}</td>
                {ORDER.map((k) => (
                  <td key={k} className="px-4 py-3 text-white/75">
                    {r.value(tiers[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

 export default async function PricingPage() {
  const tiers = {
    free: TIER_POLICIES.free,
    builder: TIER_POLICIES.builder,
    pro: TIER_POLICIES.pro,
    elite: TIER_POLICIES.elite,
  } satisfies Record<PublicTier, TierPolicy>;

  // Optional: show current tier if you persist it (your canon does: workspace_credit_balances.tier)
  let currentTier: PublicTier | null = null;

  try {
    const supabase = await supabaseServerComponent();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .limit(1);

      const workspaceId = membership?.[0]?.workspace_id;

      if (workspaceId) {
        // Compute UTC month start: YYYY-MM-01
        const now = new Date();
        const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
          .toISOString()
          .slice(0, 10); // date

        const { data: bal, error: balErr } = await supabase
          .from("workspace_credit_balances")
          .select("tier")
          .eq("workspace_id", workspaceId)
          .eq("period_start", periodStart)
          .maybeSingle();

        if (!balErr) {
          const t = (bal as any)?.tier as string | undefined;
          if (t === "free" || t === "builder" || t === "pro" || t === "elite") currentTier = t;
        }
      }
    }
  } catch {
    // ignore
  }

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold">Vestaryn Plans</h1>
            <p className="text-white/55 mt-2">
              Workspace-based credits. Server-enforced caps. Upgrade later when you need more depth.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="text-[11px] px-2 py-1 rounded-md border border-white/10 bg-white/5 text-white/60">
                Credits reset monthly
              </span>
              <span className="text-[11px] px-2 py-1 rounded-md border border-white/10 bg-white/5 text-white/60">
                RLS enforced
              </span>
              <span className="text-[11px] px-2 py-1 rounded-md border border-white/10 bg-white/5 text-white/60">
                Policy-driven limits
              </span>
            </div>
          </div>

          <div className="shrink-0">
            <Link
              href="/"
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/85"
            >
              Back to app
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {ORDER.map((tierKey) => (
            <Card
              key={tierKey}
              tier={tierKey}
              p={tiers[tierKey]}
              current={currentTier === tierKey}
            />
          ))}
        </div>

        <ComparisonTable tiers={tiers} />

        <div className="space-y-2 text-xs text-white/45">
          <SectionTitle>Notes</SectionTitle>
          <div>• “Create files” refers to assistant tool-driven creation (vault_propose_write on new paths).</div>
          <div>• “Architecture mode” maps to your server resolver using SYSTEM_PROTECTOR_ARCH.</div>
          <div>• “Grace mode” triggers when remaining credits drop under the tier reserve threshold.</div>
        </div>
      </div>
    </div>
  );
}
  
