import { normalizeCommonPathVariants } from "@/lib/chamber/pathNormalization";

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

function normalizePath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").trim().toLowerCase();
}

function extname(path: string): string {
  const m = normalizePath(path).match(/(\.[a-z0-9]+)$/i);
  return m?.[1] ?? "";
}

function isLikelyImplicitEditRequest(content: string) {
  const t = String(content ?? "").toLowerCase().trim();
  if (!t) return false;

  const hasAction =
    /\b(change|update|edit|rewrite|rename|replace|make|set|turn|fix|correct|adjust|improve|repair)\b/.test(t);

  const hasContinuation =
    /\b(continue|go ahead|yes|still|again|retry|fix it|do it)\b/.test(t);

  const hasTargetReference =
    /\b(page|about|index|layout|navbar|nav|header|footer|hero|section|content|chart|macro|formula|sheet|table|graph)\b/.test(t);

  const hasQualitySignal =
    /\b(wrong|bad|off|not right|broken|issue|error|not working|not linked|linked)\b/.test(t);

  return (
    (hasAction && hasTargetReference) ||
    (hasContinuation && hasTargetReference) ||
    (hasTargetReference && hasQualitySignal)
  );
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

function isStyleOnlyRequest(text: string): boolean {
  const hasStyle =
    /\b(css|styles|styling|theme|colors?|background|shadow|gradient|hover|font|spacing|padding|margin)\b/.test(text);

  const hasContentOrStructure =
    /\b(title|heading|headline|text|copy|content|label|name|naming|story|mission|team|section|hero|navbar|nav|header|footer|layout|page)\b/.test(text);

  return hasStyle && !hasContentOrStructure;
}

function contentAwarePathBias(content: string, path: string): number {
  const text = String(content ?? "").toLowerCase();
  const normalizedPath = normalizePath(path);
  const ext = extname(normalizedPath);

  let score = 0;

  const isAbout = normalizedPath.endsWith("about.html");
  const isIndex = normalizedPath.endsWith("index.html");
  const isCss = ext === ".css";
  const isHtml = ext === ".html";

  const mentionsAbout =
    /\babout page\b/.test(text) ||
    /\babout\.html\b/.test(text) ||
    /\babout\b/.test(text);

  const mentionsIndex =
    /\bindex\.html\b/.test(text) ||
    /\bhome page\b/.test(text) ||
    /\bhomepage\b/.test(text) ||
    /\bindex\b/.test(text);

  const textOrContentRequest =
    /\b(title|heading|headline|text|copy|wording|content|label|name|naming|story|mission|team|paragraph|section)\b/.test(
      text
    );

  const layoutRequest =
    /\b(layout|structure|page|hero|navbar|nav|header|footer|align|match|same|consistent|visually align|visually match)\b/.test(
      text
    );

  const pureStyleRequest =
    /\b(css|styles|styling|theme|colors?|background|shadow|gradient|hover|font|spacing|padding|margin)\b/.test(
      text
    );

  const pageIdentityCorrection =
    /\b(has nothing to do with|wrong page|wrong content|wrong topic|completely different|doesn'?t match the page)\b/.test(
      text
    );

  const referenceStylePattern =
    /\bmatch .* with\b/.test(text) ||
    /\balign .* with\b/.test(text) ||
    /\blike index\.html\b/.test(text) ||
    /\bwith index\.html\b/.test(text);

  if (mentionsAbout && isAbout) score += 10;
  if (mentionsIndex && isIndex) score += 10;

  if (textOrContentRequest && isHtml) score += 5;
  if (layoutRequest && isHtml) score += 4;
  if (pureStyleRequest && isCss) score += 4;

  if (isStyleOnlyRequest(text) && isCss) score += 6;
  if (!isStyleOnlyRequest(text) && isCss) score -= 1;

  if (pageIdentityCorrection && isHtml) score += 7;
  if (pageIdentityCorrection && isCss) score -= 2;

  if (referenceStylePattern && isHtml) score += 3;

  if (/\bnavbar naming\b/.test(text) && isHtml) score += 6;
  if (/\bnavbar naming\b/.test(text) && isCss) score -= 2;

  if (/\bpokemon\b/.test(text) && isAbout) score += 4;

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
    const key = normalizeCommonPathVariants(ref.path);
    if (!key) continue;

    const score =
      scoreRecentFile(ref) + contentAwarePathBias(content, ref.path);

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

  if (best.score >= 8 && margin >= 2) {
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