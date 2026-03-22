import OpenAI from "openai";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { buildRepoSnapshotSignedUrl } from "@/lib/runner/snapshot";
import { runnerRun } from "@/lib/runner/client";
import { stripCodeFences } from "@/lib/vault/utils";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type VerifyCommand =
  | "node_verify"
  | "node_lint"
  | "node_typecheck"
  | "node_test"
  | "python_verify";

export function isBaselinePreverifyFailure(
  baseline: {
    failedStep?: string | null;
    stdout?: string;
    stderr?: string;
    error?: string | null;
  },
  preverify: {
    failedStep?: string | null;
    stdout?: string;
    stderr?: string;
    error?: string | null;
  }
) {
  const baselineText = [
    baseline.error ?? "",
    baseline.stderr ?? "",
    baseline.stdout ?? "",
  ]
    .join("\n")
    .toLowerCase();

  const preverifyText = [
    preverify.error ?? "",
    preverify.stderr ?? "",
    preverify.stdout ?? "",
  ]
    .join("\n")
    .toLowerCase();

  const baselineStep = String(baseline.failedStep ?? "").trim();
  const preverifyStep = String(preverify.failedStep ?? "").trim();

  if (!baselineStep || !preverifyStep) return false;
  if (baselineStep !== preverifyStep) return false;

  const overlapNeedles = [
    "could not find a declaration file for module 'react'",
    "cannot use jsx unless the '--jsx' flag is provided",
    "'--jsx' is not set",
    "no interface 'jsx.intrinsicelements' exists",
    "module '@/components/",
    "parsing error",
    "eslint",
    "modulenotfounderror",
    "importerror",
    "syntaxerror",
    "indentationerror",
    "nameerror",
    "attributeerror",
  ];

  return overlapNeedles.some(
    (needle) =>
      baselineText.includes(needle) &&
      preverifyText.includes(needle)
  );
}

export async function runPreVerifyForProposalSet(opts: {
  repoId: string;
  verifyCmd: VerifyCommand;
  proposals: Array<{
    fileId: string;
    path?: string | null;
    mime?: string | null;
    content: string;
    meta?: any;
  }>;
}) {
  const { repoId, proposals, verifyCmd } = opts;
  const jobId = `preverify-${repoId}-${Date.now()}`;
  const supabaseAdmin = createSupabaseAdmin();

  const overlayByPath = new Map<string, { content: string; mime?: string | null }>();

  for (const p of proposals) {
    const path = String(p?.path ?? p?.meta?.path ?? "").trim();
    if (!path) continue;

    overlayByPath.set(path, {
      content: String(p?.content ?? ""),
      mime: p?.mime ?? p?.meta?.mime ?? null,
    });
  }

  const snap = await buildRepoSnapshotSignedUrl(supabaseAdmin, repoId, jobId, {
    signedUrlTtlSec: 600,
    overlayFiles: Array.from(overlayByPath.entries()).map(([path, v]) => ({
      path,
      content: v.content,
      mime: v.mime ?? undefined,
    })),
  });

  const result = await runnerRun({
    jobId,
    commandId: verifyCmd,
    snapshotUrl: snap.snapshotSignedUrl,
    timeoutMs: 120_000,
  });

  return {
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
    fileIds: proposals.map((p) => String(p.fileId)).filter(Boolean),
    paths: proposals.map((p) => String(p.path ?? p.meta?.path ?? "")).filter(Boolean),
  };
}

export function shouldPreVerifyProposalSet(
  proposals: Array<{ path?: string | null; mime?: string | null }>
) {
  return proposals.some((p) => {
    const path = String(p?.path ?? "").toLowerCase();
    return (
      path.endsWith(".ts") ||
      path.endsWith(".tsx") ||
      path.endsWith(".js") ||
      path.endsWith(".jsx") ||
      path.endsWith(".mjs") ||
      path.endsWith(".cjs") ||
      path.endsWith(".py")
    );
  });
}

export async function attemptFastPathRepair(opts: {
  repoId: string;
  path: string;
  fileId: string;
  failedStep?: string | null;
  userRequest: string;
  currentContent: string;
  stdout?: string;
  stderr?: string;
  error?: string | null;
}) {
  console.log("[repair] starting repair model");

  const failureText = [
    opts.error ? `error:\n${opts.error}` : "",
    opts.stderr ? `stderr:\n${opts.stderr}` : "",
    opts.stdout ? `stdout:\n${opts.stdout}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);

  const prompt = `
You are repairing a single repository file after sandbox verification failed.

Rules:
- Return ONLY the full repaired file contents.
- Do not include markdown fences.
- Do not include explanation.
- Preserve the user's requested change if possible.
- Prefer the smallest possible edit that makes verification pass.
- Do not rewrite unrelated parts of the file.
- Do not change exports, props, hooks, or rendered output unless the verification failure requires it.

User request:
${opts.userRequest}

Target file:
${opts.path}

Failed step:
${opts.failedStep ?? "unknown"}

Verification failure:
${failureText}

Current file content:
<<<FILE
${opts.currentContent}
FILE
>>>
`.trim();

  const resp = await openai.responses.create({
    model: "gpt-5-mini",
    input: prompt,
    max_output_tokens: 2200,
  });

  const repairedText = stripCodeFences((resp.output_text || "").trim());

  return {
    ok: Boolean(repairedText),
    proposal: repairedText,
  };
}

export async function runAutoVerifyForRepo(opts: {
  repoId: string;
  verifyCmd?: VerifyCommand | null;
}) {
  const { repoId, verifyCmd = null } = opts;
  const jobId = `verify-${repoId}-${Date.now()}`;
  const supabaseAdmin = createSupabaseAdmin();

  const { data: files, error: filesErr } = await supabaseAdmin
    .from("repo_files")
    .select("id, path, mime")
    .eq("repo_id", repoId)
    .is("deleted_at", null);

  if (filesErr) {
    throw new Error(`Auto verify file lookup failed: ${filesErr.message}`);
  }

  if (!files || files.length === 0) {
    console.log("[verify] skipped: empty_repo", { repoId });

    return {
      skipped: true,
      skipReason: "empty_repo",
      verifyPayload: {
        command: verifyCmd,
        ok: true,
        skipped: true,
        skipReason: "empty_repo",
        exitCode: 0,
        durationMs: 0,
        stdout: "",
        stderr: "",
        error: null,
        jobId,
        fingerprint: null,
        failedStep: null,
        failureKind: null,
        timedOut: false,
      },
      result: null,
    };
  }

  const verifyableFiles = (files ?? []).filter((f) => {
    const path = String(f.path ?? "").toLowerCase();

    if (!path) return false;
    if (path.startsWith("memory/")) return false;
    if (path.endsWith(".md")) return false;

    return true;
  });

  console.log("[verify] verifyable files", {
    repoId,
    allPaths: (files ?? []).map((f) => f.path),
    verifyablePaths: verifyableFiles.map((f) => f.path),
  });

  if (verifyableFiles.length === 0) {
    console.log("[verify] skipped: no_verifyable_files", {
      repoId,
      fileCount: files?.length ?? 0,
    });

    return {
      skipped: true,
      skipReason: "no_verifyable_files",
      verifyPayload: {
        command: verifyCmd,
        ok: true,
        skipped: true,
        skipReason: "no_verifyable_files",
        exitCode: 0,
        durationMs: 0,
        stdout: "",
        stderr: "",
        error: null,
        jobId,
        fingerprint: null,
        failedStep: null,
        failureKind: null,
        timedOut: false,
      },
      result: null,
    };
  }

  if (!verifyCmd) {
    console.log("[verify] skipped: no_verify_command", { repoId });

    return {
      skipped: true,
      skipReason: "no_verify_command",
      verifyPayload: {
        command: null,
        ok: true,
        skipped: true,
        skipReason: "no_verify_command",
        exitCode: 0,
        durationMs: 0,
        stdout: "",
        stderr: "",
        error: null,
        jobId: null,
        fingerprint: null,
        failedStep: null,
        failureKind: null,
        timedOut: false,
      },
      result: null,
    };
  }

  const snap = await buildRepoSnapshotSignedUrl(supabaseAdmin, repoId, jobId, {
    signedUrlTtlSec: 600,
  });

  const result = await runnerRun({
    jobId,
    commandId: verifyCmd,
    snapshotUrl: snap.snapshotSignedUrl,
    timeoutMs: 120_000,
  });

  await supabaseAdmin.from("repo_runs").insert({
    repo_id: repoId,
    change_id: null,
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

  return {
    skipped: false,
    skipReason: null,
    verifyPayload: {
      command: verifyCmd,
      ok: Boolean(result.ok),
      skipped: false,
      skipReason: null,
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
    },
    result,
  };
}

export function buildPendingVerifyPayload(opts: {
  fileIds: string[];
  command?: VerifyCommand | null;
}) {
  return {
    pending: true,
    command: opts.command ?? null,
    fileIds: opts.fileIds,
  };
}

export function buildFinalVerifyPayload(opts: {
  base: any;
  fileIds: string[];
}) {
  return {
    pending: false,
    ...opts.base,
    fileIds: opts.fileIds,
  };
}

export async function attemptRepairProposalSet(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  proposals: Array<{
    fileId: string;
    content: string;
    path?: string | null;
    mime?: string | null;
    meta?: any;
  }>;
  preverify: {
    command: string;
    ok: boolean;
    exitCode: number;
    stdout?: string;
    stderr?: string;
    error?: string | null;
    failedStep?: string | null;
    failureKind?: string | null;
  };
}) {
  const prompt = `
You are repairing a staged repository proposal that failed verification.

Return ONLY valid JSON in this exact shape:
{
  "proposals": [
    {
      "fileId": "existing-file-id",
      "path": "repo/path.ext",
      "content": "full updated file content",
      "mime": "optional mime"
    }
  ]
}

Rules:
- Do not include markdown fences.
- Do not include explanation.
- Do not include any text before or after the JSON.
- Keep the same fileIds and paths.
- Return the FULL updated file content for each changed file.
- Only include proposals that need modification.
- Fix the verification failure.

Original user request:
${opts.userRequest}

Current staged proposals:
${JSON.stringify(
  opts.proposals.map((p) => ({
    fileId: p.fileId,
    path: p.path ?? p.meta?.path ?? "",
    mime: p.mime ?? p.meta?.mime ?? null,
    content: p.content,
  }))
)}

Preverify result:
command=${opts.preverify.command}
ok=${opts.preverify.ok}
exitCode=${opts.preverify.exitCode}
failedStep=${opts.preverify.failedStep ?? ""}
failureKind=${opts.preverify.failureKind ?? ""}
stderr:
${opts.preverify.stderr ?? ""}

stdout:
${opts.preverify.stdout ?? ""}

error:
${opts.preverify.error ?? ""}
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: 3200,
  });

  const raw = (resp.output_text || "").trim();

  let parsed: any;

  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log("[repair] invalid JSON");
    return opts.proposals;
  }

  const repairs = Array.isArray(parsed?.proposals) ? parsed.proposals : [];

  const repairMap = new Map<
    string,
    {
      fileId: string;
      path: string;
      content: string;
      mime?: string;
    }
  >(
    repairs
      .filter((p: any) => typeof p?.fileId === "string" && typeof p?.content === "string")
      .map((p: any) => [
        String(p.fileId),
        {
          fileId: String(p.fileId),
          path: String(p.path ?? "").trim(),
          content: String(p.content),
          mime: p?.mime ? String(p.mime) : undefined,
        },
      ])
  );

  return opts.proposals.map((p) => {
    const repair = repairMap.get(String(p.fileId));
    if (!repair) return p;

    return {
      ...p,
      content: repair.content,
      path: repair.path || p.path || p.meta?.path || null,
      mime: repair.mime ?? p.mime ?? p.meta?.mime ?? null,
    };
  });
}