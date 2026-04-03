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
import { applyStyleRecipeFastPath } from "@/lib/chamber/style/styleFastPath";
import { applyLayoutRecipeFastPath } from "@/lib/chamber/layout/layoutFastPath";

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

function isStructuralHtmlRequest(text: string) {
  const t = String(text ?? "").toLowerCase();

  const hasStructureVerb =
    /\b(add|create|insert|generate|duplicate|remove|delete|move|reorder)\b/.test(t);

const genericAddWithPlacement =
  /\b(add|insert|place)\b/.test(t) &&
  /\b(below|above|under|before|after)\b/.test(t);

  const hasStructureTarget =
    /\b(block|blocks|section|sections|card|cards|container|div|row|rows|column|columns|grid|layout|gallery|hero|footer|header|navbar|menu|list|items|image|images)\b/.test(t);

  const hasPlacement =
    /\b(below|above|under|next to|before|after|per row|in a row)\b/.test(t);

  return (
    (hasStructureVerb && hasStructureTarget) ||
    (hasStructureTarget && hasPlacement) ||
    genericAddWithPlacement
  );
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

function extractSectionBlocks(html: string) {
  const source = String(html ?? "");
  const matches = Array.from(
    source.matchAll(/<section\b[^>]*class=["'][^"']*\bsection\b[^"']*\bcard\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi)
  );

  return matches.map((m) => {
    const full = String(m[0] ?? "");
    const headingMatch = full.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);

    return {
      full,
      heading: headingMatch
        ? String(headingMatch[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
        : "",
    };
  });
}

function normalizeHeadingText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRequestedSectionNamesFromPrompt(content: string) {
  const raw = String(content ?? "");
  const names = extractQuotedStrings(raw).map((s) => s.trim()).filter(Boolean);

  const lower = raw.toLowerCase();

  // Specific known headings from your current site flows
  if (/\babout vestaryn\b/i.test(lower)) names.push("About Vestaryn");
  if (/\bcore features\b/i.test(lower)) names.push("Core Features");
  if (/\bcontact\b.*\baccess\b/i.test(lower)) names.push("Contact & Access");

  return Array.from(new Set(names.map((s) => normalizeHeadingText(s))));
}

function cleanupEmptySectionGridWrappers(html: string) {
  let out = String(html ?? "");

  // Remove section-grid wrappers that no longer contain any card sections
  out = out.replace(
    /<section\b[^>]*class=["'][^"']*\bsection-grid\b[^"']*["'][^>]*>\s*<\/section>/gi,
    ""
  );

  // Collapse excessive blank lines
  out = out.replace(/\n{3,}/g, "\n\n");

  return out;
}

function tryRemoveNamedHtmlSectionsFastPath(
  content: string,
  currentPath: string,
  currentContent: string
) {
  if (!/\.html?$/i.test(currentPath)) return null;

  const lower = String(content ?? "").toLowerCase();

    const isDeleteIntent =
    /\b(delete|remove|removed|strip|drop)\b/.test(lower) &&
    /\b(section|sections|block|blocks|card|cards)\b/.test(lower);

  const isCompleteRemovalIntent =
    /\b(delete them completely|remove them completely|delete completely|remove completely|not completely removed|different block was touched)\b/.test(lower);

  const isRetryCorrectionIntent =
    /\b(retry|try again)\b/.test(lower) &&
    /\b(block|blocks|section|sections|removed|touched)\b/.test(lower);

  if (!isDeleteIntent && !isCompleteRemovalIntent && !isRetryCorrectionIntent) {
    return null;
  }

  const blocks = extractSectionBlocks(currentContent);
  if (blocks.length === 0) return null;

  const requestedNames = extractRequestedSectionNamesFromPrompt(content);

  let blocksToRemove = new Set<string>();

  // Case A: explicit named block deletion
  if (requestedNames.length > 0) {
    for (const block of blocks) {
      const normalizedHeading = normalizeHeadingText(block.heading);
      if (requestedNames.includes(normalizedHeading)) {
        blocksToRemove.add(block.full);
      }
    }
  }

  // Case B: broad removal / retry-correction when multiple blocks are present
  if (
    blocksToRemove.size === 0 &&
    (isCompleteRemovalIntent || isRetryCorrectionIntent)
  ) {
    for (const block of blocks) {
      if (block.heading) {
        blocksToRemove.add(block.full);
      }
    }
  }

  if (blocksToRemove.size === 0) {
    return null;
  }

  let rewritten = String(currentContent ?? "");

  for (const full of blocksToRemove) {
    rewritten = rewritten.replace(full, "");
  }

  rewritten = cleanupEmptySectionGridWrappers(rewritten);

  if (rewritten === currentContent) {
    return null;
  }

  return {
    kind: "html_remove_named_sections",
    rewritten,
    details: {
      removedCount: blocksToRemove.size,
      removedHeadings: blocks
        .filter((b) => blocksToRemove.has(b.full))
        .map((b) => b.heading)
        .filter(Boolean),
    },
  };
}

function extractClassList(fragment: string, regex: RegExp) {
  const match = String(fragment ?? "").match(regex);
  const raw = String(match?.[1] ?? "").trim();
  if (!raw) return [];
  return raw.split(/\s+/).filter(Boolean);
}

function mergeClassTokens(existing: string[], next: string[]) {
  return Array.from(new Set([...existing, ...next]));
}

function removeClassTokens(existing: string[], toRemove: string[]) {
  const blocked = new Set(toRemove);
  return existing.filter((c) => !blocked.has(c));
}

function trySimplifySingleContentCardFastPath(
  content: string,
  currentPath: string,
  currentContent: string
) {
  if (!/\.html?$/i.test(currentPath)) return null;

  const lower = String(content ?? "").toLowerCase();

const wantsSpacing =
  /\b(add|more|increase)\b.*\bspacing\b/i.test(lower) ||
  /\bspacing\b.*\babove\b/i.test(lower) ||
  /\byou removed the spacing\b/i.test(lower);

const wantsAbovePlacement =
  /\babove\b/i.test(lower) && /\bblock\b/i.test(lower);

const wantsSquare =
  /\b(square|more a square|make (it|that) square|square shape)\b/i.test(lower);

const wantsTaller =
  /\b(more height|increase the height|give (it|that|the block) more height|taller|slightly higher|higher)\b/i.test(lower);

const wantsSmaller =
  /\b(smaller|less wide|narrower|more compact)\b/i.test(lower);

const wantsEmptyContent =
  !wantsTaller &&
  !wantsSmaller &&
  !wantsSquare &&
  /\b(empty|without any information|no information|no text|blank)\b/i.test(lower);

  if (
    !wantsSpacing &&
    !wantsSmaller &&
    !wantsTaller &&
    !wantsEmptyContent &&
    !wantsAbovePlacement
  ) {
    return null;
  }

  const sectionMatch = currentContent.match(
    /<section\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>[\s\S]*?<\/section>/i
  );

  if (!sectionMatch) return null;

  const currentSection = String(sectionMatch[0] ?? "");
  const existingSectionClasses = extractClassList(
  currentSection,
  /<section\b[^>]*class=["']([^"']*)["'][^>]*>/i
);

const existingCardClasses = extractClassList(
  currentSection,
  /<div\b[^>]*class=["']([^"']*\bcontent-card\b[^"']*)["'][^>]*>/i
);

  let sectionClasses = mergeClassTokens(existingSectionClasses, ["content"]);
let cardClasses = mergeClassTokens(existingCardClasses, ["content-card"]);

if (wantsSpacing || wantsAbovePlacement) {
  sectionClasses = mergeClassTokens(sectionClasses, ["content--spaced"]);
}

if (wantsSmaller) {
  cardClasses = mergeClassTokens(cardClasses, ["content-card--compact"]);
}

if (wantsTaller) {
  cardClasses = mergeClassTokens(cardClasses, ["content-card--tall"]);
}

if (wantsSquare) {
  cardClasses = mergeClassTokens(cardClasses, [
    "content-card--compact",
    "content-card--square",
  ]);
}

if (/\bsquare\b/.test(lower)) {
  cardClasses = mergeClassTokens(cardClasses, ["content-card--square"]);
}

  const innerHtml = wantsEmptyContent
    ? `          <div class="content-card-inner"></div>`
    : `          <div class="content-card-inner"></div>`;

  const rebuiltSection =
    `    <section class="${sectionClasses.join(" ")}" id="content">\n` +
    `      <div class="container">\n` +
    `        <div class="${cardClasses.join(" ")}">\n` +
    `${innerHtml}\n` +
    `        </div>\n` +
    `      </div>\n` +
    `    </section>`;

  let rewritten = currentContent.replace(currentSection, rebuiltSection);

  if (wantsAbovePlacement) {
    const heroMatch = rewritten.match(
      /<section\b[^>]*class=["'][^"']*\bhero\b[^"']*["'][^>]*>[\s\S]*?<\/section>/i
    );

    if (heroMatch) {
      const heroSection = String(heroMatch[0] ?? "");
      const contentSectionMatch = rebuiltSection;

      // Remove the rebuilt section from its original location first
      rewritten = rewritten.replace(rebuiltSection, "");

      // Reinsert directly after hero with an empty line between for cleaner structure
      rewritten = rewritten.replace(
        heroSection,
        `${heroSection}\n\n${contentSectionMatch}`
      );
    }
  }

  if (rewritten === currentContent) {
    return null;
  }

  return {
    kind: "html_simplify_single_content_card",
    rewritten,
    details: {
      wantsSpacing,
      wantsSmaller,
      wantsTaller,
      wantsEmptyContent,
      wantsAbovePlacement,
    },
  };
}

function insertAfterMatch(html: string, match: RegExp, insertion: string) {
  const m = html.match(match);
  if (!m || !m[0]) return null;
  return html.replace(m[0], `${m[0]}\n\n${insertion}`);
}

function insertBeforeMatch(html: string, match: RegExp, insertion: string) {
  const m = html.match(match);
  if (!m || !m[0]) return null;
  return html.replace(m[0], `${insertion}\n\n${m[0]}`);
}

function tryStructuralInsertFastPath(
  content: string,
  currentPath: string,
  currentContent: string
) {
  if (!/\.html?$/i.test(currentPath)) return null;

  const lower = String(content ?? "").toLowerCase();

  const gallerySection = [
    `    <section class="container section" id="gallery">`,
    `      <div class="section card content-card--neon-glow">`,
    `        <h2>Gallery</h2>`,
    `        <p>A visual collection inspired by the site’s aesthetic and energy.</p>`,
    `      </div>`,
    `    </section>`,
  ].join("\n");

  const introSection = [
    `    <section class="container section" id="intro">`,
    `      <div class="section card content-card--neon-glow">`,
    `        <h2>Welcome</h2>`,
    `        <p>A new section placed directly below the hero.</p>`,
    `      </div>`,
    `    </section>`,
  ].join("\n");

  const imagesSection = [
    `  <div class="container section" aria-label="Images above footer">`,
    `    <div class="section card content-card--neon-glow">`,
    `      <h2>Images</h2>`,
    `      <p>Visual highlights placed above the footer.</p>`,
    `    </div>`,
    `  </div>`,
  ].join("\n");

  if (/\bgallery\b/.test(lower) && /\bbelow\b/.test(lower)) {
    const rewritten = insertAfterMatch(
      currentContent,
      /<section\b[^>]*class=["'][^"']*\bhero\b[^"']*["'][^>]*>[\s\S]*?<\/section>/i,
      gallerySection
    );
    if (rewritten && rewritten !== currentContent) {
      return {
        kind: "html_insert_gallery_below",
        rewritten,
        details: { placement: "below_hero" },
      };
    }
  }

  if (
    /\b(add|insert|place)\b/.test(lower) &&
    /\b(something|section|content)\b/.test(lower) &&
    /\bbelow\b/.test(lower) &&
    /\bhero\b/.test(lower)
  ) {
    const rewritten = insertAfterMatch(
      currentContent,
      /<section\b[^>]*class=["'][^"']*\bhero\b[^"']*["'][^>]*>[\s\S]*?<\/section>/i,
      introSection
    );
    if (rewritten && rewritten !== currentContent) {
      return {
        kind: "html_insert_section_below_hero",
        rewritten,
        details: { placement: "below_hero" },
      };
    }
  }

  if (
    /\b(insert|add)\b/.test(lower) &&
    /\b(image|images|pictures)\b/.test(lower) &&
    /\babove\b/.test(lower) &&
    /\bfooter\b/.test(lower)
  ) {
    const rewritten = insertBeforeMatch(
      currentContent,
      /<footer\b[^>]*>[\s\S]*?<\/footer>/i,
      imagesSection
    );
    if (rewritten && rewritten !== currentContent) {
      return {
        kind: "html_insert_images_above_footer",
        rewritten,
        details: { placement: "above_footer" },
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

  const removeNamedSections = tryRemoveNamedHtmlSectionsFastPath(
    content,
    currentPath,
    currentContent
  );
  if (removeNamedSections) {
    return removeNamedSections;
  }

  const simplifySingleContentCard = trySimplifySingleContentCardFastPath(
    content,
    currentPath,
    currentContent
  );
  if (simplifySingleContentCard) {
    return simplifySingleContentCard;
  }

  const structuralInsert = tryStructuralInsertFastPath(
    content,
    currentPath,
    currentContent
  );
  if (structuralInsert) {
    return structuralInsert;
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

function rejectUnexpectedInlineStyleBlock(args: {
  currentPath: string;
  currentContent: string;
  rewritten: string;
}) {
  const { currentPath, currentContent, rewritten } = args;

  if (!/\.html?$/i.test(currentPath)) return null;

  const originalInlineStyleCount = countInlineStyleBlocks(currentContent);
  const rewrittenInlineStyleCount = countInlineStyleBlocks(rewritten);

  if (originalInlineStyleCount === 0 && rewrittenInlineStyleCount > 0) {
    return new Response(
      "[Observation]\nThe requested surgical edit was blocked before staging.\n\n" +
        `[Assessment]\nThe generated rewrite for ${currentPath} introduced new inline CSS instead of keeping styling in shared CSS.\n\n` +
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

  return null;
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

function isCreateTargetRequest(content: string, targetPath: string | null) {
  const text = String(content ?? "");
  const normalizedTarget = String(targetPath ?? "").trim().toLowerCase();

  const asksToCreate =
    /\b(create|make|add|generate)\b/i.test(text) &&
    /\b(file|page|section)\b/i.test(text);

  const asksForNewFile =
    /\b(new file|create the new file|make a new file)\b/i.test(text);

  const mentionsAboutPage =
    /\babout page\b/i.test(text) ||
    /\babout\.html\b/i.test(text) ||
    normalizedTarget === "about.html";

  return asksToCreate || asksForNewFile || mentionsAboutPage;
}

function isImagePopulationRequest(text: string) {
  const t = String(text ?? "").toLowerCase();
  return (
    /\b(add|insert|place)\b/.test(t) &&
    /\b(image|images|picture|pictures|photo|photos)\b/.test(t)
  );
}

function isNonWebPlanningContext(text: string) {
  const t = String(text ?? "").toLowerCase();
  return /\b(excel|workbook|worksheet|spreadsheet|dashboard|formula|formulas|python|openpyxl|pandas|script|vba|macro|\.py|\.bas)\b/i.test(t);
}

function hasImageSourceSpecified(text: string) {
  const t = String(text ?? "").toLowerCase();
  return /\b(remote|url|urls|placeholder|local|unsplash)\b/.test(t);
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
    const explicitMentionedPaths = extractMentionedPaths(content)
    .map(normalizeCommonPathVariants)
    .filter(Boolean);

  const baselineHintedPaths = Array.isArray(baselineVerify?.executionMode?.mentionedPaths)
    ? baselineVerify.executionMode.mentionedPaths
    : Array.isArray(baselineVerify?.mentionedPaths)
      ? baselineVerify.mentionedPaths
      : [];

  const hintedPaths = Array.from(
    new Set(
      [
        targetPathOverride,
        referencePathOverride,
        ...explicitMentionedPaths,
        ...baselineHintedPaths,
      ]
        .map((p) => normalizeCommonPathVariants(String(p ?? "").trim()))
        .filter(Boolean)
    )
  );

  const resolved = resolveSurgicalTargetAndReferences(content, hintedPaths);

  const normalizedTargetOverride = targetPathOverride
    ? normalizeCommonPathVariants(String(targetPathOverride).trim())
    : null;

  const normalizedReferenceOverride = referencePathOverride
    ? normalizeCommonPathVariants(String(referencePathOverride).trim())
    : null;

  let targetPath =
  normalizedTargetOverride ??
  resolved.targetPath ??
  hintedPaths[0] ??
  null;

// 🔥 STRUCTURAL OVERRIDE
if (
  isStructuralHtmlRequest(content) &&
  !isNonWebPlanningContext(content) &&
  !/\b(glow|neon|color|colors|palette|theme|style|styling|background|text shadow|shadow|border)\b/i.test(content)
) {
  const htmlCandidate =
    hintedPaths.find((p) => /\.html?$/i.test(p)) ||
    "index.html";

  console.log("[surgical structural override]", {
    from: targetPath,
    to: htmlCandidate,
  });

  targetPath = htmlCandidate;
}

  const referencePaths = Array.from(
    new Set(
      (
        normalizedReferenceOverride
          ? [normalizedReferenceOverride]
          : resolved.referencePaths.length > 0
            ? resolved.referencePaths
            : hintedPaths.filter((p) => p !== targetPath).slice(0, 1)
      )
        .map((p) => normalizeCommonPathVariants(String(p ?? "").trim()))
        .filter(Boolean)
        .filter((p) => p !== targetPath)
    )
  );

  const reason =
    normalizedTargetOverride
      ? "runtime_target_override"
      : resolved.reason !== "no_surgical_target"
        ? resolved.reason
        : hintedPaths.length > 0
          ? "hinted_path_fallback"
          : "no_surgical_target";

  if (!targetPath) {
    console.log("[surgical] skipped: no resolved surgical target", {
      reason,
      explicitMentionedPaths,
      hintedPaths,
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

  if (referencePaths.length === 0 && hintedPaths.length > 1) {
    console.log("[surgical] note: multi-path context present but no reference path survived", {
      hintedPaths,
      targetPath,
      content,
    });
  }

  const fileId = await resolveFileIdByPathOrName(supabase, repoId, targetPath);
  const allowCreateMissing = !fileId && isCreateTargetRequest(content, targetPath);

  if (!fileId && !allowCreateMissing) {
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

  if (allowCreateMissing) {
    console.log("[surgical_create_missing] allowing create for missing target", {
      targetPath,
    });
  }

  const readOut = allowCreateMissing
    ? {
        path: targetPath,
        mime: inferTextMimeFromPath(targetPath),
        content: "",
        id: null,
      }
    : await runTool(
        supabase,
        repoId,
        userId,
        content,
        "vault_read_text",
        { path: targetPath }
      );

  if (!allowCreateMissing && (!readOut || typeof readOut !== "object" || "error" in readOut)) {
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
  const currentFileId = fileId ? String(fileId) : "";

  if (isImagePopulationRequest(content) && !hasImageSourceSpecified(content)) {
    return new Response(
      "[Observation]\nImages were requested for the page.\n\n" +
        "[Assessment]\nA source for the images was not specified, so Vestaryn cannot safely wire them in yet.\n\n" +
        "[Action]\nReply with one of: remote URLs, placeholder images, or local assets.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

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
    referenceFiles.length === 0
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

  if (!rewritten) {
    const styleFastPath = applyStyleRecipeFastPath({
      userText: content,
      currentPath,
      currentContent,
    });

    if (styleFastPath.ok) {
      rewritten = styleFastPath.nextContent;
      rewriteSource = "fast_path";

      console.log("[surgical fast-path hit]", {
        currentPath,
        kind: styleFastPath.kind,
        recipeId: styleFastPath.recipeId,
        className: styleFastPath.className,
      });
    } else {
      console.log("[surgical style fast-path miss]", {
        currentPath,
        reason: styleFastPath.reason,
      });
    }
  }

  if (!rewritten) {
    const layoutFastPath = applyLayoutRecipeFastPath({
      userText: content,
      currentPath,
      currentContent,
    });

    if (layoutFastPath.ok) {
      rewritten = layoutFastPath.nextContent;
      rewriteSource = "fast_path";

      console.log("[surgical fast-path hit]", {
        currentPath,
        kind: layoutFastPath.kind,
        recipeId: layoutFastPath.recipeId,
      });
    } else {
      console.log("[surgical layout fast-path miss]", {
        currentPath,
        reason: layoutFastPath.reason,
      });
    }
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

  const isHtmlFile = /\.html?$/i.test(currentPath);
  const isFragment = isHtmlFile && isHtmlFragment(currentContent);

  if (isHtmlFile && isFragment && referenceFiles.length > 0) {
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

if (!/\.html?$/i.test(currentPath) && /<html|<head|<body|<nav|<header/i.test(rewritten)) {
  console.log("[surgical] blocked: html injected into non-html file", {
    currentPath,
  });

  return new Response(
    "[Observation]\nThe requested edit was blocked.\n\n" +
      `[Assessment]\nGenerated content for ${currentPath} contained HTML markup which is invalid for this file type.\n\n` +
      "[Action]\nRetry with a request aligned to the file type (e.g. CSS changes for styles.css).",
    {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    }
  );
}

  {
    const inlineStyleRejection = rejectUnexpectedInlineStyleBlock({
      currentPath,
      currentContent,
      rewritten,
    });

    if (inlineStyleRejection) {
      console.log("[surgical] blocked: introduced inline style block", {
        currentPath,
      });
      return inlineStyleRejection;
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

  if (
    rewriteSource === "model_path" &&
    currentContent.length > 0 &&
    rewritten.length < currentContent.length * 0.7
  ) {
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

  const proposalArgs = allowCreateMissing
    ? {
        path: currentPath,
        content: rewritten,
      }
    : {
        fileId: currentFileId,
        path: currentPath,
        content: rewritten,
      };

  const proposal = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_propose_write",
    proposalArgs
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