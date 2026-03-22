import OpenAI from "openai";
import { generateNewFileContent } from "@/lib/chamber/generation";
import { extractSingleMentionedPath } from "@/lib/chamber/intent";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import { resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { runTool } from "@/lib/vault/toolRuntime";

type CreateMissingFileDeps = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  model: string;
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

export async function handleCreateMissingFileMode({
  openai,
  supabase,
  repoId,
  userId,
  content,
  model,
}: CreateMissingFileDeps): Promise<Response | null> {
  const requestedPath = extractSingleMentionedPath(content);

  if (!requestedPath) {
    console.log("[create_missing] skipped: no single explicit path");
    return null;
  }

  const existingFileId = await resolveFileIdByPathOrName(
    supabase,
    repoId,
    requestedPath
  );

  if (existingFileId) {
    console.log("[create_missing] skipped: file already exists", {
      requestedPath,
      existingFileId,
    });
    return null;
  }

  const mime = inferTextMimeFromPath(requestedPath);

  const newContent = await generateNewFileContent({
    openai,
    model,
    userRequest: content,
    path: requestedPath,
    mime,
  });

  if (!newContent || !newContent.trim()) {
    return new Response(
      "[Observation]\nThe requested file could not be prepared.\n\n" +
        `[Assessment]\nVestaryn attempted to generate ${requestedPath} but the generated file content was empty.\n\n` +
        "[Action]\nRetry with the same path and a clearer description of the file you want created.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
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

    return new Response(
      "[Observation]\nThe requested file could not be staged.\n\n" +
        `[Assessment]\nVestaryn generated content for ${requestedPath} but proposal staging failed.\n\n` +
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
      "[Observation]\nThe requested file creation is already satisfied.\n\n" +
        `[Assessment]\nNo staged change was needed because ${requestedPath} already matches the requested content.\n\n` +
        "[Action]\nContinue with the next change or request another file.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const canonicalProposal: CanonicalProposal = {
    fileId: String((proposal as any).fileId),
    content: String((proposal as any).content ?? newContent),
    prevHash: String((proposal as any).prevHash ?? ""),
    nextHash: String((proposal as any).nextHash ?? ""),
    confirm: String((proposal as any).confirm ?? ""),
    path: (proposal as any).path ?? requestedPath,
    name: (proposal as any).name ?? null,
    mime: (proposal as any).mime ?? mime,
    meta: (proposal as any).meta ?? null,
  };

  const body =
    `\n__PROPOSAL__:${JSON.stringify(canonicalProposal)}\n` +
    "[Observation]\nRequired repository changes were staged.\n\n" +
    "[Assessment]\nA new file was prepared and staged.\n\n" +
    "[Action]\nA staged change is ready. Confirm to apply.";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}