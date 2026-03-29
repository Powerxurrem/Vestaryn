import { extractRawGoalMarkerBlock } from "@/types/goalMarkers";
import {
  emitMaintenanceIfNeeded,
  autoResummarizeIfNeeded,
} from "@/lib/chamber/maintenanceRuntime";
import { maybeSummarizeAndEngraveProposal } from "@/lib/chamber/memory";

type PersistAssistantTurnOrchestrationArgs = {
  ctx: {
    supabase: any;
    repoId: string;
    userId: string;
    forceMaintenance: boolean;
    totalMsgCount: number | null;
    maintenanceTriggerMsgs: number;
  };
  state: {
    rawAssistantText: string;
    fullText: string;
    hadAnyProposalSet: boolean;
  };
  io: {
    controller: ReadableStreamDefaultController<Uint8Array>;
    encoder: TextEncoder;
  };
};

export async function persistAssistantTurnOrchestration({
  ctx,
  state,
  io,
}: PersistAssistantTurnOrchestrationArgs): Promise<void> {
  const {
    supabase,
    repoId,
    userId,
    forceMaintenance,
    totalMsgCount,
    maintenanceTriggerMsgs,
  } = ctx;

  const { rawAssistantText, fullText, hadAnyProposalSet } = state;
  const { controller, encoder } = io;

  const rawSourceForPersistence = rawAssistantText || fullText;
  let persistedAssistantContent = fullText;

  if (!hadAnyProposalSet) {
    const rawGoalPlan = extractRawGoalMarkerBlock(
      rawSourceForPersistence,
      "__GOAL_PLAN__:"
    );
    if (rawGoalPlan) {
      persistedAssistantContent = rawGoalPlan;
    }

    const rawGoalStatus = extractRawGoalMarkerBlock(
      rawSourceForPersistence,
      "__GOAL_STATUS__:"
    );
    if (rawGoalStatus) {
      persistedAssistantContent = rawGoalStatus;
    }

    const rawGoalDone = extractRawGoalMarkerBlock(
      rawSourceForPersistence,
      "__GOAL_DONE__:"
    );
    if (rawGoalDone) {
      persistedAssistantContent = rawGoalDone;
    }
  }

  console.log("========== ASSISTANT PERSIST DEBUG ==========", {
    rawLen: rawSourceForPersistence.length,
    hasGoalPlanInRaw: rawSourceForPersistence.includes("__GOAL_PLAN__"),
    startsWithGoalPlanInRaw: rawSourceForPersistence.startsWith("__GOAL_PLAN__:"),
    hasGoalPlan: persistedAssistantContent.includes("__GOAL_PLAN__"),
    startsWithGoalPlan: persistedAssistantContent.startsWith("__GOAL_PLAN__:"),
    hasGoalStatus: persistedAssistantContent.includes("__GOAL_STATUS__"),
    startsWithGoalStatus: persistedAssistantContent.startsWith("__GOAL_STATUS__:"),
    length: persistedAssistantContent.length,
    head: persistedAssistantContent.slice(0, 200),
  });

  const { error: aInsErr } = await supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: userId,
    role: "assistant",
    content: persistedAssistantContent,
  });

  if (aInsErr) {
    console.log("[repo_messages] assistant insert failed:", aInsErr.message);
  }

  emitMaintenanceIfNeeded({
    controller,
    encoder,
    forceMaintenance,
    totalMsgCount,
    repoId,
    triggerMsgs: maintenanceTriggerMsgs,
  });

  await autoResummarizeIfNeeded({
    repoId,
    totalMsgCount,
  });

  try {
    const engraving = await maybeSummarizeAndEngraveProposal(
      supabase,
      repoId,
      userId
    );

    if (engraving?.marker) {
      controller.enqueue(
        encoder.encode(`\n__ENGRAVING__:${JSON.stringify(engraving.marker)}\n`)
      );
    }
  } catch (e: any) {
    console.log("[engraving] skipped:", e?.message);
  }
}