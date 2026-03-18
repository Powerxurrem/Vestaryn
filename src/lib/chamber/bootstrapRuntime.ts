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
} from "@/lib/chamber/generation";
import { shouldPreVerifyProposalSet } from "@/lib/chamber/verify";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";

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

  if (s.includes("website") || s.includes("site")) {
    return ["index.html", "styles.css"];
  }

  return [];
}

function shouldUseDeterministicWebsiteBootstrap(args: {
  content: string;
  inference: { needsBootstrap?: boolean; projectType?: string | null };
}) {
  const text = String(args.content ?? "");

  if (!args.inference?.needsBootstrap) return false;
  if (!/\b(site|website|landing page|portfolio|home page)\b/i.test(text)) return false;

  const targetPaths = resolveBootstrapPathsFromUserRequest(text);
  return targetPaths.length > 0;
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
            const newContent = await generateNewFileContent({
              openai,
              model: runtimePolicy.model,
              userRequest: content,
              path: targetPath,
              mime: inferTextMimeFromPath(targetPath),
            });

            const proposal = await vault_propose_create(supabase, repoId, {
              path: targetPath,
              content: newContent,
              mime: inferTextMimeFromPath(targetPath),
            });

            if (proposal) proposals.push(proposal);
          }
        }

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
          return new Response(
            `${visible}\n\n__PROPOSAL__:${JSON.stringify(proposals[0])}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
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
            const newContent = await generateNewFileContent({
              openai,
              model: runtimePolicy.model,
              userRequest: content,
              path: targetPath,
              mime: inferTextMimeFromPath(targetPath),
            });

            const proposal = await vault_propose_create(supabase, repoId, {
              path: targetPath,
              content: newContent,
              mime: inferTextMimeFromPath(targetPath),
            });

            if (proposal) proposals.push(proposal);
          }
        }
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

          const finalProposalSet = result.repaired ? result.finalProposals : proposals;

          return new Response(
            `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: finalProposalSet })}\n__PREVERIFY__:${JSON.stringify(result.preverifyPayload)}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

        if (proposals.length === 1) {
          return new Response(
            `${visible}\n\n__PROPOSAL__:${JSON.stringify(proposals[0])}\n`,
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }

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