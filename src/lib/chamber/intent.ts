import {filterExecutionPaths} from "@/lib/chamber/executionMode";

function stripCodeBlocks(text: string) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
}

function stripExampleNoise(text: string) {
  let s = String(text ?? "");

  // Remove parenthetical examples containing e.g. / i.e.
  s = s.replace(/\((?=[^)]*\b(?:e\.g\.|i\.e\.)\b)[^)]*\)/gi, " ");

  // Remove short standalone e.g. / i.e. example tails up to punctuation/newline
  s = s.replace(/\b(?:e\.g\.|i\.e\.)\b[^.\n;:!?]*/gi, " ");

  // Remove HTML/tag examples so tags do not affect path/intent parsing
  s = s.replace(/<[^>\n]+>/g, " ");

  return s;
}

function sanitizeIntentParsingInput(text: string) {
  return stripExampleNoise(stripCodeBlocks(text));
}

export function inferMultipleImplicitPagePaths(text: string): string[] {
  const t = normText(text).toLowerCase();
  if (!t) return [];

  const mappings: Array<[RegExp, string]> = [
    [/\bportfolio\b/, "portfolio.html"],
    [/\bgallery\b/, "gallery.html"],
    [/\babout\b/, "about.html"],
    [/\bcontact\b/, "contact.html"],
    [/\bpricing\b/, "pricing.html"],
    [/\bservices\b/, "services.html"],
    [/\bfaq\b/, "faq.html"],
    [/\bexplore\b/, "explore.html"],
  ];

  const results: string[] = [];

  for (const [regex, path] of mappings) {
    if (regex.test(t)) {
      results.push(path);
    }
  }

  return Array.from(new Set(results));
}

function isValidPathCandidate(value: string) {
  const v = String(value ?? "").trim();

  if (!v) return false;
  if (/^(e\.g|i\.e)$/i.test(v)) return false;
  if (v.length < 3) return false;
  if (/^[<>()[\]{}"'`]+$/.test(v)) return false;

  // Require a plausible extension
  if (!/\.[A-Za-z0-9]{1,8}$/i.test(v)) return false;

  // Block common prose fragments that happen to contain a dot
  if (/^[A-Za-z]\.[A-Za-z]$/i.test(v)) return false;

  return true;
}

export function isConcreteEditRequest(text: string): boolean {
  const t = String(text ?? "").toLowerCase();

  return (
    /\bfix\b/.test(t) ||
    /\bcorrect\b/.test(t) ||
    /\brepair\b/.test(t) ||
    /\bupdate\b/.test(t) ||
    /\bchange\b/.test(t) ||
    /\bmodify\b/.test(t) ||
    /\bedit\b/.test(t) ||
    /\badjust\b/.test(t) ||
    /\btweak\b/.test(t) ||
    /\bpolish\b/.test(t) ||
    /\brefine\b/.test(t) ||
    /\bclean up\b/.test(t) ||
    /\brefactor\b/.test(t) ||
    /\brewrite\b/.test(t) ||
    /\breplace\b/.test(t) ||
    /\bwrite\b/.test(t) ||
    /\binsert\b/.test(t) ||
    /\binput\b/.test(t) ||
    /\badd\b/.test(t) ||
    /\bput\b/.test(t) ||
    /\bmake\b/.test(t) ||
    /\bthere (is|are)\b.*\b(break|breaks|issue|issues|error|errors|problem|problems)\b/.test(t) ||
    /\bplease\b.*\b(correct|fix|repair|update|change|modify|edit|rewrite|replace|write|insert|input|add|put|adjust|tweak|polish|refine|make)\b/.test(t)
  );
}

export function isImplicitFollowupEditIntent(text: string): boolean {
  const t = normText(text).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;
  if (isInternalGoalExecutionPrompt(t)) return false;

  const editVerb =
    /\b(change|edit|update|adjust|modify|tweak|polish|refine|rewrite|replace|add|remove|make)\b/.test(t);

  const followupTarget =
    /\b(it|that|this|same|same blocks|same section|same sections|same file|same layout|same styling)\b/.test(t) ||
    /\bthe blocks you adjusted\b/.test(t) ||
    /\bthe section you adjusted\b/.test(t) ||
    /\bthe sections you adjusted\b/.test(t) ||
    /\bthe part you adjusted\b/.test(t) ||
    /\bthe thing you adjusted\b/.test(t) ||
    /\bprevious\b/.test(t) ||
    /\bagain\b/.test(t);

  const visualOrRepoSignal =
    /\b(block|blocks|section|sections|layout|styling|style|colors|background|hero|nav|navbar|header|footer|card|cards|component|components|page|site|website)\b/.test(t);

  const explainOnly =
    /\b(explain|just explain|tell me|help me understand|what is|why is|how does)\b/.test(t);

  return editVerb && followupTarget && visualOrRepoSignal && !explainOnly;
}

export function isCreateLinkedPageIntent(text: string) {
  const raw = normText(text);

  const wantsNewPage =
    /\b(new file|separate file|separately|new page|add a .* page|create a .* page)\b/i.test(raw);

  const wantsLinking =
    /\b(link it|link to it|add.*link|add.*nav|navigation|navbar|menu)\b/i.test(raw);

  const hasReferencePage =
    /\bindex\.html\b/i.test(raw);

  return wantsNewPage && wantsLinking && hasReferencePage;
}



export function resolveCreateMissingTargetPath(text: string) {
  const raw = normText(text);
    if (isExplicitPythonFileCreateIntent(raw)) {
    return "script.py";
  }
  const explicit = extractSingleMentionedPath(raw);
  const implicitMultiple = inferMultipleImplicitPagePaths(raw);
  const implicitSingle = inferImplicitPagePath(raw);

  const wantsNewFile =
    /\b(new file|new files|separate file|separate files|separately|create a new page|create new pages|add a .* page|add .* pages|create a .* page|create .* pages)\b/i.test(raw);

  // If the prompt clearly asks to create new page(s), prefer implicit page targets
  // over a referenced existing file like index.html.
  if (wantsNewFile && implicitMultiple.length > 0) {
    return implicitMultiple;
  }

  if (wantsNewFile && implicitSingle) {
    return implicitSingle;
  }

  return explicit || implicitSingle || null;
}

export function isShortFollowupExecutionIntent(text: string): boolean {
  const t = normText(text).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;

  return (
    /^(yes|yes please|do it|go ahead|apply it|retry|try again|please retry|continue|go for it|proceed|do that)$/i.test(t)
  );
}

export function inferImplicitPagePath(text: string) {
  const t = normText(text).toLowerCase();

  if (!t) return null;
  if (isInternalControlPrompt(t)) return null;

  if (/\bportfolio page\b/.test(t)) return "portfolio.html";
  if (/\bgallery page\b/.test(t)) return "gallery.html";
  if (/\babout page\b/.test(t)) return "about.html";
  if (/\bcontact page\b/.test(t)) return "contact.html";
  if (/\bpricing page\b/.test(t)) return "pricing.html";
  if (/\bservices page\b/.test(t)) return "services.html";
  if (/\bfaq page\b/.test(t)) return "faq.html";

  return null;
}

export function extractMentionedPaths(content: string): string[] {
  const text = String(content ?? "");

  const matches = Array.from(
    text.matchAll(
      /\b[a-zA-Z0-9_./-]+\.(?:html|css|js|jsx|ts|tsx|py|sql|json|md|txt|bas|csv|xml|yml|yaml)\b/gi
    )
  )
    .map((m) => String(m[0] ?? "").trim())
    .filter(Boolean);

  return Array.from(new Set(matches))
    .filter((p) => /[a-zA-Z]/.test(p))
    .filter((p) => !/^\d+(?:\.\d+)+$/.test(p));
}

export function isLayoutAlignmentIntent(text: string) {
  return [
    /\balign layouts?\b/i,
    /\bmake .* (match|consistent)\b/i,
    /\buse .* as (the )?same layout\b/i,
    /\bstandardi[sz]e (the )?(layout|header|nav|footer)\b/i,
    /\bmake .* look the same\b/i,
    /\bmatch .* page\b/i,
    /\bconsistent (layout|structure|header|footer|nav)\b/i,
    /\bsame (layout|header|nav|footer)\b/i,
  ].some((re) => re.test(text));
}

export function resolveCanonicalLayoutPath(paths: string[]) {
  const normalized = paths.map((p) => String(p || "").trim());

  if (normalized.includes("index.html")) return "index.html";

  const htmls = normalized.filter((p) => /\.html?$/i.test(p));
  return htmls[0] ?? null;
}

export function isVisualRefinementIntent(text: string) {
  const t = normText(text).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;
  if (isGoalPlanningUserIntent(t)) return false;
  if (isShortFollowupExecutionIntent(t)) return true;

  const refinementVerb =
    /\b(make|improve|refine|polish|upgrade|tweak|adjust|elevate)\b/.test(t);

  const refinementTarget =
    /\b(look|design|ui|ux|layout|styling|style|appearance|visuals?|theme|premium|modern|cleaner|clean|polished)\b/.test(
      t
    );

  const explainOnlyLanguage =
    /\b(explain|just explain|dont need anything created|don't need anything created|no need to create|not create yet|just tell me|help me understand)\b/.test(
      t
    );

  return refinementVerb && refinementTarget && !explainOnlyLanguage;
}

export function extractSingleMentionedPath(text: string) {
  const paths = extractMentionedPaths(text || "");
  return paths.length === 1 ? paths[0] : null;
}

export function isVisualRefinementExecutionIntent(text: string) {
  const t = normText(text).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;
  if (isGoalPlanningUserIntent(t)) return false;

  const refinementVerb =
    /\b(change|make|improve|upgrade|refine|polish|adjust|add|remove|restyle|tweak)\b/.test(t);

  const visualTarget =
    /\b(background|layout|sections|section|blocks|block|spacing|styling|style|hero|design|look|ui|colors|color|visuals|theme|navbar|nav bar|header|footer|card|cards|shadow|shade|border|transparent|glass)\b/.test(t);

  const explainOnly =
    /\b(explain|just explain|tell me how|how do i|what is|why is)\b/.test(t);

  return refinementVerb && visualTarget && !explainOnly;
}

export function isExplicitPythonFileCreateIntent(text: string) {
  const t = normText(text).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;
  if (isInternalGoalExecutionPrompt(t)) return false;

  const createVerb =
    /\b(write|create|generate|build|make|convert)\b/.test(t);

  const pythonTarget =
    /\bpython\b/.test(t) ||
    /\bpython script\b/.test(t) ||
    /\.py\b/.test(t) ||
    /\bscript\b/.test(t);

  const explainOnly =
    /\b(explain|just explain|help me understand|what kind|which kind|how does)\b/.test(t);

  return createVerb && pythonTarget && !explainOnly;
}

export function isNamedFileExecutionRequest(text: string) {
  if (isCreateAndModifyIntent(text)) {
    return false;
  }

  const hasPath = extractMentionedPaths(text || "").length >= 1;

  if (!hasPath) return false;

  return (
    /check|correct|fix|debug|resolve|repair|rewrite|improve|refactor|clean up|cleanup|harden|modify|edit|update|change|adjust|review|inspect|turn|transform|convert|evolve|polish|refine|premium|modernize|restyle|write|insert|input|add|put|replace/i.test(
      text || ""
    ) || isVisualRefinementIntent(text || "")
  );
}

export function isPlanningOrSpecPrompt(text: string) {
  const t = normText(text).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;
  if (isInternalGoalExecutionPrompt(t)) return false;

  return /\b(design|structure|schema|workbook|worksheet|spreadsheet|dashboard|formula|formulas|logic|plan|planning|analysis|spec|specification|refine|refinement|implementation-ready|python generation|direct python generation|openpyxl|scaffold|automation opportunities)\b/i.test(t);
}

export function isExplainOnlyQuestion(text: string) {
  const t = normText(text).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;
  if (isInternalGoalExecutionPrompt(t)) return false;

  const explainSignal =
  /\b(explain|just explain|dont need anything created|don't need anything created|no need to create|not create yet|just tell me|help me understand|what kind|which kind|which kinds|what are|how does|difference between|pros and cons|how is this repo structured|how is this project structured|repo structure|project structure|walk me through)\b/.test(t);

  const noDirectExecutionSignal =
    !/\b(apply|change the repo|edit the file|update the file|create this file|make the file|implement now|build now|fix this file)\b/.test(t);

  return explainSignal && noDirectExecutionSignal;
}

export function isRepositoryExecutionIntent(content: string) {
  const t = normText(content).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;

  // Explicit planning requests should not be treated as execution
  if (isGoalPlanningUserIntent(t)) return false;

    if (isPlanningOrSpecPrompt(t) && !isExplicitPythonFileCreateIntent(t)) {
    return false;
  }

  const mentionedPaths = extractMentionedPaths(t);

  const hasConcreteEditVerb =
    /\b(fix|edit|update|change|modify|adjust|rewrite|refactor|replace|correct|repair|add|remove|make|tweak|polish|refine)\b/.test(t);

  const hasCodeLikeMention = mentionedPaths.some(isCodeLikeRepoPath);
  const hasContentLikeMention = mentionedPaths.some(isContentLikeRepoPath);

  if (hasCodeLikeMention && hasConcreteEditVerb) {
    return true;
  }

  if (
    hasContentLikeMention &&
    /\b(write|rewrite|replace|update|change|edit|modify|input|insert|add)\b/.test(t)
  ) {
    return true;
  }

  if (isExplicitPythonFileCreateIntent(t)) {
    return true;
  }

  if (isImplicitFollowupEditIntent(t)) return true;
  if (isVisualRefinementIntent(t)) return true;
  if (isVisualRefinementExecutionIntent(t)) return true;
  if (isConcreteEditRequest(t) && /\b(site|website|page|layout|blocks|sections|navbar|nav bar|header|footer|card|cards)\b/.test(t)) {
    return true;
  }

  const hasStrongActionVerb =
    /\b(create|build|implement|fix|update|edit|modify|change|rewrite|refactor|replace|delete|remove|add|repair|resolve|adjust|write|insert|input|put|make|tweak|polish|refine)\b/.test(
      t
    );

  const hasExecutionTarget =
    /\b(file|repo|repository|project|component|page|route|api|endpoint|function|module|script|site|website|app|dashboard|layout|section|sections|block|blocks|navbar|nav bar|header|footer|card|cards)\b/.test(
      t
    ) || mentionedPaths.length > 0;

  const explainOnlyLanguage =
    /\b(explain|just explain|dont need anything created|don't need anything created|no need to create|not create yet|just tell me|what kind|which kind|which kinds|what are|how does|help me understand)\b/.test(
      t
    );

  if (explainOnlyLanguage) return false;

  return hasStrongActionVerb && hasExecutionTarget;
}

export function isCreateAndModifyIntent(text: string) {
    if (isInternalGoalExecutionPrompt(text)) {
      return false;
    }
  const raw = String(text ?? "");
  const sanitized = sanitizeIntentParsingInput(raw);
  const paths = extractMentionedPaths(sanitized);

  if (paths.length < 2) return false;

  const hasCreateVerb =
    /\b(create|add|implement|make)\b/i.test(sanitized);

  const hasIntegrationVerb =
    /\b(render|use|import|insert|mount)\b/i.test(sanitized);

  if (!hasCreateVerb || !hasIntegrationVerb) return false;

  // Require that at least one path looks like a likely "new/extracted component/module"
  // and another path looks like an existing integration target.
  const hasLikelyCreateTarget = paths.some((p) =>
    /^(components|lib|utils|hooks|src\/components|src\/lib|src\/utils|src\/hooks)\//i.test(p) ||
    /\.(tsx|ts|jsx|js|css|scss)$/i.test(p)
  );

  const hasLikelyModifyTarget = paths.some((p) =>
    /app\/page\.(tsx|ts|jsx|js)$/i.test(p) ||
    /pages\/.+\.(tsx|ts|jsx|js)$/i.test(p) ||
    /index\.html$/i.test(p) ||
    /\.html?$/i.test(p)
  );

  return hasLikelyCreateTarget && hasLikelyModifyTarget;
}

export function isCodeLikeRepoPath(path: string) {
  const p = String(path ?? "").toLowerCase().trim();

  return (
    p.endsWith(".ts") ||
    p.endsWith(".tsx") ||
    p.endsWith(".js") ||
    p.endsWith(".jsx") ||
    p.endsWith(".mjs") ||
    p.endsWith(".cjs") ||
    p.endsWith(".py") ||
    p.endsWith(".html") ||
    p.endsWith(".css") ||
    p.endsWith(".scss") ||
    p.endsWith(".sass") ||
    p.endsWith(".json") ||
    p.endsWith(".yml") ||
    p.endsWith(".yaml") ||
    p.endsWith(".sql") ||
    p.endsWith(".xml") ||
    p.endsWith(".bas") ||
    p.endsWith(".vba")
  );
}

export function isContentLikeRepoPath(path: string) {
  const p = String(path ?? "").toLowerCase().trim();

  return (
    p.endsWith(".txt") ||
    p.endsWith(".md") ||
    p.endsWith(".csv")
  );
}

export function resolveCreateAndModifyPaths(text: string) {
  const paths = extractMentionedPaths(text || "");
  if (paths.length < 2) return null;

  const createPath =
    paths.find((p) =>
      /^(components|lib|utils|hooks|src\/components|src\/lib|src\/utils|src\/hooks)\//i.test(p)
    ) ??
    paths.find((p) => !/app\/page\.(tsx|ts|jsx|js)$/i.test(p) && !/\.html?$/i.test(p)) ??
    paths[0] ??
    null;

  const modifyPath =
    paths.find((p) => /app\/page\.(tsx|ts|jsx|js)$/i.test(p)) ??
    paths.find((p) => /\.html?$/i.test(p)) ??
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
    if (isInternalGoalExecutionPrompt(text)) {
      return false;
    }
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

export function isHighLevelBuildRequest(content: string) {
  const t = normText(content).toLowerCase();

  if (!t) return false;
  if (isInternalControlPrompt(t)) return false;

  const buildVerb =
    /\b(build|create|make)\b/.test(t);

  const buildTarget =
    /\b(website|site|app|dashboard|tool|project|web app|landing page)\b/.test(t);

  const explainOnlyLanguage =
    /\b(explain|just explain|dont need anything created|don't need anything created|no need to create|not yet|for now just|just tell me)\b/.test(t);

  return buildVerb && buildTarget && !explainOnlyLanguage;
}

export function isBootstrapProjectIntent(content: string) {
  const t = String(content || "").toLowerCase();

  return (
    /\b(help me|can you help|build|create|make)\b/.test(t) &&
    /\b(website|site|app|dashboard|tool|project)\b/.test(t)
  );
}

export function normText(input: unknown) {
  return String(input ?? "").trim();
}

export function startsWithAny(text: string, prefixes: string[]) {
  return prefixes.some((p) => text.startsWith(p));
}

export function isInternalGoalExecutionPrompt(content: string) {
  const text = normText(content);
  const lower = text.toLowerCase();

  const hasGoalCore =
    lower.includes("goal: ") &&
    lower.includes("current step: ") &&
    lower.includes("step description: ");

  const hasOldExecutionPhrase =
    lower.includes("execute this step now by making the required repository changes");

  const hasNewExecutionShape =
    lower.includes("relevant files: ") &&
    lower.includes("execution rules:") &&
    lower.includes("focus only on completing this step.");

  return hasGoalCore && (hasOldExecutionPhrase || hasNewExecutionShape);
}

export function isInternalControlPrompt(content: string) {
  const text = normText(content);
  return (
    startsWithAny(text, [
      "__GOAL_PLAN__",
      "__GOAL_APPROVE__",
      "__GOAL_CONTINUE__",
      "__GOAL_STATUS__",
      "__GOAL_DONE__",
      "__GOAL_EXECUTE__",
      "__APPLY__:",
      "__APPLY_SET__:",
      "__VERIFY__",
      "__PROPOSAL__",
      "__ENGRAVING__",
    ]) || isInternalGoalExecutionPrompt(text)
  );
}
export function buildGoalExecutionInstruction(
  step: any,
  plan: any,
  originalUserRequest: string
) {
  const stepFiles = Array.isArray(step?.files)
    ? step.files.map((x: any) => String(x)).filter(Boolean)
    : [];

  return [
    `Original user request: ${String(originalUserRequest ?? "").trim()}`,
    `Goal: ${String(plan?.title ?? "").trim()}`,
    `Goal summary: ${String(plan?.summary ?? "").trim()}`,
    `Current step: ${String(step?.title ?? "").trim()}`,
    `Step description: ${String(step?.description ?? "").trim()}`,
    `Relevant files: ${stepFiles.join(", ") || "none specified"}`,
    `Execution rules:`,
    `- Preserve the original user request, theme, and visual/style intent.`,
    `- Do not drift into a generic starter implementation if the original request is more specific.`,
    `- Focus only on completing this step.`,
    `- If the repo is empty, bootstrap only the minimal structure needed for this step.`,
    `- Use tools when needed.`,
    `- Respond with the normal Vestaryn contract.`,
  ].join("\n");
}

export function isGoalPlanningUserIntent(content: string) {
  const text = normText(content);
  const lower = text.toLowerCase();

  if (!text) return false;
  if (isInternalControlPrompt(text)) return false;
  if (isInternalGoalExecutionPrompt(text)) return false;

  const planningPatterns = [
    /\bgoal plan\b/,
    /\bnew goal plan\b/,
    /\bmake (a )?(new )?goal plan\b/,
    /\bcreate (a )?(new )?goal plan\b/,
    /\bmake a plan\b/,
    /\bcreate a plan\b/,
    /\bstep by step plan\b/,
    /\broadmap\b/,
    /\bbreak (this|it|the project) down into steps\b/,
    /\bplan this project\b/,
    /\bhelp me plan\b/,
    /\bbuild plan\b/,
    /\bimplementation plan\b/,
    /\bimprovement plan\b/,
    /\bplan for (this|the current|my) project\b/,
    /\bplan to improve\b/,
    /\bimprove the current project\b/,
  ];

  return planningPatterns.some((re) => re.test(lower));
}

export function extractGoalExecute(text: string) {
  const marker = "__GOAL_EXECUTE__:";
  const s = String(text ?? "");
  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  const after = s.slice(start);
  const endIdx = after.indexOf("\n");
  const json = (endIdx === -1 ? after : after.slice(0, endIdx)).trim();

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function isNewGoalPlanIntent(text: string): boolean {
  const t = normText(text);

  return (
    /\b(new|another|fresh|replace|redo)\s+(goal\s+plan|plan)\b/i.test(t) ||
    /\b(make|create|build|generate)\s+(a\s+)?(new\s+)?goal\s+plan\b/i.test(t) ||
    /\b(goal\s+plan)\s+(for|to)\s+(improve|upgrade|refine|extend)\b/i.test(t) ||
    /\bimprove\b.*\b(current project|existing project|project in the vault|vault)\b/i.test(t)
  );
}

