import {
  extractMentionedPaths,
  extractSingleMentionedPath,
  isCreateAndModifyIntent,
} from "@/lib/chamber/intent";

export function isSourceTargetTransferIntent(text: string): boolean {
  const t = String(text ?? "").toLowerCase();

  const hasTransferVerb =
    /\b(move|extract|transfer|pull|relocate)\b/.test(t);

  const hasFromTo =
    /\bfrom\b/.test(t) && /\b(to|into)\b/.test(t);

  const paths = extractMentionedPaths(text);

  return hasTransferVerb && hasFromTo && paths.length >= 2;
}

export function resolveSourceAndTargetPaths(text: string) {
  const rawPaths = extractMentionedPaths(text || "");
  if (rawPaths.length < 2) return null;

  const paths = Array.from(
    new Set(rawPaths.map((p) => String(p).trim()).filter(Boolean))
  );

  const fullPaths = paths.filter((p) => p.includes("/"));

  let targetPath: string | null = null;
  let sourcePath: string | null = null;

  const rewriteMatch = text.match(
    /rewrite\s+([A-Za-z0-9_./\-[\]]+\.[A-Za-z0-9]+)/i
  );
  if (rewriteMatch?.[1]) {
    targetPath = rewriteMatch[1].trim();
  }

  const fromMatch = text.match(
    /from\s+([A-Za-z0-9_./\-[\]]+\.[A-Za-z0-9]+)/i
  );
  if (fromMatch?.[1]) {
    sourcePath = fromMatch[1].trim();
  }

  if (!sourcePath) {
    sourcePath =
      fullPaths.find((p) => /app\/api\/repo\/.*\/chat\/route\.ts$/i.test(p)) ||
      fullPaths[0] ||
      paths[0];
  }

  if (!targetPath) {
    const intoMatch = text.match(
      /into\s+([A-Za-z0-9_./\-[\]]+\.[A-Za-z0-9]+)/i
    );
    if (intoMatch?.[1]) {
      targetPath = intoMatch[1].trim();
    }
  }

  if (!targetPath) {
    targetPath =
      fullPaths.find((p) => p !== sourcePath) ||
      paths.find((p) => p !== sourcePath) ||
      null;
  }

  if (!sourcePath || !targetPath) return null;
  if (sourcePath === targetPath) return null;

  return { sourcePath, targetPath, paths };
}

export function isImportRefactorIntent(text: string) {
  if (isCreateAndModifyIntent(text)) {
    return false;
  }

  const lower = String(text || "").toLowerCase();

  const hasImportVerb =
    /\bimport\b|\bupdate\b|\bremove\b|\breplace\b/.test(lower);

  const mentionsPaths = extractMentionedPaths(text || "").length >= 2;

  const mentionsHelpers =
    /\bhelper\b|\bhelpers\b|\binlined implementations\b/.test(lower);

  return hasImportVerb && mentionsPaths && mentionsHelpers;
}

export function isExtractHelpersIntent(text: string) {
  if (isCreateAndModifyIntent(text)) {
    return false;
  }

  const lower = String(text || "").toLowerCase();

  const hasExtractionVerb =
    /\bextract\b|\bmove\b|\bcopy\b|\bseparate\b|\bsplit\b/.test(lower);

  const mentionsHelpers =
    /\bhelper\b|\bhelpers\b|\bfunctions\b/.test(lower);

  const mentionsTransferStructure =
    /\bfrom\b|\binto\b/.test(lower);

  const hit =
    extractMentionedPaths(text || "").length >= 2 &&
    hasExtractionVerb &&
    mentionsHelpers &&
    mentionsTransferStructure;

  console.log("[intent] extractHelpers", {
    hit,
    hasExtractionVerb,
    mentionsHelpers,
    mentionsTransferStructure,
    paths: extractMentionedPaths(text || ""),
    text,
  });

  return hit;
}

export function isExtractHelpersToModuleIntent(text: string) {
  if (isCreateAndModifyIntent(text)) {
    return false;
  }

  const lower = String(text || "").toLowerCase();
  const paths = extractMentionedPaths(text || "");

  const hasExtractionVerb =
    /\bextract\b|\bmove\b|\brefactor\b|\bsplit\b/.test(lower);

  const mentionsHelpers =
    /\bhelper\b|\bhelpers\b|\bintent-detection\b|\bpure helper\b/.test(lower);

  const mentionsTargetModule =
    /\bnew module\b|\binto\b|\bat\b/.test(lower);

  return (
    paths.length >= 2 &&
    hasExtractionVerb &&
    mentionsHelpers &&
    mentionsTargetModule
  );
}

export function isSplitFileIntent(text: string) {
  const lower = String(text || "").toLowerCase();
  const pathCount = extractMentionedPaths(text || "").length;

  const hasSplitVerb =
    /\bsplit\b|\bseparate\b|\bbreak up\b|\bdivide\b/.test(lower);

  return hasSplitVerb && pathCount >= 1;
}

export function extractSplitTargets(text: string) {
  const src = String(text || "").replace(/\r/g, " ");

  const bulletMatches = Array.from(
    src.matchAll(/(?:^|\s)[-*]\s+([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g)
  ).map((m) => String(m[1]).trim());

  const inlineIntoMatch = src.match(
    /into\s+([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?:\s*,\s*|\s+and\s+)([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/i
  );

  const inlineTargets = inlineIntoMatch
    ? [inlineIntoMatch[1], inlineIntoMatch[2]]
    : [];

  return Array.from(
    new Set([...bulletMatches, ...inlineTargets].filter(Boolean))
  );
}

export function deriveDefaultSplitTargets(
  sourcePath: string,
  count = 2
): string[] {
  const safeCount = Math.max(2, Math.min(8, Math.floor(count)));

  const sourceDir =
    sourcePath.includes("/")
      ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
      : "";

  const baseName =
    sourcePath
      .split("/")
      .pop()
      ?.replace(/\.(tsx|ts|js|jsx)$/, "") ?? "file";

  const ext = sourcePath.includes(".")
    ? sourcePath.slice(sourcePath.lastIndexOf("."))
    : ".ts";

  return Array.from({ length: safeCount }, (_, i) => {
    const name = `${baseName}-part${i + 1}${ext}`;
    return sourceDir ? `${sourceDir}/${name}` : name;
  });
}

export function extractRequestedSplitCount(text: string): number | null {
  const s = text.toLowerCase();

  if (/\b(split|separate|break up|break)\b.*\binto\s+2\b/.test(s)) return 2;
  if (/\b(split|separate|break up|break)\b.*\binto\s+two\b/.test(s)) return 2;
  if (/\b(split|separate|break up|break)\b.*\binto\s+3\b/.test(s)) return 3;
  if (/\b(split|separate|break up|break)\b.*\binto\s+three\b/.test(s)) return 3;
  if (/\b(split|separate|break up|break)\b.*\binto\s+4\b/.test(s)) return 4;
  if (/\b(split|separate|break up|break)\b.*\binto\s+four\b/.test(s)) return 4;

  if (/\b2\s+(files|parts|modules|components)\b/.test(s)) return 2;
  if (/\btwo\s+(files|parts|modules|components)\b/.test(s)) return 2;
  if (/\b3\s+(files|parts|modules|components)\b/.test(s)) return 3;
  if (/\bthree\s+(files|parts|modules|components)\b/.test(s)) return 3;
  if (/\b4\s+(files|parts|modules|components)\b/.test(s)) return 4;
  if (/\bfour\s+(files|parts|modules|components)\b/.test(s)) return 4;

  return null;
}

export function isSplitReadAllowed(
  requestedPath: string | null,
  readPath: string | null
) {
  if (!requestedPath || !readPath) return false;

  const a = requestedPath.trim();
  const b = readPath.trim();

  return a === b;
}