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
  const explicit = extractSingleMentionedPath(raw);
  const implicit = inferImplicitPagePath(raw);

  const wantsNewFile =
    /\b(new file|separate file|separately|create a new page|add a .* page|create a .* page)\b/i.test(raw);

  // If the prompt clearly asks to create a new page, prefer the inferred page target
  // over a referenced existing file like index.html.
  if (wantsNewFile && implicit) {
    return implicit;
  }

  return explicit || implicit || null;
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

export function extractMentionedPaths(text: string) {
  const sanitized = sanitizeIntentParsingInput(text);

  return Array.from(
    new Set(
      (sanitized.match(/\b(?:[\w-]+\/)*[\w.\-[\]]+\.[A-Za-z0-9]{1,8}\b/g) ?? [])
        .map((s) => s.trim())
        .filter(isValidPathCandidate)
    )
  );
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
    /\b(change|make|improve|upgrade|refine|polish|adjust)\b/.test(t);

  const visualTarget =
    /\b(background|layout|sections|section|spacing|styling|style|hero|design|look|ui|colors|visuals)\b/.test(t);

  const explainOnly =
    /\b(explain|just explain|tell me how|how do i|what is|why is)\b/.test(t);

  return refinementVerb && visualTarget && !explainOnly;
}

export function isNamedFileExecutionRequest(text: string) {
  if (isCreateAndModifyIntent(text)) {
    return false;
  }

  const hasPath = extractMentionedPaths(text || "").length >= 1;

  if (!hasPath) return false;

  return (
    /check|correct|fix|debug|resolve|repair|rewrite|improve|refactor|clean up|cleanup|harden|modify|edit|update|review|inspect|turn|transform|convert|evolve|polish|refine|premium|modernize|restyle/i.test(
      text || ""
    ) || isVisualRefinementIntent(text || "")
  );
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

  if (isVisualRefinementIntent(t)) return true;

  const hasStrongActionVerb =
    /\b(create|build|implement|fix|update|edit|modify|change|rewrite|refactor|replace|delete|remove|add|repair|resolve)\b/.test(
      t
    );

  const hasExecutionTarget =
    /\b(file|repo|repository|project|component|page|route|api|endpoint|function|module|script|site|website|app|dashboard)\b/.test(
      t
    ) || filterExecutionPaths(extractMentionedPaths(t)).length > 0
    

  const explainOnlyLanguage =
    /\b(explain|just explain|dont need anything created|don't need anything created|no need to create|not create yet|just tell me|what kind|which kind|which kinds|what are|how does|help me understand)\b/.test(
      t
    );

  if (explainOnlyLanguage) return false;

  if (isVisualRefinementExecutionIntent(t)) return true;

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

