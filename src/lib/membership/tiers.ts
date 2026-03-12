// lib/membership/tiers.ts
export type VestarynTier = "early_access" | "free" | "builder" | "pro" | "elite" | "admin";
export type ModelClass = "mini" | "standard" | "premium";

export type BudgetPolicy = {
  period: "monthly";
  creditsPerPeriod: number;
  softReserveCredits: number;
  graceMode: "clamp" | "downgrade" | "block";
};

export type OutputPolicy = {
  maxOutputTokens: number;
  verbosityCeiling: "low" | "medium" | "high" | "very_high";
  codeDetailCeiling: "snippets" | "full_files" | "multi_file_diffs";
};

export type ToolPolicy = {
  maxToolRounds: number;
  maxToolCallsPerRound: number;
  allowVault: boolean;
  allowMultiFileOps: boolean;
  allowUserProfileEdits: boolean;
};

/**
 * Future-proof feature gates (not necessarily enforced yet).
 */
export type CapabilityPolicy = {
  // Exporting chat/session artifacts (e.g. markdown, zip, pdf later)
  allowExport: boolean;       // Builder+
  allowMultiExport: boolean;  // Elite only

  // Vault authoring capabilities
  allowCreateFiles: boolean;  // Pro+ (create new files from scratch)
  allowCreateTrees: boolean;  // Elite only (scaffold project trees / inventories)
  allowArchitectureMode: boolean;
};

export type TierPolicy = {
  tier: VestarynTier;
  label: string;

  isTemporary?: boolean;
  isInviteOnly?: boolean;

  model: string;
  modelClass: ModelClass;

  output: OutputPolicy;
  tools: ToolPolicy;
  budget: BudgetPolicy;
  capabilities: CapabilityPolicy;
};


export const TIER_POLICIES: Record<VestarynTier, TierPolicy> = {
  free: {
    tier: "free",
    label: "Free",
    model: "gpt-4.1-mini",
    modelClass: "mini",
    output: {
      maxOutputTokens: 650,
      verbosityCeiling: "low",
      codeDetailCeiling: "snippets",
    },
    tools: {
      maxToolRounds: 2,
      maxToolCallsPerRound: 2,
      allowVault: true,
      allowMultiFileOps: false,
      allowUserProfileEdits: false,
    },
    budget: {
      period: "monthly",
      creditsPerPeriod: 50_000,
      softReserveCredits: 2_000,
      graceMode: "clamp",
    },
    capabilities: {
      allowExport: false,
      allowMultiExport: false,
      allowCreateFiles: false,
      allowCreateTrees: false,
      allowArchitectureMode: false,
    },
  },

early_access: {
  tier: "early_access",
  label: "Early Access",
  isTemporary: true,
  isInviteOnly: true,
  model: "gpt-4.1-mini",
  modelClass: "mini",
  output: {
    maxOutputTokens: 1200,
    verbosityCeiling: "medium",
    codeDetailCeiling: "full_files",
  },
  tools: {
    maxToolRounds: 4,
    maxToolCallsPerRound: 4,
    allowVault: true,
    allowMultiFileOps: true,
    allowUserProfileEdits: true,
  },
  budget: {
    period: "monthly",
    creditsPerPeriod: 1_000_000,
    softReserveCredits: 10_000,
    graceMode: "clamp",
  },
  capabilities: {
    allowExport: true,
    allowMultiExport: false,
    allowCreateFiles: true,
    allowCreateTrees: false,
    allowArchitectureMode: false,
  },
},

  builder: {
    tier: "builder",
    label: "Builder",
    model: "gpt-5-mini",
    modelClass: "mini",
    output: {
      maxOutputTokens: 1200,
      verbosityCeiling: "medium",
      codeDetailCeiling: "full_files",
    },
    tools: {
      maxToolRounds: 3,
      maxToolCallsPerRound: 3,
      allowVault: true,
      allowMultiFileOps: false,
      allowUserProfileEdits: true,
    },
    budget: {
      period: "monthly",
      creditsPerPeriod: 200_000,
      softReserveCredits: 5_000,
      graceMode: "clamp",
    },
    capabilities: {
      allowExport: true,        // ✅ Builder+
      allowMultiExport: false,  // ❌ Elite only
      allowCreateFiles: false,  // ❌ Pro+
      allowCreateTrees: false,  // ❌ Elite only
      allowArchitectureMode: false,
    },
  },

  pro: {
    tier: "pro",
    label: "Pro",
    model: "gpt-5",
    modelClass: "standard",
    output: {
      maxOutputTokens: 2000,
      verbosityCeiling: "high",
      codeDetailCeiling: "full_files",
    },
    tools: {
      maxToolRounds: 4,
      maxToolCallsPerRound: 4,
      allowVault: true,
      allowMultiFileOps: true,
      allowUserProfileEdits: true,
    },
    budget: {
      period: "monthly",
      creditsPerPeriod: 600_000,
      softReserveCredits: 10_000,
      graceMode: "downgrade",
    },
    capabilities: {
      allowExport: true,
      allowMultiExport: false,
      allowCreateFiles: true,   // ✅ Pro+
      allowCreateTrees: false,  // ❌ Elite only
      allowArchitectureMode: false,
    },
  },

  elite: {
    tier: "elite",
    label: "Elite",
    model: "gpt-5.2",
    modelClass: "premium",
    output: {
      maxOutputTokens: 3200,
      verbosityCeiling: "very_high",
      codeDetailCeiling: "multi_file_diffs",
    },
    tools: {
      maxToolRounds: 6,
      maxToolCallsPerRound: 6,
      allowVault: true,
      allowMultiFileOps: true,
      allowUserProfileEdits: true,
    },
    budget: {
      period: "monthly",
      creditsPerPeriod: 1_500_000,
      softReserveCredits: 20_000,
      graceMode: "downgrade",
    },
    capabilities: {
      allowExport: true,
      allowMultiExport: true,  // ✅ Elite only
      allowCreateFiles: true,  // ✅ Pro+
      allowCreateTrees: true,  // ✅ Elite only
      allowArchitectureMode: true,
    },
  },

  admin: {
    tier: "admin",
    label: "Admin",
    model: "gpt-5-2",
    modelClass: "premium",
    output: {
      maxOutputTokens: 4000,
      verbosityCeiling: "very_high",
      codeDetailCeiling: "multi_file_diffs",
    },
    tools: {
      maxToolRounds: 8,
      maxToolCallsPerRound: 10,
      allowVault: true,
      allowMultiFileOps: true,
      allowUserProfileEdits: true,
    },
    budget: {
      period: "monthly",
      creditsPerPeriod: 10_000_000,
      softReserveCredits: 50_000,
      graceMode: "clamp",
    },
    capabilities: {
      allowExport: true,
      allowMultiExport: true,
      allowCreateFiles: true,
      allowCreateTrees: true,
      allowArchitectureMode: true,
    },
  },
};

export function parseTier(value: string | null | undefined): VestarynTier | null {
  const v = (value ?? "").toLowerCase().trim();
  if (
    v === "early_access" ||
    v === "free" ||
    v === "builder" ||
    v === "pro" ||
    v === "elite" ||
    v === "admin"
  ) return v;
  return null;
}

export function resolveTierPolicy(
  requested: string | null | undefined,
  opts: { isAdminAllowed: boolean; forcedTier?: VestarynTier }
): TierPolicy {
  return resolveTierPolicyWithMeta(requested, opts).policy;
}

export function resolveTierPolicyWithMeta(
  requested: string | null | undefined,
  opts: { isAdminAllowed: boolean; forcedTier?: VestarynTier }
): { policy: TierPolicy; meta: { requested: VestarynTier | null; effective: VestarynTier; adminClamped: boolean; forced: boolean } } {
  const requestedParsed = parseTier(requested);
  const forced = !!opts.forcedTier;

  const raw = opts.forcedTier ?? requestedParsed ?? "free";
  const adminClamped = raw === "admin" && !opts.isAdminAllowed;

  const effective: VestarynTier = adminClamped ? "free" : raw;
  return { policy: TIER_POLICIES[effective], meta: { requested: requestedParsed, effective, adminClamped, forced } };
}