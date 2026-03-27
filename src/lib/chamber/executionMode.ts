import {
  extractMentionedPaths,
  isBootstrapProjectIntent,
  isCreateAndModifyIntent,
  isExplainOnlyQuestion,
  isGoalPlanningUserIntent,
  isHighLevelBuildRequest,
  isInternalControlPrompt,
  isRepositoryExecutionIntent,
  normText,
  isInternalGoalExecutionPrompt,
  isLayoutAlignmentIntent,
  isConcreteEditRequest
} from "@/lib/chamber/intent";

function isScriptBootstrapIntent(text: string) {
  return hasAny(text, [
    /\bcreate\b.*\bpython script\b/i,
    /\bmake\b.*\bpython script\b/i,
    /\bgenerate\b.*\bpython script\b/i,
    /\bcreate\b.*\bscript\b.*\bthat\b.*\bcreates?\b.*\.xlsx\b/i,
    /\bpython script\b.*\bcreates?\b.*\.xlsx\b/i,
    /\bscript\b.*\bcreates?\b.*\.xlsx\b/i,
  ]);
}

function isFollowupReferenceIntent(text: string) {
  return hasAny(text, [
    /\b(it|this|that|them|those|both|all of them)\b/i,
    /\bthe story\b/i,
    /\bthe file\b/i,
    /\bthe files\b/i,
    /\bthat one\b/i,
    /\bthose two\b/i,
  ]);
}


function isImplicitFollowupEditIntent(text: string) {
  const hasEditVerb = hasAny(text, [
    /\bchange\b/i,
    /\bupdate\b/i,
    /\bedit\b/i,
    /\bmodify\b/i,
    /\brewrite\b/i,
    /\bshorten\b/i,
    /\brefine\b/i,
    /\bfix\b/i,
    /\bmake\b/i,
    /\breplace\b/i,
  ]);

  const hasReferentialTarget = isFollowupReferenceIntent(text);

  const explainOnly = hasAny(text, [
    /\bexplain\b/i,
    /\bjust explain\b/i,
    /\bwhat happened\b/i,
    /\bwhy\b/i,
    /\bhow\b/i,
    /\bwhat is\b/i,
  ]);

  return hasEditVerb && hasReferentialTarget && !explainOnly;
}

function isVisualRefinementIntent(text: string) {
  return hasAny(text, [
    /\bmake (it|this) look\b/i,
    /\blook more\b/i,
    /\bmore premium\b/i,
    /\bmore modern\b/i,
    /\bmore polished\b/i,
    /\bmore professional\b/i,
    /\bimprove the design\b/i,
    /\bimprove the styling\b/i,
    /\bimprove the ui\b/i,
    /\brestyle\b/i,
    /\bstyle it\b/i,
    /\bpolish the design\b/i,
    /\brefresh the design\b/i,
  ]);
}

export type ExecutionMode =
  | "advisory"
  | "explain"
  | "surgical"
  | "incremental"
  | "rewrite"
  | "bootstrap";

export type ExecutionModeResolution = {
  mode: ExecutionMode;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  mentionedPaths: string[];
  hasExplicitPaths: boolean;
};

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((re) => re.test(text));
}

function isWebsiteBootstrapIntent(text: string) {
  return hasAny(text, [
    /\bcreate\b.*\b(site|website|landing page|portfolio|homepage|home page)\b/i,
    /\bbuild\b.*\b(site|website|landing page|portfolio|homepage|home page)\b/i,
    /\bmake\b.*\b(site|website|landing page|portfolio|homepage|home page)\b/i,
    /\bgenerate\b.*\b(site|website|landing page|portfolio|homepage|home page)\b/i,
    /\b(site|website|landing page|portfolio|homepage|home page)\b.*\bfor\b/i,
  ]);
}

function isCreateMissingFileIntent(text: string) {
  return hasAny(text, [
    /\bcreate a new file\b/i,
    /\bcreate (a )?new\b/i,
    /\bi have deleted the file\b/i,
    /\bthe file is deleted\b/i,
    /\bfile is gone\b/i,
    /\bmake .* as .*\.html\b/i,
  ]);
}

function isExplicitNarrowEdit(text: string) {
  return hasAny(text, [
    /\bonly\b/i,
    /\bjust\b/i,
    /\bchange only\b/i,
    /\bchange (the )?(text|title|label|heading|button|copy)\b/i,
    /\bupdate (the )?(text|title|label|heading|button|copy)\b/i,
    /\bfix (this|that|the)\b/i,
    /\bfix typo\b/i,
    /\btypo\b/i,
    /\brename\b/i,
    /\breplace\b/i,
  ]);
}

function isBroadRewriteIntent(text: string) {
  return hasAny(text, [
    /\bredesign\b/i,
    /\brewrite\b/i,
    /\brefactor\b/i,
    /\boverhaul\b/i,
    /\brebuild\b/i,
    /\bmoderni[sz]e\b/i,
  ]);
}

function isIncrementalIntent(text: string) {
  return hasAny(text, [
    /\badd\b/i,
    /\binclude\b/i,
    /\binsert\b/i,
    /\bextend\b/i,
    /\bsupport\b/i,
    /\bappend\b/i,
  ]);
}

function isCrossFileAlignmentIntent(text: string) {
  return hasAny(text, [
    /\bcompare\b.*\b(files|pages|documents|website)\b/i,
    /\bcompare\b.*\band\b.*\balign\b/i,
    /\balign\b.*\b(layout|layouts|styling|style|structure)\b/i,
    /\balign\b.*\bbetween files\b/i,
    /\balign\b.*\bacross\b/i,
    /\bmake\b.*\bconsistent\b.*\b(across|between)\b/i,
    /\bkeep\b.*\bconsistent\b.*\b(across|between)\b/i,
    /\bstandardi[sz]e\b.*\b(layout|styling|style|structure)\b/i,
    /\bharmoni[sz]e\b.*\b(layout|styling|style|structure)\b/i,
    /\bmake the pages match\b/i,
    /\bmatch\b.*\b(layout|styling|style|structure)\b/i,
    /\balign the layout accordingly between files\b/i,
    /\bcompare the website documents\b/i,
  ]);
}

export function filterExecutionPaths(paths: string[]) {
  return paths.filter((p) => {
    const s = String(p ?? "").trim();
    if (!s) return false;

    // reject obvious CSS numeric/property noise
    if (/^\d+(\.\d+)?$/.test(s)) return false;          // 0.12
    if (/^\d+(\.\d+)?[a-z%]+$/i.test(s)) return false; // 0.02em
    if (/^[a-z]\.[a-z0-9_-]+$/i.test(s)) return false; // n.container-like junk

    // keep only known file-like extensions
    return /\.(html|css|scss|sass|js|jsx|ts|tsx|mjs|cjs|json|md|sql|yml|yaml|txt|py|bas|vba|csv|xml)$/i.test(s);
  });
}

export function resolveExecutionMode(content: string): ExecutionModeResolution {
  const text = normText(content);
  const lower = text.toLowerCase();
  const rawMentionedPaths = extractMentionedPaths(text);
const isGoalExecution = isInternalGoalExecutionPrompt(text);

const mentionedPaths =
  isInternalControlPrompt(text) && !isGoalExecution
    ? []
    : filterExecutionPaths(rawMentionedPaths);
  const hasExplicitPaths = mentionedPaths.length > 0;

  const hasEditVerb =
  /\b(improve|change|update|edit|modify|make|adjust|refine|restyle|tweak|input|insert|write|replace|rewrite|fix|correct|repair|clean up|cleanup)\b/i.test(text);

  const hasVisualEditSignal =
    /\b(gold|color|background|spacing|padding|margin|font|border|shadow|nav|navbar|header|footer|hero)\b/i.test(text);

  const hasCssPath = mentionedPaths.some((p) => /\.css$/i.test(p));

if (isLayoutAlignmentIntent(text)) {
  return {
    mode: hasExplicitPaths ? "incremental" : "incremental",
    confidence: hasExplicitPaths ? "high" : "medium",
    reasons: [
      "layout_alignment_intent",
      ...(hasExplicitPaths ? ["explicit_paths"] : []),
    ],
    mentionedPaths,
    hasExplicitPaths,
  };
}

  if (hasExplicitPaths && (hasEditVerb || hasVisualEditSignal)) {
    return {
      mode: hasCssPath ? "incremental" : "surgical",
      confidence: "high",
      reasons: [
        "explicit_file_edit_override",
        ...(hasCssPath ? ["css_target"] : []),
      ],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

  if (!text) {
    return {
      mode: "advisory",
      confidence: "low",
      reasons: ["empty_input"],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

if (isInternalGoalExecutionPrompt(text)) {
  return {
    mode: mentionedPaths.length >= 2 ? "incremental" : "surgical",
    confidence: "high",
    reasons: [
      "internal_goal_execution_prompt",
      ...(mentionedPaths.length >= 2 ? ["multi_file_goal_step"] : ["single_file_goal_step"]),
    ],
    mentionedPaths,
    hasExplicitPaths,
  };
}

  if (isInternalControlPrompt(text)) {
    return {
      mode: "advisory",
      confidence: "high",
      reasons: ["internal_control_prompt"],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

  if (isGoalPlanningUserIntent(text)) {
    return {
      mode: "advisory",
      confidence: "high",
      reasons: ["goal_planning_request"],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

    if (
    (
      isWebsiteBootstrapIntent(text) ||
      isHighLevelBuildRequest(text) ||
      isBootstrapProjectIntent(text) ||
      isScriptBootstrapIntent(text)
    ) &&
    !hasExplicitPaths
  ) {
    return {
      mode: "bootstrap",
      confidence: "high",
      reasons: ["high_level_bootstrap_request_without_specific_paths"],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

  if (isCreateAndModifyIntent(text)) {
    return {
      mode: "incremental",
      confidence: "high",
      reasons: ["create_and_modify_intent"],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

if (isCreateMissingFileIntent(text)) {
  return {
    mode: "bootstrap",
    confidence: "high",
    reasons: ["website_or_high_level_bootstrap_request"],
    mentionedPaths,
    hasExplicitPaths,
  };
}

  if (isRepositoryExecutionIntent(text)) {
    if (isExplicitNarrowEdit(text) && hasExplicitPaths) {
      return {
        mode: "surgical",
        confidence: "high",
        reasons: ["narrow_edit_language", "explicit_path"],
        mentionedPaths,
        hasExplicitPaths,
      };
    }

if (isCrossFileAlignmentIntent(text)) {
  return {
    mode: "incremental",
    confidence: "high",
    reasons: ["cross_file_alignment_intent"],
    mentionedPaths,
    hasExplicitPaths,
  };
}

if (isExplainOnlyQuestion(text)) {
  return {
    mode: "explain",
    confidence: "high",
    reasons: ["explicit_explain_only_language"],
    mentionedPaths,
    hasExplicitPaths,
  };
}
    if (isBroadRewriteIntent(lower)) {
      return {
        mode: "rewrite",
        confidence: "high",
        reasons: ["broad_rewrite_language"],
        mentionedPaths,
        hasExplicitPaths,
      };
    }

    if (isIncrementalIntent(text)) {
      return {
        mode: "incremental",
        confidence: "medium",
        reasons: ["incremental_language"],
        mentionedPaths,
        hasExplicitPaths,
      };
    }

    if (hasExplicitPaths) {
      return {
        mode: "surgical",
        confidence: "medium",
        reasons: ["repository_execution_with_explicit_path"],
        mentionedPaths,
        hasExplicitPaths,
      };
    }

    return {
      mode: "incremental",
      confidence: "low",
      reasons: ["repository_execution_without_clear_scope"],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

   if (isImplicitFollowupEditIntent(text)) {
    return {
      mode: "incremental",
      confidence: "medium",
      reasons: ["implicit_followup_edit_intent"],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

  if (isVisualRefinementIntent(text)) {
    return {
      mode: hasExplicitPaths ? "surgical" : "incremental",
      confidence: "medium",
      reasons: [
        "visual_refinement_intent",
        ...(hasExplicitPaths ? ["explicit_path"] : []),
      ],
      mentionedPaths,
      hasExplicitPaths,
    };
  }

    if (mentionedPaths.length > 0) {
    if (isExplainOnlyQuestion(text)) {
      return {
        mode: "explain",
        confidence: "high",
        reasons: ["explicit_explain_only_language"],
        mentionedPaths,
        hasExplicitPaths,
      };
    }

    if (isConcreteEditRequest(text)) {
      return {
        mode: mentionedPaths.length === 1 ? "surgical" : "incremental",
        confidence: "medium",
        reasons: ["explicit_path_with_edit_intent"],
        mentionedPaths,
        hasExplicitPaths: true,
      };
    }

    return {
      mode: mentionedPaths.length === 1 ? "surgical" : "incremental",
      confidence: "medium",
      reasons: ["path_present_default_to_execution"],
      mentionedPaths,
      hasExplicitPaths: true,
    };
  }

  console.log("[path_extract_debug]", {
    content,
    rawMentionedPaths,
    filteredMentionedPaths: mentionedPaths,
  });

  return {
    mode: "advisory",
    confidence: "medium",
    reasons: ["default_non_execution_fallback"],
    mentionedPaths,
    hasExplicitPaths,
  };
}

export function shouldRunBaselineVerifyForMode(mode: ExecutionMode) {
  return mode === "incremental" || mode === "rewrite" || mode === "bootstrap";
}

export function shouldAllowPreStreamRepoOpsForMode(mode: ExecutionMode) {
  return mode === "surgical" || mode === "incremental" || mode === "rewrite";
}

export function shouldAllowBootstrapForMode(mode: ExecutionMode) {
  return mode === "bootstrap";
}