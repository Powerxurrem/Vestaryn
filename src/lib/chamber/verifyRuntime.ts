import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { buildRepoSnapshotSignedUrl } from "@/lib/runner/snapshot";
import { runnerRun } from "@/lib/runner/client";
import { updateChamberStateDoc } from "@/lib/chamber/memory";

export const ALLOWED_VERIFY_COMMANDS = [
  "node_verify",
  "node_typecheck",
  "node_lint",
  "node_test",
  "python_verify",
] as const;

export type VerifyCommand = (typeof ALLOWED_VERIFY_COMMANDS)[number];

export function resolveVerifyCommand(
  projectType?: string | null
): VerifyCommand | null {
  switch (projectType) {
    case "python":
      return "python_verify";

    case "node":
    case "node_typescript":
    case "nextjs":
      return "node_verify";

    case "static_web":
    case "static_site":
    case "loose_files":
    case "unknown":
    default:
      return null;
  }
}

export function resolveDirectVerifyCommand(content: string): VerifyCommand | null {
  const normalized = String(content ?? "").trim();

  return normalized === "__VERIFY_ALL__"
    ? "node_verify"
    : normalized === "__VERIFY_TEST__"
    ? "node_test"
    : normalized === "__VERIFY_LINT__"
    ? "node_lint"
    : normalized === "__VERIFY_TYPECHECK__"
    ? "node_typecheck"
    : null;
}

export async function handleDirectVerifyCommand(args: {
  supabase: any;
  repoId: string;
  userId: string;
  verifyCmd: VerifyCommand;
}): Promise<Response> {
  const { supabase, repoId, userId, verifyCmd } = args;

  const jobId = `verify-${repoId}-${Date.now()}`;

  try {
    console.log("[verify] building snapshot", { repoId, jobId, verifyCmd });

    const supabaseAdmin = createSupabaseAdmin();
    const snap = await buildRepoSnapshotSignedUrl(supabaseAdmin, repoId, jobId, {
      signedUrlTtlSec: 600,
    });

    console.log("[verify] snapshot ready", {
      fileCount: snap.fileCount,
      zipBytes: snap.zipBytes,
      snapshotObjectPath: snap.snapshotObjectPath,
    });

    const result = await runnerRun({
      jobId,
      commandId: verifyCmd,
      snapshotUrl: snap.snapshotSignedUrl,
      timeoutMs: 120_000,
    });

    console.log("[verify] runner raw output", {
      stdoutLen: String(result.stdout ?? "").length,
      stderrLen: String(result.stderr ?? "").length,
      stdoutHead: String(result.stdout ?? "").slice(0, 500),
      stderrHead: String(result.stderr ?? "").slice(0, 500),
    });

    await supabaseAdmin.from("repo_runs").insert({
      repo_id: repoId,
      change_id: null,
      command: verifyCmd,
      ok: Boolean(result.ok),
      exit_code: Number(result.exitCode ?? -1),
      duration_ms: Number(result.durationMs ?? 0),
      stdout: (result.stdout ?? "").slice(0, 8000),
      stderr: (result.stderr ?? "").slice(0, 8000),
      job_id: jobId,
      runner_fingerprint: result.fingerprint ?? null,
      failed_step: result.failedStep ?? null,
      failure_kind: result.failureKind ?? null,
      timed_out: Boolean(result.timedOut),
    });

    console.log("[verify] runner returned", {
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      error: result.error ?? null,
      stdoutLen: (result.stdout ?? "").length,
      stderrLen: (result.stderr ?? "").length,
    });

    const verifyPayload = {
      command: verifyCmd,
      ok: Boolean(result.ok),
      exitCode: Number(result.exitCode ?? -1),
      durationMs: Number(result.durationMs ?? 0),
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      error: result.error ?? null,
      jobId,
      fingerprint: result.fingerprint ?? null,
      failedStep: result.failedStep ?? null,
      failureKind: result.failureKind ?? null,
      timedOut: Boolean(result.timedOut),
    };

    try {
      await updateChamberStateDoc(supabase, repoId, {
        activeEngineeringArea: "Verification and repository integrity checks.",
        recentChanges: [
          `Ran ${verifyCmd} with result ${result.ok ? "PASS" : "FAIL"}.`,
        ],
        immediateNextSteps: result.ok
          ? ["Continue implementation or stage the next change."]
          : ["Review verify output and fix failing files before continuing."],
      });
    } catch (e: any) {
      console.log("[chamber-state] verify update skipped:", e?.message);
    }

    const marker = `\n__VERIFY__:${JSON.stringify(verifyPayload)}\n`;

    const txt =
      `[Observation]\nVerification executed.\n\n` +
      `[Assessment]\ncommand=${verifyCmd}\nok=${result.ok} exitCode=${result.exitCode} durationMs=${result.durationMs}\n\n` +
      `[Action]\nstdout:\n${(result.stdout ?? "").slice(0, 3000)}\n\n` +
      `stderr:\n${(result.stderr ?? "").slice(0, 3000)}\n` +
      marker;

    await supabase.from("repo_messages").insert({
      repo_id: repoId,
      user_id: userId,
      role: "assistant",
      content:
        "[Observation]\nVerification executed.\n\n" +
        `[Assessment]\ncommand=${verifyCmd} ok=${Boolean(result.ok)} exitCode=${Number(result.exitCode ?? -1)} durationMs=${Number(result.durationMs ?? 0)}\n\n` +
        "[Action]\nVerification result recorded.",
    });

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[verify] error", { message: e?.message, name: e?.name });

    const txt =
      `[Observation]\nVerification failed.\n\n` +
      `[Assessment]\n${e?.message ?? "Unknown error"}\n\n` +
      `[Action]\nCheck server logs for [verify] and runner logs.\n`;

    return new Response(txt, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}