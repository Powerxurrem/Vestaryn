// lib/chamber/bootstrapRuntime.ts
import OpenAI from "openai";
import { isInternalGoalExecutionPrompt } from "@/lib/chamber/intent";
import {
  resolveFileIdByPathOrName,
  vault_read_text,
  vault_propose_create,
  vault_propose_write,
} from "@/lib/vault/tools";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import {
  generateNewFileContent,
  generateRewrittenFileContent,
    generateWebsiteBootstrapBrief,
} from "@/lib/chamber/generation";
import { shouldPreVerifyProposalSet } from "@/lib/chamber/verify";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";
import {
  renderWebsiteIndexHtml,
  renderWebsiteAboutHtml,
  renderWebsiteStylesCss,
} from "@/lib/chamber/bootstrapWebsiteTemplate";
import { chargeCreditsForUsage } from "@/lib/chamber/creditsRuntime";
function resolveBootstrapPathsFromUserRequest(text: string) {
  const s = String(text ?? "").toLowerCase();

  if (s.includes("portfolio") && s.includes("about")) {
    return ["index.html", "about.html", "styles.css"];
  }

  if (s.includes("portfolio")) {
    return ["index.html", "about.html", "styles.css"];
  }

  if (s.includes("landing page")) {
    return ["index.html", "styles.css"];
  }

  if (s.includes("home page") && s.includes("about page")) {
    return ["index.html", "about.html", "styles.css"];
  }

  if (
  s.includes("website") ||
  s.includes("site") ||
  s.includes("guide") ||
  s.includes("travel") ||
  s.includes("portfolio")
) {
  return ["index.html", "about.html", "styles.css"];
}

  return [];
}

function shouldUseDeterministicWebsiteBootstrap(args: {
  content: string;
  inference: { needsBootstrap?: boolean; projectType?: string | null };
}) {
  const text = String(args.content ?? "");

  const looksLikeWebsiteRequest =
    /\b(site|website|landing page|portfolio|home page)\b/i.test(text);

  const targetPaths = resolveBootstrapPathsFromUserRequest(text);

  return looksLikeWebsiteRequest && targetPaths.length > 0;
}

function extractRelevantFilesFromGoalExecutionPrompt(text: string) {
  const raw = String(text ?? "");
  const match = raw.match(/Relevant files:\s*(.+)/i);
  if (!match) return [];

  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.toLowerCase() !== "none specified");
}

function isGeneratedFileTruncationError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /appears truncated/i.test(msg);
}

function buildBootstrapRetryPrompt(args: {
  originalRequest: string;
  targetPath: string;
  }) {  
  const path = String(args.targetPath ?? "").toLowerCase();

  if (path.endsWith(".html")) {
    return [
      args.originalRequest,
      "",
      "Retry rules:",
      "- Keep the HTML compact but complete.",
      "- Return a FULL valid HTML document.",
      "- Do not truncate.",
      "- Do not leave sections half-finished.",
      "- Keep styling mostly in styles.css instead of a huge inline <style> block.",
      "- Do not include large scripts unless truly necessary.",
      "- Prefer a smaller complete page over a larger fancy page.",
    ].join("\n");
  }

  if (path.endsWith(".css")) {
    return [
      args.originalRequest,
      "",
      "Retry rules:",
      "- Return FULL valid CSS.",
      "- Keep it compact and complete.",
      "- Do not truncate.",
      "- Prefer fewer polished rules over a very large stylesheet.",
    ].join("\n");
  }

  return [
    args.originalRequest,
    "",
    "Retry rules:",
    "- Return the FULL complete file.",
    "- Keep it compact and valid.",
    "- Do not truncate.",
  ].join("\n");
}

function buildBootstrapHtmlPrompt(original: string) {
  return `
Create the initial HTML scaffold for this website.

User request:
${original}

Rules:
- Output only index.html
- Keep it compact
- No large inline <style> block
- Link to styles.css
- No large scripts
- Include only:
  - header
  - hero section
  - one content section
  - footer
- Return FULL valid HTML only
`.trim();
}

function buildBootstrapCssPrompt(original: string) {
  return `
Create the stylesheet for this website.

User request:
${original}

Rules:
- Output only styles.css
- Style the basic layout (header, hero, content, footer)
- Keep it visually clean but compact
- No excessive or repeated rules
- Return FULL valid CSS only
`.trim();
}

function assertBootstrapFileSafe(path: string, content: string) {
  const text = String(content ?? "").trim();
  const lowerPath = String(path ?? "").toLowerCase();

  if (!text) {
    throw new Error(`Bootstrap file is empty: ${path}`);
  }

  if (text.includes("```")) {
    throw new Error(`Bootstrap file leaked markdown fences: ${path}`);
  }

  if (lowerPath.endsWith(".html") && !text.toLowerCase().includes("</html>")) {
    throw new Error(`Bootstrap HTML invalid: ${path}`);
  }

  if (lowerPath.endsWith(".css") && !text.includes("{")) {
    throw new Error(`Bootstrap CSS invalid: ${path}`);
  }
}

export async function tryHandleBootstrap(args: {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  inference: any;
  runtimePolicy: any;
  membershipBlock: string;
  sacredBlock: string;
  profileBlock: string;
  masterBlock: string;
  chamberBlock: string;
  treeBlock: string;
  ledgerBlock: string;
  cleanedHistory: any[];
  baselineVerify: any;
  workspaceId: string;
  periodStart: string;
  requestId: string;
}): Promise<Response | null> {
   const {
    openai,
    supabase,
    repoId,
    userId,
    content,
    inference,
    runtimePolicy,
    baselineVerify,
    workspaceId,
    periodStart,
    requestId,
  } = args;

  // ─────────────────────────────────────────
  // INTERNAL GOAL EXECUTION BOOTSTRAP
  // ─────────────────────────────────────────
  if (isInternalGoalExecutionPrompt(content)) {
    try {
      const targetPaths = extractRelevantFilesFromGoalExecutionPrompt(content);

      console.log("[goal_execution_bootstrap]", {
        repoId,
        targetPaths,
      });



      if (targetPaths.length > 0) {
        const proposals: any[] = [];

        for (const targetPath of targetPaths) {
          const existingId = await resolveFileIdByPathOrName(supabase, repoId, targetPath);

          if (existingId) {
            const existingFile = await vault_read_text(supabase, repoId, existingId);

            const rewritten = await generateRewrittenFileContent({
              openai,
              model: runtimePolicy.model,
              userRequest: content,
              path: existingFile.path,
              mime: existingFile.mime,
              currentContent: existingFile.content,
            });

            const proposal = await vault_propose_write(
              supabase,
              repoId,
              existingFile.id,
              rewritten
            );

            if (proposal) proposals.push(proposal);
          } else {
            const mime = inferTextMimeFromPath(targetPath);

            const fileSpecificRequest =
              targetPath === "index.html"
                ? buildBootstrapHtmlPrompt(content)
                : targetPath === "styles.css"
                ? buildBootstrapCssPrompt(content)
                : content;

            let newContent: string;

            try {
              newContent = await generateNewFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest: fileSpecificRequest,
                path: targetPath,
                mime,
              });
            } catch (e) {
              if (!isGeneratedFileTruncationError(e)) throw e;

              console.log("[bootstrap create retry]", {
                repoId,
                targetPath,
                reason: e instanceof Error ? e.message : String(e),
              });

              newContent = await generateNewFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest: buildBootstrapRetryPrompt({
                  originalRequest: fileSpecificRequest,
                  targetPath,
                }),
                path: targetPath,
                mime,
                maxOutputTokens: 10000,
              });
            }

            const proposal = await vault_propose_create(supabase, repoId, {
              path: targetPath,
              content: newContent,
              mime,
            });

            if (proposal) proposals.push(proposal);
          }
        }

        console.log("[repo_execution_bootstrap] proposals built", {
          repoId,
          count: proposals.length,
          paths: proposals.map((p: any) => p?.path ?? p?.meta?.path ?? null),
        });

        if (proposals.length === 0) {
          return new Response(
            "[Observation]\nI inspected the requested goal step.\n\n[Assessment]\nNo repository changes were needed.\n\n[Action]\nContinue to the next goal step.",
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }
const inferredVerifyCmd = baselineVerify.verifyCmd;
        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe current goal step was converted into staged repository proposals.\n\n" +
          "[Action]\nA staged change is ready. Confirm to apply.";

        if (shouldPreVerifyProposalSet(proposals)) {
          const result = await finalizeProposalSet({
            openai,
            model: runtimePolicy.model,
            repoId,
            userRequest: content,
            baselineVerifyPayload: baselineVerify.verifyPayload,
            verifyCmd: inferredVerifyCmd,
            proposals,
          });

          const finalProposalSet = result.repaired ? result.finalProposals : proposals;

          return new Response(
            `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        if (proposals.length === 1) {
  await chargeCreditsForUsage({
    supabase,
    workspaceId,
    periodStart,
    repoId,
    requestId,
    amount: 1,
    kind: "goal_execution_bootstrap",
    metadata: {
      model: runtimePolicy.model,
      mode: "bootstrap",
    },
  });
}

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
    } catch (e: any) {
      console.log("[goal_execution_bootstrap] failed:", e?.message);
    }
  }

  // ─────────────────────────────────────────
  // EMPTY-REPO WEBSITE BOOTSTRAP
  // ─────────────────────────────────────────
  
  if (shouldUseDeterministicWebsiteBootstrap({ content, inference })) {
    try {
      const targetPaths = resolveBootstrapPathsFromUserRequest(content);

      console.log("[repo_execution_bootstrap]", {
        repoId,
        targetPaths,
        inference,
      });

      const brief = await generateWebsiteBootstrapBrief({
        openai,
        model: runtimePolicy.model,
        userRequest: content,
      });

      if (targetPaths.length > 0) {
        const proposals: any[] = [];

        for (const targetPath of targetPaths) {
          const existingId = await resolveFileIdByPathOrName(
            supabase,
            repoId,
            targetPath
          );

          if (existingId) {
            const existingFile = await vault_read_text(
              supabase,
              repoId,
              existingId
            );

            const rewritten = await generateRewrittenFileContent({
              openai,
              model: runtimePolicy.model,
              userRequest: content,
              path: existingFile.path,
              mime: existingFile.mime,
              currentContent: existingFile.content,
            });

            const proposal = await vault_propose_write(
              supabase,
              repoId,
              existingFile.id,
              rewritten
            );

            if (proposal) proposals.push(proposal);
          } else {
            const mime = inferTextMimeFromPath(targetPath);

            let newContent = "";

            if (targetPath === "index.html") {
              newContent = renderWebsiteIndexHtml(brief);
            } else if (targetPath === "styles.css") {
              newContent = renderWebsiteStylesCss(brief);
            } else if (targetPath === "about.html") {
              newContent = renderWebsiteAboutHtml(brief);
            } else {
              newContent = await generateNewFileContent({
                openai,
                model: runtimePolicy.model,
                userRequest: content,
                path: targetPath,
                mime,
              });
            }

            assertBootstrapFileSafe(targetPath, newContent);

            const proposal = await vault_propose_create(supabase, repoId, {
              path: targetPath,
              content: newContent,
              mime,
            });

            if (proposal) proposals.push(proposal);
          }
        }

        console.log("[repo_execution_bootstrap] proposals built", {
          repoId,
          count: proposals.length,
          paths: proposals.map((p: any) => p?.path ?? p?.meta?.path ?? null),
        });

        const inferredVerifyCmd = baselineVerify.verifyCmd;

        if (proposals.length === 0) {
          return new Response(
            "[Observation]\nI inspected the requested bootstrap.\n\n[Assessment]\nNo repository changes were needed.\n\n[Action]\nRetry with a more specific website request.",
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        const visible =
          "[Observation]\nRequired repository changes were staged.\n\n" +
          "[Assessment]\nThe requested bootstrap was converted into staged repository proposals.\n\n" +
          "[Action]\nA staged change is ready. Confirm to apply.";

        if (shouldPreVerifyProposalSet(proposals)) {
          const result = await finalizeProposalSet({
            openai,
            model: runtimePolicy.model,
            repoId,
            userRequest: content,
            baselineVerifyPayload: baselineVerify.verifyPayload,
            verifyCmd: inferredVerifyCmd,
            proposals,
          });

          const finalProposalSet = result.repaired
            ? result.finalProposals
            : proposals;

          await chargeCreditsForUsage({
            supabase,
            workspaceId,
            periodStart,
            repoId,
            requestId,
            amount: 1,
            kind: "bootstrap",
            metadata: {
              model: runtimePolicy.model,
              mode: "bootstrap",
              proposalCount: finalProposalSet.length,
              preverified: true,
            },
          });

          console.log(
            "[repo_execution_bootstrap] returning proposal_set_with_preverify",
            {
              repoId,
              count: finalProposalSet.length,
            }
          );

          return new Response(
            `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({
              proposals: finalProposalSet,
            })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        if (proposals.length === 1) {
          await chargeCreditsForUsage({
            supabase,
            workspaceId,
            periodStart,
            repoId,
            requestId,
            amount: 1,
            kind: "bootstrap",
            metadata: {
              model: runtimePolicy.model,
              mode: "bootstrap",
              proposalCount: proposals.length,
              preverified: false,
            },
          });

          console.log("[repo_execution_bootstrap] returning single proposal", {
            repoId,
            path: proposals[0]?.path ?? proposals[0]?.meta?.path ?? null,
          });

          return new Response(
            `${visible}\n\n__PROPOSAL__:${JSON.stringify(proposals[0])}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        await chargeCreditsForUsage({
          supabase,
          workspaceId,
          periodStart,
          repoId,
          requestId,
          amount: 1,
          kind: "bootstrap",
          metadata: {
            model: runtimePolicy.model,
            mode: "bootstrap",
            proposalCount: 1,
            preverified: false,
          },
        });

        console.log("[repo_execution_bootstrap] returning proposal set", {
          repoId,
          count: proposals.length,
        });

        return new Response(
          `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals })}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
    } catch (e: any) {
      console.log("[repo_execution_bootstrap] failed:", e?.message);
    }
  }

  return null;
}