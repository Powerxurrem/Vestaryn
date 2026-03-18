/**
 * FILE: src/app/api/repo/[repoId]/verify/route.ts
 * PURPOSE: Verify current repo snapshot (not tied to a change).
 */

import crypto from "crypto";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { buildRepoSnapshotSignedUrl } from "@/lib/runner/snapshot";
import { runnerRun } from "@/lib/runner/client";
import {
  ALLOWED_VERIFY_COMMANDS,
  type VerifyCommand,
  resolveVerifyCommand,
} from "@/lib/chamber/verifyRuntime";
import { loadRepoInference } from "@/lib/chamber/repoContext";
export const runtime = "nodejs";



export async function POST(
  req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { repoId } = await context.params;

  // 1) Auth
  const supabase = await supabaseServerComponent();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr) console.log("[repo_verify] auth.getUser error:", userErr.message);
  if (!user) return new Response("Unauthorized", { status: 401 });

  // 2) Membership gate (fail closed)
  const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", {
    _repo_id: repoId,
  });

  console.log("[repo_verify] is_repo_member", {
    repoId,
    userId: user.id,
    isMember,
    memErr: memErr?.message,
  });

  if (memErr) return new Response("Membership check failed", { status: 500 });
  if (!isMember) return new Response("Forbidden", { status: 403 });

  // 3) Body
    // 3) Body
  const body = await req.json().catch(() => ({} as any));
  const requestedCommand = String(body?.commandId ?? "");

  const { inference } = await loadRepoInference({
    supabase,
    repoId,
  });

  const inferredFallback =
    resolveVerifyCommand(inference?.projectType ?? null) ?? "node_verify";

  const verifyCmd: VerifyCommand =
    ALLOWED_VERIFY_COMMANDS.includes(requestedCommand as VerifyCommand)
      ? (requestedCommand as VerifyCommand)
      : inferredFallback;

  const runId = typeof body?.runId === "string" ? body.runId : crypto.randomUUID();
  const changeId = typeof body?.changeId === "string" ? body.changeId : null;

  const touchedFileIds = Array.isArray(body?.touchedFileIds) ? body.touchedFileIds : [];
  const touched = touchedFileIds.filter((x: any) => typeof x === "string");

  const jobId = `verify-${repoId}-${Date.now()}`;

  console.log("[repo_verify] start", { requestId, repoId, runId, jobId, verifyCmd });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let supabaseAdmin: ReturnType<typeof createSupabaseAdmin> | null = null;
      let repoRunId: string | null = null;

      try {
        controller.enqueue(
          encoder.encode(
            `[Observation]\nVerify started\nrepo=${repoId}\ncmd=${verifyCmd}\njobId=${jobId}\n\n`
          )
        );

        supabaseAdmin = createSupabaseAdmin();

// Insert repo_runs row (running). repo_runs.ok is NOT NULL so we use placeholders.
{
  const { data: runRow, error: runInsErr } = await supabaseAdmin
    .from("repo_runs")
    .insert({
      repo_id: repoId,
      change_id: changeId,          // may be null
      actor_user_id: user.id,       // new column you added
      command: verifyCmd,

      status: "running",
      touched_file_ids: touched,

      ok: false,
      exit_code: -1,
      duration_ms: 0,
      stdout: "",
      stderr: "",

      job_id: jobId,
      runner_fingerprint: null,
      failed_step: null,
      failure_kind: null,
      timed_out: false,
      summary: null,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runInsErr) {
    console.log("[repo_verify] repo_runs insert error:", runInsErr.message);
  } else {
    repoRunId = runRow.id;
  }
}

// Optional: mark change as verifying
if (changeId) {
  const { error: chUpErr } = await supabaseAdmin
    .from("repo_changes")
    .update({ status: "verifying", updated_at: new Date().toISOString() })
    .eq("id", changeId)
    .eq("repo_id", repoId);

  if (chUpErr) console.log("[repo_verify] repo_changes verifying update error:", chUpErr.message);
}

        // build snapshot zip in storage + signed URL
        const snap = await buildRepoSnapshotSignedUrl(supabaseAdmin, repoId, jobId, {
          signedUrlTtlSec: 600,
        });

        controller.enqueue(
          encoder.encode(
            `[Observation]\nSnapshot ready\nfiles=${snap.fileCount}\nzipBytes=${snap.zipBytes}\n\n`
          )
        );


        
        const result = await runnerRun({
          jobId,
          commandId: verifyCmd,
          snapshotUrl: snap.snapshotSignedUrl,
          timeoutMs: 300_000,
        });

const ok = Boolean(result.ok);

const summary = [
  ok ? "PASS" : "FAIL",
  verifyCmd,
  result.failedStep ? `step=${result.failedStep}` : null,
  result.exitCode != null ? `code=${result.exitCode}` : null,
].filter(Boolean).join(" • ");

if (repoRunId) {
  const { error: runUpErr } = await supabaseAdmin!
    .from("repo_runs")
    .update({
      status: "finished",
      ok,
      exit_code: Number(result.exitCode ?? -1),
      duration_ms: Number(result.durationMs ?? 0),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      job_id: jobId,
      runner_fingerprint: result.fingerprint ?? null,
      failed_step: result.failedStep ?? null,
      failure_kind: result.failureKind ?? null,
      timed_out: Boolean(result.timedOut),
      summary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", repoRunId);

  if (runUpErr) console.log("[repo_verify] repo_runs update error:", runUpErr.message);
}

// Optional: mark change final status
if (changeId) {
  const finalStatus = ok ? "verified_pass" : "verified_fail";
  const { error: chFinalErr } = await supabaseAdmin!
    .from("repo_changes")
    .update({ status: finalStatus, updated_at: new Date().toISOString() })
    .eq("id", changeId)
    .eq("repo_id", repoId);

  if (chFinalErr) console.log("[repo_verify] repo_changes final update error:", chFinalErr.message);
}

        // stream raw outputs for debugging / UX
        if (result.stdout?.trim()) controller.enqueue(encoder.encode(String(result.stdout) + "\n"));
        if (result.stderr?.trim()) controller.enqueue(encoder.encode(String(result.stderr) + "\n"));

        const markerPayload = {
          ok: Boolean(result.ok),
          exitCode: Number(result.exitCode ?? -1),
          durationMs: Number(result.durationMs ?? 0),
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          error: result.error ?? null,

          jobId,
          fingerprint: result.fingerprint ?? null,
          failedStep: result.failedStep ?? null,
          failureKind: result.failureKind ?? null,
          timedOut: Boolean(result.timedOut),

          // helpful for UI + future file-level tracking
          runId,
          repoId,
          command: verifyCmd,
          touchedFileIds: touched,
          changeId,
          repoRunId,
          requestId,
        };

        console.log("[repo_verify] runner returned", {
          ok: result.ok,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          failedStep: result.failedStep,
          failureKind: result.failureKind,
        });
        console.log("[repo_verify] emitting marker bytes=", JSON.stringify(markerPayload).length);

        controller.enqueue(encoder.encode(`\n__VERIFY__:${JSON.stringify(markerPayload)}\n`));
        controller.close();
      } catch (e: any) {
        const msg = e?.message ?? "unknown";
        console.log("[repo_verify] stream fatal", { requestId, repoId, msg });

        // best-effort persistence on server error
        if (supabaseAdmin && repoRunId) {
          const { error: runUpErr } = await supabaseAdmin
            .from("repo_runs")
            .update({
              status: "finished",
              ok: false,
              exit_code: -1,
              duration_ms: 0,
              stdout: "",
              stderr: "",
              runner_fingerprint: "repo_verify_route",
              failed_step: "server",
              failure_kind: "server_error",
              timed_out: false,
              summary: `FAIL • ${verifyCmd} • server_error`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", repoRunId);

          if (runUpErr) console.log("[repo_verify] repo_runs catch update error:", runUpErr.message);
        }

        if (supabaseAdmin && changeId) {
          const { error: chErr } = await supabaseAdmin
            .from("repo_changes")
            .update({ status: "verified_fail", updated_at: new Date().toISOString() })
            .eq("id", changeId)
            .eq("repo_id", repoId);

          if (chErr) console.log("[repo_verify] repo_changes catch update error:", chErr.message);
        }

        const markerPayload = {
          ok: false,
          exitCode: -1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: msg,
          jobId,
          fingerprint: "repo_verify_route",
          failedStep: "server",
          failureKind: "server_error",
          timedOut: false,
          runId,
          repoId,
          command: verifyCmd,
          touchedFileIds: touched,
          changeId,
          repoRunId,
          requestId,
        };

        controller.enqueue(encoder.encode(`[Assessment]\nVerify failed: ${msg}\n\n`));
        controller.enqueue(encoder.encode(`__VERIFY__:${JSON.stringify(markerPayload)}\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}