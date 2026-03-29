import OpenAI from "openai";
import {
  extractMentionedPaths,
  isCreateAndModifyIntent,
  isCreateLinkedPageIntent,
  isLayoutAlignmentIntent,
  resolveCanonicalLayoutPath,
} from "@/lib/chamber/intent";
import { isSourceTargetTransferIntent } from "@/lib/chamber/refactorIntent";
import {
  generateRewrittenFileContent,
} from "@/lib/chamber/generation";
import { runTool } from "@/lib/vault/toolRuntime";
import { inferTextMimeFromPath } from "@/lib/vault/utils";

function extractCanonicalNavbarMarkup(html: string) {
  const header = extractHeaderRegion(html);
  if (header) return header;

  const nav = extractNavRegion(html);
  if (nav) return nav;

  return null;
}

function reorderNavLinksToMatchReference(args: {
  targetHtml: string;
  referenceHtml: string;
}) {
  const { targetHtml, referenceHtml } = args;

  const extractLinks = (html: string) => {
    const nav = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
    if (!nav) return [];

    return Array.from(nav[1].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi))
      .map((m) => String(m[1] ?? "").trim());
  };

  const refLinks = extractLinks(referenceHtml);
  if (refLinks.length === 0) return targetHtml;

  const navMatch = targetHtml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return targetHtml;

  const navInner = navMatch[1];

  const links = Array.from(navInner.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi));

  const map = new Map<string, string>();
  for (const m of links) {
    map.set(String(m[1]), m[0]);
  }

  const ordered = refLinks.map((href) => map.get(href)).filter(Boolean);

  if (ordered.length === 0) return targetHtml;

  const rebuiltNav = navMatch[0].replace(navInner, ordered.join("\n"));

  return targetHtml.replace(navMatch[0], rebuiltNav);
}

function extractHeaderRegion(html: string) {
  const m = String(html ?? "").match(/<header\b[^>]*>[\s\S]*?<\/header>/i);
  return m ? m[0] : null;
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
  let out = String(html ?? "");

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

function extractLocalAssetRefs(html: string): string[] {
  const refs = Array.from(
    String(html ?? "").matchAll(/(?:src|href)=["']([^"']+)["']/gi)
  )
    .map((m) => String(m[1] ?? "").trim())
    .filter(Boolean)
    .filter((v) => !/^(https?:|data:|#|mailto:|tel:|\/\/)/i.test(v))
    .map((v) => v.split("#")[0].split("?")[0].trim())
    .filter(Boolean)
    .filter((v) => !/\.html?$/i.test(v))
    .filter((v) => !/\.css$/i.test(v));

  return Array.from(new Set(refs));
}

function normalizeRepoRelativePath(path: string, basePath?: string | null) {
  const raw = String(path ?? "").trim();
  if (!raw) return raw;

  const cleaned = raw.replace(/^\.\/+/, "").replace(/^\/+/, "");

  if (!basePath || !cleaned) return cleaned;

  const baseDir = dirnameOf(basePath);
  if (!baseDir) return cleaned;

  return joinWithinDir(baseDir, cleaned);
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

type ListFilesOrchestrationArgs = {
  ctx: {
    openai: OpenAI;
    supabase: any;
    repoId: string;
    userId: string;
    content: string;
    runtimePolicy: any;
    executionMode: any;
    continuityTargetPath: string | null;
    getEffectiveSinglePath: () => string | null;
    getEffectiveMentionedPaths: () => string[];
    generateNewFileContentSafe: (args: {
      openai: OpenAI;
      model: string;
      userRequest: string;
      path: string;
      mime: string;
      maxOutputTokens?: number;
    }) => Promise<string>;
  };
  toolName: string;
  out: any;
  callId: string;
  state: {
    requestHandledByOrchestration: boolean;
    pendingProposalOuts: any[];
  };
};

type ListFilesOrchestrationResult = {
  handled: boolean;
  requestHandledByOrchestration: boolean;
  pendingProposalOuts: any[];
  deterministicToolHandled?: boolean;
  assistantText?: string;
  toolOutput?: {
    type: "function_call_output";
    call_id: string;
    output: string;
  };
};

export async function tryHandleListFilesOrchestration({
  ctx,
  toolName,
  out,
  callId,
  state,
}: ListFilesOrchestrationArgs) {
  if (toolName !== "vault_list_files") {
  return {
    handled: false,
    requestHandledByOrchestration: state.requestHandledByOrchestration,
    pendingProposalOuts: state.pendingProposalOuts,
  };
}

const {
  openai,
  supabase,
  repoId,
  userId,
  content,
  runtimePolicy,
  executionMode,
  continuityTargetPath,
  getEffectiveSinglePath,
  getEffectiveMentionedPaths,
  generateNewFileContentSafe,
} = ctx;

  let { requestHandledByOrchestration, pendingProposalOuts } = state;

  // ─────────────────────────────────────────────
  // Deterministic create+modify orchestration
  // Example: create components/X.tsx and use it in app/page.tsx
  // ─────────────────────────────────────────────
  if (
    !requestHandledByOrchestration &&
    executionMode?.mode === "surgical" &&
    !isCreateAndModifyIntent(content) &&
    !isSourceTargetTransferIntent(content) &&
    out &&
    typeof out === "object" &&
    !("error" in out)
  ) {
    const paths = executionMode?.mentionedPaths ?? extractMentionedPaths(content);

    const createPath = paths.find((p: string) => p.startsWith("components/"));
const modifyPath = paths.find((p: string) => p !== createPath);

    const files = Array.isArray((out as any).files) ? (out as any).files : [];
    const existingPaths = new Set(files.map((f: any) => String(f.path)));

    if (
      createPath &&
      modifyPath &&
      !existingPaths.has(createPath) &&
      existingPaths.has(modifyPath)
    ) {
      const newFileContent = await generateNewFileContentSafe({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
        path: createPath,
        mime: inferTextMimeFromPath(createPath),
      });

      const createProposal = await runTool(
        supabase,
        repoId,
        userId,
        content,
        "vault_propose_create",
        {
          path: createPath,
          content: newFileContent,
          mime: inferTextMimeFromPath(createPath),
        }
      );

      if (
        createProposal &&
        typeof createProposal === "object" &&
        !("error" in createProposal)
      ) {
        pendingProposalOuts.push(createProposal);
      }

      const existingFile = await runTool(
        supabase,
        repoId,
        userId,
        content,
        "vault_read_text",
        { path: modifyPath }
      );

const repoFilePaths = new Set(
  files.map((f: any) => String(f?.path ?? "").trim()).filter(Boolean)
);

      if (
        existingFile &&
        typeof existingFile === "object" &&
        !("error" in existingFile)
      ) {
        const rewritten = await generateRewrittenFileContent({
          openai,
          model: runtimePolicy.model,
          userRequest: content,
          path: String((existingFile as any).path ?? modifyPath),
          mime: String((existingFile as any).mime ?? "text/plain"),
          currentContent: String((existingFile as any).content ?? ""),
        });


        
        const writeProposal = await runTool(
          supabase,
          repoId,
          userId,
          content,
          "vault_propose_write",
          {
            fileId: (existingFile as any).id,
            content: rewritten,
          }
        );

        if (
          writeProposal &&
          typeof writeProposal === "object" &&
          !("error" in writeProposal)
        ) {
          pendingProposalOuts.push(writeProposal);
        }
      }

      return {
        handled: true as const,
        requestHandledByOrchestration,
        pendingProposalOuts,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }
  }

  // ─────────────────────────────────────────────
  // Deterministic generic repo edit orchestration
  // Example: "make it look more premium"
  // ─────────────────────────────────────────────
  const isEditExecutionMode =
    executionMode.mode === "incremental" ||
    executionMode.mode === "rewrite" ||
    executionMode.mode === "surgical";

  if (
    !requestHandledByOrchestration &&
    isEditExecutionMode &&
    !isCreateAndModifyIntent(content) &&
    !isSourceTargetTransferIntent(content) &&
    out &&
    typeof out === "object" &&
    !("error" in out)
  ) {
    const files = Array.isArray((out as any).files) ? (out as any).files : [];

    const requestedPath = getEffectiveSinglePath();
    const effectiveRequestedPaths = getEffectiveMentionedPaths();

    const explicitStyleChange =
      /\b(background|topbar|top bar|header color|gold|black|contrast|theme|styles?\.css|color palette|restyle|same style|same theme)\b/i.test(
        content
      );

    // shared navbar extraction
    const isSharedNavbarRequest =
      /\b(navbar|nav|header)\b/i.test(content) &&
      /\b(new file|shared file|separate file|extract|component|partial|include|import)\b/i.test(content) &&
      /\b(all created files|all pages|all html files|created files)\b/i.test(content);

    if (isSharedNavbarRequest) {
      console.log("[shared_navbar_orchestration] triggered", {
        repoId,
        requestedPaths: effectiveRequestedPaths,
        content,
      });

      const htmlFiles = files.filter((f: any) =>
        String(f?.path ?? "").toLowerCase().endsWith(".html")
      );

      const candidateTargets = htmlFiles.filter((f: any) => {
        const path = String(f?.path ?? "").trim();
        return (
          path === "index.html" ||
          path === "about.html" ||
          path === "contact.html" ||
          path === "faq.html" ||
          path === "pricing.html"
        );
      });

      const targetPaths = candidateTargets.map((f: any) => String(f.path));
      const navbarPath = "partials/navbar.html";

      if (targetPaths.length >= 2) {
        let canonicalFile: any | null = null;

        const canonicalPath =
          resolveCanonicalLayoutPath(targetPaths) ||
          targetPaths.find((p: string) => /(^|\/)index\.html$/i.test(p)) ||
          targetPaths[0] ||
          null;

        if (canonicalPath) {
          const readCanonical = await runTool(
            supabase,
            repoId,
            userId,
            content,
            "vault_read_text",
            { path: canonicalPath }
          );

          if (
            readCanonical &&
            typeof readCanonical === "object" &&
            !("error" in readCanonical)
          ) {
            canonicalFile = readCanonical;
          }
        }

        if (canonicalFile) {
          const canonicalHtml = String((canonicalFile as any).content ?? "");
          const navbarContent = extractCanonicalNavbarMarkup(canonicalHtml);

          if (!navbarContent) {
            console.log("[shared_navbar_orchestration] skipped: no canonical nav/header found", {
              canonicalPath,
            });
          } else {

          const navbarProposal = await runTool(
            supabase,
            repoId,
            userId,
            content,
            "vault_propose_create",
            {
              path: navbarPath,
              content: navbarContent,
              mime: "text/html",
            }
          );

          if (
            navbarProposal &&
            typeof navbarProposal === "object" &&
            !("error" in navbarProposal) &&
            !(navbarProposal as any).noop
          ) {
            pendingProposalOuts.push(navbarProposal);
          }

          for (const path of targetPaths) {
            if (path === canonicalPath) {
                continue;
              }
            const existingFile = await runTool(
              supabase,
              repoId,
              userId,
              content,
              "vault_read_text",
              { path }
            );

            if (
              !existingFile ||
              typeof existingFile !== "object" ||
              "error" in existingFile
            ) {
              continue;
            }

            const rewritten = await generateRewrittenFileContent({
              openai,
              model: runtimePolicy.model,
              userRequest:
                `${content}\n\n` +
                `Rewrite this file so its existing navbar/header is replaced with a shared include/reference to ${navbarPath}.\n` +
                `Hard rules:\n` +
                `- Return the FULL complete file.\n` +
                `- Preserve the rest of the page content exactly as much as possible.\n` +
                `- Do NOT redesign the navbar.\n` +
                `- Do NOT simplify the navbar into a generic template.\n` +
                `- Do NOT add, remove, or reorder navigation links unless required to reference ${navbarPath}.\n` +
                `- Reuse the canonical navbar structure taken from ${canonicalPath}.\n` +
                `- Do not invent new assets.\n` +
                `- Keep the change focused only on shared navbar extraction.\n`,
              path: String((existingFile as any).path ?? path),
              mime: String((existingFile as any).mime ?? "text/html"),
              currentContent: String((existingFile as any).content ?? ""),
              maxOutputTokens: 10000,
            });

            const proposal = await runTool(
              supabase,
              repoId,
              userId,
              content,
              "vault_propose_write",
              {
                fileId: (existingFile as any).id,
                content: rewritten,
              }
            );

            if (
              proposal &&
              typeof proposal === "object" &&
              !("error" in proposal) &&
              !(proposal as any).noop
            ) {
              pendingProposalOuts.push(proposal);
            }
          }

          if (pendingProposalOuts.length > 0) {
            requestHandledByOrchestration = true;

            return {
              handled: true as const,
              requestHandledByOrchestration,
              pendingProposalOuts,
              toolOutput: {
                type: "function_call_output",
                call_id: callId,
                output: JSON.stringify({
                  ...(out as any),
                  handled: "shared_navbar_extraction",
                  navbarPath,
                  targetPaths,
                  canonicalPath,
                }),
              },
            };
          }
        }
      }
    }

    const editableFiles = files.filter((f: any) => {
      const path = String(f?.path ?? "").toLowerCase();
      if (!path) return false;
      if (path.startsWith("memory/")) return false;

      return (
        path.endsWith(".html") ||
        path.endsWith(".css") ||
        path.endsWith(".ts") ||
        path.endsWith(".tsx") ||
        path.endsWith(".js") ||
        path.endsWith(".jsx") ||
        path.endsWith(".txt")
      );
    });

         // multi-file rewrite/create
    if (effectiveRequestedPaths.length >= 2) {
      console.log("[multi_file_orchestration] triggered", {
        repoId,
        requestedPaths: effectiveRequestedPaths,
      });

      const resolvedRequestedPaths = resolveMentionedRepoPaths(
        effectiveRequestedPaths,
        files
      );

      const canonicalPath =
        resolveCanonicalLayoutPath(resolvedRequestedPaths) ||
        resolvedRequestedPaths.find((p) => /(^|\/)index\.html$/i.test(p)) ||
        resolvedRequestedPaths[0] ||
        null;

      const canonicalDir = canonicalPath ? dirnameOf(canonicalPath) : "";

      const htmlTargetPaths = resolvedRequestedPaths
        .filter((p) => /\.html?$/i.test(p) && p !== canonicalPath)
        .map((p) => (p.includes("/") ? p : joinWithinDir(canonicalDir, p)));

      const cssTargetPaths = explicitStyleChange
        ? resolvedRequestedPaths
            .filter((p) => /\.css$/i.test(p))
            .map((p) => (p.includes("/") ? p : joinWithinDir(canonicalDir, p)))
        : [];

      const isVisualRequest =
        /\b(look|design|style|theme|color|background|topbar|top bar|nav|navbar|gold|black|white|dark|light|grey|gray|blue|red|green|burgundy|yellow|silver|premium|modern|cleaner|nicer|prettier|polish|visual)\b/i.test(
          content
        );

      const multiHtmlRequest =
        effectiveRequestedPaths.length >= 2 &&
        effectiveRequestedPaths.every((p) => /\.html?$/i.test(String(p)));

      const cssFile =
        files.find((f: any) =>
          String(f?.path ?? "").toLowerCase().endsWith(".css")
        ) ?? null;

      const existingFilePaths = new Set(
        files.map((f: any) => String(f?.path ?? "").trim()).filter(Boolean)
      );

      const requestedHtmlPaths = resolvedRequestedPaths.filter((p) =>
        /\.html?$/i.test(p)
      );

      const missingRequestedHtmlPaths = requestedHtmlPaths.filter(
        (p) => !existingFilePaths.has(p)
      );

const isSharedLayoutOnlyRequest =
  /\b(navbar|nav|header|topbar|footer)\b/i.test(content) &&
  (
    /\b(add|update|include|fix|align|match|consistent)\b/i.test(content)
  );

const isMultiFileHtml =
  resolvedRequestedPaths.length >= 2 &&
  resolvedRequestedPaths.every((p) => /\.html?$/i.test(String(p)));

const shouldUseSharedLayoutRewrite =
  isSharedLayoutOnlyRequest && isMultiFileHtml;

      const isAlignmentRequest =
        isLayoutAlignmentIntent(content) ||
        /\b(visually align|align with|match(?:es|ing)? the style of|same style as|same look as|consistent with)\b/i.test(
          content
        ) ||
        (
          /\b(align|aligned|alignment|match|matching|consistent|consistency|same)\b/i.test(
            content
          ) &&
          /\b(style|styling|theme|layout|design|look|feel|visual)\b/i.test(
            content
          )
        ) ||
        /\bbetween\s+[a-z0-9._/-]+(?:\s*&\s*|\s+and\s+)[a-z0-9._/-]+\b/i.test(
          content
        );

      const isSourceTargetAlignmentRequest =
        resolvedRequestedPaths.length === 2 &&
        resolvedRequestedPaths.every((p) => /\.html?$/i.test(String(p))) &&
        isAlignmentRequest &&
        !!canonicalPath;

if (shouldUseSharedLayoutRewrite) {
  console.log("[shared_layout_rewrite] triggered", {
    repoId,
    requestedPaths: effectiveRequestedPaths,
  });

  const proposals: any[] = [];

  for (const path of resolvedRequestedPaths) {
    const file = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_read_text",
      { path }
    );

    if (!file || typeof file !== "object" || "error" in file) continue;

    const html = String((file as any).content ?? "");

    // 🔹 extract region
    const match =
      html.match(/<header[\s\S]*?<\/header>/i) ||
      html.match(/<nav[\s\S]*?<\/nav>/i);

    if (!match) {
      console.log("[shared_layout_rewrite] no header/nav found", { path });
      continue;
    }

    const originalRegion = match[0];

    // 🔹 rewrite ONLY region
    const rewrittenRegion = await generateRewrittenFileContent({
      openai,
      model: runtimePolicy.model,
      userRequest:
        `${content}\n\n` +
        `You are rewriting ONLY a shared layout region.\n` +
        `Rules:\n` +
        `- Return ONLY the updated region (header/nav)\n` +
        `- Do NOT generate a full HTML document\n` +
        `- Do NOT add new sections\n` +
        `- Do NOT change page identity\n`,
      path: path,
      mime: "text/html",
      currentContent: originalRegion,
    });

    // 🔹 splice back
    let finalHtml = html.replace(originalRegion, rewrittenRegion);

      if (canonicalPath) {
        const canonicalFile = await runTool(
          supabase,
          repoId,
          userId,
          content,
          "vault_read_text",
          { path: canonicalPath }
        );

        if (canonicalFile && typeof canonicalFile === "object" && !("error" in canonicalFile)) {
          finalHtml = reorderNavLinksToMatchReference({
            targetHtml: finalHtml,
            referenceHtml: String((canonicalFile as any).content ?? ""),
          });
        }
      }

      
    const proposal = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_propose_write",
      {
        fileId: (file as any).id,
        content: finalHtml,
      }
    );

    if (proposal && typeof proposal === "object" && !("error" in proposal)) {
      proposals.push(proposal);
    }
  }

  if (proposals.length > 0) {
    requestHandledByOrchestration = true;

    return {
      handled: true as const,
      requestHandledByOrchestration,
      pendingProposalOuts: [...pendingProposalOuts, ...proposals],
      toolOutput: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          ...(out as any),
          handled: "shared_layout_region_rewrite",
          requestedPaths: effectiveRequestedPaths,
        }),
      },
    };
  }
}

      // source-target alignment override
      // example: "rewrite about.html to visually align with index.html"
      if (isSourceTargetAlignmentRequest) {
        const targetPath =
          resolvedRequestedPaths.find((p) => p !== canonicalPath) ?? null;

        console.log("[multi_file_orchestration] source-target alignment", {
          repoId,
          requestedPaths: effectiveRequestedPaths,
          resolvedRequestedPaths,
          canonicalPath,
          targetPath,
        });

        if (targetPath && canonicalPath) {
          const targetFile = await runTool(
            supabase,
            repoId,
            userId,
            content,
            "vault_read_text",
            { path: targetPath }
          );

          const canonicalFile = await runTool(
            supabase,
            repoId,
            userId,
            content,
            "vault_read_text",
            { path: canonicalPath }
          );

          if (
            targetFile &&
            typeof targetFile === "object" &&
            !("error" in targetFile) &&
            canonicalFile &&
            typeof canonicalFile === "object" &&
            !("error" in canonicalFile)
          ) {
            const resolvedPath = String((targetFile as any).path ?? targetPath);
            const resolvedMime = String(
              (targetFile as any).mime ?? "text/html"
            );
            const currentContent = String(
              (targetFile as any).content ?? ""
            );

            const repoFilePaths = new Set(
              files.map((f: any) => String(f?.path ?? "").trim()).filter(Boolean)
            );

            const validateRewrittenHtmlRefs = (args: {
              rewritten: string;
              resolvedPath: string;
            }) => {
              const { rewritten, resolvedPath } = args;

              const localHtmlRefs = extractLocalHtmlRefs(rewritten);
              const localAssetRefs = extractLocalAssetRefs(rewritten);

              const missingHtmlRefs = localHtmlRefs.filter((ref) => {
                const normalized = normalizeRepoRelativePath(ref, resolvedPath);
                return normalized !== resolvedPath && !repoFilePaths.has(normalized);
              });

              const missingAssetRefs = localAssetRefs.filter((ref) => {
                const normalized = normalizeRepoRelativePath(ref, resolvedPath);
                return !repoFilePaths.has(normalized);
              });

              if (missingHtmlRefs.length > 0) {
                return {
                  ok: false as const,
                  reason: "missing_html_refs",
                  missingHtmlRefs,
                  missingAssetRefs,
                };
              }

              if (missingAssetRefs.length > 0) {
                return {
                  ok: false as const,
                  reason: "missing_asset_refs",
                  missingHtmlRefs,
                  missingAssetRefs,
                };
              }

              return {
                ok: true as const,
                missingHtmlRefs: [] as string[],
                missingAssetRefs: [] as string[],
              };
            };

            let rewritten: string;

            const alignmentPrompt =
              `${content}\n\n` +
              `Alignment rules:\n` +
              `- Rewrite ONLY ${resolvedPath}.\n` +
              `- Use ${canonicalPath} as a VISUAL reference only, not as a full structural template.\n` +
              `- Preserve the existing subject, purpose, and page identity of ${resolvedPath}.\n` +
              `- Align colors, spacing, typography, layout rhythm, surfaces, and overall presentation with ${canonicalPath}.\n` +
              `- Do NOT copy navigation, footer, or page sections blindly from ${canonicalPath}.\n` +
              `- Do NOT add links to any page unless that exact file already exists in the repository.\n` +
              `- If ${canonicalPath} contains links to pages that do not exist, omit them or replace them with non-link text.\n` +
              `- Do NOT invent new pages, assets, scripts, or footer/legal links.\n` +
              `- Keep local file references limited to files that already exist in the repo.\n` +
              `- Return the FULL complete file.\n` +
              `\nExisting repo files:\n${Array.from(repoFilePaths).join("\n")}\n` +
              `\nCanonical file content:\n${String((canonicalFile as any)?.content ?? "")}`;

            try {
              rewritten = await generateRewrittenFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest: alignmentPrompt,
                path: resolvedPath,
                mime: resolvedMime,
                currentContent,
              });
            } catch (e: any) {
              const msg = String(e?.message ?? "");

              if (!/appears truncated/i.test(msg)) {
                throw e;
              }

              console.log(
                "[multi_file_orchestration] source-target retry after truncation",
                {
                  repoId,
                  targetPath: resolvedPath,
                  canonicalPath,
                  reason: msg,
                }
              );

              rewritten = await generateRewrittenFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest:
                  `${alignmentPrompt}\n\nRetry rules:\n` +
                  `- Return the FULL complete file.\n` +
                  `- Do not truncate.\n` +
                  `- Rewrite ONLY ${resolvedPath}.\n` +
                  `- Keep changes focused on visual/layout alignment.\n`,
                path: resolvedPath,
                mime: resolvedMime,
                currentContent,
                maxOutputTokens: 10000,
              });
            }

            let validation = validateRewrittenHtmlRefs({
              rewritten,
              resolvedPath,
            });

            if (!validation.ok) {
              console.log(
                "[multi_file_orchestration] source-target validation failed, retrying stricter",
                {
                  path: resolvedPath,
                  reason: validation.reason,
                  missingHtmlRefs: validation.missingHtmlRefs,
                  missingAssetRefs: validation.missingAssetRefs,
                }
              );

              if (validation.ok) {
                console.log("[multi_file_orchestration] source-target alignment success", {
                  path: resolvedPath,
                  retried: false,
                });
              }

              const stricterRetryPrompt =
                `${alignmentPrompt}\n\n` +
                `Critical retry rules:\n` +
                `- Remove any navigation item whose target file does not exist in the repo.\n` +
                `- Remove any footer link whose target file does not exist in the repo.\n` +
                `- Do NOT add projects.html, blog.html, contact.html, privacy.html, or terms.html unless those files already exist.\n` +
                `- Prefer fewer links over invalid links.\n` +
                `- If necessary, simplify the nav/footer to only valid existing destinations.\n` +
                `- Preserve the Pokémon identity and content purpose of ${resolvedPath}.\n` +
                `- Rewrite ONLY ${resolvedPath}.\n`;

              rewritten = await generateRewrittenFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest: stricterRetryPrompt,
                path: resolvedPath,
                mime: resolvedMime,
                currentContent,
                maxOutputTokens: 10000,
              });

              validation = validateRewrittenHtmlRefs({
                rewritten,
                resolvedPath,
              });

              if (!validation.ok) {
                console.log(
                  "[multi_file_orchestration] source-target validation failed after retry",
                  {
                    path: resolvedPath,
                    missingHtmlRefs: validation.missingHtmlRefs,
                    missingAssetRefs: validation.missingAssetRefs,
                  }
                );

                console.log("[multi_file_orchestration] source-target alignment success", {
                  path: resolvedPath,
                  retried: true,
                });

                return {
                  handled: true as const,
                  requestHandledByOrchestration,
                  pendingProposalOuts,
                  deterministicToolHandled: true,
                  assistantText:
                    "[Observation]\nThe target page could not be safely aligned.\n\n" +
                    "[Assessment]\nThe generated rewrite for the target page introduced references to local files that do not exist in the repository, so the change was not staged.\n\n" +
                    "[Action]\nRefine the request or create the missing linked pages first.",
                  toolOutput: {
                    type: "function_call_output",
                    call_id: callId,
                    output: JSON.stringify({
                      ...(out as any),
                      handled: "source_target_alignment_failed_validation",
                      canonicalPath,
                      targetPath: resolvedPath,
                      missingHtmlRefs: validation.missingHtmlRefs,
                      missingAssetRefs: validation.missingAssetRefs,
                    }),
                  },
                };
              }
            }

if (canonicalFile && /\.html?$/i.test(resolvedPath)) {
  rewritten = reorderNavLinksToMatchReference({
    targetHtml: rewritten,
    referenceHtml: String((canonicalFile as any).content ?? ""),
  });
}

            const proposal = await runTool(
              supabase,
              repoId,
              userId,
              content,
              "vault_propose_write",
              {
                fileId: (targetFile as any).id,
                content: rewritten,
              }
            );

console.log("[multi_file_orchestration] source-target alignment success", {
  repoId,
  canonicalPath,
  targetPath,
  proposedFileId: (proposal as any)?.fileId ?? null,
});

            if (
              proposal &&
              typeof proposal === "object" &&
              !("error" in proposal)
            ) {
              if (!(proposal as any).noop) {
                pendingProposalOuts.push(proposal);
                requestHandledByOrchestration = true;
              }

              return {
                handled: true as const,
                requestHandledByOrchestration,
                pendingProposalOuts,
                toolOutput: {
                  type: "function_call_output",
                  call_id: callId,
                  output: JSON.stringify({
                    ...(out as any),
                    handled: "source_target_alignment",
                    canonicalPath,
                    targetPath: resolvedPath,
                    requestedPaths: effectiveRequestedPaths,
                  }),
                },
              };
            }
          }
        }
      }

      // CSS-first override
      if (
        explicitStyleChange &&
        isVisualRequest &&
        multiHtmlRequest &&
        cssFile &&
        missingRequestedHtmlPaths.length === 0
      ) {
        console.log("[multi_file_orchestration] rerouted to CSS", {
          repoId,
          requestedPaths: effectiveRequestedPaths,
          cssTarget: cssFile.path,
        });

        const existingFile = await runTool(
          supabase,
          repoId,
          userId,
          content,
          "vault_read_text",
          { path: cssFile.path }
        );

        if (
          existingFile &&
          typeof existingFile === "object" &&
          !("error" in existingFile)
        ) {
          const resolvedPath = String(
            (existingFile as any).path ?? cssFile.path
          );
          const resolvedMime = String(
            (existingFile as any).mime ?? "text/css"
          );
          const currentContent = String(
            (existingFile as any).content ?? ""
          );

          let rewritten: string;

          try {
            rewritten = await generateRewrittenFileContent({
              openai,
              model: runtimePolicy.model,
              userRequest:
                `${content}\n\n` +
                `Hard rules:\n` +
                `- Return the FULL complete file.\n` +
                `- Keep changes focused on shared styling only.\n` +
                `- Do not invent new local assets, pages, scripts, or selectors for files that do not exist.\n` +
                `- Prefer reusable styles over inline duplication.\n`,
              path: resolvedPath,
              mime: resolvedMime,
              currentContent,
            });
          } catch (e: any) {
            const msg = String(e?.message ?? "");

            if (!/appears truncated/i.test(msg)) {
              throw e;
            }

            rewritten = await generateRewrittenFileContent({
              openai,
              model: runtimePolicy.model,
              userRequest:
                `${content}\n\nRetry rules:\n` +
                `- Return the FULL complete file.\n` +
                `- Do not truncate.\n` +
                `- Keep changes focused.\n` +
                `- Prefer reusable styles (no inline duplication).\n`,
              path: resolvedPath,
              mime: resolvedMime,
              currentContent,
              maxOutputTokens: 10000,
            });
          }


          
          const proposal = await runTool(
            supabase,
            repoId,
            userId,
            content,
            "vault_propose_write",
            {
              fileId: (existingFile as any).id,
              content: rewritten,
            }
          );

          if (
            proposal &&
            typeof proposal === "object" &&
            !("error" in proposal)
          ) {
            pendingProposalOuts.push(proposal);
            requestHandledByOrchestration = true;
          }
        }

        return {
          handled: true as const,
          requestHandledByOrchestration,
          pendingProposalOuts,
          toolOutput: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              ...(out as any),
              handled: "css_reroute",
              requestedPaths: effectiveRequestedPaths,
              target: cssFile.path,
            }),
          },
        };
      }

      const editableTargets = resolvedRequestedPaths.filter((p) => {
        const lower = String(p ?? "").toLowerCase();
        if (!lower) return false;
        if (lower.startsWith("memory/")) return false;

        return (
          lower.endsWith(".html") ||
          lower.endsWith(".css") ||
          lower.endsWith(".ts") ||
          lower.endsWith(".tsx") ||
          lower.endsWith(".js") ||
          lower.endsWith(".jsx") ||
          lower.endsWith(".txt")
        );
      });

      if (editableTargets.length >= 1) {
        const resolvedTargets: any[] = [];
        const missingTargets: string[] = [];

        for (const path of editableTargets) {
          const existingFile = await runTool(
            supabase,
            repoId,
            userId,
            content,
            "vault_read_text",
            { path }
          );

          if (
            existingFile &&
            typeof existingFile === "object" &&
            !("error" in existingFile)
          ) {
            resolvedTargets.push(existingFile);
          } else {
            missingTargets.push(path);

            console.log("[multi_file_orchestration] read skipped", {
              path,
              error:
                existingFile &&
                typeof existingFile === "object" &&
                "error" in existingFile
                  ? (existingFile as any).error
                  : null,
            });
          }
        }

        let canonicalFile: any | null =
          resolvedTargets.find(
            (file: any) => String((file as any)?.path ?? "") === canonicalPath
          ) ?? null;

        if (!canonicalFile && canonicalPath) {
          const readCanonical = await runTool(
            supabase,
            repoId,
            userId,
            content,
            "vault_read_text",
            { path: canonicalPath }
          );

          if (
            readCanonical &&
            typeof readCanonical === "object" &&
            !("error" in readCanonical)
          ) {
            canonicalFile = readCanonical;
          }
        }

        const rewriteTargets = isAlignmentRequest
          ? resolvedTargets.filter(
              (file) => String((file as any).path ?? "") !== canonicalPath
            )
          : resolvedTargets;

        console.log("[multi_file_orchestration] target split", {
          requestedPaths: effectiveRequestedPaths,
          canonicalPath,
          isAlignmentRequest,
          resolvedPaths: resolvedTargets.map((f: any) =>
            String(f?.path ?? "")
          ),
          rewritePaths: rewriteTargets.map((f: any) =>
            String(f?.path ?? "")
          ),
          missingTargets,
          htmlTargetPaths,
          cssTargetPaths,
        });

        const repoFilePaths = new Set(
          files.map((f: any) => String(f?.path ?? "").trim()).filter(Boolean)
        );

        const multiFileFailures: Array<{ path: string; reason: string }> = [];
        const multiFileNoopPaths: string[] = [];

        const validateRewrittenHtmlRefs = (args: {
          rewritten: string;
          resolvedPath: string;
        }) => {
          const { rewritten, resolvedPath } = args;

          if (!/\.html?$/i.test(resolvedPath)) {
            return { ok: true as const };
          }

          const localHtmlRefs = extractLocalHtmlRefs(rewritten);
          const localAssetRefs = extractLocalAssetRefs(rewritten);

          const missingHtmlRefs = localHtmlRefs.filter((ref) => {
            const normalized = normalizeRepoRelativePath(ref, resolvedPath);
            return normalized !== resolvedPath && !repoFilePaths.has(normalized);
          });

          const missingAssetRefs = localAssetRefs.filter((ref) => {
            const normalized = normalizeRepoRelativePath(ref, resolvedPath);
            return !repoFilePaths.has(normalized);
          });

          if (missingHtmlRefs.length > 0) {
            return {
              ok: false as const,
              reason: "missing_html_refs",
              missingHtmlRefs,
              missingAssetRefs,
            };
          }

          if (missingAssetRefs.length > 0) {
            return {
              ok: false as const,
              reason: "missing_asset_refs",
              missingHtmlRefs,
              missingAssetRefs,
            };
          }

          return {
            ok: true as const,
            missingHtmlRefs: [] as string[],
            missingAssetRefs: [] as string[],
          };
        };

        for (const file of rewriteTargets) {
          const resolvedPath = String((file as any).path ?? "");
          const resolvedMime = String((file as any).mime ?? "text/plain");
          const currentContent = String((file as any).content ?? "");
          const allowedFilesList = Array.from(repoFilePaths).join("\n");
          try {
            let rewritten: string;

            const alignmentPrompt =
              `${content}\n\n` +
              `Alignment rules:\n` +
              `- Preserve the existing purpose, subject, and core content of ${resolvedPath}.\n` +
              `- Use ${canonicalPath} as the visual/layout reference only.\n` +
              `- Align styling, spacing, layout rhythm, class structure, and presentation.\n` +
              `- Do not change the site into a different product, business, or brand.\n` +
              `- Do not invent new pages, nav items, footer links, assets, scripts, or sections not already present in the repo.\n` +
              `- Do not reference any local file unless it already exists in the repo.\n` +
              `- Preserve the overall purpose of ${resolvedPath}; do not replace its identity with a generic template.\n` +
              `- Return the FULL complete file.\n` +
              `\nCanonical file content:\n${String((canonicalFile as any)?.content ?? "")}`;

            const rewritePrompt = isAlignmentRequest ? alignmentPrompt : (
              `${content}\n\n` +
              `Hard rules:\n` +
              `- Return the FULL complete file.\n` +
              `- Keep changes focused on the requested alignment/update.\n` +
              `- Do not invent new local assets, logos, SVGs, scripts, or image files.\n` +
              `- Do not reference any local file unless it already exists in the repo.\n` +
              `- Preserve the rest of the page unless the request explicitly requires structural changes.\n` +
              `Allowed local file refs in this repo:\n${allowedFilesList}\n\n` +
              `Critical rule:\n` +
              `- Any local href/src not in the allowed file list is forbidden and must be omitted.\n\n`+
              `Canonical file content:\n${String((canonicalFile as any)?.content ?? "")}`
                          );

            try {
              rewritten = await generateRewrittenFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest: rewritePrompt,
                path: resolvedPath,
                mime: resolvedMime,
                currentContent,
              });
            } catch (e: any) {
              const msg = String(e?.message ?? "");

              if (!/appears truncated/i.test(msg)) {
                throw e;
              }

              console.log(
                "[multi_file_orchestration] retrying after truncation",
                {
                  repoId,
                  path: resolvedPath,
                  reason: msg,
                }
              );

              rewritten = await generateRewrittenFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest:
                  `${rewritePrompt}\n\nRetry rules:\n` +
                  `- Return the FULL complete file.\n` +
                  `- Do not truncate.\n` +
                  `- Keep changes focused.\n` +
                  `- Prefer structure over bloated inline styling.\n`,
                path: resolvedPath,
                mime: resolvedMime,
                currentContent,
                maxOutputTokens: 10000,
              });
            }

            let validation = validateRewrittenHtmlRefs({
              rewritten,
              resolvedPath,
            });

            if (!validation.ok) {
              console.log("[multi_file_orchestration] rewritten html failed validation, retrying stricter", {
                path: resolvedPath,
                reason: validation.reason,
                missingHtmlRefs: validation.missingHtmlRefs,
                missingAssetRefs: validation.missingAssetRefs,
              });

              const stricterRetryPrompt =
                `${rewritePrompt}\n\n` +
                `Critical retry rules:\n` +
                `- Do NOT invent new nav items.\n` +
                `- Do NOT add links to projects.html, blog.html, contact.html, privacy.html, terms.html, or any other page unless that file already exists in the repo.\n` +
                `- Only keep or use local links that already exist in the repo.\n` +
                `- Do NOT introduce new footer links.\n` +
                `- Preserve the existing page purpose and content identity.\n` +
                `- Align layout/styling only.\n`;

              rewritten = await generateRewrittenFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest: stricterRetryPrompt,
                path: resolvedPath,
                mime: resolvedMime,
                currentContent,
                maxOutputTokens: 10000,
              });

              validation = validateRewrittenHtmlRefs({
                rewritten,
                resolvedPath,
              });

              if (!validation.ok) {
                console.log("[multi_file_orchestration] rewritten html referenced missing local refs after retry", {
                  path: resolvedPath,
                  missingHtmlRefs: validation.missingHtmlRefs,
                  missingAssetRefs: validation.missingAssetRefs,
                });

                throw new Error(
                  validation.reason === "missing_html_refs"
                    ? `rewritten_html_references_missing_pages: ${validation.missingHtmlRefs.join(", ")}`
                    : `rewritten_html_references_missing_assets: ${validation.missingAssetRefs.join(", ")}`
                );
              }
            }

            if (canonicalFile && /\.html?$/i.test(resolvedPath)) {
              rewritten = reorderNavLinksToMatchReference({
                targetHtml: rewritten,
                referenceHtml: String((canonicalFile as any).content ?? ""),
              });
            }

            const proposal = await runTool(
              supabase,
              repoId,
              userId,
              content,
              "vault_propose_write",
              {
                fileId: (file as any).id,
                content: rewritten,
              }
            );

            if (
              proposal &&
              typeof proposal === "object" &&
              !("error" in proposal)
            ) {
              if ((proposal as any).noop) {
                multiFileNoopPaths.push(resolvedPath);
              } else {
                pendingProposalOuts.push(proposal);
              }
            } else {
              multiFileFailures.push({
                path: resolvedPath,
                reason:
                  proposal &&
                  typeof proposal === "object" &&
                  "error" in proposal
                    ? String((proposal as any).error)
                    : "proposal_invalid",
              });
            }
          } catch (e: any) {
            multiFileFailures.push({
              path: resolvedPath,
              reason: String(e?.message ?? "unknown error"),
            });
          }
        }

        if (canonicalFile && missingTargets.length > 0) {
          for (const missingPath of missingTargets) {
            if (!/\.html?$/i.test(missingPath)) {
              multiFileFailures.push({
                path: missingPath,
                reason:
                  "missing target is not html and cannot be created by layout-alignment flow",
              });
              continue;
            }

            try {
              const newContent = await generateNewFileContentSafe({
                openai,
                model: runtimePolicy.model,
                userRequest:
                  `${content}\n\n` +
                  `Create this as a new sibling page using ${canonicalPath} as the canonical layout.\n` +
                  `Hard rules:\n` +
                  `- Reuse the same stylesheet reference pattern as ${canonicalPath}.\n` +
                  `- Match the header structure, nav structure, main layout rhythm, and footer structure of ${canonicalPath}.\n` +
                  `- Preserve the same site identity, naming, and tone as ${canonicalPath}.\n` +
                  `- Do not invent new local assets, logos, icons, SVGs, scripts, helper files, privacy pages, terms pages, or image files.\n` +
                  `- Do not reference files that do not already exist, except the target page being created.\n` +
                  `- Do not introduce new JavaScript unless it already exists in ${canonicalPath}.\n` +
                  `- Keep class naming aligned with ${canonicalPath} instead of inventing a parallel structure.\n` +
                  `- Output a complete working page for: ${missingPath}\n\n` +
                  `Canonical file content:\n${String((canonicalFile as any)?.content ?? "")}`,
                path: missingPath,
                mime: inferTextMimeFromPath(missingPath),
                maxOutputTokens: 10000,
              });

              const proposal = await runTool(
                supabase,
                repoId,
                userId,
                content,
                "vault_propose_create",
                {
                  path: missingPath,
                  content: newContent,
                  mime: inferTextMimeFromPath(missingPath),
                }
              );

              const localAssetRefs = extractLocalAssetRefs(newContent);
              const localHtmlRefs = extractLocalHtmlRefs(newContent);

              const missingHtmlRefs = localHtmlRefs.filter((ref) => {
                const normalized = normalizeRepoRelativePath(ref, missingPath);
                return normalized !== missingPath && !repoFilePaths.has(normalized);
              });

              if (missingHtmlRefs.length > 0) {
                console.log(
                  "[multi_file_orchestration] generated page referenced missing local html pages",
                  {
                    missingPath,
                    missingHtmlRefs,
                  }
                );

                throw new Error(
                  `generated_html_references_missing_pages: ${missingHtmlRefs.join(", ")}`
                );
              }

              const missingAssetRefs = localAssetRefs.filter((ref) => {
                const normalized = normalizeRepoRelativePath(ref, missingPath);
                return !repoFilePaths.has(normalized);
              });

              if (missingAssetRefs.length > 0) {
                console.log(
                  "[multi_file_orchestration] generated page referenced missing local assets",
                  {
                    missingPath,
                    missingAssetRefs,
                  }
                );

                throw new Error(
                  `generated_html_references_missing_assets: ${missingAssetRefs.join(", ")}`
                );
              }

              if (
                proposal &&
                typeof proposal === "object" &&
                !("error" in proposal) &&
                !(proposal as any).noop
              ) {
                pendingProposalOuts.push(proposal);
              } else {
                multiFileFailures.push({
                  path: missingPath,
                  reason:
                    proposal &&
                    typeof proposal === "object" &&
                    "error" in proposal
                      ? String((proposal as any).error)
                      : "create_proposal_noop_or_invalid",
                });
              }
            } catch (e: any) {
              multiFileFailures.push({
                path: missingPath,
                reason: String(e?.message ?? "unknown error"),
              });
            }
          }
        }

        if (
          pendingProposalOuts.length === 0 &&
          multiFileFailures.length === 0 &&
          multiFileNoopPaths.length > 0
        ) {
          return {
            handled: true as const,
            requestHandledByOrchestration,
            pendingProposalOuts,
            deterministicToolHandled: true,
            assistantText:
              "[Observation]\nThe requested repository state is already satisfied.\n\n" +
              "[Assessment]\nThe target files already match the requested layout/style alignment, so no staged change was needed.\n\n" +
              "[Action]\nContinue with the next change or request a more specific adjustment.",
            toolOutput: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({
                ...(out as any),
                handled: "multi_file_noop",
                noopPaths: multiFileNoopPaths,
                requestedPaths: effectiveRequestedPaths,
                canonicalPath,
              }),
            },
          };
        }

        if (pendingProposalOuts.length > 0) {
          requestHandledByOrchestration = true;

          return {
            handled: true as const,
            requestHandledByOrchestration,
            pendingProposalOuts,
            toolOutput: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({
                ...(out as any),
                handled: "multi_file_rewrite_or_create",
                requestedPaths: effectiveRequestedPaths,
                resolvedRequestedPaths,
                canonicalPath,
                resolvedPaths: resolvedTargets.map((f: any) =>
                  String(f?.path ?? "")
                ),
                createdPaths: missingTargets,
                failedPaths: multiFileFailures,
              }),
            },
          };
        }

        console.log("[multi_file_orchestration] insufficient resolved targets", {
          requestedPaths: effectiveRequestedPaths,
          resolvedRequestedPaths,
          editableTargets,
          resolvedCount: resolvedTargets.length,
          missingTargets,
          canonicalPath,
        });
      }

      console.log(
        "[generic_edit_orchestration] skipped because request mentions multiple paths",
        {
          requestedPaths: effectiveRequestedPaths,
        }
      );

      return {
        handled: true as const,
        requestHandledByOrchestration,
        pendingProposalOuts,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }

     // generic fallback single-file edit
    let targetFile: any | null = null;

    const cssFile =
      editableFiles.find((f: any) =>
        String(f.path ?? "").toLowerCase().endsWith(".css")
      ) ?? null;

    const htmlFile =
      editableFiles.find((f: any) =>
        String(f.path ?? "").toLowerCase().endsWith(".html")
      ) ?? null;

    const tsxFile =
      editableFiles.find((f: any) =>
        String(f.path ?? "").toLowerCase().endsWith(".tsx")
      ) ?? null;

    const tsFile =
      editableFiles.find((f: any) =>
        String(f.path ?? "").toLowerCase().endsWith(".ts")
      ) ?? null;

    const styleLikeRequest =
      /\b(style|styling|theme|visual|look|feel|design|background|color|colors|palette|contrast|glow|spark|sparkly|electric|lightning|thunder|hero|navbar|nav bar|nav|header|footer|button|hover|shadow|gradient|lines)\b/i.test(
        content
      );

    const structureLikeRequest =
      /\b(section|sections|content|text|heading|title|paragraph|copy|remove|add section|move|reorder|layout block|card|cards)\b/i.test(
        content
      );

    // 1. explicit continuity target wins first
    if (continuityTargetPath) {
      targetFile =
        editableFiles.find(
          (f: any) => String(f.path) === continuityTargetPath
        ) ?? null;
    }

    // 2. explicit requested path wins next
    if (!targetFile && requestedPath) {
      targetFile =
        editableFiles.find((f: any) => String(f.path) === requestedPath) ?? null;
    }

    // 3. style/UI requests prefer CSS
    if (!targetFile && styleLikeRequest) {
      targetFile =
        cssFile ?? htmlFile ?? tsxFile ?? tsFile ?? editableFiles[0] ?? null;
    }

    // 4. structure/content requests prefer HTML
    if (!targetFile && structureLikeRequest) {
      targetFile =
        htmlFile ?? tsxFile ?? tsFile ?? cssFile ?? editableFiles[0] ?? null;
    }

    // 5. final fallback
    if (!targetFile) {
      targetFile =
        htmlFile ?? tsxFile ?? tsFile ?? cssFile ?? editableFiles[0] ?? null;
    }

    if (targetFile?.path) {
      console.log("[generic_edit_orchestration] target selected", {
        repoId,
        requestedPath: requestedPath ?? null,
        continuityTargetPath: continuityTargetPath ?? null,
        selectedPath: targetFile.path,
        styleLikeRequest,
        structureLikeRequest,
      });

      const existingFile = await runTool(
        supabase,
        repoId,
        userId,
        content,
        "vault_read_text",
        { path: targetFile.path }
      );

      if (
        existingFile &&
        typeof existingFile === "object" &&
        !("error" in existingFile)
      ) {
        const resolvedPath = String(
          (existingFile as any).path ?? targetFile.path
        );
        const resolvedMime = String(
          (existingFile as any).mime ?? targetFile.mime ?? "text/plain"
        );
        const currentContent = String((existingFile as any).content ?? "");

        const isHtmlTarget = /\.html?$/i.test(resolvedPath);

        const wantsVisualAlignment =
          /\b(match|align|same style|same styling|same theme|layout|styling|design|look|feel|colors?|theme|visual|consistent)\b/i.test(
            content
          );

        let canonicalReferenceBlock = "";

        if (
          isHtmlTarget &&
          resolvedPath !== "index.html" &&
          wantsVisualAlignment
        ) {
          const canonicalFile = await runTool(
            supabase,
            repoId,
            userId,
            content,
            "vault_read_text",
            { path: "index.html" }
          );

          if (
            canonicalFile &&
            typeof canonicalFile === "object" &&
            !("error" in canonicalFile)
          ) {
            canonicalReferenceBlock =
              `\n\nCanonical reference file: index.html\n` +
              `Use this file as the visual/layout reference.\n` +
              `Match its page structure rhythm, section spacing, styling language, color mood, and overall site identity.\n` +
              `If the user says this page does not match the site, prioritize visual/layout alignment over copy-only edits.\n` +
              `Do not copy unrelated content literally.\n` +
              `Do not invent new local files, assets, or links.\n` +
              `Do not add local links unless that file already exists in the repo.\n` +
              `Preserve the purpose of the target page while making it feel like the same site.\n\n` +
              `Canonical file content:\n${String((canonicalFile as any).content ?? "")}`;

            console.log("[generic_edit_orchestration] canonical reference attached", {
              repoId,
              targetPath: resolvedPath,
              canonicalPath: "index.html",
            });
          }
        }

        let rewritten: string;

        try {
          rewritten = await generateRewrittenFileContent({
            openai,
            model: runtimePolicy.model,
            userRequest:
              `${content}\n\n` +
              `Hard rules:\n` +
              `- Return the FULL complete file.\n` +
              `- Keep changes focused on the requested alignment/update.\n` +
              `- Do not invent new local assets, logos, SVGs, scripts, or image files.\n` +
              `- Do not reference any local file unless it already exists in the repo.\n` +
              `- Preserve the rest of the page unless the request explicitly requires structural changes.\n` +
              canonicalReferenceBlock,
            path: resolvedPath,
            mime: resolvedMime,
            currentContent,
          });
        } catch (e: any) {
          const msg = String(e?.message ?? "");

          if (!/appears truncated/i.test(msg)) {
            throw e;
          }

          console.log("[generic_edit_orchestration] retrying after truncation", {
            repoId,
            selectedPath: resolvedPath,
            reason: msg,
          });

          rewritten = await generateRewrittenFileContent({
            openai,
            model: runtimePolicy.model,
            userRequest:
              `${content}\n\nRetry rules:\n` +
              `- Return the FULL complete file.\n` +
              `- Do not truncate.\n` +
              `- Keep changes focused.\n` +
              `- Prefer structure over bloated inline styling.\n` +
              canonicalReferenceBlock,
            path: resolvedPath,
            mime: resolvedMime,
            currentContent,
            maxOutputTokens: 10000,
          });
        }

if (canonicalReferenceBlock && /\.html?$/i.test(resolvedPath)) {
  const canonicalFile = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_read_text",
    { path: "index.html" }
  );

  if (canonicalFile && typeof canonicalFile === "object" && !("error" in canonicalFile)) {
    rewritten = reorderNavLinksToMatchReference({
      targetHtml: rewritten,
      referenceHtml: String((canonicalFile as any).content ?? ""),
    });
  }
}

        const writeProposal = await runTool(
          supabase,
          repoId,
          userId,
          content,
          "vault_propose_write",
          {
            fileId: (existingFile as any).id,
            content: rewritten,
          }
        );


        
        if (
          writeProposal &&
          typeof writeProposal === "object" &&
          !("error" in writeProposal)
        ) {
          pendingProposalOuts.push(writeProposal);
          requestHandledByOrchestration = true;
        }
      }
    }
  }

  // ─────────────────────────────────────────────
  // Linked page creation orchestration
  // ─────────────────────────────────────────────
  if (
    !requestHandledByOrchestration &&
    isCreateLinkedPageIntent(content) &&
    out &&
    typeof out === "object" &&
    !("error" in out)
  ) {
    const files = Array.isArray((out as any).files) ? (out as any).files : [];
    const existingPaths = new Set(files.map((f: any) => String(f.path)));

    const createPathMatch = content.match(/\b([a-zA-Z0-9_-]+\.html)\b/i);
    const createPath = createPathMatch ? createPathMatch[1] : "portfolio.html";
    const modifyPath = "index.html";

    if (
      createPath &&
      !existingPaths.has(createPath) &&
      existingPaths.has(modifyPath)
    ) {
      return {
        handled: true as const,
        requestHandledByOrchestration,
        pendingProposalOuts,
        toolOutput: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(out),
        },
      };
    }
  }

  return {
    handled: false as const,
    requestHandledByOrchestration,
    pendingProposalOuts,
  };
}
}
