import { containsGoalMarker } from "@/types/goalMarkers";
import { loadRepoInference } from "@/lib/chamber/repoInferenceRuntime";
import {
  scrubVisibleToolPayload,
  ensureTriplet,
  stripDuplicateTriplet,
} from "@/lib/vault/utils";
import { hasValidAssistantContract } from "@/lib/chamber/output";
import { isRepositoryExecutionIntent } from "@/lib/chamber/intent";

type Pass1FallbackArgs = {
  supabase: any;
  repoId: string;
  content: string;
  executionMode: any;
  initialHadTools: boolean;
  pendingTools: any[];
  pass1Buffer: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
};

type Pass1FallbackResult = {
  initialHadTools: boolean;
  pendingTools: any[];
  fullText: string;
};

export async function handlePass1FallbackOrchestration({
  supabase,
  repoId,
  content,
  executionMode,
  initialHadTools,
  pendingTools,
  pass1Buffer,
  controller,
  encoder,
}: Pass1FallbackArgs): Promise<Pass1FallbackResult> {
  let fullText = "";
  const rawOut = String(pass1Buffer ?? "");
  const hasGoalMarkers = containsGoalMarker(rawOut);

  if (!initialHadTools) {
    if (
      !hasGoalMarkers &&
      isRepositoryExecutionIntent(content) &&
      executionMode.mode === "incremental"
    ) {
      try {
        console.log("[pass1_fallback] incremental repo execution produced no tools");

        const inferred = await loadRepoInference({
          supabase,
          repoId,
        });

        const filePaths = Array.isArray(inferred?.filePaths)
          ? inferred.filePaths
          : [];

        const preferredPath =
          /background|color|spacing|padding|margin|font|shadow|border|animation|styles?/i.test(content)
            ? filePaths.includes("styles.css")
              ? "styles.css"
              : filePaths.includes("index.html")
                ? "index.html"
                : filePaths.includes("app/page.tsx")
                  ? "app/page.tsx"
                  : null
            : /section|layout|structure|hero|content|sidebar|footer|header/i.test(content)
              ? filePaths.includes("index.html")
                ? "index.html"
                : filePaths.includes("app/page.tsx")
                  ? "app/page.tsx"
                  : filePaths.includes("styles.css")
                    ? "styles.css"
                    : null
              : filePaths.includes("index.html")
                ? "index.html"
                : filePaths.includes("app/page.tsx")
                  ? "app/page.tsx"
                  : filePaths.includes("styles.css")
                    ? "styles.css"
                    : null;

        if (preferredPath) {
          console.log("[pass1_fallback] forcing read", {
            repoId,
            preferredPath,
          });

          initialHadTools = true;
          pendingTools = [
            {
              call_id: `fallback_${Date.now()}`,
              name: "vault_read_text",
              arguments: JSON.stringify({ path: preferredPath }),
            },
          ];
        }
      } catch (e: any) {
        console.log("[pass1_fallback] failed", {
          repoId,
          message: e?.message ?? "unknown error",
        });
      }
    }

    if (!initialHadTools) {
      if (hasGoalMarkers) {
        fullText = rawOut.trim();
        controller.enqueue(encoder.encode(fullText));
      } else {
        let out = scrubVisibleToolPayload(rawOut);
        out = ensureTriplet(stripDuplicateTriplet(out)).trim();

        if (!hasValidAssistantContract(out)) {
          out =
            "[Observation]\nContract violation detected.\n\n" +
            "[Assessment]\nAssistant output did not start with [Observation].\n\n" +
            "[Action]\nRetry the request or adjust prompt to conform to the output contract.";
        }

        fullText = out;
        controller.enqueue(encoder.encode(out));
      }
    } else {
      fullText = "";
    }
  } else {
    fullText = "";
  }

  return {
    initialHadTools,
    pendingTools,
    fullText,
  };
}