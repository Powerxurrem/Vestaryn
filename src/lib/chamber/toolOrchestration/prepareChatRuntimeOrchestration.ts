import { buildChatContext } from "@/lib/chamber/chatContext";
import {
  resolveImplicitFollowupTarget,
  type RecentFileRef,
} from "@/lib/chamber/followupContinuity";
import { collectRecentTouchedFilesFromMessages } from "@/lib/chamber/followupContinuityMessages";
import { extractRepoPathMentions } from "@/lib/chamber/pathMentions";
import { resolveVerifyCommand } from "@/lib/chamber/verifyRuntime";
import { resolveRuntimePolicyFromCredits } from "@/lib/chamber/creditsRuntime";
import {inferArtifactPath} from "@/lib/chamber/inferArtifactPath"

type PrepareChatRuntimeOrchestrationArgs = {
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  text: string;
  tierPolicy: any;
  rawExecutionMode: any;
};

function isArtifactFollowupEdit(text: string) {
  return /\b(fix|correct|repair|update|adjust|chart|macro|linked|error|broken|not working|not linked)\b/i.test(
    String(text ?? "")
  );
}

function pickRecentArtifactPath(recentFiles: RecentFileRef[]) {
  const recent = [...recentFiles].reverse();
  return (
    recent.find((f) => /\.(bas|py|sql|js|ts|tsx|jsx|css|html)$/i.test(String(f.path ?? "")))
      ?.path ?? null
  );
}

export async function prepareChatRuntimeOrchestration({
  supabase,
  repoId,
  userId,
  content,
  text,
  tierPolicy,
  rawExecutionMode,
}: PrepareChatRuntimeOrchestrationArgs) {
  const chatCtx = await buildChatContext({
    supabase,
    repoId,
    userId,
    content,
    tierPolicy,
  });

  const {
  inference,
  orderedHistory,
  cleanedHistory,
  sacredBlock,
  profileBlock,
  masterBlock,
  chamberBlock,
  treeBlock,
  ledgerBlock,
  membershipBlock,
} = chatCtx;

  const recentFilesFromMessages = collectRecentTouchedFilesFromMessages(
  orderedHistory.map((m: any) => ({
    role: m.role,
    content: m.content,
    created_at: m.created_at ?? null,
  }))
);

  const continuityRecentFiles: RecentFileRef[] = [...recentFilesFromMessages];

  console.log("[followup_recent_files_input]", {
    repoId,
    recentFilesFromMessages,
    cleanedHistoryHeads: cleanedHistory.slice(-6).map((m: any) => ({
      role: m.role,
      head: String(m.content ?? "").slice(0, 160),
    })),
  });

  const explicitMentionedPaths = rawExecutionMode.mentionedPaths ?? [];

  const inferredFilePaths = Array.isArray((inference as any)?.filePaths)
    ? ((inference as any).filePaths as string[])
    : [];

  const repoPathMentions = extractRepoPathMentions({
    content: text,
    repoPaths: inferredFilePaths,
  });

  const mergedMentionedPaths = Array.from(
    new Set([...explicitMentionedPaths, ...repoPathMentions])
  );

  const continuity = resolveImplicitFollowupTarget({
    content: text,
    mentionedPaths: mergedMentionedPaths,
    recentFiles: continuityRecentFiles,
  });

  const isRetryLikeFollowup =
    /\b(yes|yes please|do it|go ahead|apply it|retry|can you retry|try again|please retry|continue|redo)\b/i.test(
      String(text ?? "")
    );

  const recentAssistantNeedsNavCleanup = cleanedHistory
    .slice(-4)
    .some(
      (m: any) =>
        m?.role === "assistant" &&
        /\b(nav|navbar|navigation|duplicate|duplicates|still contain|single home \/ explore \/ about|retry removing)\b/i.test(
          String(m?.content ?? "")
        )
    );

    const staticSiteHtmlPaths = Array.from(
    new Set(
      continuityRecentFiles
        .filter((f) => ["apply", "proposal", "read"].includes(String(f?.source ?? "")))
        .map((f) => String(f?.path ?? "").trim().toLowerCase())
        .filter(Boolean)
        .filter((p) => /\.html?$/i.test(p))
    )
  );

  const continuityOverride =
  isRetryLikeFollowup &&
    recentAssistantNeedsNavCleanup &&
    String(inference?.projectType ?? "").toLowerCase() === "static_site" &&
    staticSiteHtmlPaths.length >= 2
      ? {
          matched: true,
          confidence: "high" as const,
          targetPath: null,
          reason: "short_followup_resume_previous_task",
        }
      : continuity;

  let effectiveMentionedPaths =
    continuityOverride.matched && continuityOverride.targetPath
      ? [continuityOverride.targetPath]
      : mergedMentionedPaths;

  if (
    continuityOverride.reason === "short_followup_resume_previous_task" &&
    staticSiteHtmlPaths.length >= 2
  ) {
    effectiveMentionedPaths = staticSiteHtmlPaths;
  }
  
  const availableRepoPaths =
    Array.isArray((inference as any)?.files) &&
    (inference as any).files.length > 0
      ? (inference as any).files
          .map((f: any) => String(f?.path ?? "").trim())
          .filter(Boolean)
      : Array.from(
          new Set(
            continuityRecentFiles
              .map((f) => String(f?.path ?? "").trim())
              .filter(Boolean)
          )
        );

  const singlePageHtmlPaths = Array.from(
    new Set(
      continuityRecentFiles
        .filter((f) => ["apply", "proposal", "read"].includes(String(f?.source ?? "")))
        .map((f) => String(f?.path ?? "").trim().toLowerCase())
        .filter(Boolean)
        .filter((p) => /\.html?$/i.test(p))
        .filter((p) => p === "index.html")
    )
  );

  const normalizedText = String(text ?? "");

  const isRelativeSinglePageFollowup =
    /\b(opposite|instead of|above it|below it|move it|move that|right above|right below)\b/i.test(
      normalizedText
    ) ||
    /\b(add|create|insert).*(block|blocks|card|cards|section|sections)\b/i.test(
      normalizedText
    ) ||
    /\b(block|blocks|card|cards|section|sections).*(below|above)\b/i.test(
      normalizedText
    );

  const isLayoutStyleFollowup =
    /\b(row|rows|column|columns|grid|per row|same height|equal height|match height|height doesn'?t match|height does not match|max \d+ per row|spacing|gap)\b/i.test(
      normalizedText
    );

  const recentAssistantTouchedSinglePageHtml = cleanedHistory
    .slice(-6)
    .some(
      (m: any) =>
        m?.role === "assistant" &&
        /\b(index\.html|single content card|content-card|hero card|staged change to index\.html|confirmed and the file version advanced)\b/i.test(
          String(m?.content ?? "")
        )
    );

    const recentAssistantNeedsSinglePageContentRetry = cleanedHistory
      .slice(-6)
      .some(
        (m: any) =>
          m?.role === "assistant" &&
          /\b(section|sections|block|blocks|content|remove|removed|hide|hidden|styles\.css|only hid|wrong file|html sections still exist|still exist in index\.html|delete them completely|remove the blocks completely)\b/i.test(
            String(m?.content ?? "")
          )
      );

  let forceSinglePageSurgicalResume = false;
  let forceArtifactBootstrap = false;

      const currentProjectType = String(inference?.projectType ?? "").toLowerCase();
  const hasExplicitResolvedTarget = effectiveMentionedPaths.length > 0;

  if (
    currentProjectType === "static_site" &&
    !hasExplicitResolvedTarget &&
    (
      availableRepoPaths.includes("index.html") ||
      singlePageHtmlPaths.includes("index.html")
    ) &&
    (
      (isRetryLikeFollowup && recentAssistantNeedsSinglePageContentRetry) ||
      (isRelativeSinglePageFollowup && recentAssistantTouchedSinglePageHtml) ||
      isLayoutStyleFollowup
    )
  ) {
    if (isLayoutStyleFollowup && availableRepoPaths.includes("styles.css")) {
      console.log("[retry_resume_single_page] redirected to styles.css (layout-style request)", {
        repoId,
        availableRepoPaths,
        isRetryLikeFollowup,
        isRelativeSinglePageFollowup,
        isLayoutStyleFollowup,
      });

      effectiveMentionedPaths = ["styles.css"];
      forceSinglePageSurgicalResume = true;
    } else {
      console.log("[retry_resume_single_page] forcing index.html surgical", {
        repoId,
        availableRepoPaths,
        isRetryLikeFollowup,
        isRelativeSinglePageFollowup,
        isLayoutStyleFollowup,
      });

      effectiveMentionedPaths = ["index.html"];
      forceSinglePageSurgicalResume = true;
    }
  }

  // 1) explicit artifact inference from the current prompt
  if (effectiveMentionedPaths.length === 0) {
  const inferredArtifactPath = inferArtifactPath(text);

  if (inferredArtifactPath) {
    console.log("[artifact_inference.force_execution]", inferredArtifactPath);

    effectiveMentionedPaths = [inferredArtifactPath];

    // 👇 DO NOT set executionMode here
    forceArtifactBootstrap = true;
  }
}
  // 2) recent-artifact follow-up inference
  if (
    effectiveMentionedPaths.length === 0 &&
    isArtifactFollowupEdit(text)
  ) {
    const inferredRecentArtifact = pickRecentArtifactPath(continuityRecentFiles);

    if (inferredRecentArtifact) {
      console.log("[artifact_followup.inject]", inferredRecentArtifact);
      effectiveMentionedPaths = [inferredRecentArtifact];
    }
  }

  // 2.5) final CSS preference override (post-continuity, pre-execution-mode)
  const prefersStylesCss =
    /\b(row|rows|column|columns|grid|per row|max \d+ per row|same height|equal height|match height|height doesn'?t match|height does not match|spacing|gap|padding|margin|background|glow|neon|futuristic|palette|color|colors|coloring|theme)\b/i.test(
      normalizedText
    );

  const hasStylesCss = availableRepoPaths.includes("styles.css");

  if (
    prefersStylesCss &&
    hasStylesCss &&
    effectiveMentionedPaths.length === 1 &&
    effectiveMentionedPaths[0] === "index.html"
  ) {
    console.log("[final_target_override] index.html -> styles.css", {
      repoId,
      reason: "layout_or_style_css_preference",
    });

    effectiveMentionedPaths = ["styles.css"];
    forceSinglePageSurgicalResume = true;
  }

      let executionMode =
  forceArtifactBootstrap
    ? {
        ...rawExecutionMode,
        mode: "bootstrap",
        confidence: "high",
        reasons: [
          ...(rawExecutionMode.reasons ?? []),
          "artifact_inference_forced_bootstrap",
        ],
        mentionedPaths: effectiveMentionedPaths,
        hasExplicitPaths: true,
      }
    : forceSinglePageSurgicalResume
    ? {
        ...rawExecutionMode,
        mode: "surgical",
        confidence: "high",
        reasons: [
          ...(rawExecutionMode.reasons ?? []),
          "single_page_followup_resume_override",
        ],
        mentionedPaths: effectiveMentionedPaths,
        hasExplicitPaths: true,
      }
    : continuityOverride.matched &&
      (continuityOverride.confidence === "high" ||
        continuityOverride.confidence === "medium")
    ? {
        ...rawExecutionMode,
        mode: "surgical",
        confidence: continuityOverride.confidence,
        reasons: [
          ...(rawExecutionMode.reasons ?? []),
          `implicit_followup:${continuityOverride.reason}`,
        ],
        mentionedPaths: effectiveMentionedPaths,
        hasExplicitPaths: effectiveMentionedPaths.length > 0,
      }
    : {
        ...rawExecutionMode,
        mentionedPaths: effectiveMentionedPaths,
      };

  // 3) advisory -> bootstrap when artifact inference produced a file path
if (effectiveMentionedPaths.length > 0) {
  const inferredArtifactPath = inferArtifactPath(text);

  if (inferredArtifactPath) {
    console.log("[execution_mode.force_bootstrap_from_artifact]", {
      path: inferredArtifactPath,
      previousMode: rawExecutionMode.mode,
    });

    executionMode = {
      ...executionMode,
      mode: "bootstrap",
      confidence: "high",
      reasons: [
        ...(executionMode.reasons ?? []),
        "artifact_inference_override_bootstrap",
      ],
      mentionedPaths: [inferredArtifactPath],
      hasExplicitPaths: true,
    };
  }
}

  // 4) incremental/rewrite -> surgical for single-file editable artifact edits
  const shouldForceSingleFileSurgical =
    effectiveMentionedPaths.length === 1 &&
    /\.(bas|py|sql|js|ts|tsx|jsx|css|html)$/i.test(
      effectiveMentionedPaths[0] ?? ""
    ) &&
    /\b(add|update|change|modify|edit|extend|append|insert|rewrite|fix|correct|repair|adjust)\b/i.test(
      text
    );

  if (shouldForceSingleFileSurgical && executionMode.mode !== "surgical") {
    console.log("[execution_mode.force_single_file_surgical]", {
      from: executionMode.mode,
      to: "surgical",
      path: effectiveMentionedPaths[0],
    });

    executionMode = {
      ...executionMode,
      mode: "surgical",
      confidence: "high",
      reasons: [
        ...(executionMode.reasons ?? []),
        "single_file_edit_override",
      ],
      mentionedPaths: effectiveMentionedPaths,
      hasExplicitPaths: true,
    };
  }

  const continuityTargetPath =
    continuityOverride.matched && continuityOverride.targetPath
      ? continuityOverride.targetPath
      : null;

  console.log("[followup_continuity]", {
    content: text,
    rawMentionedPaths: rawExecutionMode.mentionedPaths ?? [],
    repoPathMentions,
    mergedMentionedPaths,
    continuity: continuityOverride,
    effectiveMentionedPaths,
    finalMode: executionMode.mode,
    finalConfidence: executionMode.confidence,
    reasons: executionMode.reasons,
  });

  const inferredVerifyCmd =
    inference?.projectType === "unknown" || inference?.projectType === "loose_files"
      ? null
      : resolveVerifyCommand(inference?.projectType ?? null);

  const creditsResolution = await resolveRuntimePolicyFromCredits({
    supabase,
    repoId,
    tierPolicy,
  });

  const {
    workspaceId,
    periodStart,
    remaining,
    runtimePolicy,
    errorResponse,
  } = creditsResolution;

  console.log("[credits]", {
    workspaceId,
    periodStart,
    remaining,
    runtimeTier: runtimePolicy?.tier,
  });

  return {
    inference,
    cleanedHistory,
    sacredBlock,
    profileBlock,
    masterBlock,
    chamberBlock,
    treeBlock,
    ledgerBlock,
    membershipBlock,
    repoPathMentions,
    mergedMentionedPaths,
    continuity: continuityOverride,
    effectiveMentionedPaths,
    executionMode,
    continuityTargetPath,
    inferredVerifyCmd,
    workspaceId,
    periodStart,
    remaining,
    runtimePolicy,
    errorResponse,
  };
}