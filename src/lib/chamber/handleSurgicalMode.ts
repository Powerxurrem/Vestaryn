import OpenAI from "openai";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";
import { generateRewrittenFileContent } from "@/lib/chamber/generation";
import { shouldPreVerifyProposalSet } from "@/lib/chamber/verify";
import { extractMentionedPaths, extractSingleMentionedPath } from "@/lib/chamber/intent";
import type { VerifyCommand } from "@/lib/chamber/verifyRuntime";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import { resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { runTool } from "@/lib/vault/toolRuntime";
import { normalizeCommonPathVariants } from "@/lib/chamber/pathNormalization";

type SurgicalDeps = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  model: string;
  baselineVerify: any;
  inferredVerifyCmd: VerifyCommand | null;
  targetPathOverride?: string | null;
  referencePathOverride?: string | null;
};

type CanonicalProposal = {
  fileId: string;
  content: string;
  prevHash: string;
  nextHash: string;
  confirm: string;
  path?: string | null;
  name?: string | null;
  mime?: string | null;
  meta?: any;
};

function isHtmlFragment(content: string) {
  const s = String(content ?? "").trim().toLowerCase();

  return (
    !s.includes("<html") &&
    !s.includes("<head") &&
    !s.includes("<body")
  );
}

function extractHeaderRegion(html: string) {
  const s = String(html ?? "");

  const m = s.match(/<header\b[^>]*>[\s\S]*?<\/header>/i);
  if (!m) return null;

  const header = m[0];

  // Only accept header if it actually contains nav
  if (/<nav\b/i.test(header)) {
    return header;
  }

  return null;
}

function extractNavRegion(html: string) {
  const m = String(html ?? "").match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i);
  return m ? m[0] : null;
}

function replaceHeaderOrNav(args: {
  html: string;
  canonicalHeader: string | null;
  canonicalNav: string | null;
}) {
  const { html, canonicalHeader, canonicalNav } = args;
  const out = String(html ?? "");

  if (!out.trim()) return null;

  const targetHeader = extractHeaderRegion(out);
  const targetNav = extractNavRegion(out);

  if (canonicalHeader && targetHeader) {
    return out.replace(targetHeader, canonicalHeader);
  }

  if (canonicalNav && targetNav) {
    return out.replace(targetNav, canonicalNav);
  }

  if (canonicalNav && targetHeader) {
    const patchedHeader = targetHeader.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i)
      ? targetHeader.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/i, canonicalNav)
      : targetHeader.replace(/(<header\b[^>]*>)/i, `$1\n${canonicalNav}\n`);

    return out.replace(targetHeader, patchedHeader);
  }

  return null;
}

function extractLikelyHtmlTextTargets(currentContent: string) {
  const candidates: string[] = [];

  const patterns = [
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi,
    /<title\b[^>]*>([\s\S]*?)<\/title>/gi,
    /<button\b[^>]*>([\s\S]*?)<\/button>/gi,
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const re of patterns) {
    for (const match of currentContent.matchAll(re)) {
      const text = String(match[1] ?? "")
        .replace(/\s+/g, " ")
        .trim();

      if (text && text.length <= 120) {
        candidates.push(text);
      }
    }
  }

  return Array.from(new Set(candidates));
}

function extractSingleHtmlTagText(currentContent: string, tagName: string) {
  const matches = Array.from(
    currentContent.matchAll(
      new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}>)`, "gi")
    )
  );

  if (matches.length !== 1) return null;

  return {
    open: String(matches[0][1] ?? ""),
    text: String(matches[0][2] ?? "").replace(/\s+/g, " ").trim(),
    close: String(matches[0][3] ?? ""),
  };
}


function tryQuotedReplaceStructuralFallback(
  content: string,
  currentPath: string,
  currentContent: string
) {
  if (!/\.html?$/i.test(currentPath)) return null;
  if (!/\breplace\b/i.test(content) || !/\bwith\b/i.test(content)) return null;

  const quoted = extractQuotedStrings(content);
  if (quoted.length < 2) return null;

  const from = quoted[0];
  const to = quoted[1];

  const singleH1 = extractSingleHtmlTagText(currentContent, "h1");
  if (singleH1 && singleH1.text && singleH1.text !== to) {
    const rewritten = currentContent.replace(
      /(<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/i,
      `$1${to}$3`
    );

    if (rewritten !== currentContent) {
      return {
        kind: "quoted_replace_structural_h1_fallback",
        rewritten,
        details: {
          from,
          to,
          detectedCurrentValue: singleH1.text,
          tag: "h1",
        },
      };
    }
  }

  return null;
}

function pickClosestCandidate(requested: string, candidates: string[]) {
  if (!requested || candidates.length === 0) return null;

  const requestedLower = requested.toLowerCase();

  for (const c of candidates) {
    if (c.toLowerCase() === requestedLower) return c;
  }

  for (const c of candidates) {
    if (
      c.toLowerCase().includes(requestedLower) ||
      requestedLower.includes(c.toLowerCase())
    ) {
      return c;
    }
  }

  return candidates[0] ?? null;
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function replaceSingleOccurrence(haystack: string, from: string, to: string) {
  const idx = haystack.indexOf(from);
  if (idx === -1) return null;

  return haystack.slice(0, idx) + to + haystack.slice(idx + from.length);
}

function extractQuotedStrings(text: string) {
  const matches = Array.from(text.matchAll(/"([^"]+)"|'([^']+)'/g));
  return matches
    .map((m) => m[1] ?? m[2] ?? "")
    .filter(Boolean);
}

function tryQuotedReplaceFastPath(
  content: string,
  currentPath: string,
  currentContent: string
) {
  const lower = content.toLowerCase();

  if (!/\breplace\b/i.test(lower) || !/\bwith\b/i.test(lower)) {
    return null;
  }

  const quoted = extractQuotedStrings(content);
  if (quoted.length < 2) return null;

  const from = quoted[0];
  const to = quoted[1];

  const occurrenceCount = countOccurrences(currentContent, from);

  if (occurrenceCount === 0) {
    const likelyCandidates = /\.html?$/i.test(currentPath)
      ? extractLikelyHtmlTextTargets(currentContent)
      : [];

    const suggestedCurrentValue = pickClosestCandidate(from, likelyCandidates);

    return {
      kind: "quoted_replace_missing_source",
      rewritten: null,
      details: {
        from,
        to,
        occurrenceCount,
        suggestedCurrentValue,
      },
    };
  }

  if (occurrenceCount > 1) {
    return {
      kind: "quoted_replace_ambiguous",
      rewritten: null,
      details: { from, to, occurrenceCount },
    };
  }

  const replaced = replaceSingleOccurrence(currentContent, from, to);
  if (!replaced) return null;

  return {
    kind: "quoted_replace",
    rewritten: replaced,
    details: { from, to, occurrenceCount },
  };
}

function tryHtmlTagTextReplace(
  currentContent: string,
  tagName: string,
  nextText: string
) {
  const re = new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}>)`, "i");
  const matches = Array.from(
    currentContent.matchAll(
      new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}>)`, "gi")
    )
  );

  if (matches.length !== 1) {
    return null;
  }

  return currentContent.replace(re, `$1${nextText}$3`);
}

function tryHtmlIntentFastPath(content: string, currentPath: string, currentContent: string) {
  if (!/\.html?$/i.test(currentPath)) return null;

  const quoted = extractQuotedStrings(content);
  const nextText = quoted[0];
  if (!nextText) return null;

  if (/\bhero title\b/i.test(content) || /\btitle\b/i.test(content)) {
    const replacedH1 = tryHtmlTagTextReplace(currentContent, "h1", nextText);
    if (replacedH1 && replacedH1 !== currentContent) {
      return {
        kind: "html_h1_replace",
        rewritten: replacedH1,
        details: { tag: "h1", nextText },
      };
    }
  }

  if (
    /\bpage title\b/i.test(content) ||
    /\bdocument title\b/i.test(content) ||
    /\b<title>\b/i.test(content)
  ) {
    const replacedTitle = tryHtmlTagTextReplace(currentContent, "title", nextText);
    if (replacedTitle && replacedTitle !== currentContent) {
      return {
        kind: "html_title_replace",
        rewritten: replacedTitle,
        details: { tag: "title", nextText },
      };
    }
  }

  if (/\bbutton\b/i.test(content) || /\bbutton label\b/i.test(content)) {
    const replacedButton = tryHtmlTagTextReplace(currentContent, "button", nextText);
    if (replacedButton && replacedButton !== currentContent) {
      return {
        kind: "html_button_replace",
        rewritten: replacedButton,
        details: { tag: "button", nextText },
      };
    }
  }

  return null;
}

function tryDeterministicFastPath(
  content: string,
  currentPath: string,
  currentContent: string
) {
  const quotedReplace = tryQuotedReplaceFastPath(content, currentPath, currentContent);

  if (quotedReplace?.kind === "quoted_replace") {
    return quotedReplace;
  }

  if (quotedReplace?.kind === "quoted_replace_missing_source") {
    const structuralFallback = tryQuotedReplaceStructuralFallback(
      content,
      currentPath,
      currentContent
    );

    if (structuralFallback) {
      console.log("[surgical fast-path fallback hit]", {
        currentPath,
        kind: structuralFallback.kind,
        details: structuralFallback.details,
      });
      return structuralFallback;
    }

    return quotedReplace;
  }

  if (quotedReplace?.kind === "quoted_replace_ambiguous") {
    return quotedReplace;
  }

  const htmlIntent = tryHtmlIntentFastPath(content, currentPath, currentContent);
  if (htmlIntent) return htmlIntent;

  return null;
}

function escapeRegExp(value: string) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveSurgicalTargetAndReferences(
  content: string,
  hintedPaths?: string[]
) {
  const rawMentionedPaths =
  Array.isArray(hintedPaths) && hintedPaths.length > 0
    ? hintedPaths
    : extractMentionedPaths(content);

  const mentionedPaths = rawMentionedPaths.map(normalizeCommonPathVariants);

  const singlePath =
    mentionedPaths.length === 1
      ? mentionedPaths[0]
      : extractSingleMentionedPath(content);

  if (singlePath) {
    return {
      targetPath: singlePath,
      referencePaths: [] as string[],
      reason: "single_explicit_path",
    };
  }

  const unique = Array.from(
    new Set(
      mentionedPaths
        .map((p) => String(p ?? "").trim())
        .filter(Boolean)
    )
  );

  if (unique.length >= 2) {
    const text = String(content ?? "").toLowerCase();

    const navHeaderMatchIntent =
  unique.length === 2 &&
  unique.every((p) => /\.html?$/i.test(p)) &&
  /\b(nav|navbar|header)\b/.test(text) &&
  (
    /\b(match|align|same|fix|correct|link|update|make)\b/.test(text) ||
    /\blooks like\b/.test(text) ||
    /\blook exactly like\b/.test(text)
  ) &&
  (
    /\b(style|styling|layout|design|look|visual)\b/.test(text) ||
    /\bnav\b/.test(text) ||
    /\bnavbar\b/.test(text) ||
    /\bheader\b/.test(text)
  );

    if (navHeaderMatchIntent) {
      const referencePath =
        unique.find((p) => /(^|\/)index\.html$/i.test(p)) ?? unique[1];

      const targetPath =
        unique.find((p) => p !== referencePath) ?? unique[0];

      return {
        targetPath,
        referencePaths: [referencePath],
        reason: "nav_header_target_plus_reference",
      };
    }

    const sourceTargetStyleIntent =
      /\brewrite\b/.test(text) &&
      (
        /\balign\b/.test(text) ||
        /\bmatch\b/.test(text) ||
        /\bmirror\b/.test(text) ||
        /\bsame\b/.test(text)
      ) &&
      (
        /\bstyle\b/.test(text) ||
        /\bstyling\b/.test(text) ||
        /\blayout\b/.test(text) ||
        /\bdesign\b/.test(text) ||
        /\blook\b/.test(text) ||
        /\bfeel\b/.test(text) ||
        /\bvisual\b/.test(text) ||
        /\bvisually\b/.test(text)
      );

    const explicitSourceTargetPhrase =
      new RegExp(
        `\\b(?:rewrite|update|change|make)\\s+${escapeRegExp(unique[0])}\\b[\\s\\S]*\\b(?:align|match|mirror|look like|looks like|same as)\\b[\\s\\S]*\\b${escapeRegExp(unique[1])}\\b`,
        "i"
      ).test(content);

    if (sourceTargetStyleIntent || explicitSourceTargetPhrase) {
      return {
        targetPath: unique[0],
        referencePaths: [unique[1]],
        reason: "target_plus_reference",
      };
    }
  }

  return {
    targetPath: null,
    referencePaths: [] as string[],
    reason: "no_surgical_target",
  };
}

function detectReferenceIdentityDrift(args: {
  originalContent: string;
  rewrittenContent: string;
  referenceContent: string;
}) {
  const { originalContent, rewrittenContent, referenceContent } = args;

  const originalTitle =
    extractSingleHtmlTagText(originalContent, "title")?.text ?? "";
  const rewrittenTitle =
    extractSingleHtmlTagText(rewrittenContent, "title")?.text ?? "";
  const referenceTitle =
    extractSingleHtmlTagText(referenceContent, "title")?.text ?? "";

  const originalH1 =
    extractSingleHtmlTagText(originalContent, "h1")?.text ?? "";
  const rewrittenH1 =
    extractSingleHtmlTagText(rewrittenContent, "h1")?.text ?? "";
  const referenceH1 =
    extractSingleHtmlTagText(referenceContent, "h1")?.text ?? "";

  const suspiciousTitleCopy =
    !!referenceTitle &&
    !!rewrittenTitle &&
    rewrittenTitle.toLowerCase() === referenceTitle.toLowerCase() &&
    rewrittenTitle.toLowerCase() !== originalTitle.toLowerCase();

  const suspiciousH1Copy =
    !!referenceH1 &&
    !!rewrittenH1 &&
    rewrittenH1.toLowerCase() === referenceH1.toLowerCase() &&
    rewrittenH1.toLowerCase() !== originalH1.toLowerCase();

  return {
    ok: !(suspiciousTitleCopy || suspiciousH1Copy),
    suspiciousTitleCopy,
    suspiciousH1Copy,
    originalTitle,
    rewrittenTitle,
    referenceTitle,
    originalH1,
    rewrittenH1,
    referenceH1,
  };
}

function countInlineStyleBlocks(html: string) {
  return (String(html ?? "").match(/<style\b[^>]*>/gi) ?? []).length;
}

type SurgicalStrategy =
  | "text_replace"
  | "html_targeted"
  | "css_preferred"
  | "full_rewrite";

function resolveSurgicalStrategy(args: {
  content: string;
  currentPath: string;
  referenceFiles: Array<{ path: string; mime: string; content: string }>;
}) : SurgicalStrategy {
  const { content, currentPath, referenceFiles } = args;
  const t = content.toLowerCase();

  const isHtml = /\.html?$/i.test(currentPath);
  const hasReference = referenceFiles.length > 0;

  // 🔹 1. Explicit replace → deterministic
  if (/\breplace\b/i.test(t) && /\bwith\b/i.test(t)) {
    return "text_replace";
  }

  // 🔹 2. Targeted UI element edits
  if (
    /\b(title|hero|h1|button|label|navbar|nav|header|footer)\b/.test(t)
  ) {
    return "html_targeted";
  }

  // 🔹 3. Visual alignment → prefer CSS if possible
  if (
    hasReference &&
    /\b(align|match|same|consistent|style|theme|visual)\b/.test(t)
  ) {
    return isHtml ? "html_targeted" : "css_preferred";
  }

  // 🔹 fallback
  return "full_rewrite";
}

export async function handleSurgicalMode({
  openai,
  supabase,
  repoId,
  userId,
  content,
  model,
  baselineVerify,
  inferredVerifyCmd,
  targetPathOverride = null,
  referencePathOverride = null,
}: SurgicalDeps): Promise<Response | null> {
  const hintedPaths =
  baselineVerify?.executionMode?.mentionedPaths ??
  baselineVerify?.mentionedPaths ??
  [];

const resolved = resolveSurgicalTargetAndReferences(content, hintedPaths);

const targetPath =
  targetPathOverride ??
  resolved.targetPath ??
  null;

const referencePaths = referencePathOverride
  ? [referencePathOverride]
  : resolved.referencePaths;

const reason = targetPathOverride
  ? "runtime_target_override"
  : resolved.reason;

if (!targetPath) {
  console.log("[surgical] skipped: no resolved surgical target", {
    reason,
    mentionedPaths: extractMentionedPaths(content),
    targetPathOverride,
    referencePathOverride,
  });
  return null;
}

  console.log("[surgical] target resolved", {
    repoId,
    targetPath,
    referencePaths,
    reason,
  });

  const fileId = await resolveFileIdByPathOrName(supabase, repoId, targetPath);

  if (!fileId) {
    console.log("[surgical] skipped: target file not found", { targetPath });

    return new Response(
      "[Observation]\nThe requested surgical edit could not start.\n\n" +
        `[Assessment]\nThe target file was not found: ${targetPath}.\n\n` +
        "[Action]\nReference one existing file path and retry the edit request.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const readOut = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_read_text",
    { path: targetPath }
  );

  if (!readOut || typeof readOut !== "object" || "error" in readOut) {
    console.log("[surgical] read failed", {
      targetPath,
      error: (readOut as any)?.error ?? null,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit could not read the target file.\n\n" +
        `[Assessment]\nVestaryn could not load ${targetPath} for a minimal edit.\n\n` +
        "[Action]\nRetry the request or verify that the file exists and is readable.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const currentPath = String((readOut as any).path ?? targetPath);
  const currentMime = String((readOut as any).mime ?? inferTextMimeFromPath(currentPath));
  const currentContent = String((readOut as any).content ?? "");
  const currentFileId = String((readOut as any).id ?? fileId);

  const referenceFiles: Array<{ path: string; mime: string; content: string }> = [];

  for (const refPath of referencePaths) {
    const refRead = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_read_text",
      { path: refPath }
    );

    if (refRead && typeof refRead === "object" && !("error" in refRead)) {
      referenceFiles.push({
        path: String((refRead as any).path ?? refPath),
        mime: String((refRead as any).mime ?? inferTextMimeFromPath(refPath)),
        content: String((refRead as any).content ?? ""),
      });
    }
  }

  if (referencePaths.length > 0) {
    console.log("[surgical] reference context loaded", {
      repoId,
      targetPath: currentPath,
      requestedReferencePaths: referencePaths,
      loadedReferencePaths: referenceFiles.map((f) => f.path),
    });
  }

  let rewritten = "";
  let rewriteSource: "fast_path" | "model_path" = "model_path";

  const strategy = resolveSurgicalStrategy({
    content,
    currentPath,
    referenceFiles,
  });

  console.log("[surgical] strategy", {
    currentPath,
    strategy,
    hasReferenceFiles: referenceFiles.length > 0,
  });

  const navHeaderReferenceFastPath =
    referenceFiles.length > 0 &&
    /\.html?$/i.test(currentPath) &&
    /\b(nav|navbar|header)\b/i.test(content) &&
    /\b(match|align|same|fix|correct|link)\b/i.test(content);

  if (!rewritten && navHeaderReferenceFastPath) {
    const primaryReference = referenceFiles[0];
    const canonicalHeader = extractHeaderRegion(primaryReference.content);
    const canonicalNav = canonicalHeader
      ? null // header already includes nav → don't double-replace
      : extractNavRegion(primaryReference.content);

    const replaced = replaceHeaderOrNav({
      html: currentContent,
      canonicalHeader,
      canonicalNav,
    });

function extractNavLinkSequence(html: string) {
  const nav = extractNavRegion(html);
  if (!nav) return [];

  return Array.from(
    nav.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)
  ).map((m) => ({
    href: String(m[1] ?? "").trim(),
    html: String(m[0] ?? ""),
  }));
}

function reorderNavLinksToMatchReference(args: {
  targetHtml: string;
  referenceHtml: string;
}) {
  const { targetHtml, referenceHtml } = args;

  const targetNav = extractNavRegion(targetHtml);
  const referenceNav = extractNavRegion(referenceHtml);

  if (!targetNav || !referenceNav) return targetHtml;

  const targetLinks = extractNavLinkSequence(targetHtml);
  const referenceLinks = extractNavLinkSequence(referenceHtml);

  if (targetLinks.length === 0 || referenceLinks.length === 0) return targetHtml;

  const targetByHref = new Map(targetLinks.map((x) => [x.href, x.html]));

  const reordered = referenceLinks
    .map((ref) => targetByHref.get(ref.href))
    .filter(Boolean) as string[];

  // keep any extra links not present in reference at the end
  const extras = targetLinks
    .filter((x) => !referenceLinks.some((r) => r.href === x.href))
    .map((x) => x.html);

  const finalLinks = [...reordered, ...extras];

  const rewrittenNav = targetNav.replace(
    /(<nav\b[^>]*>)[\s\S]*?(<\/nav>)/i,
    (_m, open, close) => `${open}\n        ${finalLinks.join("\n        ")}\n      ${close}`
  );

  return targetHtml.replace(targetNav, rewrittenNav);
}

    if (replaced && replaced !== currentContent) {
      const reordered = reorderNavLinksToMatchReference({
        targetHtml: replaced,
        referenceHtml: primaryReference.content,
      });

      rewritten = reordered;
      rewriteSource = "fast_path";

      console.log("[surgical] fragment override length", {
        path: currentPath,
        rewrittenLen: rewritten.length,
      });

      console.log("[surgical nav/header reference fast-path hit]", {
        currentPath,
        referencePath: primaryReference.path,
        usedHeader: !!canonicalHeader,
        usedNav: !!canonicalNav,
      });
    }
  }

  const fastPath =
    strategy === "text_replace" && referenceFiles.length === 0
      ? tryDeterministicFastPath(content, currentPath, currentContent)
      : null;

  if (
    fastPath?.kind === "quoted_replace_missing_source" &&
    fastPath.details &&
    "from" in fastPath.details
  ) {
    const suggested =
      "suggestedCurrentValue" in fastPath.details &&
      fastPath.details.suggestedCurrentValue
        ? String(fastPath.details.suggestedCurrentValue)
        : null;

    return new Response(
      "[Observation]\nThe requested surgical replace did not run.\n\n" +
        `[Assessment]\nThe source text "${fastPath.details.from}" was not found in ${currentPath}, so no exact replacement could be made.` +
        (suggested
          ? ` A likely current visible value is "${suggested}".`
          : "") +
        "\n\n" +
        "[Action]\n" +
        (suggested
          ? `Retry with Replace "${suggested}" with "${fastPath.details.to}" in ${currentPath}.`
          : "Retry with the current text that exists in the file, or request a direct replacement for the visible value."),
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  if (
    fastPath?.kind === "quoted_replace_ambiguous" &&
    fastPath.details &&
    "from" in fastPath.details
  ) {
    return new Response(
      "[Observation]\nThe requested surgical replace did not run.\n\n" +
        `[Assessment]\nThe source text "${String(fastPath.details.from)}" appears multiple times in ${currentPath}, so the replacement was ambiguous.\n\n` +
        "[Action]\nMake the request more specific by naming the target element, section, or exact location.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  if (fastPath?.rewritten) {
    rewritten = fastPath.rewritten;
    rewriteSource = "fast_path";

    console.log("[surgical fast-path hit]", {
      currentPath,
      kind: fastPath.kind,
      details: fastPath.details,
    });
  }

  if (!rewritten && strategy === "html_targeted") {
    const htmlIntent = tryHtmlIntentFastPath(
      content,
      currentPath,
      currentContent
    );

    if (htmlIntent?.rewritten) {
      rewritten = htmlIntent.rewritten;
      rewriteSource = "fast_path";

      console.log("[surgical html-targeted hit]", {
        currentPath,
        kind: htmlIntent.kind,
        details: htmlIntent.details,
      });
    }
  }

  if (!rewritten) {
  console.log("[surgical fast-path miss]", {
    currentPath,
    strategy,
    hasReferenceFiles: referenceFiles.length > 0,
  });

  const referenceBlock =
    referenceFiles.length > 0
      ? [
          "",
          "Reference files (READ-ONLY CONTEXT, DO NOT MODIFY THEM):",
          ...referenceFiles.flatMap((ref) => [
            `--- REFERENCE FILE: ${ref.path} ---`,
            ref.content,
            `--- END REFERENCE FILE: ${ref.path} ---`,
          ]),
        ].join("\n")
      : "";

  const referenceResolvedPath =
    referenceFiles.length > 0 ? referenceFiles[0].path : null;

  const referenceContent =
    referenceFiles.length > 0 ? referenceFiles[0].content : "";

  const surgicalPrompt = [
    "You are performing a STRICT surgical edit.",
    "",
    "Hard rules:",
    "- Modify ONLY the target file.",
    "- Preserve the full file.",
    "- Preserve the target page purpose, subject matter, and content identity unless the user explicitly asked to change them.",
    "- Make the smallest viable change that satisfies the request.",
    "- Do NOT redesign the whole file unless the request explicitly requires it.",
    "- Do NOT invent new local pages, assets, footer links, nav items, scripts, or sections.",
    "- Do NOT remove unrelated lines.",
    "- Do NOT introduce placeholder text.",
    "- Return the FULL updated file content only.",
    "- If you cannot perform the change precisely, return the original file content unchanged.",
    "",
    `Target file: ${currentPath}`,
    referenceResolvedPath
      ? `Reference file for visual/style alignment only: ${referenceResolvedPath}`
      : "Reference file for visual/style alignment only: none",
    "",
    referenceContent
      ? [
          "Reference rules:",
          "- Use the reference file only for visual alignment, layout rhythm, spacing, and styling cues.",
          "- Do NOT copy the reference page's topic, brand, nav links, footer links, or content purpose into the target page.",
          "- Keep the target file's own subject matter intact.",
          "",
          "Reference file content:",
          referenceContent,
          "",
        ].join("\n")
      : "",
    referenceBlock,
    `User request: ${content}`,
  ].join("\n");

  const isFragment = isHtmlFragment(currentContent);

  if (isFragment && referenceFiles.length > 0) {
    const primaryReference =
      referenceFiles.find((f) => /(^|\/)index\.html$/i.test(f.path)) ??
      referenceFiles[0] ??
      null;

    const canonicalHtml = String(primaryReference?.content ?? "");

    const canonicalHeader = extractHeaderRegion(canonicalHtml);
    const canonicalNav = canonicalHeader ? null : extractNavRegion(canonicalHtml);

    const canonicalMarkup = canonicalHeader || canonicalNav;

    if (!canonicalMarkup) {
      throw new Error("No nav/header found in canonical reference");
    }

    rewritten = canonicalMarkup.trim();
    rewriteSource = "fast_path";

    console.log("[surgical] fragment override applied", {
      path: currentPath,
      usedReference: primaryReference?.path ?? null,
      rewrittenLen: rewritten.length,
    });
  } else {
    rewritten = await generateRewrittenFileContent({
      openai,
      model,
      userRequest: surgicalPrompt,
      path: currentPath,
      mime: currentMime,
      currentContent,
    });
  }
}

  if (typeof rewritten !== "string" || rewritten.trim().length === 0) {
    console.log("[surgical] generation failed: empty rewrite", {
      currentPath,
      rewriteSource,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit did not produce updated file content.\n\n" +
        `[Assessment]\nVestaryn attempted a minimal rewrite for ${currentPath} but the generated result was empty.\n\n` +
        "[Action]\nRetry the request with the same target file and exact local change.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const normalizedOriginal = currentContent.replace(/\r\n/g, "\n").trim();
  const normalizedRewritten = rewritten.replace(/\r\n/g, "\n").trim();

  if (normalizedRewritten === normalizedOriginal) {
    console.log("[surgical] no-op detected", {
      currentPath,
      rewriteSource,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit is already satisfied.\n\n" +
        `[Assessment]\nNo staged change was needed because ${currentPath} already matches the requested update.\n\n` +
        "[Action]\nContinue with the next edit or request another precise change.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  if (currentContent.length > 0 && rewritten.length < currentContent.length * 0.7) {
    console.log("[surgical] rewrite rejected: suspicious truncation", {
      currentPath,
      rewriteSource,
      originalLen: currentContent.length,
      rewrittenLen: rewritten.length,
    });

  if (referenceFiles.length > 0 && /\.html?$/i.test(currentPath)) {
    const primaryReference = referenceFiles[0];

    const driftCheck = detectReferenceIdentityDrift({
      originalContent: currentContent,
      rewrittenContent: rewritten,
      referenceContent: primaryReference.content,
    });

    if (!driftCheck.ok) {
      console.log("[surgical] rewrite rejected: reference identity drift", {
        currentPath,
        referencePath: primaryReference.path,
        suspiciousTitleCopy: driftCheck.suspiciousTitleCopy,
        suspiciousH1Copy: driftCheck.suspiciousH1Copy,
        originalTitle: driftCheck.originalTitle,
        rewrittenTitle: driftCheck.rewrittenTitle,
        referenceTitle: driftCheck.referenceTitle,
        originalH1: driftCheck.originalH1,
        rewrittenH1: driftCheck.rewrittenH1,
        referenceH1: driftCheck.referenceH1,
      });

      return new Response(
        "[Observation]\nThe requested surgical edit was blocked before staging.\n\n" +
          `[Assessment]\nThe generated rewrite for ${currentPath} copied identity-level content from the reference page instead of only aligning style/layout.\n\n` +
          "[Action]\nRetry with a stricter visual-only alignment request.",
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        }
      );
    }

    const originalInlineStyleCount = countInlineStyleBlocks(currentContent);
    const rewrittenInlineStyleCount = countInlineStyleBlocks(rewritten);

    if (originalInlineStyleCount === 0 && rewrittenInlineStyleCount > 0) {
      console.log("[surgical] rewrite rejected: introduced inline style block", {
        currentPath,
        referencePath: primaryReference.path,
        originalInlineStyleCount,
        rewrittenInlineStyleCount,
      });

      return new Response(
        "[Observation]\nThe requested surgical edit was blocked before staging.\n\n" +
          `[Assessment]\nThe generated rewrite for ${currentPath} introduced new inline CSS instead of staying aligned with the existing shared stylesheet structure.\n\n` +
          "[Action]\nRetry with a smaller visual-only change or update shared CSS directly.",
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        }
      );
    }
  }

    return new Response(
      "[Observation]\nThe requested surgical edit was blocked before staging.\n\n" +
        `[Assessment]\nThe generated result for ${currentPath} looked truncated relative to the current file, so Vestaryn rejected it instead of risking a broken rewrite.\n\n` +
        "[Action]\nRetry with a more specific local edit request.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const lengthDeltaRatio =
    currentContent.length > 0
      ? Math.abs(rewritten.length - currentContent.length) / currentContent.length
      : 0;

  if (lengthDeltaRatio > 0.3) {
    console.log("[surgical] large change detected", {
      currentPath,
      rewriteSource,
      originalLen: currentContent.length,
      rewrittenLen: rewritten.length,
      lengthDeltaRatio,
    });
  }

  const proposal = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_propose_write",
    {
      fileId: currentFileId,
      path: currentPath,
      content: rewritten,
    }
  );

  if (!proposal || typeof proposal !== "object" || "error" in proposal) {
    console.log("[surgical] propose failed", {
      currentPath,
      rewriteSource,
      proposal,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit could not be staged.\n\n" +
        `[Assessment]\nVestaryn generated updated content for ${currentPath} but proposal staging failed.\n\n` +
        "[Action]\nRetry the request or inspect vault proposal handling.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  if ((proposal as any).noop === true) {
    return new Response(
      "[Observation]\nThe requested surgical edit is already satisfied.\n\n" +
        `[Assessment]\nNo staged change was needed because ${currentPath} already matches the requested update.\n\n` +
        "[Action]\nContinue with the next edit or request another precise change.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  console.log("[surgical] proposal success", {
    repoId,
    targetPath: currentPath,
    proposedFileId: (proposal as any)?.fileId ?? null,
    rewriteSource,
  });

  const canonicalProposal: CanonicalProposal = {
    fileId: String((proposal as any).fileId),
    content: String((proposal as any).content ?? rewritten),
    prevHash: String((proposal as any).prevHash ?? ""),
    nextHash: String((proposal as any).nextHash ?? ""),
    confirm: String((proposal as any).confirm ?? ""),
    path: (proposal as any).path ?? currentPath,
    name: (proposal as any).name ?? null,
    mime: (proposal as any).mime ?? currentMime,
    meta: (proposal as any).meta ?? null,
  };

  let finalProposal = canonicalProposal;
  let preverifyPayload: any = null;
  const proposals: CanonicalProposal[] = [canonicalProposal];

  if (shouldPreVerifyProposalSet(proposals)) {
    try {
      const result = await finalizeProposalSet({
        openai,
        model,
        repoId,
        userRequest: content,
        baselineVerifyPayload: baselineVerify.verifyPayload,
        verifyCmd: inferredVerifyCmd,
        proposals,
      });

      preverifyPayload = result.preverifyPayload;

      if (
        result.repaired &&
        Array.isArray(result.finalProposals) &&
        result.finalProposals.length === 1
      ) {
        finalProposal = {
          fileId: String(result.finalProposals[0].fileId),
          content: String(result.finalProposals[0].content),
          prevHash: String((result.finalProposals[0] as any).prevHash ?? canonicalProposal.prevHash),
          nextHash: String((result.finalProposals[0] as any).nextHash ?? canonicalProposal.nextHash),
          confirm: String((result.finalProposals[0] as any).confirm ?? canonicalProposal.confirm),
          path: result.finalProposals[0].path ?? currentPath,
          name: (result.finalProposals[0] as any).name ?? canonicalProposal.name ?? null,
          mime: result.finalProposals[0].mime ?? currentMime,
          meta: result.finalProposals[0].meta ?? null,
        };
      }
    } catch (e: any) {
      console.log("[surgical] preverify failed", {
        message: e?.message,
        currentPath,
      });

      preverifyPayload = {
        ok: false,
        error: e?.message ?? "Pre-verify failed",
        failedStep: "preverify_boot",
        failureKind: "internal_error",
        baseline: false,
        paths: [currentPath],
      };
    }
  }

  const body =
    "[Observation]\nRequired repository changes were staged.\n\n" +
    `[Assessment]\nA surgical edit was prepared for one file using ${
      rewriteSource === "fast_path"
        ? "a deterministic fast path"
        : "the surgical rewrite path"
    }.\n\n` +
    "[Action]\nA staged change is ready. Confirm to apply." +
    `\n\n__PROPOSAL__:${JSON.stringify(finalProposal)}\n` +
    (preverifyPayload
      ? `__PREVERIFY__:${JSON.stringify(preverifyPayload)}\n`
      : "");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}