export function emitMaintenanceIfNeeded(args: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  forceMaintenance: boolean;
  totalMsgCount: number | null | undefined;
  repoId: string;
  triggerMsgs: number;
}) {
  const {
    controller,
    encoder,
    forceMaintenance,
    totalMsgCount,
    repoId,
    triggerMsgs,
  } = args;

  try {
    const msgCount = Number(totalMsgCount ?? 0);
    const messageCap = triggerMsgs;

    const shouldEmit = forceMaintenance || msgCount >= triggerMsgs;
    if (!shouldEmit) return;

    const payload = forceMaintenance
      ? {
          type: "recommend_resummarize",
          reason: "dev_force",
          count: msgCount,
          cap: messageCap,
        }
      : {
          type: "recommend_resummarize",
          reason: "message_cap",
          count: msgCount,
          cap: messageCap,
        };

    console.log("[maintenance] trigger", {
      repoId,
      msgCount,
      cap: messageCap,
      forceMaintenance,
    });

    controller.enqueue(
      encoder.encode(`\n__MAINTENANCE__:${JSON.stringify(payload)}\n`)
    );

    console.log("[maintenance] emitted", payload);
  } catch (e: any) {
    console.log("[maintenance] emit failed:", e?.message ?? e);
  }
}

export async function autoResummarizeIfNeeded(args: {
  repoId: string;
  totalMsgCount: number | null | undefined;
}) {
  const { repoId, totalMsgCount } = args;

  try {
    const messageCap = 160;
    const msgCount = Number(totalMsgCount ?? 0);

    if (msgCount < messageCap) return;

    console.log("[maintenance] auto-resummarize trigger", {
      repoId,
      msgCount,
    });

    await fetch(`/api/repo/${repoId}/maintenance/resummarize`, {
      method: "POST",
    });
  } catch (e: any) {
    console.log("[maintenance] auto-resummarize failed:", e?.message);
  }
}