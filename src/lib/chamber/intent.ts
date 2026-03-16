export function extractMentionedPaths(text: string) {
  return Array.from(
    new Set(
      (text.match(/[\w./\-[\]]+\.[A-Za-z0-9]+/g) ?? []).map((s) => s.trim())
    )
  );
}

export function extractSingleMentionedPath(text: string) {
  const paths = extractMentionedPaths(text || "");
  return paths.length === 1 ? paths[0] : null;
}

export function isNamedFileExecutionRequest(text: string) {
  if (isCreateAndModifyIntent(text)) {
    return false;
  }

  return (
    /check|correct|fix|debug|resolve|repair|rewrite|improve|refactor|clean up|cleanup|harden|modify|edit|update|review|inspect|turn|transform|convert|evolve/i.test(
      text || ""
    ) && extractMentionedPaths(text || "").length >= 1
  );
}

export function isRepositoryExecutionIntent(text: string) {
  return /create|add|render|use|insert|implement|refine|improve|rewrite|clean up|cleanup|harden|extend|modify|edit|tighten|fix|update|replace|check|correct|review|inspect|debug|repair|resolve|turn|transform|convert|evolve/i.test(
    text || ""
  );
}

export function isCreateAndModifyIntent(text: string) {
  return (
    /create|add|implement/i.test(text || "") &&
    /render|use|import|insert|mount/i.test(text || "")
  );
}

export function resolveCreateAndModifyPaths(text: string) {
  const paths = extractMentionedPaths(text || "");
  if (paths.length < 2) return null;

  const createPath =
    paths.find((p) => !/app\/page\.tsx$/i.test(p)) ?? paths[0] ?? null;

  const modifyPath =
    paths.find((p) => /app\/page\.tsx$/i.test(p)) ??
    paths.find((p) => p !== createPath) ??
    null;

  if (!createPath || !modifyPath) return null;
  if (createPath === modifyPath) return null;

  return { createPath, modifyPath };
}

// ─────────────────────────────────────────────
// Extract → module intent
// Example:
// "Extract card styles from components/Card.tsx into components/cardStyles.ts"
// ─────────────────────────────────────────────

export function isExtractToModuleIntent(text: string) {
  const t = text.toLowerCase();

  const hasExtractLanguage =
    /\bextract\b/.test(t) ||
    /\bmove\b/.test(t) ||
    /\bpull\b/.test(t);

  const hasModuleLanguage =
    /\bmodule\b/.test(t) ||
    /\bhelper\b/.test(t) ||
    /\bhelpers\b/.test(t) ||
    /\butil\b/.test(t) ||
    /\butils\b/.test(t);

  const isImportRefactorLike =
    /\bimport\b/.test(t) ||
    /\bshared\b/.test(t) ||
    /\buse\b.+\binside\b/.test(t) ||
    /\bupdate\b.+\bimport\b/.test(t);

  if (isImportRefactorLike) return false;

  return hasExtractLanguage && hasModuleLanguage;
}

export function looksLikeStandaloneModule(path: string, content: string) {
  const body = String(content ?? "").trim();
  if (!body) return false;

  const isTsLike = /\.(ts|tsx|js|jsx)$/i.test(path);
  if (!isTsLike) return true;

  const hasImport = /\bimport\b/.test(body);
  const hasExport = /\bexport\b/.test(body);
  const hasComponentLike = /\bconst\s+[A-Z]\w*\s*:\s*React\.FC\b|\bfunction\s+[A-Z]\w*\s*\(/.test(body);
  const hasInterface = /\binterface\s+\w+/.test(body);
  const looksLikeTailFragment = /^(return\s*\(|\}\s*;?\s*export\b|\)\s*;?\s*$)/.test(body);
  const looksLikeHeadFragment = /^(import[\s\S]*?)$/.test(body) && !hasExport && !hasComponentLike && !hasInterface;

  if (looksLikeTailFragment) return false;
  if (looksLikeHeadFragment) return false;

  return hasExport || hasComponentLike || hasInterface;
}

export function isMetaRepositoryQuestion(text: string) {
  const t = text.toLowerCase();

  return (
    /\bmake sure\b/.test(t) ||
    /\bdoes\b/.test(t) ||
    /\bshould\b/.test(t) ||
    /\bwhy\b/.test(t) ||
    /\bhow\b/.test(t) ||
    /\bcheck\b/.test(t) ||
    /\bverify\b/.test(t) ||
    /\bdebug\b/.test(t) ||
    /\btrigger\b/.test(t) ||
    /\borchestration\b/.test(t) ||
    /\bread of\b/.test(t) ||
    /\btest\b/.test(t)
  );
}

export function resolveExtractToModulePaths(text: string): {
  sourcePath: string;
  targetPath: string;
} | null {
  const raw = String(text ?? "").trim();
  const paths = extractMentionedPaths(raw);

  if (paths.length < 2) {
    return null;
  }

  const normalized = raw.toLowerCase();

  const uniquePaths = paths.filter(
    (p, i) => paths.findIndex((x) => x === p) === i
  );

  if (uniquePaths.length < 2) {
    return null;
  }

  const first = String(uniquePaths[0] ?? "").trim();
  const second = String(uniquePaths[1] ?? "").trim();

  if (!first || !second) {
    return null;
  }

  const firstIdx = normalized.indexOf(first.toLowerCase());
  const secondIdx = normalized.indexOf(second.toLowerCase());

  const between =
    firstIdx >= 0 && secondIdx > firstIdx
      ? normalized.slice(firstIdx + first.length, secondIdx)
      : "";

  const hasIntoLanguage =
    /\binto\b/.test(between) ||
    /\bto\b/.test(between) ||
    /\bin\b/.test(between);

  const hasFromLanguage =
    /\bfrom\b/.test(normalized) ||
    /\bout of\b/.test(normalized);

  if (hasFromLanguage && hasIntoLanguage) {
    return {
      sourcePath: first,
      targetPath: second,
    };
  }

  if (/\bextract\b/.test(normalized) && /\binto\b/.test(normalized)) {
    return {
      sourcePath: first,
      targetPath: second,
    };
  }

  if (/\bmove\b/.test(normalized) && /\binto\b/.test(normalized)) {
    return {
      sourcePath: first,
      targetPath: second,
    };
  }

  return {
    sourcePath: first,
    targetPath: second,
  };
}

export function isGoalPlanningRequest(text: string) {
  return /\b(plan|roadmap|breakdown|steps|step plan|implementation strategy|staged approach|multi-step|phases)\b/i.test(text)
    && !contentStartsWithControlMarker(text);
}

export function contentStartsWithControlMarker(text: string) {
  const t = String(text ?? "").trim();
  return (
    t.startsWith("__APPLY__:") ||
    t.startsWith("__APPLY_SET__:") ||
    t === "__VERIFY_ALL__" ||
    t === "__VERIFY_TEST__" ||
    t === "__VERIFY_LINT__" ||
    t === "__VERIFY_TYPECHECK__" ||
    t === "__RUNNER_PING__" ||
    t === "__ENGRAVE__"
  );
}

