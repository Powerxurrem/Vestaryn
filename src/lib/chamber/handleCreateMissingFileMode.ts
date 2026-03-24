import OpenAI from "openai";
import { generateNewFileContent } from "@/lib/chamber/generation";
import { extractSingleMentionedPath } from "@/lib/chamber/intent";
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

function textResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
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

        newContent = await generateNewFileContent({
          openai,
          model,
          userRequest:
            `${content}\n\n` +
            `Create this as a new sibling page using index.html as the canonical layout.\n` +
            `Hard rules:\n` +
            `- Reuse the same stylesheet reference pattern as index.html.\n` +
            `- Preserve the same site identity, naming, and general tone as index.html.\n` +
            `- Do not invent new local assets, logos, icons, SVGs, scripts, or image files.\n` +
            `- Do not reference files that do not already exist, except the target page being created.\n` +
            `- Keep the structure aligned with index.html.\n` +
            `- Prefer simple compatible markup over introducing a brand new design system.\n` +
            `- Output a complete working page for: ${requestedPath}\n\n` +
            `Canonical file content:\n${String(canonicalFile?.content ?? "")}`,
          path: requestedPath,
          mime,
          maxOutputTokens: 5200,
        });

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
        newContent = await generateNewFileContent({
          openai,
          model,
          userRequest: content,
          path: requestedPath,
          mime,
        });
      }
    } else {
      newContent = await generateNewFileContent({
        openai,
        model,
        userRequest: content,
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
        "[Observation]\nThe requested file could not be staged safely.\n\n" +
          `[Assessment]\nVestaryn attempted to generate ${requestedPath}, but the generated file was truncated before a valid complete file could be produced.\n\n` +
          "[Action]\nRetry with a narrower request, or describe a smaller first version of the file."
      );
    }

    return textResponse(
      "[Observation]\nThe requested file could not be prepared.\n\n" +
        `[Assessment]\nVestaryn attempted to generate ${requestedPath}, but file generation failed before staging.\n\n` +
        "[Action]\nRetry the request with a clearer description of the file you want created."
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
      "[Observation]\nThe requested file could not be staged.\n\n" +
        `[Assessment]\nVestaryn generated content for ${requestedPath} but proposal staging failed.\n\n` +
        "[Action]\nRetry the request or inspect vault proposal handling."
    );
  }

  if ((proposal as any).noop === true) {
    return textResponse(
      "[Observation]\nThe requested file creation is already satisfied.\n\n" +
        `[Assessment]\nNo staged change was needed because ${requestedPath} already matches the requested content.\n\n` +
        "[Action]\nContinue with the next change or request another file."
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

  return textResponse(body);
}