import OpenAI from "openai";
import { runTool } from "@/lib/vault/toolRuntime";
import { resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { extractMentionedPaths, isLayoutAlignmentIntent } from "@/lib/chamber/intent";
import { generateNewFileContent } from "@/lib/chamber/generation";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import { shouldPreVerifyProposalSet } from "@/lib/chamber/verify";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";

type Deps = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  model: string;
  inference: any;
  baselineVerify: any;
  inferredVerifyCmd: any;
};

function labelFromPath(path: string) {
  const base = String(path ?? "")
    .split("/")
    .pop()
    ?.replace(/\.html?$/i, "") ?? "page";

  return base.charAt(0).toUpperCase() + base.slice(1);
}

function extractTitleFromHtml(html: string) {
  const m = String(html ?? "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? String(m[1]).replace(/\s+/g, " ").trim() : "";
}

function extractBrandTextFromHtml(html: string) {
  const brandMatch =
    String(html ?? "").match(/<div\b[^>]*class=["'][^"']*brand[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    String(html ?? "").match(/<a\b[^>]*class=["'][^"']*brand[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);

  return brandMatch ? String(brandMatch[1]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
}

function extractNavLinksFromHtml(html: string) {
  const navMatch = String(html ?? "").match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return [];

  return Array.from(navMatch[1].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))
    .map((m) => ({
      href: String(m[1] ?? "").trim(),
      label: String(m[2] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    }))
    .filter((x) => x.href && x.label);
}

function extractStylesheetRefsFromHtml(html: string) {
  return Array.from(
    String(html ?? "").matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)
  )
    .map((m) => String(m[1] ?? "").trim())
    .filter(Boolean);
}

function injectNavLinksIntoHtml(
  current: string,
  links: Array<{ href: string; label: string }>
) {
  let out = String(current ?? "");

  if (!out.trim()) return out;

  const navMatch = out.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i);
  if (navMatch) {
    let nav = navMatch[0];

    for (const link of links) {
      const hrefRe = new RegExp(`href=["']${link.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
      if (hrefRe.test(nav)) continue;

      nav = nav.replace(
        /<\/nav>/i,
        `  <a href="${link.href}">${link.label}</a>\n</nav>`
      );
    }

    return out.replace(navMatch[0], nav);
  }

  const headerMatch = out.match(/<header\b[^>]*>/i);
  if (headerMatch) {
    const navHtml =
      `\n  <nav>\n` +
      `    <a href="index.html">Home</a>\n` +
      links.map((l) => `    <a href="${l.href}">${l.label}</a>\n`).join("") +
      `  </nav>\n`;

    return out.replace(headerMatch[0], `${headerMatch[0]}${navHtml}`);
  }

  const bodyMatch = out.match(/<body\b[^>]*>/i);
  if (bodyMatch) {
    const navHtml =
      `\n  <nav>\n` +
      `    <a href="index.html">Home</a>\n` +
      links.map((l) => `    <a href="${l.href}">${l.label}</a>\n`).join("") +
      `  </nav>\n`;

    return out.replace(bodyMatch[0], `${bodyMatch[0]}${navHtml}`);
  }

  return out;
}

function resolveImplicitStaticPageRequest(content: string) {
  const t = String(content ?? "").toLowerCase();
  const createPaths: string[] = [];

  const hasExplicitCreateVerb = /\b(create|make|add|build|generate)\b/.test(t);
  const hasExplicitPageWord = /\b(page|html)\b/.test(t);
  const hasExplicitHtmlFile = /\b[a-z0-9_-]+\.html\b/.test(t);

  const mentionsAboutPage =
    /\babout page\b/.test(t) ||
    /\babout\.html\b/.test(t) ||
    /\b(create|make|add|build|generate)\b.*\babout\b.*\b(page|html)\b/.test(t);

  const mentionsContactPage =
    /\bcontact page\b/.test(t) ||
    /\bcontact\.html\b/.test(t) ||
    /\b(create|make|add|build|generate)\b.*\bcontact\b.*\b(page|html)\b/.test(t);

  const sectionOnlyLanguage =
    /\b(about|contact|services|highlights|hero)\s+(section|block|area|part)\b/.test(t) ||
    /\b(section|block|area|part|component|card)\b/.test(t);

  const explicitPageIntent =
    (hasExplicitCreateVerb && hasExplicitPageWord) || hasExplicitHtmlFile;

  if (!explicitPageIntent || sectionOnlyLanguage) {
    return {
      createPaths: [],
      shouldLinkFromIndex: false,
    };
  }

  if (mentionsAboutPage) {
    createPaths.push("about.html");
  }

  if (mentionsContactPage) {
    createPaths.push("contact.html");
  }

  return {
    createPaths,
    shouldLinkFromIndex:
      /\b(connect|connecting|link|links|linked|navigation|nav)\b/.test(t),
  };
}

function buildCanonicalStaticPageRequest(args: {
  originalRequest: string;
  createPath: string;
  canonicalHtml: string;
  canonicalTitle?: string;
  canonicalBrand?: string;
  canonicalNav?: Array<{ href: string; label: string }>;
  canonicalStylesheets?: string[];
}) {
  const {
    originalRequest,
    createPath,
    canonicalHtml,
    canonicalTitle,
    canonicalBrand,
    canonicalNav = [],
    canonicalStylesheets = [],
  } = args;

  return (
    `${originalRequest}\n\n` +
    `Create this as a new sibling page using index.html as the canonical layout.\n` +
    `Repository-derived identity:\n` +
    `- Canonical title: ${canonicalTitle || "(none)"}\n` +
    `- Canonical brand text: ${canonicalBrand || "(none)"}\n` +
    `- Existing nav links: ${
      canonicalNav.length
        ? canonicalNav.map((x) => `${x.label} -> ${x.href}`).join(", ")
        : "(none)"
    }\n` +
    `- Existing stylesheet refs: ${
      canonicalStylesheets.length ? canonicalStylesheets.join(", ") : "(none)"
    }\n` +
    `Hard rules:\n` +
    `- Reuse the same stylesheet reference pattern as index.html.\n` +
    `- Reuse the same site identity, naming, and tone as index.html.\n` +
    `- Preserve the existing nav items from index.html unless the user explicitly asked to change them.\n` +
    `- Do not invent fake email addresses, fake social links, fake contact details, testimonials, or placeholder business data.\n` +
    `- Do not invent new local assets, logos, icons, SVGs, scripts, or image files.\n` +
    `- Do not use an inline <style> block if index.html uses shared CSS.\n` +
    `- Keep the structure aligned with index.html.\n` +
    `- Output a complete working page for: ${createPath}\n\n` +
    `Canonical file content:\n${canonicalHtml}`
  );
}

export async function handleImplicitStaticPageMode({
  openai,
  supabase,
  repoId,
  userId,
  content,
  model,
  inference,
  baselineVerify,
  inferredVerifyCmd,
}: Deps): Promise<Response | null> {
  // Only for static sites
  if (!inference || inference.projectType !== "static_site") {
    return null;
  }

  const t = String(content ?? "").toLowerCase();
  const mentionedPaths = extractMentionedPaths(content);

  const explicitPageIntent =
    /\b(create|make|add|build|generate)\b.*\b(page|html)\b/.test(t) ||
    /\bnew\s+(page|html)\b/.test(t) ||
    /\b[a-z0-9_-]+\.html\b/.test(t);

  const sectionOnlyLanguage =
    /\b(about|contact|services|highlights|hero)\s+(section|block|area|part)\b/.test(t) ||
    /\b(section|block|area|part|component|card)\b/.test(t);

  // explicit multi-file or explicit html edit requests should never hit implicit page creation
  if (mentionedPaths.length >= 2) {
    return null;
  }

  if (
    mentionedPaths.length === 1 &&
    /\.html?$/i.test(String(mentionedPaths[0] ?? ""))
  ) {
    return null;
  }

  // alignment / edit requests should not be hijacked by implicit page creation
  if (
    isLayoutAlignmentIntent(content) ||
    /\b(fix|align|match|same styling|same style|same theme)\b/i.test(content)
  ) {
    return null;
  }

  // Do not treat "about section" or "highlights section" as page creation
  if (!explicitPageIntent || sectionOnlyLanguage) {
    return null;
  }

  const { createPaths, shouldLinkFromIndex } =
    resolveImplicitStaticPageRequest(content);

  if (createPaths.length === 0) return null;
    const createPath = createPaths[0];

  console.log("[implicit_static_page] detected", {
    repoId,
    createPath,
    shouldLinkFromIndex,
  });

  // Check if file already exists
  const existingId = await resolveFileIdByPathOrName(
    supabase,
    repoId,
    createPath
  );

   if (existingId) {
    console.log("[implicit_static_page] skipped: file already exists", {
      createPath,
    });

    return null;
  }

  const proposals: any[] = [];

   // ─────────────────────────────────────────────
  // 1. Create new page(s)
  // ─────────────────────────────────────────────
  for (const createPath of createPaths) {
    const existingId = await resolveFileIdByPathOrName(
      supabase,
      repoId,
      createPath
    );

    if (existingId) {
      console.log("[implicit_static_page] skipped existing page", {
        createPath,
      });
      continue;
    }

    let newPageContent: string;

    const baseArgs = {
      openai,
      model,
      path: createPath,
      mime: inferTextMimeFromPath(createPath),
    };

const canonicalIndex = await runTool(
  supabase,
  repoId,
  userId,
  content,
  "vault_read_text",
  { path: "index.html" }
);

const canonicalHtml =
  canonicalIndex &&
  typeof canonicalIndex === "object" &&
  !("error" in canonicalIndex)
    ? String((canonicalIndex as any).content ?? "")
    : "";

const canonicalTitle = canonicalHtml
  ? extractTitleFromHtml(canonicalHtml)
  : "";

const canonicalBrand = canonicalHtml
  ? extractBrandTextFromHtml(canonicalHtml)
  : "";

const canonicalNav = canonicalHtml
  ? extractNavLinksFromHtml(canonicalHtml)
  : [];

const canonicalStylesheets = canonicalHtml
  ? extractStylesheetRefsFromHtml(canonicalHtml)
  : [];

const effectiveUserRequest = canonicalHtml
  ? buildCanonicalStaticPageRequest({
      originalRequest: content,
      createPath,
      canonicalHtml,
      canonicalTitle,
      canonicalBrand,
      canonicalNav,
      canonicalStylesheets,
    })
  : content;

console.log("[implicit_static_page canonical identity]", {
  createPath,
  canonicalTitle,
  canonicalBrand,
  canonicalNav,
  canonicalStylesheets,
});

    try {
      newPageContent = await generateNewFileContent({
        ...baseArgs,
        userRequest: effectiveUserRequest,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? "");

      if (!/appears truncated/i.test(msg)) {
        throw e;
      }

      console.log("[implicit_static_page] retrying after truncation", {
        repoId,
        createPath,
        reason: msg,
      });

      newPageContent = await generateNewFileContent({
        ...baseArgs,
        userRequest:
          `${effectiveUserRequest}\n\nRetry rules:\n` +
          `- Return the FULL complete file.\n` +
          `- Do not truncate.\n` +
          `- Keep the page compact but complete.\n` +
          `- Match the existing website style and navigation.\n` +
          `- Return only valid file contents.\n`,
        maxOutputTokens: 5200,
      });
    }

if (canonicalStylesheets.length > 0) {
  const missingStylesheet = canonicalStylesheets.some(
    (href) => !newPageContent.includes(href)
  );

  if (missingStylesheet) {
    console.log("[implicit_static_page retry missing stylesheet]", {
      createPath,
      canonicalStylesheets,
    });

    newPageContent = await generateNewFileContent({
      ...baseArgs,
      userRequest:
        `${effectiveUserRequest}\n\n` +
        `Critical retry rules:\n` +
        `- Reuse the exact stylesheet link pattern from index.html.\n` +
        `- The page must include these stylesheet refs: ${canonicalStylesheets.join(", ")}\n` +
        `- Do not omit the shared stylesheet.\n` +
        `- Return the FULL complete file.\n`,
      maxOutputTokens: 5200,
    });
  }
}

    const createProposal = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_propose_create",
      {
        path: createPath,
        content: newPageContent,
        mime: inferTextMimeFromPath(createPath),
      }
    );

    if (
      createProposal &&
      typeof createProposal === "object" &&
      !("error" in createProposal)
    ) {
      proposals.push(createProposal);
    }
  }
    // ─────────────────────────────────────────────
  // 2. Optionally link from index.html
  // ─────────────────────────────────────────────
  if (shouldLinkFromIndex) {
    const indexFile = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_read_text",
      { path: "index.html" }
    );

    if (
      indexFile &&
      typeof indexFile === "object" &&
      !("error" in indexFile)
    ) {
           const links = createPaths.map((p) => ({
        href: p.split("/").pop() ?? p,
        label: labelFromPath(p),
      }));

      const rewritten = injectNavLinksIntoHtml(
        String((indexFile as any).content ?? ""),
        links
      );

      if (
        rewritten.trim() &&
        rewritten !== String((indexFile as any).content ?? "")
      ) {
        const writeProposal = await runTool(
          supabase,
          repoId,
          userId,
          content,
          "vault_propose_write",
          {
            fileId: (indexFile as any).id,
            content: rewritten,
          }
        );

        if (
          writeProposal &&
          typeof writeProposal === "object" &&
          !("error" in writeProposal)
        ) {
          proposals.push(writeProposal);
        }
      }
    }
  }

  if (proposals.length === 0) {
    return null;
  }

  let finalProposals = proposals;
  let preverifyPayload: any = null;

  // ─────────────────────────────────────────────
  // 3. Preverify
  // ─────────────────────────────────────────────
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

      if (result.repaired && result.finalProposals?.length) {
        finalProposals = result.finalProposals;
      }
    } catch (e: any) {
      console.log("[implicit_static_page] preverify failed", e?.message);

      preverifyPayload = {
        ok: false,
        error: e?.message ?? "Preverify failed",
        failedStep: "preverify_boot",
      };
    }
  }

  // ─────────────────────────────────────────────
  // 4. Emit response
  // ─────────────────────────────────────────────
  const proposalBlock =
    finalProposals.length === 1
      ? `\n__PROPOSAL__:${JSON.stringify(finalProposals[0])}\n`
      : `\n__PROPOSAL_SET__:${JSON.stringify({
          proposals: finalProposals,
        })}\n`;

  const body =
    proposalBlock +
    (preverifyPayload
      ? `\n__PREVERIFY__:${JSON.stringify(preverifyPayload)}\n`
      : "") +
    "[Observation]\nA new page was prepared for the website.\n\n" +
    `[Assessment]\nVestaryn created ${createPaths.join(", ")}` +
    (shouldLinkFromIndex ? " and connected it to the main page." : ".") +
    "\n\n" +
    "[Action]\nA staged change is ready. Confirm to apply.";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}