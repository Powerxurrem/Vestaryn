export type RecentFileRefSource =
  | "apply"
  | "proposal"
  | "read"
  | "active_tab";

export type RecentFileRef = {
  path: string;
  source: RecentFileRefSource;
  ts?: number;
};

export type ContinuityResolution = {
  matched: boolean;
  confidence: "low" | "medium" | "high";
  targetPath: string | null;
  reason: string;
};

const IMPLICIT_EDIT_PATTERNS: RegExp[] = [
  /\byes continue\b/i,
  /\bcontinue\b/i,
  /\bchange (it|that|this)\b/i,
  /\bupdate (it|that|this)\b/i,
  /\bmodify (it|that|this)\b/i,
  /\bedit (it|that|this)\b/i,
  /\bfix (it|that|this)\b/i,
  /\bmake (it|that|this)\b/i,
  /\bmake\b/i,
  /\badd\b/i,
  /\bremove\b/i,
  /\bshorten\b/i,
  /\blengthen\b/i,
  /\brename\b/i,
  /\bheaders?\b/i,
  /\brows?\b/i,
  /\bcolumns?\b/i,
  /\bgreen\b/i,
  /\bblue\b/i,
  /\bred\b/i,
  /\blight green\b/i,
  /\blight blue\b/i,
  /\bit\b/i,
  /\bthat\b/i,
  /\bthis\b/i,
];

function normalizePath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").trim().toLowerCase();
}

export function isLikelyImplicitEditRequest(content: string): boolean {
  const text = String(content ?? "").trim();
  if (!text) return false;
  return IMPLICIT_EDIT_PATTERNS.some((rx) => rx.test(text));
}

function scoreRecentFile(ref: RecentFileRef, now = Date.now()): number {
  let score = 0;

  if (ref.source === "apply") score += 10;
  if (ref.source === "proposal") score += 7;
  if (ref.source === "read") score += 4;
  if (ref.source === "active_tab") score += 3;

  if (ref.ts) {
    const ageMs = Math.max(0, now - ref.ts);
    if (ageMs < 2 * 60 * 1000) score += 6;
    else if (ageMs < 10 * 60 * 1000) score += 4;
    else if (ageMs < 30 * 60 * 1000) score += 2;
  }

  return score;
}

export function resolveImplicitFollowupTarget(args: {
  content: string;
  mentionedPaths: string[];
  recentFiles: RecentFileRef[];
}): ContinuityResolution {
  const { content, mentionedPaths, recentFiles } = args;

  if (mentionedPaths.length > 0) {
    return {
      matched: false,
      confidence: "low",
      targetPath: null,
      reason: "explicit_path_present",
    };
  }

  if (!isLikelyImplicitEditRequest(content)) {
    return {
      matched: false,
      confidence: "low",
      targetPath: null,
      reason: "not_implicit_edit_request",
    };
  }

  const deduped = new Map<string, RecentFileRef & { score: number }>();

  for (const ref of recentFiles) {
    const key = normalizePath(ref.path);
    if (!key) continue;

    const score = scoreRecentFile(ref);
    const prev = deduped.get(key);

    if (!prev || score > prev.score) {
      deduped.set(key, { ...ref, score });
    }
  }

  const ranked = [...deduped.values()].sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return {
      matched: false,
      confidence: "low",
      targetPath: null,
      reason: "no_recent_file_context",
    };
  }

  const best = ranked[0];
  const second = ranked[1];
  const margin = best.score - (second?.score ?? 0);

  if (best.score >= 12 && margin >= 3) {
    return {
      matched: true,
      confidence: "high",
      targetPath: best.path,
      reason: `strong_recent_file:${best.source}`,
    };
  }

  if (best.score >= 8 && margin >= 4) {
    return {
      matched: true,
      confidence: "medium",
      targetPath: best.path,
      reason: `recent_file_bias:${best.source}`,
    };
  }

  return {
    matched: false,
    confidence: "low",
    targetPath: null,
    reason: "ambiguous_recent_file_context",
  };
}