import OpenAI from "openai";
import { runTool } from "@/lib/vault/toolRuntime";
import { generateRewrittenFileContent } from "@/lib/chamber/generation";

type RepoWideStyleOrchestrationArgs = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  executionMode: any;
  runtimePolicy: any;
};

export async function tryHandleRepoWideStyleOrchestration({
  openai,
  supabase,
  repoId,
  userId,
  content,
  executionMode,
  runtimePolicy,
}: RepoWideStyleOrchestrationArgs): Promise<Response | null> {
  const isRepoWideStyleRequest =
    executionMode.mode === "bootstrap" &&
    /\b(whole site|entire site|site-wide|global|across all pages|every page)\b/i.test(content) &&
    /\b(style|theme|look|visual|premium|modern|color|palette|accent|background|blocks)\b/i.test(content);

  if (!isRepoWideStyleRequest) {
    return null;
  }

  console.log("[repo_wide_style_handler] triggered", {
    repoId,
    content,
  });

  const filesResp = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_list_files",
    {}
  );

  const files =
    filesResp &&
    typeof filesResp === "object" &&
    !("error" in filesResp) &&
    Array.isArray((filesResp as any).files)
      ? (filesResp as any).files
      : [];

  const cssFile =
    files.find((f: any) =>
      String(f?.path ?? "").toLowerCase().endsWith(".css")
    ) ?? null;

  const htmlFiles = files.filter((f: any) =>
    String(f?.path ?? "").toLowerCase().endsWith(".html")
  );

  if (!cssFile) {
    console.log("[repo_wide_style_handler] no shared css target found");
    return null;
  }

  console.log("[repo_wide_style_handler] rerouting to shared css file", {
    repoId,
    cssPath: cssFile.path,
    htmlCount: htmlFiles.length,
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
    !existingFile ||
    typeof existingFile !== "object" ||
    "error" in existingFile
  ) {
    return null;
  }

  let rewritten: string;

  try {
    rewritten = await generateRewrittenFileContent({
      openai,
      model: runtimePolicy.model,
      userRequest:
        `${content}\n\n` +
        `Hard rules:\n` +
        `- Apply the styling change site-wide through the shared stylesheet.\n` +
        `- Do not rewrite unrelated HTML files unless absolutely required.\n` +
        `- Prefer shared reusable CSS changes over per-page duplication.\n` +
        `- Return the FULL complete stylesheet.\n`,
      path: String((existingFile as any).path ?? cssFile.path),
      mime: String((existingFile as any).mime ?? "text/css"),
      currentContent: String((existingFile as any).content ?? ""),
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
        `${content}\n\n` +
        `Retry rules:\n` +
        `- Return the FULL complete file.\n` +
        `- Do not truncate.\n` +
        `- Keep changes focused.\n` +
        `- Do not invent new local assets, logos, SVGs, scripts, or image files.\n` +
        `- Do not reference any local file unless it already exists in the repo.\n` +
        `- Prefer structure over bloated inline styling.\n`,
      path: String((existingFile as any).path ?? cssFile.path),
      mime: String((existingFile as any).mime ?? "text/css"),
      currentContent: String((existingFile as any).content ?? ""),
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
    !("error" in proposal) &&
    !(proposal as any).noop
  ) {
    const responseText =
      "[Observation]\nA site-wide style change was staged through the shared stylesheet.\n\n" +
      "[Assessment]\nThe request was rerouted to the shared CSS layer so the visual update applies consistently across pages.\n\n" +
      "[Action]\nA staged change is ready. Confirm to apply.\n" +
      `\n__PROPOSAL__:${JSON.stringify(proposal)}\n`;

    return new Response(responseText, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  return null;
}