export type RunnerCommandId =
  | "ping"
  | "node_test"
  | "node_lint"
  | "node_typecheck"
  | "node_verify"
  | "python_verify";

export type RunnerFailedStep =
  | "profile"
  | "install"
  | "lint"
  | "typecheck"
  | "test"
  | "exec"
  | null;

export type RunnerResult = {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  error?: string;

  fingerprint?: string;
  failedStep?: RunnerFailedStep;
  failureKind?: string | null;
  timedOut?: boolean;

  profile?: {
    hasPackageJson: boolean;
    hasLockfile: boolean;
    hasTypeScript: boolean;
    hasESLintConfig: boolean;
    hasVerifyScript: boolean;
    hasLintScript: boolean;
    hasTypecheckScript: boolean;
    hasTestScript: boolean;
  };

  steps?: Array<{
    name: "install" | "lint" | "typecheck" | "test";
    ok: boolean;
    skipped?: boolean;
    exitCode?: number;
    reason?: string;
  }>;

    artifactPreview?: {
    type: "xlsx";
    path: string;
    sheets: Array<{
      name: string;
      rows: Array<Array<string | number | boolean | null>>;
    }>;
  };
};

export async function runnerRun(args: {
  jobId: string;
  commandId: RunnerCommandId;
  snapshotUrl?: string;
  timeoutMs?: number;
}): Promise<RunnerResult> {
  const baseRaw = (process.env.RUNNER_URL ?? "").trim();
  const secret = (process.env.RUNNER_SECRET ?? "").trim();
  const base = baseRaw.replace(/\/+$/, "");

  if (!base) throw new Error("RUNNER_URL not set");
  if (!secret) throw new Error("RUNNER_SECRET not set");

  const timeoutMs = Number(args.timeoutMs ?? 60_000);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Math.max(1_000, timeoutMs + 5_000));

  console.log("[runner_client]", {
    base,
    commandId: args.commandId,
    timeoutMs,
    hasSnapshot: Boolean(args.snapshotUrl),
    secretLen: secret.length,
    secretHead: secret.slice(0, 6),
    secretTail: secret.slice(-6),
  });

  try {
    const res = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        jobId: args.jobId,
        commandId: args.commandId,
        timeoutMs,
        snapshotUrl: args.snapshotUrl,
      }),
      signal: ctl.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        exitCode: -1,
        durationMs: 0,
        error: `Runner HTTP ${res.status}: ${txt.slice(0, 500)}`,
        fingerprint: "runner_client:v2",
        failedStep: null,
        failureKind: "runner_http_error",
        timedOut: false,
      };
    }

    const data: any = await res.json().catch(() => null);
    console.log("[runner_client raw artifactPreview]", data?.artifactPreview);
    if (!data || typeof data !== "object") {
      return {
        ok: false,
        exitCode: -1,
        durationMs: 0,
        error: "Runner returned invalid JSON",
        fingerprint: "runner_client:v2",
        failedStep: null,
        failureKind: "runner_invalid_json",
        timedOut: false,
      };
    }

    const ok = Boolean(data.ok);
    const exitCode =
      typeof data.exitCode === "number" ? data.exitCode : ok ? 0 : -1;
    const durationMs =
      typeof data.durationMs === "number" ? data.durationMs : 0;

    const failedStep: RunnerFailedStep =
      data.failedStep === "profile" ||
      data.failedStep === "install" ||
      data.failedStep === "lint" ||
      data.failedStep === "typecheck" ||
      data.failedStep === "test" ||
      data.failedStep === "exec"
        ? data.failedStep
        : null;

        console.log("[runner_client mapped artifactPreview]", {
          raw: data?.artifactPreview,
        });
    return {
      ok,
      exitCode,
      durationMs,
      stdout: typeof data.stdout === "string" ? data.stdout : "",
      stderr: typeof data.stderr === "string" ? data.stderr : "",
      error: typeof data.error === "string" ? data.error : undefined,

      fingerprint:
        typeof data.fingerprint === "string" ? data.fingerprint : "runner:v?",
      failedStep,
      failureKind:
        typeof data.failureKind === "string" ? data.failureKind : null,
      timedOut: Boolean(data.timedOut),

      profile:
        data.profile && typeof data.profile === "object"
          ? {
              hasPackageJson: Boolean(data.profile.hasPackageJson),
              hasLockfile: Boolean(data.profile.hasLockfile),
              hasTypeScript: Boolean(data.profile.hasTypeScript),
              hasESLintConfig: Boolean(data.profile.hasESLintConfig),
              hasVerifyScript: Boolean(data.profile.hasVerifyScript),
              hasLintScript: Boolean(data.profile.hasLintScript),
              hasTypecheckScript: Boolean(data.profile.hasTypecheckScript),
              hasTestScript: Boolean(data.profile.hasTestScript),
            }
          : undefined,

      steps: Array.isArray(data.steps)
        ? data.steps.map((step: any) => ({
            name: step?.name,
            ok: Boolean(step?.ok),
            skipped: Boolean(step?.skipped),
            exitCode:
              typeof step?.exitCode === "number" ? step.exitCode : undefined,
            reason: typeof step?.reason === "string" ? step.reason : undefined,
          }))
        : undefined,

      artifactPreview:  
    data.artifactPreview && typeof data.artifactPreview === "object"
      ? {
          type: data.artifactPreview.type,
          path:
            typeof data.artifactPreview.path === "string"
              ? data.artifactPreview.path
              : "",
          sheets: Array.isArray(data.artifactPreview.sheets)
            ? data.artifactPreview.sheets.map((sheet: any) => ({
                name:
                  typeof sheet?.name === "string" ? sheet.name : "Sheet",
                rows: Array.isArray(sheet?.rows)
                  ? sheet.rows.map((row: any) =>
                      Array.isArray(row)
                        ? row.map((cell: any) =>
                            cell === null ||
                            typeof cell === "string" ||
                            typeof cell === "number" ||
                            typeof cell === "boolean"
                              ? cell
                              : String(cell)
                          )
                        : []
                    )
                  : [],
              }))
          : [],
        }
      : undefined,
    };
  } finally {
    clearTimeout(t);
  }
}