import OpenAI from "openai";
import { runTool } from "@/lib/vault/toolRuntime";
import { resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { generateNewFileContent, generateRewrittenFileContent } from "@/lib/chamber/generation";
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

  if (/\babout page\b/.test(t) || /\babout\b/.test(t)) {
    createPaths.push("about.html");
  }

  if (/\bcontact page\b/.test(t) || /\bcontact\b/.test(t)) {
    createPaths.push("contact.html");
  }

  return {
    createPaths,
    shouldLinkFromIndex: /\b(connect|connecting|link|navigation|nav)\b/.test(t),
  };
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

    return new Response(
      "[Observation]\nThe requested page already exists.\n\n" +
        `[Assessment]\n${createPath} is already present in the repository.\n\n` +
        "[Action]\nRequest a modification to that page or create a different one.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
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

    try {
      newPageContent = await generateNewFileContent({
        ...baseArgs,
        userRequest: content,
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
          `${content}\n\nRetry rules:\n` +
          `- Return the FULL complete file.\n` +
          `- Do not truncate.\n` +
          `- Keep the page compact but complete.\n` +
          `- Match the existing website style and navigation.\n` +
          `- Return only valid file contents.\n`,
        maxOutputTokens: 5200,
      });
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