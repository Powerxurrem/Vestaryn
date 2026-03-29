// lib/chamber/toolOrchestration/buildStreamedAssistantResponse.ts

type BuildStreamedAssistantResponseArgs = {
  supabase: any;
  repoId: string;
  userId: string;
  responseText: string;
  logLabel: string;
  afterInsert?: () => Promise<void>;
};

export async function buildStreamedAssistantResponse({
  supabase,
  repoId,
  userId,
  responseText,
  logLabel,
  afterInsert,
}: BuildStreamedAssistantResponseArgs): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(responseText));

        const { error: aInsErr } = await supabase.from("repo_messages").insert({
          repo_id: repoId,
          user_id: userId,
          role: "assistant",
          content: responseText,
        });

        if (aInsErr) {
          console.log(logLabel, aInsErr.message);
        } else if (afterInsert) {
          await afterInsert();
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}