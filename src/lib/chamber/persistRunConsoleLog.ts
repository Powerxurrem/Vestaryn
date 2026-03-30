type PersistRunConsoleLogArgs = {
  supabase: any;
  bucket: string;
  repoId: string;
  runId: string;
  runKind?: string | null;
  createdAt?: string | null;
  failedStep?: string | null;
  durationMs?: number | null;
  stdout?: string | null;
  stderr?: string | null;
};

type PersistRunConsoleLogResult = {
  stdoutPreview: string;
  stderrPreview: string;
  logStorageKey: string;
  logSizeBytes: number;
  fullLogText: string;
};

function slicePreview(input: string, max = 4000) {
  return String(input ?? "").slice(0, max);
}

function buildConsoleLogText(args: {
  repoId: string;
  runId: string;
  runKind?: string | null;
  createdAt?: string | null;
  failedStep?: string | null;
  durationMs?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}) {
  const stdout = String(args.stdout ?? "");
  const stderr = String(args.stderr ?? "");

  return [
    `run_id: ${args.runId}`,
    `repo_id: ${args.repoId}`,
    `kind: ${args.runKind ?? ""}`,
    `created_at: ${args.createdAt ?? ""}`,
    `failed_step: ${args.failedStep ?? ""}`,
    `duration_ms: ${args.durationMs ?? ""}`,
    "",
    "=== STDOUT ===",
    stdout,
    "",
    "=== STDERR ===",
    stderr,
    "",
  ].join("\n");
}

export async function persistRunConsoleLog(
  args: PersistRunConsoleLogArgs
): Promise<PersistRunConsoleLogResult> {
  const {
    supabase,
    bucket,
    repoId,
    runId,
    runKind,
    createdAt,
    failedStep,
    durationMs,
    stdout,
    stderr,
  } = args;

  const stdoutText = String(stdout ?? "");
  const stderrText = String(stderr ?? "");

  const stdoutPreview = slicePreview(stdoutText);
  const stderrPreview = slicePreview(stderrText);

  const fullLogText = buildConsoleLogText({
    repoId,
    runId,
    runKind,
    createdAt,
    failedStep,
    durationMs,
    stdout: stdoutText,
    stderr: stderrText,
  });

  const logStorageKey = `runs/${repoId}/${runId}/console.log`;
  const body = new TextEncoder().encode(fullLogText);
  const logSizeBytes = body.byteLength;

  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(logStorageKey, body, {
      contentType: "text/plain; charset=utf-8",
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(`Console log upload failed: ${uploadErr.message}`);
  }

  return {
    stdoutPreview,
    stderrPreview,
    logStorageKey,
    logSizeBytes,
    fullLogText,
  };
}