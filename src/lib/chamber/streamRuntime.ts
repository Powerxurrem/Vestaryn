export async function streamResponse(args: {
  respStream: any;
  mode: "pass1" | "pass2";
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  onFirstToken?: () => void;
  onResponseCreated?: (id: string) => void;
}): Promise<{
  sawToolsThisPass: boolean;
  buffer: string;
  builtPendingTools: { call_id: string; name: string; arguments: string }[];
}> {
  const {
    respStream,
    mode,
    controller,
    encoder,
    onFirstToken,
    onResponseCreated,
  } = args;

  let sawToolsThisPass = false;
  let sentAnyDelta = false;
  let messageDoneText = "";
  let buffer = "";

  const toolArgsByCallId = new Map<string, string>();
  const toolNameByCallId = new Map<string, string>();

  for await (const event of respStream) {
    const e: any = event;

    if (
      (e.type === "response.created" || e.type === "response.running") &&
      e.response?.id
    ) {
      onResponseCreated?.(e.response.id);
    }

    if (e.type === "response.output_item.added" && e.item?.type === "function_call") {
      sawToolsThisPass = true;

      const callId = e.item.call_id || e.item.id;
      if (callId) {
        toolNameByCallId.set(callId, String(e.item.name ?? ""));
        if (typeof e.item.arguments === "string") {
          toolArgsByCallId.set(callId, e.item.arguments);
        }
      }
      continue;
    }

    if (e.type === "response.function_call_arguments.delta") {
      const callId = e.call_id || e.item_id;
      if (callId) {
        toolArgsByCallId.set(
          callId,
          (toolArgsByCallId.get(callId) ?? "") + (e.delta ?? "")
        );
      }
      continue;
    }

    if (e.type === "response.function_call_arguments.done") {
      const callId = e.call_id || e.item_id;
      if (callId && typeof e.arguments === "string") {
        toolArgsByCallId.set(callId, e.arguments);
      }
      continue;
    }

    if (e.type === "response.output_item.done" && e.item?.type === "function_call") {
      const callId = e.item.call_id || e.item.id;
      if (callId) {
        toolNameByCallId.set(callId, String(e.item.name ?? ""));
        if (typeof e.item.arguments === "string") {
          toolArgsByCallId.set(callId, e.item.arguments);
        }
      }
      continue;
    }

    if (e.type === "response.output_item.done" && e.item?.type === "message") {
      let combined = "";
      const parts = Array.isArray(e.item.content) ? e.item.content : [];

      for (const p of parts) {
        if (typeof p?.text === "string") combined += p.text;
        if (typeof p?.output_text === "string") combined += p.output_text;
        if (typeof p?.content === "string") combined += p.content;
        if (typeof p?.value === "string") combined += p.value;
        if (p?.text && typeof p.text?.value === "string") combined += p.text.value;
      }

      if (combined) {
        messageDoneText = combined;
      }
      continue;
    }

    if (e.type === "response.output_text.delta") {
      if (!sentAnyDelta) {
        onFirstToken?.();
      }

      sentAnyDelta = true;
      const chunk = e.delta ?? "";
      if (!chunk) continue;

      buffer += chunk;
      continue;
    }

    if (e.type === "response.output_text.done") {
      if (sentAnyDelta) continue;

      const txt = e.text ?? "";
      if (!txt) continue;

      onFirstToken?.();
      buffer += txt;
      continue;
    }

    if (e.type === "response.completed") {
      const finalText = (e.response?.output_text ?? "").toString();

      if (!sentAnyDelta) {
        if (finalText) {
          buffer += finalText;
        } else if (messageDoneText) {
          buffer += messageDoneText;
        }
      }

      break;
    }
  }

  const builtPendingTools = Array.from(toolNameByCallId.entries()).map(
    ([call_id, name]) => ({
      call_id,
      name,
      arguments: toolArgsByCallId.get(call_id) ?? "",
    })
  );

  return {
    sawToolsThisPass,
    buffer,
    builtPendingTools,
  };
}