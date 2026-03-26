import OpenAI from "openai";
import { finalizeProposalSet } from "@/lib/chamber/proposalFlow";
import { generateRewrittenFileContent } from "@/lib/chamber/generation";
import { shouldPreVerifyProposalSet } from "@/lib/chamber/verify";
import { extractSingleMentionedPath } from "@/lib/chamber/intent";
import type { VerifyCommand } from "@/lib/chamber/verifyRuntime";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import { resolveFileIdByPathOrName } from "@/lib/vault/tools";
import { runTool } from "@/lib/vault/toolRuntime";

type SurgicalDeps = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  model: string;
  baselineVerify: any;
  inferredVerifyCmd: VerifyCommand | null;
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

function extractLikelyHtmlTextTargets(currentContent: string) {
  const candidates: string[] = [];

  const patterns = [
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi,
    /<title\b[^>]*>([\s\S]*?)<\/title>/gi,
    /<button\b[^>]*>([\s\S]*?)<\/button>/gi,
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const re of patterns) {
    for (const match of currentContent.matchAll(re)) {
      const text = String(match[1] ?? "")
        .replace(/\s+/g, " ")
        .trim();

      if (text && text.length <= 120) {
        candidates.push(text);
      }
    }
  }

  return Array.from(new Set(candidates));
}

function extractSingleHtmlTagText(currentContent: string, tagName: string) {
  const matches = Array.from(
    currentContent.matchAll(
      new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}>)`, "gi")
    )
  );

  if (matches.length !== 1) return null;

  return {
    open: String(matches[0][1] ?? ""),
    text: String(matches[0][2] ?? "").replace(/\s+/g, " ").trim(),
    close: String(matches[0][3] ?? ""),
  };
}

function tryQuotedReplaceStructuralFallback(
  content: string,
  currentPath: string,
  currentContent: string
) {
  if (!/\.html?$/i.test(currentPath)) return null;
  if (!/\breplace\b/i.test(content) || !/\bwith\b/i.test(content)) return null;

  const quoted = extractQuotedStrings(content);
  if (quoted.length < 2) return null;

  const from = quoted[0];
  const to = quoted[1];

  const singleH1 = extractSingleHtmlTagText(currentContent, "h1");
  if (singleH1 && singleH1.text && singleH1.text !== to) {
    const rewritten = currentContent.replace(
      /(<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/i,
      `$1${to}$3`
    );

    if (rewritten !== currentContent) {
      return {
        kind: "quoted_replace_structural_h1_fallback",
        rewritten,
        details: {
          from,
          to,
          detectedCurrentValue: singleH1.text,
          tag: "h1",
        },
      };
    }
  }

  return null;
}

function pickClosestCandidate(requested: string, candidates: string[]) {
  if (!requested || candidates.length === 0) return null;

  const requestedLower = requested.toLowerCase();

  for (const c of candidates) {
    if (c.toLowerCase() === requestedLower) return c;
  }

  for (const c of candidates) {
    if (
      c.toLowerCase().includes(requestedLower) ||
      requestedLower.includes(c.toLowerCase())
    ) {
      return c;
    }
  }

  return candidates[0] ?? null;
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function replaceSingleOccurrence(haystack: string, from: string, to: string) {
  const idx = haystack.indexOf(from);
  if (idx === -1) return null;

  return haystack.slice(0, idx) + to + haystack.slice(idx + from.length);
}

function extractQuotedStrings(text: string) {
  const matches = Array.from(text.matchAll(/"([^"]+)"|'([^']+)'/g));
  return matches
    .map((m) => m[1] ?? m[2] ?? "")
    .filter(Boolean);
}

function tryQuotedReplaceFastPath(
  content: string,
  currentPath: string,
  currentContent: string
) {
  const lower = content.toLowerCase();

  if (!/\breplace\b/i.test(lower) || !/\bwith\b/i.test(lower)) {
    return null;
  }

  const quoted = extractQuotedStrings(content);
  if (quoted.length < 2) return null;

  const from = quoted[0];
  const to = quoted[1];

  const occurrenceCount = countOccurrences(currentContent, from);

  if (occurrenceCount === 0) {
    const likelyCandidates = /\.html?$/i.test(currentPath)
      ? extractLikelyHtmlTextTargets(currentContent)
      : [];

    const suggestedCurrentValue = pickClosestCandidate(from, likelyCandidates);

    return {
      kind: "quoted_replace_missing_source",
      rewritten: null,
      details: {
        from,
        to,
        occurrenceCount,
        suggestedCurrentValue,
      },
    };
  }

  if (occurrenceCount > 1) {
    return {
      kind: "quoted_replace_ambiguous",
      rewritten: null,
      details: { from, to, occurrenceCount },
    };
  }

  const replaced = replaceSingleOccurrence(currentContent, from, to);
  if (!replaced) return null;

  return {
    kind: "quoted_replace",
    rewritten: replaced,
    details: { from, to, occurrenceCount },
  };
}

function tryHtmlTagTextReplace(
  currentContent: string,
  tagName: string,
  nextText: string
) {
  const re = new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}>)`, "i");
  const matches = Array.from(currentContent.matchAll(new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}>)`, "gi")));

  if (matches.length !== 1) {
    return null;
  }

  return currentContent.replace(re, `$1${nextText}$3`);
}

function tryHtmlIntentFastPath(content: string, currentPath: string, currentContent: string) {
  if (!/\.html?$/i.test(currentPath)) return null;

  const quoted = extractQuotedStrings(content);
  const nextText = quoted[0];
  if (!nextText) return null;

  if (/\bhero title\b/i.test(content) || /\btitle\b/i.test(content)) {
    const replacedH1 = tryHtmlTagTextReplace(currentContent, "h1", nextText);
    if (replacedH1 && replacedH1 !== currentContent) {
      return {
        kind: "html_h1_replace",
        rewritten: replacedH1,
        details: { tag: "h1", nextText },
      };
    }
  }

  if (/\bpage title\b/i.test(content) || /\bdocument title\b/i.test(content) || /\b<title>\b/i.test(content)) {
    const replacedTitle = tryHtmlTagTextReplace(currentContent, "title", nextText);
    if (replacedTitle && replacedTitle !== currentContent) {
      return {
        kind: "html_title_replace",
        rewritten: replacedTitle,
        details: { tag: "title", nextText },
      };
    }
  }

  if (/\bbutton\b/i.test(content) || /\bbutton label\b/i.test(content)) {
    const replacedButton = tryHtmlTagTextReplace(currentContent, "button", nextText);
    if (replacedButton && replacedButton !== currentContent) {
      return {
        kind: "html_button_replace",
        rewritten: replacedButton,
        details: { tag: "button", nextText },
      };
    }
  }

  return null;
}

function tryDeterministicFastPath(
  content: string,
  currentPath: string,
  currentContent: string
) {
  const quotedReplace = tryQuotedReplaceFastPath(content, currentPath, currentContent);

  if (quotedReplace?.kind === "quoted_replace") {
    return quotedReplace;
  }

  if (quotedReplace?.kind === "quoted_replace_missing_source") {
    const structuralFallback = tryQuotedReplaceStructuralFallback(
      content,
      currentPath,
      currentContent
    );

    if (structuralFallback) {
      console.log("[surgical fast-path fallback hit]", {
        currentPath,
        kind: structuralFallback.kind,
        details: structuralFallback.details,
      });
      return structuralFallback;
    }

    return quotedReplace;
  }

  if (quotedReplace?.kind === "quoted_replace_ambiguous") {
    return quotedReplace;
  }

  const htmlIntent = tryHtmlIntentFastPath(content, currentPath, currentContent);
  if (htmlIntent) return htmlIntent;

  return null;
}

export async function handleSurgicalMode({
  openai,
  supabase,
  repoId,
  userId,
  content,
  model,
  baselineVerify,
  inferredVerifyCmd,
}: SurgicalDeps): Promise<Response | null> {
  const requestedPath = extractSingleMentionedPath(content);

  if (!requestedPath) {
    console.log("[surgical] skipped: no single explicit path");
    return null;
  }

  const fileId = await resolveFileIdByPathOrName(supabase, repoId, requestedPath);

  if (!fileId) {
    console.log("[surgical] skipped: target file not found", { requestedPath });

    return new Response(
      "[Observation]\nThe requested surgical edit could not start.\n\n" +
        `[Assessment]\nThe target file was not found: ${requestedPath}.\n\n` +
        "[Action]\nReference one existing file path and retry the edit request.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const readOut = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_read_text",
    { path: requestedPath }
  );

  if (!readOut || typeof readOut !== "object" || "error" in readOut) {
    console.log("[surgical] read failed", {
      requestedPath,
      error: (readOut as any)?.error ?? null,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit could not read the target file.\n\n" +
        `[Assessment]\nVestaryn could not load ${requestedPath} for a minimal edit.\n\n` +
        "[Action]\nRetry the request or verify that the file exists and is readable.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const currentPath = String((readOut as any).path ?? requestedPath);
  const currentMime = String((readOut as any).mime ?? inferTextMimeFromPath(currentPath));
  const currentContent = String((readOut as any).content ?? "");
  const currentFileId = String((readOut as any).id ?? fileId);

  let rewritten = "";
  let rewriteSource: "fast_path" | "model_path" = "model_path";

  const fastPath = tryDeterministicFastPath(content, currentPath, currentContent);

if (
  fastPath?.kind === "quoted_replace_missing_source" &&
  fastPath.details &&
  "from" in fastPath.details
) {
  const suggested =
    "suggestedCurrentValue" in fastPath.details &&
    fastPath.details.suggestedCurrentValue
      ? String(fastPath.details.suggestedCurrentValue)
      : null;

  return new Response(
    "[Observation]\nThe requested surgical replace did not run.\n\n" +
      `[Assessment]\nThe source text "${fastPath.details.from}" was not found in ${currentPath}, so no exact replacement could be made.` +
      (suggested
        ? ` A likely current visible value is "${suggested}".`
        : "") +
      "\n\n" +
      "[Action]\n" +
      (suggested
        ? `Retry with Replace "${suggested}" with "${fastPath.details.to}" in ${currentPath}.`
        : "Retry with the current text that exists in the file, or request a direct replacement for the visible value."),
    {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    }
  );
}

if (
  fastPath?.kind === "quoted_replace_ambiguous" &&
  fastPath.details &&
  "from" in fastPath.details
) {
  return new Response(
    "[Observation]\nThe requested surgical replace did not run.\n\n" +
      `[Assessment]\nThe source text "${String(fastPath.details.from)}" appears multiple times in ${currentPath}, so the replacement was ambiguous.\n\n` +
      "[Action]\nMake the request more specific by naming the target element, section, or exact location.",
    {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    }
  );
}

  if (fastPath?.rewritten) {
    rewritten = fastPath.rewritten;
    rewriteSource = "fast_path";

    console.log("[surgical fast-path hit]", {
      currentPath,
      kind: fastPath.kind,
      details: fastPath.details,
    });
  } else {
    console.log("[surgical fast-path miss]", { currentPath });

    const surgicalPrompt = [
      "You are performing a STRICT surgical edit.",
      "",
      "Hard rules:",
      "- Modify ONLY the requested file.",
      "- Preserve the full file.",
      "- Preserve structure, formatting, style, and unrelated code exactly unless the request requires otherwise.",
      "- Make the smallest viable change that satisfies the request.",
      "- Do NOT redesign, refactor, clean up, improve, or modernize anything else.",
      "- Do NOT remove unrelated lines.",
      "- Do NOT introduce placeholder text.",
      "- Return the FULL updated file content only.",
      "- If you cannot perform the change precisely, return the original file content unchanged.",
      "",
      `User request: ${content}`,
    ].join("\n");

    rewritten = await generateRewrittenFileContent({
      openai,
      model,
      userRequest: surgicalPrompt,
      path: currentPath,
      mime: currentMime,
      currentContent,
      maxOutputTokens: 10000,
    });
  }

  if (!rewritten || !rewritten.trim()) {
    console.log("[surgical] generation failed: empty rewrite", {
      currentPath,
      rewriteSource,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit did not produce updated file content.\n\n" +
        `[Assessment]\nVestaryn attempted a minimal rewrite for ${currentPath} but the generated result was empty.\n\n` +
        "[Action]\nRetry the request with the same target file and exact local change.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const normalizedOriginal = currentContent.replace(/\r\n/g, "\n").trim();
  const normalizedRewritten = rewritten.replace(/\r\n/g, "\n").trim();

  if (normalizedRewritten === normalizedOriginal) {
    console.log("[surgical] no-op detected", {
      currentPath,
      rewriteSource,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit is already satisfied.\n\n" +
        `[Assessment]\nNo staged change was needed because ${currentPath} already matches the requested update.\n\n` +
        "[Action]\nContinue with the next edit or request another precise change.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  if (currentContent.length > 0 && rewritten.length < currentContent.length * 0.7) {
    console.log("[surgical] rewrite rejected: suspicious truncation", {
      currentPath,
      rewriteSource,
      originalLen: currentContent.length,
      rewrittenLen: rewritten.length,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit was blocked before staging.\n\n" +
        `[Assessment]\nThe generated result for ${currentPath} looked truncated relative to the current file, so Vestaryn rejected it instead of risking a broken rewrite.\n\n` +
        "[Action]\nRetry with a more specific local edit request.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  const lengthDeltaRatio =
    currentContent.length > 0
      ? Math.abs(rewritten.length - currentContent.length) / currentContent.length
      : 0;

  if (lengthDeltaRatio > 0.3) {
    console.log("[surgical] large change detected", {
      currentPath,
      rewriteSource,
      originalLen: currentContent.length,
      rewrittenLen: rewritten.length,
      lengthDeltaRatio,
    });
  }

  const proposal = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_propose_write",
    {
      fileId: currentFileId,
      path: currentPath,
      content: rewritten,
    }
  );

  if (!proposal || typeof proposal !== "object" || "error" in proposal) {
    console.log("[surgical] propose failed", {
      currentPath,
      rewriteSource,
      proposal,
    });

    return new Response(
      "[Observation]\nThe requested surgical edit could not be staged.\n\n" +
        `[Assessment]\nVestaryn generated updated content for ${currentPath} but proposal staging failed.\n\n` +
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
      "[Observation]\nThe requested surgical edit is already satisfied.\n\n" +
        `[Assessment]\nNo staged change was needed because ${currentPath} already matches the requested update.\n\n` +
        "[Action]\nContinue with the next edit or request another precise change.",
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
    content: String((proposal as any).content ?? rewritten),
    prevHash: String((proposal as any).prevHash ?? ""),
    nextHash: String((proposal as any).nextHash ?? ""),
    confirm: String((proposal as any).confirm ?? ""),
    path: (proposal as any).path ?? currentPath,
    name: (proposal as any).name ?? null,
    mime: (proposal as any).mime ?? currentMime,
    meta: (proposal as any).meta ?? null,
  };

  let finalProposal = canonicalProposal;
  let preverifyPayload: any = null;
  const proposals: CanonicalProposal[] = [canonicalProposal];

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

      if (
        result.repaired &&
        Array.isArray(result.finalProposals) &&
        result.finalProposals.length === 1
      ) {
        finalProposal = {
          fileId: String(result.finalProposals[0].fileId),
          content: String(result.finalProposals[0].content),
          prevHash: String((result.finalProposals[0] as any).prevHash ?? canonicalProposal.prevHash),
          nextHash: String((result.finalProposals[0] as any).nextHash ?? canonicalProposal.nextHash),
          confirm: String((result.finalProposals[0] as any).confirm ?? canonicalProposal.confirm),
          path: result.finalProposals[0].path ?? currentPath,
          name: (result.finalProposals[0] as any).name ?? canonicalProposal.name ?? null,
          mime: result.finalProposals[0].mime ?? currentMime,
          meta: result.finalProposals[0].meta ?? null,
        };
      }
    } catch (e: any) {
      console.log("[surgical] preverify failed", {
        message: e?.message,
        currentPath,
      });

      preverifyPayload = {
        ok: false,
        error: e?.message ?? "Pre-verify failed",
        failedStep: "preverify_boot",
        failureKind: "internal_error",
        baseline: false,
        paths: [currentPath],
      };
    }
  }

 const body =
  "[Observation]\nRequired repository changes were staged.\n\n" +
  `[Assessment]\nA surgical edit was prepared for one file using ${
    rewriteSource === "fast_path"
      ? "a deterministic fast path"
      : "the surgical rewrite path"
  }.\n\n` +
  "[Action]\nA staged change is ready. Confirm to apply." +
  `\n\n__PROPOSAL__:${JSON.stringify(finalProposal)}\n` +
  (preverifyPayload
    ? `__PREVERIFY__:${JSON.stringify(preverifyPayload)}\n`
    : "");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}