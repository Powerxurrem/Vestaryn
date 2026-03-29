// lib/chamber/toolOrchestration/pass1ToolNormalizationOrchestration.ts

type PendingTool = {
  call_id: string;
  name: string;
  arguments: string;
};

type Pass1ToolNormalizationArgs = {
  repoId: string;
  content: string;
  executionMode: {
    mode: string;
  };
  pendingTools: PendingTool[];
  effectiveMentionedPaths: string[];
  inference?: any;
  isImportRefactorIntent: (text: string) => boolean;
  isSplitFileIntent: (text: string) => boolean;
  isSourceTargetTransferIntent: (text: string) => boolean;
  isCreateAndModifyIntent: (text: string) => boolean;
};

type Pass1ToolNormalizationResult = {
  pendingTools: PendingTool[];
};

export async function normalizePass1ToolsOrchestration({
  repoId,
  content,
  executionMode,
  pendingTools,
  effectiveMentionedPaths,
  inference,
  isImportRefactorIntent,
  isSplitFileIntent,
  isSourceTargetTransferIntent,
  isCreateAndModifyIntent,
}: Pass1ToolNormalizationArgs): Promise<Pass1ToolNormalizationResult> {
  const hasExplicitMultiFileEditRequest =
    effectiveMentionedPaths.length >= 2 &&
    (
      executionMode.mode === "surgical" ||
      executionMode.mode === "incremental" ||
      executionMode.mode === "rewrite"
    ) &&
    !isImportRefactorIntent(content) &&
    !isSplitFileIntent(content) &&
    !isSourceTargetTransferIntent(content) &&
    !isCreateAndModifyIntent(content);

  if (hasExplicitMultiFileEditRequest) {
    const pass1ToolNames = pendingTools.map((t) => String(t?.name ?? ""));
    const onlyDirectReads =
      pendingTools.length > 0 &&
      pendingTools.every((t) => String(t?.name ?? "") === "vault_read_text");

    if (onlyDirectReads) {
      console.log("[pass1_tool_normalization] forcing vault_list_files for multi-file edit", {
        repoId,
        requestedPaths: effectiveMentionedPaths,
        originalTools: pass1ToolNames,
      });

      const originalCallId =
        pendingTools[0]?.call_id ?? `normalize_${Date.now()}`;

      return {
        pendingTools: [
          {
            call_id: originalCallId,
            name: "vault_list_files",
            arguments: "{}",
          },
        ],
      };
    }
  }

  // ─────────────────────────────────────────────
  // Fast-path single-file reroute for vague style/UI edits
  // Avoid list_files when we can confidently jump to the likely target.
  // ─────────────────────────────────────────────
  const singleImplicitEdit =
    effectiveMentionedPaths.length === 0 &&
    (
      executionMode.mode === "incremental" ||
      executionMode.mode === "surgical"
    ) &&
    !isImportRefactorIntent(content) &&
    !isSplitFileIntent(content) &&
    !isSourceTargetTransferIntent(content) &&
    !isCreateAndModifyIntent(content);

  if (!singleImplicitEdit) {
    return { pendingTools };
  }

  const styleLikeRequest =
    /\b(style|styling|theme|visual|look|feel|design|background|color|colors|palette|contrast|glow|spark|sparkly|electric|lightning|thunder|hero|navbar|nav bar|nav|header|footer|button|hover|shadow|gradient|lines)\b/i.test(
      content
    );

  const structureLikeRequest =
    /\b(section|sections|content|text|heading|title|paragraph|copy|remove|add section|move|reorder|layout block|card|cards)\b/i.test(
      content
    );

  const inferredFiles = Array.isArray((inference as any)?.files)
    ? ((inference as any).files as Array<{ path?: string; mime?: string }>)
    : [];

  const cssPath =
    inferredFiles.find((f) => /(^|\/)styles\.css$/i.test(String(f?.path ?? "")))?.path ?? null;

  const indexPath =
    inferredFiles.find((f) => /(^|\/)index\.html$/i.test(String(f?.path ?? "")))?.path ?? null;

  const preferredPath =
    styleLikeRequest && cssPath
      ? cssPath
      : structureLikeRequest && indexPath
      ? indexPath
      : cssPath ?? indexPath ?? null;

  if (!preferredPath) {
    return { pendingTools };
  }

  const normalizedTools = pendingTools.map((tool) => {
    if (String(tool?.name ?? "") !== "vault_list_files") {
      return tool;
    }

    console.log("[pass1_tool_normalization] rerouted list_files to read_text", {
      repoId,
      originalTool: tool.name,
      preferredPath,
      styleLikeRequest,
      structureLikeRequest,
      mode: executionMode.mode,
    });

    return {
      ...tool,
      name: "vault_read_text",
      arguments: JSON.stringify({ path: preferredPath }),
    };
  });

  return { pendingTools: normalizedTools };
}