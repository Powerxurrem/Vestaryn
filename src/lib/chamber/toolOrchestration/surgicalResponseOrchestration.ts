// lib/chamber/toolOrchestration/surgicalResponseOrchestration.ts

import { buildStreamedAssistantResponse } from "@/lib/chamber/toolOrchestration/buildStreamedAssistantResponse";

type BuildSurgicalResponseArgs = {
  supabase: any;
  repoId: string;
  userId: string;
  responseText: string;
};

export async function buildSurgicalResponseOrchestration({
  supabase,
  repoId,
  userId,
  responseText,
}: BuildSurgicalResponseArgs): Promise<Response> {
  return await buildStreamedAssistantResponse({
    supabase,
    repoId,
    userId,
    responseText,
    logLabel: "[repo_messages] surgical assistant insert failed:",
  });
}