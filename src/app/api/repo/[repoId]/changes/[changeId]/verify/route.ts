/**
 * FILE: src/app/api/repo/[repoId]/changes/[changeId]/verify/route.ts
 * PURPOSE: Verify an *applied* change by running a deterministic command in the runner against a repo snapshot.
 *
 * Requires:
 * - lib/runner/snapshot.ts  -> buildRepoSnapshotSignedUrl(...)
 * - lib/runner/client.ts    -> runnerRun(...)
 * - Supabase RPC: is_repo_member(_repo_id uuid) -> boolean
 * - DB tables:
 *   - repo_changes(id, repo_id, status, proposal, updated_at, ...)
 *   - repo_runs(repo_id, change_id, command, ok, exit_code, duration_ms, stdout, stderr, created_at, ...)
 */

import crypto from "crypto";
import { supabaseServerComponent } from "@/lib/supabase/server"; // src/lib/supabase/server.ts
import { createSupabaseAdmin } from "@/lib/supabase/admin";      // src/lib/supabase/admin.ts
import { buildRepoSnapshotSignedUrl } from "@/lib/runner/snapshot"; // src/lib/runner/snapshot.ts
import { runnerRun } from "@/lib/runner/client";                   // src/lib/runner/client.ts

export const runtime = "nodejs";

type VerifyCmd = "node_typecheck"; // v0: keep it simple

export async function POST(
  _req: Request,
  context: { params: Promise<{ repoId: string; changeId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { repoId, changeId } = await context.params;

  // ─────────────────────────────────────────────
  // 1) Auth (user session)
  // ─────────────────────────────────────────────
  const supabase = await supabaseServerComponent();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr) {
    console.log("[change_verify] auth.getUser error:", userErr.message);
  }
  if (!user) return new Response("Unauthorized", { status: 401 });

  // ─────────────────────────────────────────────
  // 2) Membership gate (fail closed)
  // ─────────────────────────────────────────────
  const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", {
    _repo_id: repoId,
  });

  console.log("[change_verify] is_repo_member", {
    repoId,
    userId: user.id,
    isMember,
    memErr: memErr?.message,
  });

  if (memErr) return new Response("Membership check failed", { status: 500 });
  if (!isMember) return new Response("Forbidden", { status: 403 });

  // ─────────────────────────────────────────────
  // 3) Load change (admin / server-authoritative)
  // ─────────────────────────────────────────────
  const supabaseAdmin = createSupabaseAdmin();

  const ch = await supabaseAdmin
    .from("repo_changes")
    .select("id, repo_id, status")
    .eq("id", changeId)
    .eq("repo_id", repoId)
    .single();

  if (ch.error || !ch.data) {
    return new Response(`Change not found: ${ch.error?.message ?? "unknown"}`, {
      status: 404,
    });
  }

  if (ch.data.status !== "applied") {
    return new Response(`Change not in applied state (status=${ch.data.status})`, {
      status: 409,
    });
  }

  // ─────────────────────────────────────────────
  // 4) Snapshot + runner execution
  // ─────────────────────────────────────────────
  const verifyCmd: VerifyCmd = "node_typecheck";
  const jobId = `verify-${repoId}-${changeId}-${Date.now()}`;

  console.log("[change_verify] start", { requestId, repoId, changeId, jobId, verifyCmd });

  try {
    // build snapshot zip in storage + signed URL
    const snap = await buildRepoSnapshotSignedUrl(supabaseAdmin, repoId, jobId, {
      signedUrlTtlSec: 600,
    });

    console.log("[change_verify] snapshot ready", {
      fileCount: snap.fileCount,
      zipBytes: snap.zipBytes,
      objectPath: snap.snapshotObjectPath,
    });

    // run command in runner (timeout bumped)
    const result = await runnerRun({
      jobId,
      commandId: verifyCmd,
      snapshotUrl: snap.snapshotSignedUrl,
      timeoutMs: 300_000,
    });

    console.log("[change_verify] runner returned", {
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      hasStdout: Boolean(result.stdout && result.stdout.trim()),
      hasStderr: Boolean(result.stderr && result.stderr.trim()),
      error: result.error ?? null,
    });

    // ─────────────────────────────────────────────
    // 5) Audit log (repo_runs)
    // ─────────────────────────────────────────────
    const ins = await supabaseAdmin.from("repo_runs").insert({
      repo_id: repoId,
      change_id: changeId,
      command: verifyCmd,
      ok: Boolean(result.ok),
      exit_code: Number(result.exitCode ?? -1),
      duration_ms: Number(result.durationMs ?? 0),
      stdout: String(result.stdout ?? "").slice(0, 8000),
      stderr: String(result.stderr ?? "").slice(0, 8000),

      job_id: jobId,
      runner_fingerprint: result.fingerprint ?? null,
      failed_step: result.failedStep ?? null,
      failure_kind: result.failureKind ?? null,
      timed_out: Boolean(result.timedOut),
    });

    if (ins.error) {
      console.warn("[change_verify] repo_runs insert failed:", ins.error.message);
    }

    // ─────────────────────────────────────────────
    // 6) Update change status
    // ─────────────────────────────────────────────
    const nextStatus = result.ok ? "verified_green" : "verified_red";

    const up = await supabaseAdmin
      .from("repo_changes")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", changeId)
      .eq("repo_id", repoId);

    if (up.error) {
      console.warn("[change_verify] repo_changes update failed:", up.error.message);
      // still return the verify result; UI can show it even if status update failed
    }

    return Response.json({
      ok: true,
      requestId,
      repoId,
      changeId,
      verify: {
        command: verifyCmd,
        ok: Boolean(result.ok),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        error: result.error ?? null,

        jobId,
        fingerprint: result.fingerprint ?? null,
        failedStep: result.failedStep ?? null,
        failureKind: result.failureKind ?? null,
        timedOut: Boolean(result.timedOut),
      },
      snapshot: {
        fileCount: snap.fileCount,
        zipBytes: snap.zipBytes,
        objectPath: snap.snapshotObjectPath,
      },
      status: nextStatus,
    });
  } catch (e: any) {
    const msg = e?.message ?? "unknown";
    console.log("[change_verify] fatal", { requestId, repoId, changeId, msg });

    // fail closed: mark verified_red on unexpected error
    const up = await supabaseAdmin
      .from("repo_changes")
      .update({ status: "verified_red", updated_at: new Date().toISOString() })
      .eq("id", changeId)
      .eq("repo_id", repoId);

    if (up.error) {
      console.warn("[change_verify] repo_changes fail-closed update failed:", up.error.message);
    }

    return new Response(`Verify failed: ${msg}`, { status: 500 });
  }
}