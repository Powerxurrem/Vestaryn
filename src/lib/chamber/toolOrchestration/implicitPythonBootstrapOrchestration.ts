import OpenAI from "openai";
import { inferTextMimeFromPath } from "@/lib/vault/utils";
import {
  generateNewFileContent,
  buildRequirementsTxtContentFromPython,
  mergeRequirementsTxt,
} from "@/lib/chamber/generation";
import { runTool } from "@/lib/vault/toolRuntime";
import { fileExistsByPath, resolveFileIdByPathOrName } from "@/lib/vault/tools";

type ImplicitPythonBootstrapOrchestrationArgs = {
  openai: OpenAI;
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  inference: any;
  executionMode: any;
  runtimePolicy: any;
  requestHandledByOrchestration: boolean;
  isImplicitPythonScriptBootstrapRequest: (text: string) => boolean;
  cleanedHistory: Array<{ role: string; content: string }>;
};

function hasWorkbookSpecContext(
  cleanedHistory: Array<{ role: string; content: string }>
) {
  const joined = cleanedHistory
    .slice(-8)
    .map((m) => String(m?.content ?? ""))
    .join("\n")
    .toLowerCase();

  return /\b(excel|workbook|spreadsheet|dashboard|openpyxl|monthly sales|raw_sales|monthly_summary|category_analysis|region_analysis)\b/.test(joined);
}

function isExplicitPythonScriptFollowup(text: string) {
  const t = String(text ?? "").toLowerCase();

  return (
    /\b(write|create|generate|build|make|convert)\b/.test(t) &&
    (
      /\bpython\b/.test(t) ||
      /\.py\b/.test(t) ||
      /\bpython script\b/.test(t) ||
      /\bscript\b/.test(t)
    )
  );
}

async function stageBootstrapPythonRequirements(args: {
  supabase: any;
  repoId: string;
  userId: string;
  userMessage: string;
  pythonContent: string;
}) {
  const { supabase, repoId, userId, userMessage, pythonContent } = args;

  const requirementsPath = "requirements.txt";
  const generatedRequirements = buildRequirementsTxtContentFromPython(pythonContent);

  const existingRequirementsId = await resolveFileIdByPathOrName(
    supabase,
    repoId,
    requirementsPath
  );

  if (!existingRequirementsId) {
    const proposal = await runTool(
      supabase,
      repoId,
      userId,
      userMessage,
      "vault_propose_create",
      {
        path: requirementsPath,
        content: generatedRequirements,
        mime: "text/plain",
      }
    );

    if (!proposal || typeof proposal !== "object" || "error" in proposal) {
      throw new Error("bootstrap requirements create proposal failed");
    }

    return proposal;
  }

  const existingRequirements = await runTool(
    supabase,
    repoId,
    userId,
    userMessage,
    "vault_read_text",
    {
      fileRef: existingRequirementsId,
    }
  );

  if (!existingRequirements || typeof existingRequirements !== "object" || "error" in existingRequirements) {
    throw new Error("bootstrap requirements read failed");
  }

  const mergedRequirements = mergeRequirementsTxt(
    String((existingRequirements as any)?.content ?? ""),
    generatedRequirements
  );

  const proposal = await runTool(
    supabase,
    repoId,
    userId,
    userMessage,
    "vault_propose_write",
    {
      fileId: existingRequirementsId,
      content: mergedRequirements,
    }
  );

  if (!proposal || typeof proposal !== "object" || "error" in proposal) {
    throw new Error("bootstrap requirements write proposal failed");
  }

  if ((proposal as any).noop === true) {
    return null;
  }

  return proposal;
}

export async function tryHandleImplicitPythonBootstrapOrchestration({
  openai,
  supabase,
  repoId,
  userId,
  content,
  inference,
  executionMode,
  runtimePolicy,
  requestHandledByOrchestration,
  isImplicitPythonScriptBootstrapRequest,
  cleanedHistory,
}: ImplicitPythonBootstrapOrchestrationArgs): Promise<Response | null> {
    const explicitPythonScriptRequest =
    isImplicitPythonScriptBootstrapRequest(content);

  const workbookSpecContext =
    hasWorkbookSpecContext(cleanedHistory);

  const shouldRunImplicitPythonBootstrap =
  executionMode?.mode === "bootstrap" &&
  executionMode?.mentionedPaths?.includes("script.py");

  if (
    requestHandledByOrchestration ||
    executionMode?.mode !== "bootstrap" ||
    executionMode?.hasExplicitPaths && executionMode?.mode !== "bootstrap" ||
    !shouldRunImplicitPythonBootstrap
  ) {
    return null;
  }

  const createPath = "script.py";
  const mime = inferTextMimeFromPath(createPath);

  console.log("[implicit_python_bootstrap] entered", {
    repoId,
    createPath,
    needsBootstrap: inference?.needsBootstrap ?? null,
  });

  let newContent: string;

  try {
    newContent = await generateNewFileContent({
      openai,
      model: runtimePolicy.model,
      userRequest:
        `${content}\n\n` +
        `Create the file at ${createPath}.\n` +
        `Return a complete runnable Python script.\n` +
        `Use openpyxl.\n` +
        `This script must generate an Excel workbook scaffold, not a generic Python starter.\n` +
        `Include workbook sheets for a small reporting/dashboard workflow.\n` +
        `At minimum, create sheets for raw data, summary, and dashboard.\n` +
        `Write headers, basic formatting, and save the workbook to an .xlsx file.\n` +
        `Do not return placeholder code like hello world.\n`,
      path: createPath,
      mime,
      maxOutputTokens: 5200,
    });

    console.log("[implicit_python_bootstrap] generated", {
      repoId,
      createPath,
      contentLen: newContent.length,
      head: newContent.slice(0, 120),
      tail: newContent.slice(-200),
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown generation error";

    console.log("[implicit_python_bootstrap] generation failed", {
      repoId,
      createPath,
      message: msg,
    });

    const visible =
      "[Observation]\nPython bootstrap generation failed validation.\n\n" +
      "[Assessment]\nThe generated file looked incomplete and was rejected before staging.\n\n" +
      "[Action]\nRetry with a simpler workbook script or regenerate the file.";

    return new Response(visible, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

const stagedProposals: any[] = [];

let scriptProposal: any;

const exists = await fileExistsByPath(supabase, repoId, createPath);

if (!exists) {
  scriptProposal = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_propose_create",
    {
      path: createPath,
      content: newContent,
      mime,
    }
  );
} else {
  const fileId = await resolveFileIdByPathOrName(
    supabase,
    repoId,
    createPath
  );

  if (!fileId) {
    throw new Error(`Failed to resolve fileId for ${createPath}`);
  }

  scriptProposal = await runTool(
    supabase,
    repoId,
    userId,
    content,
    "vault_propose_write",
    {
      fileId,
      content: newContent,
    }
  );
}

console.log("[implicit_python_bootstrap] proposal result", {
  repoId,
  createPath,
  proposalType: typeof scriptProposal,
  isObject: !!scriptProposal && typeof scriptProposal === "object",
  hasError: !!scriptProposal && typeof scriptProposal === "object" && "error" in scriptProposal,
  keys:
    scriptProposal && typeof scriptProposal === "object"
      ? Object.keys(scriptProposal as Record<string, unknown>)
      : [],
});

if (!scriptProposal || typeof scriptProposal !== "object" || "error" in scriptProposal) {
  console.log("[implicit_python_bootstrap] proposal invalid -> returning null", {
    repoId,
    createPath,
  });
  return null;
}

stagedProposals.push(scriptProposal);

const requirementsProposal = await stageBootstrapPythonRequirements({
  supabase,
  repoId,
  userId,
  userMessage: content,
  pythonContent: newContent,
});

if (
  requirementsProposal &&
  typeof requirementsProposal === "object" &&
  !("error" in requirementsProposal)
) {
  stagedProposals.push(requirementsProposal);
}

const visible =
  "[Observation]\nRequired repository changes were staged.\n\n" +
  "[Assessment]\nA new Python workbook generator was prepared together with its dependency contract.\n\n" +
  "[Action]\nA staged change is ready. Confirm to apply.";

const body =
  stagedProposals.length === 1
    ? `${visible}\n\n__PROPOSAL__:${JSON.stringify(stagedProposals[0])}\n`
    : `${visible}\n\n__PROPOSAL_SET__:${JSON.stringify({ proposals: stagedProposals })}\n`;

  console.log("[implicit_python_bootstrap] returning response", {
    repoId,
    createPath,
    bodyLen: body.length,
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}