import { runnerRun } from "@/lib/runner/client";

export async function tryHandleRunnerPing(args: {
  content: string;
  repoId: string;
}): Promise<Response | null> {
  const { content, repoId } = args;

  if (content.trim() !== "__RUNNER_PING__") {
    return null;
  }

  try {
    console.log("[runner_ping] calling runnerRun", {
      base: (process.env.RUNNER_URL ?? "").trim(),
      secretLen: ((process.env.RUNNER_SECRET ?? "").trim()).length,
      repoId,
    });

    const result = await runnerRun({
      jobId: `ping-${repoId}-${Date.now()}`,
      commandId: "ping",
      timeoutMs: 30_000,
    });

    console.log("[runner_ping] runnerRun returned", {
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      error: result.error ?? null,
    });

    const txt =
      `[Observation]\nVerification executed.\n\n` +
      `[Assessment]\n` +
      `command=ping\n` +
      `ok=${result.ok} exitCode=${result.exitCode} durationMs=${result.durationMs}\n` +
      `error=${result.error ?? "null"}\n\n` +
      `[Action]\nstdout:\n${(result.stdout ?? "").slice(0, 3000)}\n\n` +
      `stderr:\n${(result.stderr ?? "").slice(0, 3000)}\n`;

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[runner_ping] error", {
      name: e?.name,
      message: e?.message,
      code: e?.code,
    });

    console.log("[runner_ping] message:", e?.message);
    console.log("[runner_ping] cause:", e?.cause);

    const txt =
      `[Observation]\nRunner ping failed.\n\n` +
      `[Assessment]\n${e?.message ?? "Unknown error"}\n\n` +
      `[Action]\nCheck RUNNER_URL/RUNNER_SECRET and Fly app status.\n`;

    return new Response(txt, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}