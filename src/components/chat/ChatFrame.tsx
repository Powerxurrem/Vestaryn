"use client";

import { useEffect, useRef, useState } from "react";
import ChatInput from "./ChatInput";

/**
 * @file ChatFrame.tsx
 * @purpose Obsidian chamber chat UI (history + streaming) for a single repo workspace.
 * @exports ChatFrame
 *
 * @sections
 * - Types
 * - Component state & refs
 * - Helpers (IDs)
 * - Effects: history load, autoscroll
 * - Action: handleSend (streaming pipeline)
 * - Render: chamber planes (history + input deck)
 *
 * @invariants
 * - Streaming must remain stable: placeholder is replaced on first chunk; content accumulates in-order.
 * - Soft-delete/RLS invariants live server-side; this component trusts API output.
 * - Do not add complex state machines here unless mirrored in UI affordances.
 *
 * @touchpoints
 * - GET  /api/repo/[repoId]/messages   (history)
 * - POST /api/repo/[repoId]/chat      (streaming response body)
 *
 * @notes
 * - This file currently updates message content on every streamed chunk.
 *   If perf ever regresses, move streamed content to a separate state/ref and commit once at end.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
};

type Props = { repoId: string };

type ChamberState = "stable" | "analyzing" | "deep" | "archive";

export default function ChatFrame({ repoId }: Props) {
  // ─────────────────────────────────────────────────────────────
  // Component state & refs
  // ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [state, setState] = useState<ChamberState>("stable");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  const makeId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // ─────────────────────────────────────────────────────────────
  // Effects: load history
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      const res = await fetch(`/api/repo/${repoId}/messages`);
      const json = await res.json().catch(() => ({}));

      if (!cancelled && res.ok) {
        const loaded: Message[] = (json.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: new Date(m.created_at).getTime(),
        }));

        setMessages(
          loaded.length > 0
            ? loaded
            : [
                {
                  id: makeId(),
                  role: "system",
                  content: "Vestaryn chamber initialized.",
                  createdAt: Date.now(),
                },
              ]
        );
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [repoId]);

  // ─────────────────────────────────────────────────────────────
  // Effects: autoscroll
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─────────────────────────────────────────────────────────────
  // Action: send message + stream assistant response
  // ─────────────────────────────────────────────────────────────
  const ASSISTANT_PLACEHOLDER =
  `[Observation]\n…\n\n[Assessment]\n…\n\n[Action]\n…`;

const handleSend = async (text: string) => {
  // 1) append user message
  const userMsg: Message = {
    id: makeId(),
    role: "user",
    content: text,
    createdAt: Date.now(),
  };

  setMessages((prev) => [...prev, userMsg]);

  // 2) create assistant placeholder bubble
  const assistantId = makeId();

  setThinking(true);
  setState("analyzing");

  setMessages((prev) => [
    ...prev,
    {
      id: assistantId,
      role: "assistant",
      content: ASSISTANT_PLACEHOLDER, // ✅ use contract placeholder
      createdAt: Date.now(),
    },
  ]);

  try {
    // 3) start streaming request
    const res = await fetch(`/api/repo/${repoId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(errText || `Request failed (${res.status})`);
    }

    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let accumulated = "";
    let sawFirstChunk = false;

    // 4) stream loop: flip state on first chunk, then accumulate
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      if (!sawFirstChunk) {
        sawFirstChunk = true;
        setState("deep");
        // ❌ do NOT clear content to "" (causes empty flash)
      }

      accumulated += chunk;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: accumulated } : m
        )
      );
    }

    // 5) finalize state
    setThinking(false);
    setState("stable");
  } catch (e) {
    // 6) error path: archive state + replace assistant bubble content
    setThinking(false);
    setState("archive");

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              content:
                "[Observation]\nStream failed.\n\n[Assessment]\nThe server did not return a valid stream.\n\n[Action]\nCheck server logs for /api/repo/[repoId]/chat and retry.",
            }
          : m
      )
    );

    console.error(e);
  }
};

  // ─────────────────────────────────────────────────────────────
  // Render: Obsidian chamber (back plane history + front plane input deck)
  // ─────────────────────────────────────────────────────────────
 
 function parseSections(content: string) {
  const sections = {
    observation: "",
    assessment: "",
    action: "",
  };

  const obsMatch = content.match(/\[Observation\]([\s\S]*?)(?=\[Assessment\]|\[Action\]|$)/);
  const assMatch = content.match(/\[Assessment\]([\s\S]*?)(?=\[Action\]|$)/);
  const actMatch = content.match(/\[Action\]([\s\S]*)/);

  if (obsMatch) sections.observation = obsMatch[1].trim();
  if (assMatch) sections.assessment = assMatch[1].trim();
  if (actMatch) sections.action = actMatch[1].trim();

  return sections;
}
  return (
    <section className="relative h-[70vh] w-full rounded-xl overflow-hidden bg-gradient-to-b from-[#0a0f14] via-[#05080c] to-[#020304] shadow-[0_20px_40px_rgba(0,0,0,0.55),0_0_40px_rgba(59,130,246,0.12)] ring-1 ring-blue-500/25">
      {/* Command Seam */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 h-[2px] transition-all duration-500 ${
          state === "stable"
            ? "bg-white/15"
            : state === "analyzing"
            ? "bg-blue-400/40 shadow-[0_0_12px_rgba(59,130,246,0.6)]"
            : state === "deep"
            ? "bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.9)]"
            : "bg-purple-400/50 shadow-[0_0_15px_rgba(168,85,247,0.6)]"
        }`}
      />

      {/* top haze */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(59,130,246,0.10) 0%, rgba(59,130,246,0.04) 18%, transparent 55%)",
        }}
      />

      {/* vertical beam behind content */}
      <div className="pointer-events-none absolute inset-0 z-0 flex items-end justify-center">
        <div
          className={`w-[55%] h-[85%] transition-opacity duration-700 ${
            thinking ? "opacity-100" : "opacity-70"
          }`}
          style={{
            background:
              "linear-gradient(to top, rgba(59,130,246,0.26) 0%, rgba(59,130,246,0.12) 25%, rgba(59,130,246,0.06) 45%, transparent 75%)",
            filter: "blur(60px)",
          }}
        />
      </div>

      {/* etched grid (top only) */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(circle at 50% 20%, black 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 20%, black 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex h-full flex-col">
        {/* BACK PLANE: history */}
        <div className="relative flex-1 overflow-y-auto px-6 py-5">
          {/* recessed panel */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-black/35 shadow-[inset_0_0_90px_rgba(0,0,0,0.90)]" />

          <div className="relative space-y-4">
            {loading && messages.length === 0 && (
              <p className="text-white/30 text-sm">Loading memory…</p>
            )}

            {!loading && messages.length === 0 && (
              <p className="text-white/40 text-sm">The chamber is ready.</p>
            )}

            {messages.map((msg) => {
              const isThinkingBubble = thinking && msg.role === "assistant";

              return (
                <div
                  key={msg.id}
                  className={`max-w-[80%] rounded-lg px-4 py-3 text-sm border ${
                    msg.role === "user"
                      ? "ml-auto bg-white/[0.04] border-blue-500/15 text-white/90 shadow-[inset_0_0_20px_rgba(255,255,255,0.03)]"
                      : msg.role === "system"
                      ? "mx-auto bg-black/20 border-white/10 text-white/50 text-xs"
                      : isThinkingBubble
                      ? "bg-white/[0.04] border-blue-400/25 text-white/90 animate-[pulse_3s_ease-in-out_infinite] shadow-[0_0_25px_rgba(59,130,246,0.25)] backdrop-blur-md"
                      : "bg-gradient-to-b from-white/[0.04] to-white/[0.02] border-white/[0.08] backdrop-blur-md text-white/80 shadow-[inset_0_0_30px_rgba(59,130,246,0.03)]"
                  }`}
                >
                  {msg.role === "assistant" ? (
                      (() => {
                        const s = parseSections(msg.content);

                        return (
                          <div className="space-y-3">
                            {s.observation && (
                              <div className="border-l-2 border-white/20 pl-3">
                                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
                                  Observation
                                </div>
                                <div className="text-white/80">{s.observation}</div>
                              </div>
                            )}
                          <div className="h-px bg-white/5 my-2" />
                            {s.assessment && (
                              <div className="border-l-2 border-blue-400/40 pl-3">
                                <div className="text-[10px] uppercase tracking-widest text-blue-300/60 mb-1">
                                  Assessment
                                </div>
                                <div className="text-white/85">{s.assessment}</div>
                              </div>
                            )}
                          <div className="h-px bg-white/5 my-2" />
                            {s.action && (
                              <div className="border-l-2 border-emerald-400/50 pl-3">
                                <div className="text-[10px] uppercase tracking-widest text-emerald-300/70 mb-1">
                                  Action
                                </div>
                                <div className="text-white/95">{s.action}</div>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      msg.content
                    )}
                </div>
              );
            })}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* FRONT PLANE: input deck */}
        <div className="relative px-6 pb-5 pt-4">
          {/* shadow shelf */}
          <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-black/60" />

          {/* laser seam */}
          <div className="pointer-events-none absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent" />
          <div className="pointer-events-none absolute top-0 left-6 right-6 h-10 bg-gradient-to-b from-blue-400/12 to-transparent" />

          {/* deck plate */}
          <div className="relative rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-md shadow-[0_-18px_45px_rgba(0,0,0,0.75),0_0_25px_rgba(59,130,246,0.08),inset_0_0_30px_rgba(59,130,246,0.05)]">
            <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/[0.06]" />
            <ChatInput onSend={handleSend} />
          </div>
        </div>
      </div>
    </section>
  );
}