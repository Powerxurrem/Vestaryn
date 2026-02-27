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
  const baseRaw = (process.env.RUNNER_URL ?? "").trim();
  const secret = (process.env.RUNNER_SECRET ?? "").trim();
  const base = baseRaw.replace(/\/+$/, "");

  console.log("[runner_client]", {
    base,
    secretLen: secret.length,
    secretHead: secret.slice(0, 6),
    secretTail: secret.slice(-6),
  });

  if (!base) throw new Error("RUNNER_URL missing/empty");
  if (!secret) throw new Error("RUNNER_SECRET missing/empty");

  const timeoutMs = args.timeoutMs ?? 30_000;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const resp = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(args),
      signal: ac.signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Runner HTTP ${resp.status}: ${txt}`);
    }

    return (await resp.json()) as RunnerResult;
  } finally {
    clearTimeout(t);
  }
}