import OpenAI from "openai";
import {
  generateNewFileContent,
  buildRequirementsTxtContentFromPython,
  mergeRequirementsTxt,
} from "@/lib/chamber/generation";
import {
  resolveCreateMissingTargetPath,
} from "@/lib/chamber/intent";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import { vault_read_text, resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { runTool } from "@/lib/vault/toolRuntime";

type CreateMissingFileDeps = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  model: string;
  executionMode?: {
    mentionedPaths?: string[];
  } | null;
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

function isPythonWorkbookRequest(content: string, path: string) {
  return (
    /\.py$/i.test(path) &&
    /\b(excel|workbook|openpyxl|spreadsheet|dashboard)\b/i.test(content)
  );
}

function textResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
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

function shouldForceCompactBootstrapHtml(content: string, requestedPath: string) {
  const t = String(content ?? "").toLowerCase();

  return (
    requestedPath.toLowerCase() === "index.html" &&
    (
      t.includes("current step: scaffold") ||
      t.includes("current step: setup") ||
      t.includes("create html structure") ||
      t.includes("bootstrap only the minimal structure needed") ||
      t.includes("goal:")
    )
  );
}

function isHtmlSiblingStyleRequest(content: string, requestedPath: string) {
  return (
    /\.html?$/i.test(requestedPath) &&
    /\b(same style|same styling|same layout|same theme|rest of the site|rest of site|match the site|match the rest|same look)\b/i.test(
      content
    )
  );
}

function normalizeRepoRelativePath(path: string) {
  return String(path ?? "").trim().replace(/^\/+/, "");
}

function extractLocalAssetRefs(html: string): string[] {
  const refs = Array.from(
    String(html ?? "").matchAll(/(?:src|href)=["']([^"']+)["']/gi)
  )
    .map((m) => String(m[1] ?? "").trim())
    .filter(Boolean)
    .filter((v) => !/^(https?:|data:|#|mailto:|tel:|\/\/)/i.test(v))
    .filter((v) => !/\.html?$/i.test(v));

  return Array.from(new Set(refs));
}

async function generateNewFileContentWithRetry(args: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  path: string;
  mime: string;
  maxOutputTokens?: number;
}) {
  const { openai, model, userRequest, path, mime, maxOutputTokens } = args;

  try {
    return await generateNewFileContent({
      openai,
      model,
      userRequest,
      path,
      mime,
      maxOutputTokens,
    });
  } catch (e: any) {
    const message = String(e?.message ?? "");

    if (!/appears truncated/i.test(message)) {
      throw e;
    }

    console.log("[create_missing] retrying after truncation", {
      requestedPath: path,
      message,
    });

    const retryRules = /\.html?$/i.test(path)
      ? [
          "Retry rules:",
          "- Return the FULL complete file.",
          "- Do not truncate.",
          "- Return a complete HTML document.",
          "- Include closing </body> and </html> tags when applicable.",
          "- Keep the file compact but complete.",
          "- Return only valid file contents.",
        ].join("\n")
      : [
          "Retry rules:",
          "- Return the FULL complete file.",
          "- Do not truncate.",
          "- Keep the file compact but complete.",
          "- Close all required structures.",
          "- Return only valid file contents.",
        ].join("\n");

    return await generateNewFileContent({
      openai,
      model,
      userRequest: `${userRequest}\n\n${retryRules}`,
      path,
      mime,
      maxOutputTokens: Math.max(maxOutputTokens ?? 10000, 10000),
    });
  }
}

async function stagePythonRequirementsProposal(args: {
  supabase: any;
  repoId: string;
  userId: string;
  userMessage: string;
  pythonPath: string;
  pythonContent: string;
}) {
  const { supabase, repoId, userId, userMessage, pythonPath, pythonContent } = args;

  if (!/\.py$/i.test(String(pythonPath ?? "").trim())) {
    return null;
  }

  const requirementsPath = "requirements.txt";
  const generatedRequirements = buildRequirementsTxtContentFromPython(pythonContent);

  const existingRequirementsId = await resolveFileIdByPathOrName(
    supabase,
    repoId,
    requirementsPath
  );

  if (!existingRequirementsId) {
    const proposal = await runTool(
      supabase,
      repoId,
      userId,
      userMessage,
      "vault_propose_create",
      {
        path: requirementsPath,
        content: generatedRequirements,
        mime: "text/plain",
      }
    );

    if (!proposal || typeof proposal !== "object" || "error" in proposal) {
      throw new Error("requirements create proposal failed");
    }

    return proposal;
  }

  const existingRequirements = await vault_read_text(
    supabase,
    repoId,
    existingRequirementsId
  );

  const mergedRequirements = mergeRequirementsTxt(
    String(existingRequirements?.content ?? ""),
    generatedRequirements
  );

  const proposal = await runTool(
    supabase,
    repoId,
    userId,
    userMessage,
    "vault_propose_write",
    {
      fileId: existingRequirementsId,
      content: mergedRequirements,
    }
  );

  if (!proposal || typeof proposal !== "object" || "error" in proposal) {
    throw new Error("requirements write proposal failed");
  }

  if ((proposal as any).noop === true) {
    return null;
  }

  return proposal;
}

export async function handleCreateMissingFileMode({
  openai,
  supabase,
  repoId,
  userId,
  content,
  model,
  executionMode,
}: CreateMissingFileDeps): Promise<Response | null> {
  const hintedPaths = Array.isArray(executionMode?.mentionedPaths)
    ? executionMode.mentionedPaths.map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];

  const resolvedCreateMissingTarget = resolveCreateMissingTargetPath(content);

  const requestedPaths =
    hintedPaths.length > 1
      ? hintedPaths
      : Array.isArray(resolvedCreateMissingTarget)
        ? resolvedCreateMissingTarget
        : hintedPaths.length === 1
          ? hintedPaths
          : resolvedCreateMissingTarget
            ? [resolvedCreateMissingTarget]
            : [];

  if (requestedPaths.length === 0) {
    console.log("[create_missing] skipped: no requested path");
    return null;
  }

  const existingChecks = await Promise.all(
    requestedPaths.map(async (path) => ({
      path,
      existingFileId: await resolveFileIdByPathOrName(supabase, repoId, path),
    }))
  );

  const missingPaths = existingChecks
    .filter((x) => !x.existingFileId)
    .map((x) => x.path);

  const existingPaths = existingChecks
    .filter((x) => x.existingFileId)
    .map((x) => x.path);

  if (missingPaths.length === 0) {
    console.log("[create_missing] skipped: all requested files already exist", {
      requestedPaths,
      existingPaths,
    });
    return null;
  }

  const stagedProposals: CanonicalProposal[] = [];

  for (const requestedPath of missingPaths) {
    const mime = inferTextMimeFromPath(requestedPath);
    let newContent = "";

    try {
      const shouldUseCanonicalHtmlPath = isHtmlSiblingStyleRequest(
        content,
        requestedPath
      );

      if (shouldUseCanonicalHtmlPath) {
        const canonicalFileId = await resolveFileIdByPathOrName(
          supabase,
          repoId,
          "index.html"
        );

        if (canonicalFileId) {
          const canonicalFile = await vault_read_text(
            supabase,
            repoId,
            canonicalFileId
          );

          const { data: repoFiles } = await supabase
            .from("repo_files")
            .select("path")
            .eq("repo_id", repoId)
            .is("deleted_at", null);

          const repoFilePaths = new Set(
            (repoFiles ?? [])
              .map((f: any) => String(f?.path ?? "").trim())
              .filter(Boolean)
          );

          console.log("[create_missing] canonical html fast-path", {
            requestedPath,
            canonicalPath: "index.html",
          });

          const shouldForceCompactHtml = shouldForceCompactBootstrapHtml(
            content,
            requestedPath
          );

          const canonicalHtml = String(canonicalFile?.content ?? "");
          const canonicalTitle = extractTitleFromHtml(canonicalHtml);
          const canonicalBrand = extractBrandTextFromHtml(canonicalHtml);
          const canonicalNav = extractNavLinksFromHtml(canonicalHtml);
          const canonicalStylesheets = extractStylesheetRefsFromHtml(canonicalHtml);

          const canonicalUserRequest =
            `${content}\n\n` +
            `Create this as a new sibling page using index.html as the canonical layout.\n` +
            `Repository-derived identity:\n` +
            `- Canonical title: ${canonicalTitle || "(none)"}\n` +
            `- Canonical brand text: ${canonicalBrand || "(none)"}\n` +
            `- Existing nav links: ${canonicalNav.map((x) => `${x.label} -> ${x.href}`).join(", ") || "(none)"}\n` +
            `- Existing stylesheet refs: ${canonicalStylesheets.join(", ") || "(none)"}\n` +
            `Hard rules:\n` +
            `- Reuse the same stylesheet reference pattern as index.html.\n` +
            `- Reuse the same brand/site identity as index.html.\n` +
            `- Preserve the existing nav items from index.html.\n` +
            `- Add the new page link only if the request implies it.\n` +
            `- Do not invent fake email addresses, fake social links, fake contact details, testimonials, or placeholder business data.\n` +
            `- Do not invent new local assets, logos, icons, SVGs, scripts, or image files.\n` +
            `- Do not use an inline <style> block if index.html uses shared CSS.\n` +
            `- Keep structure aligned with index.html.\n` +
            `- Output a complete working page for: ${requestedPath}\n` +
            (
              shouldForceCompactHtml
                ? `- Keep the page SMALL and complete.\n` +
                  `- Prefer a minimal first version over a large elaborate page.\n` +
                  `- Use only essential sections.\n` +
                  `- Do not add filler sections, fake testimonials, fake forms, or extra marketing blocks unless explicitly requested.\n`
                : ""
            ) +
            `\nCanonical file content:\n${canonicalHtml}`;

          if (isPythonWorkbookRequest(content, requestedPath)) {
            const workbookPrompt =
              `${content}\n\n` +
              `You are generating a Python script using openpyxl.\n\n` +
              `Hard rules:\n` +
              `- This must be a COMPLETE working script.\n` +
              `- Do NOT return a placeholder or minimal script.\n` +
              `- Do NOT return "Hello World".\n` +
              `- The script must CREATE an Excel workbook.\n` +
              `- The script must create sheets and headers.\n` +
              `- The script must include realistic workbook structure.\n` +
              `- The script must save the workbook to a file.\n\n` +
              `Minimum requirements:\n` +
              `- import openpyxl\n` +
              `- create Workbook()\n` +
              `- create at least 3 sheets\n` +
              `- add headers to each sheet\n` +
              `- save the file\n\n` +
              `Return ONLY the full Python file.\n`;

            newContent = await generateNewFileContentWithRetry({
              openai,
              model,
              userRequest: workbookPrompt,
              path: requestedPath,
              mime,
              maxOutputTokens: 10000,
            });
          } else {
            newContent = await generateNewFileContentWithRetry({
              openai,
              model,
              userRequest: content,
              path: requestedPath,
              mime,
            });
          }

          const localAssetRefs = extractLocalAssetRefs(newContent);

          const missingAssetRefs = localAssetRefs.filter((ref) => {
            const normalized = normalizeRepoRelativePath(ref);
            return !repoFilePaths.has(normalized);
          });

          if (missingAssetRefs.length > 0) {
            console.log("[create_missing] canonical html fast-path generated missing assets", {
              requestedPath,
              missingAssetRefs,
            });

            return textResponse(
              "[Observation]\nThe requested file could not be staged safely.\n\n" +
                `[Assessment]\nVestaryn generated ${requestedPath}, but it referenced local assets that do not exist in the repository.\n\n` +
                "[Action]\nRetry with a simpler page request, or add the required assets first."
            );
          }
        } else {
          const shouldForceCompactHtml = shouldForceCompactBootstrapHtml(
            content,
            requestedPath
          );

          const baseUserRequest =
            shouldForceCompactHtml
              ? `${content}\n\nAdditional generation rules:\n` +
                `- Create a SMALL first version of the page.\n` +
                `- Keep the HTML compact and complete.\n` +
                `- Use only essential sections for the first scaffold.\n` +
                `- Do not generate a long landing page.\n` +
                `- Do not add unnecessary cards, extra marketing sections, fake testimonials, fake forms, or filler copy.\n` +
                `- Prefer a minimal hero plus 1 to 2 short sections.\n` +
                `- Return a complete valid HTML document with closing </body> and </html> tags.\n`
              : content;

          newContent = await generateNewFileContentWithRetry({
            openai,
            model,
            userRequest: baseUserRequest,
            path: requestedPath,
            mime,
          });
        }
      } else {
        const shouldForceCompactHtml = shouldForceCompactBootstrapHtml(
          content,
          requestedPath
        );

        const baseUserRequest =
          shouldForceCompactHtml
            ? `${content}\n\nAdditional generation rules:\n` +
              `- Create a SMALL first version of the page.\n` +
              `- Keep the HTML compact and complete.\n` +
              `- Use only essential sections for the first scaffold.\n` +
              `- Do not generate a long landing page.\n` +
              `- Do not add unnecessary cards, extra marketing sections, fake testimonials, fake forms, or filler copy.\n` +
              `- Prefer a minimal hero plus 1 to 2 short sections.\n` +
              `- Return a complete valid HTML document with closing </body> and </html> tags.\n`
            : content;

        newContent = await generateNewFileContentWithRetry({
          openai,
          model,
          userRequest: baseUserRequest,
          path: requestedPath,
          mime,
        });
      }
    } catch (e: any) {
      const message = String(e?.message ?? "unknown error");

      console.log("[create_missing] generation failed", {
        requestedPath,
        message,
      });

      if (/appears truncated/i.test(message)) {
        return textResponse(
          "[Observation]\nThe requested files could not be staged safely.\n\n" +
            `[Assessment]\nVestaryn attempted to generate ${requestedPath}, but the generated file was truncated before a valid complete file could be produced.\n\n` +
            "[Action]\nRetry with a narrower request, or describe a smaller first version of the file."
        );
      }

      return textResponse(
        "[Observation]\nThe requested files could not be prepared.\n\n" +
          `[Assessment]\nVestaryn attempted to generate ${requestedPath}, but file generation failed before staging the full multi-file set.\n\n` +
          "[Action]\nRetry the request with a clearer description of the files you want created."
      );
    }

    const proposal = await runTool(
      supabase,
      repoId,
      userId,
      content,
      "vault_propose_create",
      {
        path: requestedPath,
        content: newContent,
        mime,
      }
    );

    if (!proposal || typeof proposal !== "object" || "error" in proposal) {
      console.log("[create_missing] propose failed", {
        requestedPath,
        proposal,
      });

      return textResponse(
        "[Observation]\nThe requested files could not be staged.\n\n" +
          `[Assessment]\nVestaryn generated ${requestedPath} but proposal staging failed before the full multi-file set could be prepared.\n\n` +
          "[Action]\nRetry the request or inspect vault proposal handling."
      );
    }

    if ((proposal as any).noop === true) {
      continue;
    }

    stagedProposals.push({
  fileId: String((proposal as any).fileId),
  content: String((proposal as any).content ?? newContent),
  prevHash: String((proposal as any).prevHash ?? ""),
  nextHash: String((proposal as any).nextHash ?? ""),
  confirm: String((proposal as any).confirm ?? ""),
  path: (proposal as any).path ?? requestedPath,
  name: (proposal as any).name ?? null,
  mime: (proposal as any).mime ?? mime,
  meta: (proposal as any).meta ?? null,
});

if (/\.py$/i.test(requestedPath)) {
  const requirementsProposal = await stagePythonRequirementsProposal({
    supabase,
    repoId,
    userId,
    userMessage: content,
    pythonPath: requestedPath,
    pythonContent: String(newContent ?? ""),
  });

  if (
    requirementsProposal &&
    typeof requirementsProposal === "object" &&
    !("error" in requirementsProposal)
  ) {
    stagedProposals.push({
      fileId: String((requirementsProposal as any).fileId),
      content: String((requirementsProposal as any).content ?? ""),
      prevHash: String((requirementsProposal as any).prevHash ?? ""),
      nextHash: String((requirementsProposal as any).nextHash ?? ""),
      confirm: String((requirementsProposal as any).confirm ?? ""),
      path: (requirementsProposal as any).path ?? "requirements.txt",
      name: (requirementsProposal as any).name ?? "requirements.txt",
      mime: (requirementsProposal as any).mime ?? "text/plain",
      meta: (requirementsProposal as any).meta ?? null,
    });
  }
}

} // closes: for (const requestedPath of missingPaths)

if (stagedProposals.length === 0) {
  return textResponse(
    "[Observation]\nThe requested file creation is already satisfied.\n\n" +
      "[Assessment]\nNo staged change was needed because the requested files already exist or matched the requested content.\n\n" +
      "[Action]\nContinue with the next change or request another file."
  );
}

const body =
  stagedProposals.length === 1
    ? `\n__PROPOSAL__:${JSON.stringify(stagedProposals[0])}\n` +
      "[Observation]\nRequired repository changes were staged.\n\n" +
      "[Assessment]\nA new file was prepared and staged.\n\n" +
      "[Action]\nA staged change is ready. Confirm to apply."
    : `\n__PROPOSAL_SET__:${JSON.stringify({ proposals: stagedProposals })}\n` +
      "[Observation]\nRequired repository changes were staged.\n\n" +
      "[Assessment]\nMultiple new files were prepared and staged as one aligned change set.\n\n" +
      "[Action]\nA staged multi-file change is ready. Confirm to apply.";

return textResponse(body);
}