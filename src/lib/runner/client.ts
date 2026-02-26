export type RunnerResult = {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  fingerprint?: string;
};

export async function runnerRun(args: {
  jobId: string;
  commandId: "ping" | "node_test" | "node_lint" | "node_typecheck";
  snapshotUrl?: string;
  timeoutMs?: number;
}): Promise<RunnerResult> {
  const base = process.env.RUNNER_URL;
  const secret = process.env.RUNNER_SECRET;

  if (!base) throw new Error("RUNNER_URL not set");
  if (!secret) throw new Error("RUNNER_SECRET not set");

  const resp = await fetch(`${base}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(args),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Runner HTTP ${resp.status}: ${txt}`);
  }

  return (await resp.json()) as RunnerResult;
}