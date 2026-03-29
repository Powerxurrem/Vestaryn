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

    let effectiveMentionedPaths =
    continuity.matched && continuity.targetPath
      ? [continuity.targetPath]
      : mergedMentionedPaths;

  // 1) explicit artifact inference from the current prompt
  if (effectiveMentionedPaths.length === 0) {
    const inferredPath = inferArtifactPath(text);

    if (inferredPath) {
      console.log("[artifact_inference.inject]", inferredPath);
      effectiveMentionedPaths = [inferredPath];
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

  let executionMode =
    continuity.matched &&
    (continuity.confidence === "high" || continuity.confidence === "medium")
      ? {
          ...rawExecutionMode,
          mode: "surgical" as const,
          confidence: continuity.confidence,
          reasons: [
            ...(rawExecutionMode.reasons ?? []),
            `implicit_followup:${continuity.reason}`,
          ],
          mentionedPaths: effectiveMentionedPaths,
          hasExplicitPaths: effectiveMentionedPaths.length > 0,
        }
      : {
          ...rawExecutionMode,
          mentionedPaths: effectiveMentionedPaths,
        };

  // 3) advisory -> surgical when artifact inference produced a file path
  if (
    rawExecutionMode.mode === "advisory" &&
    effectiveMentionedPaths.length > 0
  ) {
    console.log("[execution_mode.upgrade_from_inference]", {
      from: rawExecutionMode.mode,
      to: "surgical",
      paths: effectiveMentionedPaths,
    });

    executionMode = {
      ...executionMode,
      mode: "surgical",
      confidence: "high",
      reasons: [
        ...(executionMode.reasons ?? []),
        "artifact_inference_override",
      ],
      mentionedPaths: effectiveMentionedPaths,
      hasExplicitPaths: true,
    };
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
    continuity.matched && continuity.targetPath
      ? continuity.targetPath
      : null;

  console.log("[followup_continuity]", {
    content: text,
    rawMentionedPaths: rawExecutionMode.mentionedPaths ?? [],
    repoPathMentions,
    mergedMentionedPaths,
    continuity,
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
    continuity,
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