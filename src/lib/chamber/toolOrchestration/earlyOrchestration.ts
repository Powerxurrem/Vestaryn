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
}) {
  const pythonBootstrap =
    await tryHandleImplicitPythonBootstrapOrchestration(args);

  if (pythonBootstrap) return pythonBootstrap;

  return null;
}