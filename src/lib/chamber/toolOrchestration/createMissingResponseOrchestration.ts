// lib/chamber/toolOrchestration/createMissingResponseOrchestration.ts

import { buildStreamedAssistantResponse } from "@/lib/chamber/toolOrchestration/buildStreamedAssistantResponse";

type CreateMissingResponseArgs = {
  supabase: any;
  repoId: string;
  userId: string;
  workspaceId: string;
  periodStart: string;
  requestId: string;
  executionMode: {
    mode: string;
  };
  runtimePolicy: {
    model: string;
    tier: string;
  };
  responseText: string;
  chargeCreditsForUsage: (args: {
    supabase: any;
    workspaceId: string;
    periodStart: string;
    repoId: string;
    requestId: string;
    amount: number;
    kind: string;
    metadata?: Record<string, any>;
  }) => Promise<any>;
};

export async function buildCreateMissingResponseOrchestration({
  supabase,
  repoId,
  userId,
  workspaceId,
  periodStart,
  requestId,
  executionMode,
  runtimePolicy,
  responseText,
  chargeCreditsForUsage,
}: CreateMissingResponseArgs): Promise<Response> {
  return await buildStreamedAssistantResponse({
    supabase,
    repoId,
    userId,
    responseText,
    logLabel: "[repo_messages] create-missing assistant insert failed:",
    afterInsert: async () => {
      await chargeCreditsForUsage({
        supabase,
        workspaceId,
        periodStart,
        repoId,
        requestId,
        amount: 1,
        kind: "chat_turn",
        metadata: {
          mode: executionMode.mode,
          model: runtimePolicy.model,
          tier: runtimePolicy.tier,
        },
      });
    },
  });
}