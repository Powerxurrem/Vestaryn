// IMPORTANT:
// Do not route bootstrap-mode requests through create-missing-file mode.
// High-level website bootstraps may infer index.html as a target, but they
// must still flow into deterministic bootstrap so index.html + styles.css
// are staged together instead of a single freeform file being generated.

import OpenAI from "openai";
import { resolveTierPolicy } from "@/lib/membership/tiers";
import { SYSTEM_PROTECTOR_DEFAULT,SYSTEM_PROTECTOR_ARCH,} from "@/lib/chamber/prompts";
import {
  extractSingleMentionedPath,
  isRepositoryExecutionIntent,
  isCreateAndModifyIntent,
  isHighLevelBuildRequest,
  isInternalGoalExecutionPrompt,
  normText,
  isInternalControlPrompt,
  isGoalPlanningUserIntent,
  resolveCreateMissingTargetPath,
} from "@/lib/chamber/intent";
import {isSourceTargetTransferIntent,isImportRefactorIntent,isSplitFileIntent} from "@/lib/chamber/refactorIntent";
import { generateNewFileContent} from "@/lib/chamber/generation";
import { runAutoVerifyForRepo,} from "@/lib/chamber/verify";
import { TOOLS}from "@/lib/vault/toolRuntime";
import {  resolveDirectVerifyCommand,handleDirectVerifyCommand} from "@/lib/chamber/verifyRuntime";
import {  handleApplySetCommand,handleApplyCommand,} from "@/lib/chamber/applyRuntime";
import { handlePlanningRequest } from "@/lib/chamber/planningRuntime";
import { tryHandleBootstrap } from "@/lib/chamber/bootstrapRuntime";
import { tryHandlePreStreamRepoOps } from "@/lib/chamber/preStreamRuntime";
import { tryHandleRunnerPing } from "@/lib/chamber/runnerRuntime";
import {chargeCreditsForUsage} from "@/lib/chamber/creditsRuntime";
import { tryHandleDeterministicCommands } from "@/lib/chamber/deterministicCommands";
import { streamResponse } from "@/lib/chamber/streamRuntime";
import {  resolveExecutionMode,shouldAllowBootstrapForMode,shouldAllowPreStreamRepoOpsForMode,  shouldRunBaselineVerifyForMode} from "@/lib/chamber/executionMode";
import { handleSurgicalMode } from "@/lib/chamber/handleSurgicalMode";
import { handleCreateMissingFileMode } from "@/lib/chamber/handleCreateMissingFileMode";
import { handleImplicitStaticPageMode } from "@/lib/chamber/handleImplicitStaticPageMode";
import { handleProposalPreverify } from "@/lib/chamber/toolOrchestration/proposalPreverifyOrchestration";
import { finalizeAssistantTurnOrchestration } from "@/lib/chamber/toolOrchestration/finalizeAssistantTurnOrchestration";
import { persistAssistantTurnOrchestration } from "@/lib/chamber/toolOrchestration/persistAssistantTurnOrchestration";
import { tryHandleRepoWideStyleOrchestration } from "@/lib/chamber/toolOrchestration/repoWideStyleOrchestration";
import { tryHandleExplainModeOrchestration } from "@/lib/chamber/toolOrchestration/explainModeOrchestration";
import { handlePass1FallbackOrchestration } from "@/lib/chamber/toolOrchestration/pass1FallbackOrchestration";
import { executeToolOrchestration } from "@/lib/chamber/toolOrchestration/toolExecutionOrchestration";
import { prepareChatRuntimeOrchestration } from "@/lib/chamber/toolOrchestration/prepareChatRuntimeOrchestration";
import { normalizePass1ToolsOrchestration } from "@/lib/chamber/toolOrchestration/pass1ToolNormalizationOrchestration";
import { buildCreateMissingResponseOrchestration } from "@/lib/chamber/toolOrchestration/createMissingResponseOrchestration";
import { buildSurgicalResponseOrchestration } from "@/lib/chamber/toolOrchestration/surgicalResponseOrchestration";
import { tryHandleEarlyOrchestration } from "@/lib/chamber/toolOrchestration/earlyOrchestration";
import { runToolExecutionLoop } from "@/lib/chamber/toolOrchestration/toolExecutionLoopOrchestration";
import { runToolExecutionRounds } from "@/lib/chamber/toolOrchestration/toolExecutionRoundsOrchestration";
import { supabaseRouteHandler } from "@/lib/supabase/server";
import { vault_read_text, resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { runTool } from "@/lib/vault/toolRuntime";

/**
 * @file app/api/repo/[repoId]/chat/route.ts
 * @purpose Stream assistant output for a repo chat, while enforcing Vestaryn output contract.
 * @exports POST
 */

export const runtime = "nodejs";
export const maxDuration = 180;
const GOAL_PLAN_ENABLED = false;

// ─────────────────────────────────────────────────────────────
// OpenAI client
// ─────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MAINTENANCE_TRIGGER_MSGS = 160;

async function generateNewFileContentSafe(args: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  path: string;
  mime: string;
  maxOutputTokens?: number;
}) {
  try {
    return await generateNewFileContent(args);
  } catch (e: any) {
    const message = String(e?.message ?? "");

    if (!/appears truncated/i.test(message)) {
      throw e;
    }

    return await generateNewFileContent({
      ...args,
      userRequest:
        `${args.userRequest}\n\nRetry rules:\n` +
        `- Return the FULL complete file.\n` +
        `- Do not truncate.\n` +
        `- Keep the file compact and complete.\n` +
        `- Return only valid file contents.\n`,
      maxOutputTokens: Math.max(args.maxOutputTokens ?? 10000, 10000),
    });
  }
}

function isImplicitPythonScriptBootstrapRequest(text: string) {
  const t = String(text ?? "").toLowerCase();

  const asksForScript =
    /\b(write|create|generate|build|make|convert)\b/.test(t) &&
    (
      /\bpython\b/.test(t) ||
      /\.py\b/.test(t) ||
      /\bpython script\b/.test(t) ||
      /\bscript\b/.test(t)
    );

  const spreadsheetContext =
    /\.xlsx\b/.test(t) ||
    /\bexcel\b/.test(t) ||
    /\bworkbook\b/.test(t) ||
    /\bspreadsheet\b/.test(t) ||
    /\bopenpyxl\b/.test(t) ||
    /\bdashboard\b/.test(t);

  return asksForScript && spreadsheetContext;
}

function resolveSurgicalPaths(content: string): {
  targetPath: string | null;
  referencePath: string | null;
} {
  const mentioned = Array.from(
    new Set(
      (content.match(/[a-zA-Z0-9_\-./]+\.(html|css|js|jsx|ts|tsx)/gi) ?? [])
        .map((p) => String(p).trim())
        .filter(Boolean)
    )
  );

  if (mentioned.length === 1) {
    return {
      targetPath: mentioned[0],
      referencePath: null,
    };
  }

  if (mentioned.length >= 2) {
    const lower = content.toLowerCase();

    if (/\balign\b|\bmatch\b|\bvisually align\b|\bsame style\b|\bsame layout\b/.test(lower)) {
      return {
        targetPath: mentioned[0],
        referencePath: mentioned[1],
      };
    }

    return {
      targetPath: mentioned[0],
      referencePath: mentioned[1],
    };
  }

  return {
    targetPath: null,
    referencePath: null,
  };
}

function stripPathInsertCommandPrefix(input: string): string {
  return String(input ?? "").replace(/^\/path\s+/i, "").trim();
}

function dirnameOf(path: string) {
  const s = String(path ?? "").trim();
  const idx = s.lastIndexOf("/");
  return idx === -1 ? "" : s.slice(0, idx);
}

function joinWithinDir(dir: string, leaf: string) {
  const cleanLeaf = String(leaf ?? "").trim().replace(/^\/+/, "");
  if (!dir) return cleanLeaf;
  return `${dir}/${cleanLeaf}`;
}

function normalizeNavHref(href: string) {
  const h = String(href ?? "").trim().toLowerCase();

  if (!h) return "";
  if (h === "#home" || h === "/" || h === "/index.html" || h === "index.html") {
    return "index.html";
  }

  return h.replace(/^\/+/, "");
}

function normalizeNavLabel(label: string) {
  return String(label ?? "").trim().toLowerCase();
}

function extractNavLinks(html: string): Array<{ href: string; label: string }> {
  const navMatch = String(html ?? "").match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return [];

  return Array.from(
    String(navMatch[1] ?? "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  )
    .map((m) => ({
      href: String(m[1] ?? "").trim(),
      label: String(m[2] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    }))
    .filter((x) => x.href && x.label);
}

function resolveMentionedRepoPaths(
  requestedPaths: string[],
  files: Array<{ path?: string; name?: string }>
) {
  return requestedPaths.map((requested) => {
    const raw = String(requested ?? "").trim();
    if (!raw) return raw;

    const exact = files.find((f) => String(f?.path ?? "").trim() === raw);
    if (exact) return String(exact?.path ?? "").trim();

    const byName = files.filter((f) => String(f?.name ?? "").trim() === raw);
    if (byName.length === 1) {
      return String(byName[0]?.path ?? "").trim();
    }

    return raw;
  });
}

function extractLocalHtmlRefs(html: string): string[] {
  const refs = Array.from(
    String(html ?? "").matchAll(/(?:src|href)=["']([^"']+)["']/gi)
  )
    .map((m) => String(m[1] ?? "").trim())
    .filter(Boolean)
    .filter((v) => !/^(https?:|data:|#|mailto:|tel:|\/\/)/i.test(v))
    .filter((v) => /\.html?$/i.test(v));

  return Array.from(new Set(refs));
}

function resolveEditTarget(
  mentionedPaths: string[],
  content: string,
  availableFiles: string[] = [],
  continuityTargetPath?: string | null
): { target: string | null; references: string[]; preserveMultiTarget: boolean } {
  const intent = classifyEditIntent(content);

  const hasStylesCss = availableFiles.some((p) => /(^|\/)styles\.css$/i.test(p));
  const cssTarget =
    availableFiles.find((p) => /(^|\/)styles\.css$/i.test(p)) ?? "styles.css";

  // Strong CSS preference for vague visual/style follow-ups
  if (intent === "style" && hasStylesCss && mentionedPaths.length === 0) {
    return {
      target: cssTarget,
      references: [],
      preserveMultiTarget: false,
    };
  }

  // Continuity fallback when user is clearly continuing a prior edit
  if (!mentionedPaths?.length && continuityTargetPath) {
    // But styling requests should still prefer CSS when it exists
    if (intent === "style" && hasStylesCss) {
      return {
        target: cssTarget,
        references: [],
        preserveMultiTarget: false,
      };
    }

    return {
      target: continuityTargetPath,
      references: [],
      preserveMultiTarget: false,
    };
  }

  if (!mentionedPaths?.length) {
    return { target: null, references: [], preserveMultiTarget: false };
  }

  const wantsSharedStyling =
    intent === "style" &&
    (
      mentionedPaths.length >= 2 ||
      /\b(same style|apply the same style|same theme|same look|match the style|consistent|align style|match the styling)\b/i.test(
        content
      )
    );

  if (wantsSharedStyling) {
    return {
      target: null,
      references: [],
      preserveMultiTarget: true,
    };
  }

  const inMatch = content.match(
    /\bin\s+([a-zA-Z0-9_\-./]+\.(html|css|js|jsx|ts|tsx))\b/i
  );

  if (inMatch) {
    const target = String(inMatch[1] ?? "").trim();
    return {
      target,
      references: mentionedPaths.filter((p) => p !== target),
      preserveMultiTarget: false,
    };
  }

  // If the user explicitly mentioned CSS for a style request, prefer it
  const explicitCssPath = mentionedPaths.find((p) => /\.css$/i.test(p));
  if (intent === "style" && explicitCssPath) {
    return {
      target: explicitCssPath,
      references: mentionedPaths.filter((p) => p !== explicitCssPath),
      preserveMultiTarget: false,
    };
  }

  if (mentionedPaths.length > 1) {
    const target = mentionedPaths[mentionedPaths.length - 1];
    return {
      target,
      references: mentionedPaths.slice(0, -1),
      preserveMultiTarget: false,
    };
  }

  // Final CSS bias for style requests
  if (intent === "style" && hasStylesCss) {
    return {
      target: cssTarget,
      references: [],
      preserveMultiTarget: false,
    };
  }

  return {
    target: mentionedPaths[0],
    references: [],
    preserveMultiTarget: false,
  };
}

function isStaticSiteStyleFollowup(args: {
  content: string;
  inference: any;
  availableFiles: string[];
  effectiveMentionedPaths: string[];
}) {
  const t = String(args.content ?? "").toLowerCase();
  const projectType = String(args.inference?.projectType ?? "").toLowerCase();
  const hasStylesCss = args.availableFiles.some((p) => /(^|\/)styles\.css$/i.test(p));
  const hasHtml = args.availableFiles.some((p) => /\.html?$/i.test(p));
  const hasExplicitPaths = args.effectiveMentionedPaths.length > 0;

  const styleOnlyIntent =
    /\b(color|colors|background|theme|style|styling|shade|shadow|blur|transparent|glass|border|glow|spacing|padding|margin|font|visual|look|feel)\b/.test(t);

  const structuralOrContentIntent =
    /\b(remove|delete|hide|replace|rewrite|change the contents|content|text|section|sections|block|blocks|left|right|middle|hero|card|cards)\b/.test(t);

  return (
    projectType === "static_site" &&
    styleOnlyIntent &&
    !structuralOrContentIntent &&
    !hasExplicitPaths &&
    hasStylesCss &&
    hasHtml
  );
}

function resolveStaticSiteStyleTargets(availableFiles: string[]) {
  const stylesPath =
    availableFiles.find((p) => /(^|\/)styles\.css$/i.test(p)) ?? "styles.css";

  const htmlPath =
    availableFiles.find((p) => /(^|\/)index\.html$/i.test(p)) ??
    availableFiles.find((p) => /\.html?$/i.test(p)) ??
    null;

  return {
    targetPath: stylesPath,
    referencePaths: htmlPath ? [htmlPath] : [],
  };
}

function dedupeLinks(
  links: Array<{ href: string; label: string }>
): Array<{ href: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ href: string; label: string }> = [];

  for (const link of links) {
    const href = String(link?.href ?? "").trim();
    const label = String(link?.label ?? "").trim();
    if (!href || !label) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label });
  }

  return out;
}

function titleFromPath(path: string) {
  const base = String(path ?? "")
    .replace(/^.*\//, "")
    .replace(/\.html?$/i, "")
    .trim();

  if (!base) return "Page";
  if (base.toLowerCase() === "index") return "Home";

  return base.charAt(0).toUpperCase() + base.slice(1);
}

function buildDesiredLinksForPages(htmlPaths: string[]) {
  const unique = Array.from(new Set(htmlPaths.map((p) => String(p).trim()).filter(Boolean)));

  return unique.map((path) => ({
    href: path,
    label: titleFromPath(path),
  }));
}

function ensureNavContainsLinks(
  html: string,
  desiredLinks: Array<{ href: string; label: string }>
): string {
  const source = String(html ?? "");
  if (!source.trim()) return source;

  const navMatch = source.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i);
  if (!navMatch) return source;

  const navFull = String(navMatch[0] ?? "");

  const canonicalOrder = ["index.html", "explore.html", "about.html"];

  const desiredByPage = new Map<string, { href: string; label: string }>();

  for (const link of desiredLinks) {
    const href = String(link?.href ?? "").trim();
    const label = String(link?.label ?? "").trim();
    if (!href || !label) continue;

    const pageKey = normalizeNavHref(href);
    if (!pageKey) continue;

    if (!desiredByPage.has(pageKey)) {
      desiredByPage.set(pageKey, {
        href: pageKey,
        label,
      });
    }
  }

  const cleanedLinks = canonicalOrder
    .filter((page) => desiredByPage.has(page))
    .map((page) => desiredByPage.get(page)!)
    .map((link) => ({
      href: link.href,
      label:
        link.href === "index.html"
          ? "Home"
          : link.href === "explore.html"
            ? "Explore"
            : link.href === "about.html"
              ? "About"
              : link.label,
    }));

  const rebuiltNav =
    '<nav class="nav">\n' +
    cleanedLinks
      .map((link) => `        <a href="${link.href}">${link.label}</a>`)
      .join("\n") +
    "\n      </nav>";

  if (rebuiltNav === navFull) {
    return source;
  }

  return source.replace(navFull, rebuiltNav);
}

function isExistingMultiPageLinkingRequest(args: {
  content: string;
  availableFiles: string[];
  effectiveMentionedPaths: string[];
}) {
  const t = String(args.content ?? "").toLowerCase().trim();

  const mentionedHtmlPaths = args.effectiveMentionedPaths.filter((p) => /\.html?$/i.test(p));
  const existingHtmlPaths = mentionedHtmlPaths.filter((p) => args.availableFiles.includes(p));

  const allExistingHtmlPaths = args.availableFiles.filter((p) => /\.html?$/i.test(p));

  const hasLinkingIntent =
    /\b(link|linked|linking|connect|wire up|navigation|nav|navbar|menu)\b/.test(t);

  const hasSharedLayoutIntent =
    /\b(same styling|same style|same layout|same theme|same color|same colours|same colors|align|match)\b/.test(t);

  const hasNavCleanupIntent =
    /\b(remove|clean up|cleanup|fix|dedupe|deduplicate|delete)\b/.test(t) &&
    /\b(nav|navbar|navigation|menu|links?)\b/.test(t);

  const hasDuplicateNavIntent =
    /\b(double|duplicate|duplicates|duplicated)\b/.test(t) &&
    /\b(nav|navbar|navigation|menu|links?|pages)\b/.test(t);

  const isShortRetryFollowup =
    /^(yes|yes please|do it|go ahead|apply it|retry|can you retry|try again|please retry|continue)$/i.test(
      String(args.content ?? "").trim()
    );

  if (existingHtmlPaths.length >= 2 && (hasLinkingIntent || hasSharedLayoutIntent)) {
    return true;
  }

  if (allExistingHtmlPaths.length >= 2 && (hasNavCleanupIntent || hasDuplicateNavIntent)) {
    return true;
  }

  if (existingHtmlPaths.length >= 2 && isShortRetryFollowup) {
    return true;
  }

  return false;
}

function classifyEditIntent(content: string): "style" | "content" | "structure" | "unknown" {
  const t = String(content ?? "").toLowerCase();

  if (
    /\b(color|colors|background|theme|style|styling|navbar|nav bar|top bar|header|footer|layout|spacing|padding|margin|font|visual|look|feel|shade|shadow|blur|transparent|glass|border|surrounding|surround|glow)\b/.test(t)
  ) {
    return "style";
  }

  if (
    /\b(text|title|heading|paragraph|copy|content|wording|rename|label)\b/.test(t)
  ) {
    return "content";
  }

  if (
    /\b(add|remove|section|sections|div|container|grid|layout block|blocks|structure|component|components)\b/.test(t)
  ) {
    return "structure";
  }

  return "unknown";
}

// ─────────────────────────────────────────────────────────────
// Route: POST /api/repo/[repoId]/chat
// ─────────────────────────────────────────────────────────────
console.log("[supabase]", process.env.NEXT_PUBLIC_SUPABASE_URL);
export async function POST(req: Request, context: { params: Promise<{ repoId: string }> }) {
  const t0 = performance.now();
  const { repoId } = await context.params;
  const requestId = crypto.randomUUID();
  const url = new URL(req.url);
  const forceMaintenance = url.searchParams.get("forceMaintenance") === "1";
  const supabase = await supabaseRouteHandler();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", { _repo_id: repoId });
console.log("[is_repo_member]", { userId: user.id, repoId, isMember, memErr: memErr?.message });

if (memErr) {
  return new Response("Membership check failed", { status: 500 });
}

if (!isMember) {
  return new Response("Forbidden", { status: 403 });
}
const { content } = await req.json();
if (!content?.trim()) return new Response("Missing content", { status: 400 });

const text = normText(content);

// Stage 1: raw mode from user text only
const rawExecutionMode = resolveExecutionMode(text);

console.log("[execution_mode.raw]", {
  mode: rawExecutionMode.mode,
  confidence: rawExecutionMode.confidence,
  reasons: rawExecutionMode.reasons,
  mentionedPaths: rawExecutionMode.mentionedPaths,
});

const explicitGoalPlanRequest =
  GOAL_PLAN_ENABLED &&
  !isInternalControlPrompt(text) &&
  isGoalPlanningUserIntent(text);

const planningRequest = explicitGoalPlanRequest;

const autoGoalPlanRequest =
  GOAL_PLAN_ENABLED &&
  !isInternalControlPrompt(text) &&
  !explicitGoalPlanRequest &&
  !isRepositoryExecutionIntent(text) &&
  isHighLevelBuildRequest(text);

console.log("[goal_plan branch check]", {
  repoId,
  planningRequest,
  autoGoalPlanRequest,
  isInternalControl: isInternalControlPrompt(text),
  isInternalGoalExecution: isInternalGoalExecutionPrompt(text),
  isRepoExecution: isRepositoryExecutionIntent(text),
  contentHead: text.slice(0, 120),
});

console.log("[goal_debug_content]", JSON.stringify(content));

  console.log("[chat] content_head:", content.slice(0, 40));

  // ─────────────────────────────────────────────────────────────
  // Membership tier policy (server clamp)
  // ─────────────────────────────────────────────────────────────
  const requestedTier = req.headers.get("x-vestaryn-tier");

  const isAdminAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VESTARYN_ALLOW_ADMIN_TIER === "1";

  const tierPolicy = resolveTierPolicy(requestedTier, {
  isAdminAllowed,
  forcedTier: "early_access",
});

// ─────────────────────────────────────────
// Architecture mode resolver (server-side)
// ─────────────────────────────────────────
const wantsArchitecture =
  /architecture|system design|topology|multi-file|refactor plan|deep dive/i.test(content);

const allowArchitecture =
  tierPolicy.capabilities?.allowArchitectureMode === true;

const useArchitectureMode = allowArchitecture && wantsArchitecture;

const resolvedInstructions = useArchitectureMode
  ? SYSTEM_PROTECTOR_ARCH
  : SYSTEM_PROTECTOR_DEFAULT;

const resolvedMode: "default" | "arch" = useArchitectureMode ? "arch" : "default";

console.log("[policy]", {
  tier: tierPolicy.tier,
  model: tierPolicy.model,
  maxOutputTokens: tierPolicy.output.maxOutputTokens,
  maxToolRounds: tierPolicy.tools.maxToolRounds,
  mode: resolvedMode,
});

if (GOAL_PLAN_ENABLED && (planningRequest || autoGoalPlanRequest)) {
  return await handlePlanningRequest({
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    model: tierPolicy.model,
  });
}

const deterministicResponse = await tryHandleDeterministicCommands({
  supabase,
  repoId,
  userId: user.id,
  content,
});

if (deterministicResponse) {
  return deterministicResponse;
}

console.log("[verify_probe] content:", JSON.stringify(content));

let baselineVerify = {
  verifyPayload: {
    ok: true,
    skipped: true,
    reason: "mode_skipped",
    failedStep: null,
  },
} as any;

if (shouldRunBaselineVerifyForMode(rawExecutionMode.mode)) {
  baselineVerify = await runAutoVerifyForRepo({ repoId });

  console.log("[baseline_verify]", {
    ok: baselineVerify.verifyPayload.ok,
    failedStep: baselineVerify.verifyPayload.failedStep,
    mode: rawExecutionMode.mode,
  });

  if (!baselineVerify.verifyPayload.ok) {
    console.log("[baseline_verify] repo currently broken, repair needed");
  }
} else {
  console.log("[baseline_verify] skipped", {
    mode: rawExecutionMode.mode,
  });
}

console.log("[baseline_verify]", {
  ok: baselineVerify.verifyPayload.ok,
  failedStep: baselineVerify.verifyPayload.failedStep,
});

if (!baselineVerify.verifyPayload.ok) {
  console.log("[baseline_verify] repo currently broken, repair needed");
}

const directVerifyCmd = resolveDirectVerifyCommand(content);

if (directVerifyCmd) {
  return await handleDirectVerifyCommand({
    supabase,
    repoId,
    userId: user.id,
    verifyCmd: directVerifyCmd,
  });
}

// 🔒 Runner connectivity test (deterministic, bypass LLM)
const runnerPingResponse = await tryHandleRunnerPing({
  content,
  repoId,
});

if (runnerPingResponse) {
  return runnerPingResponse;
}

// 🔒 APPLY_SET SHORT-CIRCUIT (deterministic multi-apply, bypass LLM)
if (content.startsWith("__APPLY_SET__:")) {
  return await handleApplySetCommand({
    supabase,
    repoId,
    userId: user.id,
    requestId,
    content,
  });
}

// 🔒 APPLY SHORT-CIRCUIT (deterministic single apply, bypass LLM)
if (content.startsWith("__APPLY__:")) {
  return await handleApplyCommand({
    supabase,
    repoId,
    userId: user.id,
    requestId,
    content,
  });
}

// ─────────────────────────────────────────────
// Credits preflight (workspace pool, server-canonical)
// ─────────────────────────────────────────────
const runtimeSetup = await prepareChatRuntimeOrchestration({
  supabase,
  repoId,
  userId: user.id,
  content,
  text,
  tierPolicy,
  rawExecutionMode,
});

if (runtimeSetup.errorResponse) {
  return runtimeSetup.errorResponse;
}

const {
  inference,
  cleanedHistory,
  sacredBlock,
  profileBlock,
  masterBlock,
  chamberBlock,
  treeBlock,
  ledgerBlock,
  membershipBlock,
  effectiveMentionedPaths,
  executionMode,
  continuityTargetPath,
  inferredVerifyCmd,
  workspaceId,
  periodStart,
  runtimePolicy,
} = runtimeSetup;

const availableFiles = await getAvailableFiles();

let effectivePathsResolved = [...effectiveMentionedPaths];
let continuityTargetResolved = continuityTargetPath;
let executionModeResolved = executionMode;

const createMissingTarget = resolveCreateMissingTargetPath(content);

const createMissingTargetPaths = Array.isArray(createMissingTarget)
  ? createMissingTarget
  : createMissingTarget
    ? [createMissingTarget]
    : [];

const hasExistingExplicitPaths =
  effectiveMentionedPaths.length > 0 &&
  effectiveMentionedPaths.some((p) => availableFiles.includes(p));

if (
  executionModeResolved.mode !== "bootstrap" &&
  createMissingTargetPaths.length > 0 &&
  !hasExistingExplicitPaths
) {
  const filteredCreateMissingPaths = createMissingTargetPaths.filter(
    (p) => p && p !== continuityTargetResolved
  );

  if (filteredCreateMissingPaths.length > 0) {
    effectivePathsResolved = Array.from(
      new Set([...filteredCreateMissingPaths, ...effectivePathsResolved])
    );

    executionModeResolved = {
      ...executionModeResolved,
      mode: "incremental",
      confidence: "high",
      reasons: [
        ...(Array.isArray(executionModeResolved?.reasons)
          ? executionModeResolved.reasons
          : []),
        "implicit_create_missing_targets",
      ],
      mentionedPaths: effectivePathsResolved,
    };

    console.log("[create_missing_targets_resolved]", {
      createMissingTarget,
      effectivePathsResolved,
    });
  }
}

if (
  isStaticSiteStyleFollowup({
    content,
    inference,
    availableFiles,
    effectiveMentionedPaths,
  })
) {
  const styleTargets = resolveStaticSiteStyleTargets(availableFiles);

  effectivePathsResolved = [styleTargets.targetPath];
  continuityTargetResolved = styleTargets.targetPath;

  executionModeResolved = {
    ...executionMode,
    mode: "surgical",
    confidence: "high",
    reasons: [
      ...(Array.isArray(executionMode?.reasons) ? executionMode.reasons : []),
      "static_site_style_followup_auto_targeted",
    ],
    mentionedPaths: [styleTargets.targetPath, ...styleTargets.referencePaths],
  };

  console.log("[static_site_style_followup_override]", {
    targetPath: styleTargets.targetPath,
    referencePaths: styleTargets.referencePaths,
    availableFiles,
  });
}

async function tryHandleExistingMultiPageLinking(args: {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  runtimePolicy: any;
  effectiveMentionedPaths: string[];
}) {
  const explicitHtmlPaths = args.effectiveMentionedPaths
    .filter((p) => /\.html?$/i.test(p))
    .map((p) => String(p).trim())
    .filter(Boolean);

  const availableHtmlPaths = availableFiles.filter((p) => /\.html?$/i.test(p));

  const lower = String(args.content ?? "").toLowerCase();

  const isLinking =
    /\b(link|linked|linking|connect|navigation|nav|navbar|menu)\b/.test(lower);

  const isNavCleanupFollowup =
    (/\b(remove|clean up|cleanup|fix|dedupe|deduplicate|delete)\b/.test(lower) &&
      /\b(nav|navbar|navigation|menu|links?)\b/.test(lower)) ||
    (/\b(double|duplicate|duplicates|duplicated)\b/.test(lower) &&
      /\b(nav|navbar|navigation|menu|links?|pages)\b/.test(lower));

  const isShortRetryFollowup =
    /^(yes|yes please|do it|go ahead|apply it|retry|can you retry|try again|please retry|continue)$/i.test(
      String(args.content ?? "").trim()
    );

  const htmlPaths = Array.from(
    new Set(
      (isNavCleanupFollowup ? availableHtmlPaths : explicitHtmlPaths)
        .map((p) => String(p).trim())
        .filter(Boolean)
    )
  );

  if (htmlPaths.length < 2) return null;
    if (!isLinking && !isNavCleanupFollowup && !isShortRetryFollowup) return null;

    console.log("[existing_multi_page_linking.handler]", {
    repoId: args.repoId,
    htmlPaths,
    isLinking,
    isNavCleanupFollowup,
    isShortRetryFollowup,
  });

  const desiredLinks = dedupeLinks(buildDesiredLinksForPages(htmlPaths));
  const stagedProposals: any[] = [];

  for (const path of htmlPaths) {
    const fileId = await resolveFileIdByPathOrName(args.supabase, args.repoId, path);
    if (!fileId) continue;

    const file = await vault_read_text(args.supabase, args.repoId, fileId);
    const currentHtml = String(file?.content ?? "");
    if (!currentHtml.trim()) continue;

    const nextHtml = ensureNavContainsLinks(currentHtml, desiredLinks);

    if (nextHtml === currentHtml) {
      console.log("[existing_multi_page_linking.noop]", {
        repoId: args.repoId,
        path,
      });
      continue;
    }

    const proposal = await runTool(
      args.supabase,
      args.repoId,
      args.userId,
      args.content,
      "vault_propose_write",
      {
        fileId,
        content: nextHtml,
      }
    );

    if (!proposal || typeof proposal !== "object" || "error" in proposal) {
      console.log("[existing_multi_page_linking.propose_failed]", {
        repoId: args.repoId,
        path,
        proposal,
      });
      return null;
    }

    if ((proposal as any).noop === true) {
      continue;
    }

    stagedProposals.push({
      fileId: String((proposal as any).fileId),
      content: String((proposal as any).content ?? nextHtml),
      prevHash: String((proposal as any).prevHash ?? ""),
      nextHash: String((proposal as any).nextHash ?? ""),
      confirm: String((proposal as any).confirm ?? ""),
      path: (proposal as any).path ?? path,
      name: (proposal as any).name ?? path,
      mime: (proposal as any).mime ?? "text/html",
      meta: (proposal as any).meta ?? null,
    });
  }

  if (stagedProposals.length === 0) {
    return new Response(
      "[Observation]\nThe requested navigation cleanup is already satisfied.\n\n" +
        "[Assessment]\nThe referenced HTML pages already contain the required navigation links and no duplicate cleanup was needed.\n\n" +
        "[Action]\nNo staged change is needed.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const body =
    stagedProposals.length === 1
      ? `\n__PROPOSAL__:${JSON.stringify(stagedProposals[0])}\n` +
        "[Observation]\nRequired repository changes were staged.\n\n" +
        "[Assessment]\nA page navigation update was prepared.\n\n" +
        "[Action]\nA staged change is ready. Confirm to apply."
      : `\n__PROPOSAL_SET__:${JSON.stringify({ proposals: stagedProposals })}\n` +
        "[Observation]\nRequired repository changes were staged.\n\n" +
        "[Assessment]\nNavigation links were prepared across multiple existing pages.\n\n" +
        "[Action]\nA staged multi-file change is ready. Confirm to apply.";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function getEffectiveMentionedPaths() {
  return effectivePathsResolved;
}

async function getAvailableFiles() {
  const { data, error } = await supabase
    .from("repo_files")
    .select("path")
    .eq("repo_id", repoId)
    .is("deleted_at", null);

  if (error) {
    console.log("[available_files] query failed", {
      repoId,
      error: error.message,
    });
    return [];
  }

  const paths = Array.isArray(data)
    ? data.map((row: any) => String(row?.path ?? "").trim()).filter(Boolean)
    : [];

  console.log("[available_files]", {
    repoId,
    count: paths.length,
    paths,
  });

  return paths;
}

function getEffectiveSinglePath() {
  if (effectivePathsResolved.length === 1) {
    return effectivePathsResolved[0];
  }
  if (executionModeResolved?.mentionedPaths?.length === 1) {
    return executionModeResolved.mentionedPaths[0];
  }
  return extractSingleMentionedPath(content);
}

const shouldRunExistingMultiPageLinking =
  isExistingMultiPageLinkingRequest({
    content,
    availableFiles,
    effectiveMentionedPaths: effectivePathsResolved,
  });

const missingEffectivePaths = effectivePathsResolved.filter(
  (p) => !availableFiles.includes(p)
);

const shouldRunCreateMissingMode =
  !shouldRunExistingMultiPageLinking &&
  !continuityTargetResolved &&
  executionModeResolved.mode !== "bootstrap" &&
  missingEffectivePaths.length > 0 &&
  (
    executionModeResolved.mode === "incremental" ||
    executionModeResolved.mode === "surgical" ||
    executionModeResolved.mode === "rewrite"
  );

console.log("[route_path_decision]", {
  mode: executionModeResolved.mode,
  createMissing: shouldRunCreateMissingMode,
  bootstrap: shouldAllowBootstrapForMode(executionModeResolved.mode),
  effectiveMentionedPaths: effectivePathsResolved,
});


if (shouldRunCreateMissingMode) {
  console.log("[execution_mode] create-missing-file handler active", {
    confidence: executionModeResolved.confidence,
    paths: executionModeResolved.mentionedPaths,
  });

  const createMissingResponse = await handleCreateMissingFileMode({
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    model: runtimePolicy.model,
    executionMode: executionModeResolved,
  });

  if (createMissingResponse) {
    const responseText = await createMissingResponse.text();

    return await buildCreateMissingResponseOrchestration({
      supabase,
      repoId,
      userId: user.id,
      workspaceId,
      periodStart,
      requestId,
      executionMode: executionModeResolved,
      runtimePolicy,
      responseText,
      chargeCreditsForUsage,
    });
  }
}

if (executionModeResolved.mode === "surgical") {
  console.log("[execution_mode] surgical handler active", {
    confidence: executionModeResolved.confidence,
    paths: executionModeResolved.mentionedPaths,
  });

  const resolvedSurgicalPaths = resolveSurgicalPaths(content);

  const surgicalTargetPath =
    getEffectiveSinglePath() ??
    resolvedSurgicalPaths.targetPath ??
    (effectivePathsResolved.length >= 1 ? effectivePathsResolved[0] : null);

  const surgicalReferencePath =
    resolvedSurgicalPaths.referencePath ??
    (effectivePathsResolved.length >= 2 ? effectivePathsResolved[1] : null);

  const surgicalResponse = await handleSurgicalMode({
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    model: runtimePolicy.model,
    baselineVerify,
    inferredVerifyCmd,
    targetPathOverride: surgicalTargetPath,
    referencePathOverride: surgicalReferencePath,
  });

  if (surgicalResponse) {
    const responseText = await surgicalResponse.text();

    console.log("[execution_mode] surgical handler returned response", {
      repoId,
      responseLen: responseText.length,
    });

    return await buildSurgicalResponseOrchestration({
      supabase,
      repoId,
      userId: user.id,
      responseText,
    });
  }
}

const explainModeResponse = await tryHandleExplainModeOrchestration({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  executionMode: executionModeResolved,
  runtimePolicy,
  resolvedInstructions,
  membershipBlock,
  sacredBlock,
  profileBlock,
  masterBlock,
  chamberBlock,
  treeBlock,
  ledgerBlock,
  cleanedHistory,
});

if (explainModeResponse) {
  return explainModeResponse;
}

const implicitStaticPageResponse = await handleImplicitStaticPageMode({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  model: runtimePolicy.model,
  inference,
  baselineVerify,
  inferredVerifyCmd,
});

if (implicitStaticPageResponse) {
  return implicitStaticPageResponse;
}

const repoWideStyleResponse = await tryHandleRepoWideStyleOrchestration({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  executionMode: executionModeResolved,
  runtimePolicy,
});

if (repoWideStyleResponse) {
  return repoWideStyleResponse;
}

if (shouldRunExistingMultiPageLinking) {
  const multiPageLinkingResponse = await tryHandleExistingMultiPageLinking({
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    runtimePolicy,
    effectiveMentionedPaths: effectivePathsResolved,
  });

  if (multiPageLinkingResponse) {
    return multiPageLinkingResponse;
  }
}

console.log("[existing_multi_page_linking]", {
  shouldRunExistingMultiPageLinking,
  effectivePathsResolved,
  content,
});

if (shouldAllowPreStreamRepoOpsForMode(executionModeResolved.mode)) {
  const preStreamResponse = await tryHandlePreStreamRepoOps({
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    runtimePolicy,
    baselineVerify,
  });

  if (preStreamResponse) {
    return preStreamResponse;
  }
} else {
  console.log("[prestream] skipped", {
    mode: executionModeResolved.mode,
  });
}

if (shouldAllowBootstrapForMode(executionModeResolved.mode)) {
  const bootstrapResponse = await tryHandleBootstrap({
    openai,
    supabase,
    repoId,
    userId: user.id,
    content,
    inference,
    runtimePolicy,
    membershipBlock,
    sacredBlock,
    profileBlock,
    masterBlock,
    chamberBlock,
    treeBlock,
    ledgerBlock,
    cleanedHistory,
    baselineVerify,
    workspaceId,
    periodStart,
    requestId,
  });

  if (bootstrapResponse) {
    return bootstrapResponse;
  }
} else {
  console.log("[bootstrap] skipped", {
    mode: executionModeResolved.mode,
  });
}

const input = [
  { role: "system", content: membershipBlock },
  { role: "system", content: sacredBlock },
  { role: "system", content: profileBlock },

  { role: "system", content: masterBlock },
  { role: "system", content: chamberBlock },
  { role: "system", content: treeBlock },
  { role: "system", content: ledgerBlock },

  ...cleanedHistory.map((m: any) => ({
    role: m.role,
    content: m.content,
  })),

  { role: "user", content },
];

const { count: totalMsgCount, error: totalCountErr } = await supabase
  .from("repo_messages")
  .select("id", { count: "exact", head: true })
  .eq("repo_id", repoId);

if (totalCountErr) console.log("[maintenance] count failed:", totalCountErr.message);

const earlyResponse = await tryHandleEarlyOrchestration({
  openai,
  supabase,
  repoId,
  userId: user.id,
  content,
  inference,
  executionMode: executionModeResolved,
  runtimePolicy,
  requestHandledByOrchestration: false,
  isImplicitPythonScriptBootstrapRequest,
  cleanedHistory,
});

console.log("[chat_route] early orchestration result", {
  repoId,
  hasResponse: Boolean(earlyResponse),
  status: earlyResponse?.status ?? null,
});

if (earlyResponse) {
  console.log("[chat_route] returning early orchestration response", {
    repoId,
    status: earlyResponse.status,
  });
  return earlyResponse;
}

const encoder = new TextEncoder();

 const stream = new ReadableStream<Uint8Array>({
  async start(controller) {
    let lastResponseId: string | null = null;
    let pendingProposalOuts: any[] = [];
    let fullText = "";
    let rawAssistantText = "";
    let hadAnyProposalSet = false;
    let handledSplitTurn = false;
    let firstTokenTime: number | null = null;
    let creditsCharged = false;
    let requestHandledByOrchestration = false;
    let deterministicToolHandled = false;
    let pendingTools: { call_id: string; name: string; arguments: string }[] = [];
    const toolArgsByCallId = new Map<string, string>();
    const toolNameByCallId = new Map<string, string>();
  

    try {
      let resp: any;
        console.log("[responses.create pass1 start]", {
          model: runtimePolicy.model,
          inputLen: JSON.stringify(input).length,
          instructionsLen: resolvedInstructions.length,
        });
        try {
          resp = await openai.responses.create({
            model: runtimePolicy.model,
            instructions: resolvedInstructions,
            input,
            tools: TOOLS,
            tool_choice: "auto",
            stream: true,
            max_output_tokens: runtimePolicy.output.maxOutputTokens,
          });
        } catch (err: any) {
          console.log("[responses.create pass1 failed]", {
            message: err?.message,
            name: err?.name,
            status: err?.status,
            code: err?.code,
            type: err?.type,
            param: err?.param,
            cause: err?.cause,
          });
          throw err;
        }

      const pass1 = await streamResponse({
        respStream: resp,
        mode: "pass1",
        controller,
        encoder,
        onFirstToken: () => {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
            console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
          }
        },
        onResponseCreated: (id) => {
          lastResponseId = id;
        },
      });

      console.log("[tool] built after pass1", {
        count: (pass1.builtPendingTools ?? []).length,
        tools: (pass1.builtPendingTools ?? []).map((t: any) => ({
          callId: t.call_id,
          name: t.name,
          argsLen: String(t.arguments ?? "").length,
          argsHead: String(t.arguments ?? "").slice(0, 200),
        })),
      });

      pendingTools = pass1.builtPendingTools ?? [];
      rawAssistantText = pass1.buffer ?? "";

      let initialHadTools = pendingTools.length > 0 || pass1.sawToolsThisPass;

           const normalizationResult =
            await normalizePass1ToolsOrchestration({
              repoId,
              content,
              executionMode: executionModeResolved,
              pendingTools,
              effectiveMentionedPaths: effectivePathsResolved,
              inference,
              isImportRefactorIntent,
              isSplitFileIntent,
              isSourceTargetTransferIntent,
              isCreateAndModifyIntent,
            });

          pendingTools = normalizationResult.pendingTools;

      console.log(
        "[pass1] hadTools=",
        initialHadTools,
        "bufLen=",
        pass1.buffer?.length ?? 0
      );

      console.log("[tool] built after pass1", {
        count: (pass1.builtPendingTools ?? []).length,
        tools: (pass1.builtPendingTools ?? []).map((t: any) => ({
          callId: t.call_id,
          name: t.name,
          argsLen: String(t.arguments ?? "").length,
          argsHead: String(t.arguments ?? "").slice(0, 200),
        })),
      });

      const fallbackResult = await handlePass1FallbackOrchestration({
        supabase,
        repoId,
        content,
        executionMode: executionModeResolved,
        initialHadTools,
        pendingTools,
        pass1Buffer: pass1.buffer ?? "",
        controller,
        encoder,
      });

      initialHadTools = fallbackResult.initialHadTools;
      pendingTools = fallbackResult.pendingTools;
      fullText = fallbackResult.fullText;

      console.log("[stream] pass1", {
        pass1SawTools: pass1.sawToolsThisPass,
        pendingTools: pendingTools.length,
        initialHadTools,
      });

      console.log("[stream] pass1 flushed", { len: fullText.length });


      const roundsResult = await runToolExecutionRounds({
        pendingTools,
        runtimePolicy,
        tierPolicy,
        ctx: {
          openai,
          supabase,
          repoId,
          userId: user.id,
          content,
          runtimePolicy,
          tierPolicy,
          executionMode: executionModeResolved,
          continuityTargetPath: continuityTargetResolved,
          baselineVerify,
          inferredVerifyCmd,
          generateNewFileContentSafe,
          getEffectiveSinglePath,
          getEffectiveMentionedPaths,
          getAvailableFiles,
          resolveEditTarget,
          executeToolOrchestration,
          runToolExecutionLoop,
        },
        toolArgsByCallId,
        state: {
          requestHandledByOrchestration,
          pendingProposalOuts,
          handledSplitTurn,
          deterministicToolHandled,
          fullText,
        },
        io: {
          controller,
          encoder,
        },
      });

requestHandledByOrchestration = roundsResult.state.requestHandledByOrchestration;
pendingProposalOuts = roundsResult.state.pendingProposalOuts;
handledSplitTurn = roundsResult.state.handledSplitTurn;
deterministicToolHandled = roundsResult.state.deterministicToolHandled;
fullText = roundsResult.state.fullText;

const toolOutputs = roundsResult.toolOutputs;

const proposalResult = await handleProposalPreverify({
  ctx: {
    openai,
    repoId,
    content,
    runtimePolicy,
    baselineVerify,
    inferredVerifyCmd,
  },
  pendingProposalOuts,
  controller,
  encoder,
});

pendingProposalOuts = proposalResult.pendingProposalOuts;
hadAnyProposalSet = proposalResult.hadAnyProposalSet;

const finalizeResult = await finalizeAssistantTurnOrchestration({
  ctx: {
    openai,
    resolvedInstructions,
    runtimePolicy,
    t0,
  },
  state: {
    lastResponseId,
    fullText,
    rawAssistantText,
    hadAnyProposalSet,
    deterministicToolHandled,
    toolOutputs,
    firstTokenTime,
  },
  io: {
    controller,
    encoder,
  },
});

fullText = finalizeResult.fullText;
rawAssistantText = finalizeResult.rawAssistantText;
firstTokenTime = finalizeResult.firstTokenTime;

await persistAssistantTurnOrchestration({
  ctx: {
    supabase,
    repoId,
    userId: user.id,
    forceMaintenance,
    totalMsgCount,
    maintenanceTriggerMsgs: MAINTENANCE_TRIGGER_MSGS,
  },
  state: {
    rawAssistantText,
    fullText,
    hadAnyProposalSet,
  },
  io: {
    controller,
    encoder,
  },
});
  }  catch (err: any) {
      console.error("LLM error:", err?.message);
      controller.enqueue(encoder.encode("System: LLM unavailable. Check billing/quota."));
    } finally {
      console.log("Total request time (ms):", Math.round(performance.now() - t0));
      controller.close();
    }
  },
});

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}