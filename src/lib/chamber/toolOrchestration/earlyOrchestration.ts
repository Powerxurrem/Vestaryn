// lib/chamber/toolOrchestration/earlyOrchestration.ts
import { tryHandleImplicitPythonBootstrapOrchestration } from "@/lib/chamber/toolOrchestration/implicitPythonBootstrapOrchestration";

export async function tryHandleEarlyOrchestration(args: {
  openai: any;
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
}) {
  const pythonBootstrap =
    await tryHandleImplicitPythonBootstrapOrchestration(args);

  console.log("[early_orchestration] implicit python bootstrap returned", {
    repoId: args.repoId,
    hasResponse: Boolean(pythonBootstrap),
    status: pythonBootstrap?.status ?? null,
  });

  if (pythonBootstrap) {
    console.log("[early_orchestration] returning implicit python bootstrap response", {
      repoId: args.repoId,
      status: pythonBootstrap.status,
    });
    return pythonBootstrap;
  }

  return null;
}