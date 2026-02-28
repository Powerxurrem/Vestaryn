"use client";

import { useEffect, useRef, useState } from "react";
import ChatInput from "./ChatInput";
import { flushSync } from "react-dom";
import TierSwitcher from "@/components/dev/TierSwitcher";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
};

type Props = { repoId: string };

type ChamberState = "stable" | "analyzing" | "deep" | "archive";

export default function ChatFrame({ repoId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [state, setState] = useState<ChamberState>("stable");
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const [lastEngraving, setLastEngraving] = useState<any | null>(null);

    const [lastProposal, setLastProposal] = useState<{
    fileId: string;
    content: string;
    prevHash: string;
    nextHash: string;
    confirm: string;
  } | null>(null);
  const [lastVerify, setLastVerify] = useState<any | null>(null);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // hard lock to prevent double-submit / overlapping requests
  const sendingRef = useRef(false);

  const ASSISTANT_PLACEHOLDER = `[Observation]\n…\n\n[Assessment]\n…\n\n[Action]\n…`;

  const makeId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
function parseSections(content: string) {
  const sections = { observation: "", assessment: "", action: "" };

  const obsMatch = content.match(
    /\[Observation\]([\s\S]*?)(?=\[Assessment\]|\[Action\]|$)/
  );
  const assMatch = content.match(/\[Assessment\]([\s\S]*?)(?=\[Action\]|$)/);
  const actMatch = content.match(/\[Action\]([\s\S]*)/);

  if (obsMatch) sections.observation = obsMatch[1].trim();
  if (assMatch) sections.assessment = assMatch[1].trim();
  if (actMatch) sections.action = actMatch[1].trim();

  // Guard: if model repeats [Observation] inside [Action], trim it out
  if (sections.action.includes("[Observation]")) {
    sections.action = sections.action.split("[Observation]")[0].trim();
  }

  return sections;
}

  function extractConfirmPhrase(text: string) {
    const m = text.match(
      /APPLY\s+[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\s+[0-9a-f]{64}/i
    );
    return m ? m[0].trim() : null;
  }

function isContractComplete(t: string) {
  return (
    t.includes("[Observation]") &&
    t.includes("[Assessment]") &&
    t.includes("[Action]")
  );
}

  // ─────────────────────────────────────────────────────────────
  // Effects: load history
  // ─────────────────────────────────────────────────────────────
useEffect(() => {
  if (!repoId || repoId === "undefined") return;

  const seq = ++loadSeqRef.current;

  // Abort any in-flight history load
  loadAbortRef.current?.abort();
  const controller = new AbortController();
  loadAbortRef.current = controller;

  async function fetchOnce(): Promise<Message[]> {
    const res = await fetch(`/api/repo/${repoId}/messages`, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
      headers: { "Cache-Control": "no-store" },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

    const loaded: Message[] = (json.messages ?? []).map((m: any) => {
      const ts =
        typeof m.createdAt === "number"
          ? m.createdAt
          : m.created_at
          ? new Date(m.created_at).getTime()
          : Date.now();

      return {
        id: String(m.id),
        role: m.role,
        content: String(m.content ?? ""),
        createdAt: ts,
      };
    });

    return loaded;
  }

  (async () => {
    // Keep existing messages on screen; just show loader
    setLoading(true);

    try {
      let loaded = await fetchOnce();

      // Retry once if empty (covers transient auth/cookie readiness)
      if (loaded.length === 0) {
        await new Promise((r) => setTimeout(r, 150));
        if (seq !== loadSeqRef.current) return;
        loaded = await fetchOnce();
      }

      if (seq !== loadSeqRef.current) return;

      // IMPORTANT: do not inject a fake "initialized" message
      setMessages(loaded);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      if (seq !== loadSeqRef.current) return;

      // If we already have messages, keep them; otherwise show deterministic error
      setMessages((prev) =>
        prev.length
          ? prev
          : [
              {
                id: makeId(),
                role: "system",
                content: `Chamber memory unavailable. ${e?.message ?? ""}`.trim(),
                createdAt: Date.now(),
              },
            ]
      );
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  })();

  return () => controller.abort();
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

const handleSend = async (text: string) => {
  const trimmed = text.trim();
  console.log("[handleSend] sending:", trimmed);
  if (!trimmed) return;

  if (sendingRef.current) return;
  sendingRef.current = true;

  setPendingConfirm(null);

  const userMsg: Message = {
    id: makeId(),
    role: "user",
    content: trimmed,
    createdAt: Date.now(),
  };
  setMessages((prev) => [...prev, userMsg]);

  const assistantId = makeId();
  streamingAssistantIdRef.current = assistantId;

  setThinking(true);
  setState("analyzing");

  setMessages((prev) => [
    ...prev,
    {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    },
  ]);

  try {
const tier =
  typeof window !== "undefined"
    ? localStorage.getItem("vestaryn.tier") ?? "free"
    : "free";

const res = await fetch(`/api/repo/${repoId}/chat`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-vestaryn-tier": tier,
  },
  body: JSON.stringify({ content: trimmed }),
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

    while (true) {
      const { value, done } = await reader.read();
      console.log("[stream] read", {
      done,
      bytes: value?.byteLength ?? 0,
      t: performance.now().toFixed(0),
    });
      
      console.log("[stream] chunk bytes:", value?.byteLength ?? 0);
      
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      if (!sawFirstChunk) {
        sawFirstChunk = true;
        setState("deep");
      }

      accumulated += chunk;
      if (accumulated.includes("__RESET__")) {
        // wipe current assistant bubble and continue streaming fresh
        accumulated = accumulated.replace(/\n__RESET__\n/g, "");
      }
      const maybeConfirm = extractConfirmPhrase(accumulated);
        if (maybeConfirm) setPendingConfirm(maybeConfirm);  

 // ─────────────────────────────────────────────
// Marker extraction (proposal + verify)
// Markers are injected as standalone lines:
//   __PROPOSAL__:{json}\n
//   __VERIFY__:{json}\n
// We strip them out so they never render as chat text.
// ─────────────────────────────────────────────
const lines = accumulated.split("\n");
let changed = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i] ?? "";

  // Proposal marker
  if (line.startsWith("__PROPOSAL__:")) {
    const jsonStr = line.slice("__PROPOSAL__:".length).trim();
    try {
      const proposal = JSON.parse(jsonStr);

      if (
        proposal?.fileId &&
        proposal?.content &&
        proposal?.prevHash &&
        proposal?.nextHash &&
        (proposal?.confirm || proposal?.pendingConfirmPhrase)
      ) {
        const confirm = String(proposal.confirm || proposal.pendingConfirmPhrase);

        setLastProposal({
          fileId: proposal.fileId,
          content: proposal.content,
          prevHash: proposal.prevHash,
          nextHash: proposal.nextHash,
          confirm,
        });

        setPendingConfirm(confirm);
      }
    } catch {}

    lines[i] = ""; // strip line
    changed = true;
  }

  // Verify marker
  if (line.startsWith("__VERIFY__:")) {
    const jsonStr = line.slice("__VERIFY__:".length).trim();
    try {
      const verify = JSON.parse(jsonStr);
      setLastVerify(verify);
    } catch {}

    lines[i] = ""; // strip line
    changed = true;
  }

  // Engraving marker
  if (line.startsWith("__ENGRAVING__:")) {
    const jsonStr = line.slice("__ENGRAVING__:".length).trim();
    try {
      const engr = JSON.parse(jsonStr);
      setLastEngraving(engr);

      // Reuse existing proposal UX: engr.proposal is a vault proposal
      const p = engr?.proposal;
      if (
        p?.fileId &&
        p?.content &&
        p?.prevHash &&
        p?.nextHash &&
        (p?.confirm || p?.pendingConfirmPhrase)
      ) {
        const confirm = String(p.confirm || p.pendingConfirmPhrase);

        setLastProposal({
          fileId: p.fileId,
          content: p.content,
          prevHash: p.prevHash,
          nextHash: p.nextHash,
          confirm,
        });

        setPendingConfirm(confirm);
      }
    } catch {}

    lines[i] = ""; // strip line
    changed = true;
  }
}
if (changed) {
  accumulated = lines.filter((l) => l !== "").join("\n");
}

flushSync(() => {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === assistantId ? { ...m, content: accumulated } : m
    )
  );
});
    } // ✅ closes while

    setThinking(false);
    setState("stable");
  } catch (e) {
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
    } finally {
      streamingAssistantIdRef.current = null;
      sendingRef.current = false;
    }
};
  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    
    <section className="relative h-[70vh] w-full rounded-xl overflow-hidden bg-gradient-to-b from-[#0a0f14] via-[#05080c] to-[#020304] shadow-[0_20px_40px_rgba(0,0,0,0.55),0_0_40px_rgba(59,130,246,0.12)] ring-1 ring-blue-500/25">
<div className="fixed right-6 top-6 z-[999]">
  <TierSwitcher />
</div>
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

      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(59,130,246,0.10) 0%, rgba(59,130,246,0.04) 18%, transparent 55%)",
        }}
      />

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

      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(circle at 50% 20%, black 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 20%, black 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex h-full flex-col">
        <div className="relative flex-1 overflow-y-auto px-6 py-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-black/35 shadow-[inset_0_0_90px_rgba(0,0,0,0.90)]" />

          <div className="relative space-y-4">

            {loading && messages.length === 0 && (
              <p className="text-white/30 text-sm">Loading memory…</p>
            )}

            {!loading && messages.length === 0 && (
              <p className="text-white/40 text-sm">The chamber is ready.</p>
            )}

            {messages.map((msg) => {
              const isThinkingBubble =
          thinking && msg.role === "assistant" && streamingAssistantIdRef.current === msg.id;
            streamingAssistantIdRef.current === msg.id;

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
                    const isStreamingThis =
                      thinking && streamingAssistantIdRef.current === msg.id;

                    // While streaming, show raw text until the contract markers exist
                    if (isStreamingThis && !isContractComplete(msg.content)) {
                      return (
                        <div className="whitespace-pre-wrap text-white/80">
                          {msg.content}
                        </div>
                      );
                    }

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

        <div className="relative px-6 pb-5 pt-4">
          <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-black/60" />
          <div className="pointer-events-none absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent" />
          <div className="pointer-events-none absolute top-0 left-6 right-6 h-10 bg-gradient-to-b from-blue-400/12 to-transparent" />

          <div className="relative rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-md shadow-[0_-18px_45px_rgba(0,0,0,0.75),0_0_25px_rgba(59,130,246,0.08),inset_0_0_30px_rgba(59,130,246,0.05)]">
            <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/[0.06]" />
            
            {lastVerify && !thinking && (
              <div className="px-3 pt-3">
                <div
                  className={`rounded-lg border p-3 text-xs ${
                    lastVerify.ok
                      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100/90"
                      : "border-rose-400/25 bg-rose-500/10 text-rose-100/90"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-widest opacity-80">
                        Verification
                      </div>
                      <div className="mt-1 truncate">
                        {lastVerify.ok ? "PASS" : "FAIL"} · {String(lastVerify.command ?? "")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLastVerify(null)}
                      className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                    >
                      Dismiss
                    </button>
                  </div>

                  <div className="mt-2 text-[11px] opacity-80 flex flex-wrap gap-x-3 gap-y-1">
                    <span>exit {Number(lastVerify.exitCode ?? -1)}</span>
                    <span>{Number(lastVerify.durationMs ?? 0)}ms</span>
                    {lastVerify.failureKind ? <span>{String(lastVerify.failureKind)}</span> : null}
                    {lastVerify.failedStep ? <span>({String(lastVerify.failedStep)})</span> : null}
                    {lastVerify.fingerprint ? <span>{String(lastVerify.fingerprint)}</span> : null}
                  </div>
                </div>
              </div>
            )}
            {lastProposal && pendingConfirm && !thinking && (
              <div className="px-3 pt-3">
                <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 text-xs text-emerald-100/90">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
                        Pending change
                      </div>
                      <div className="mt-1 truncate">
                        File: <span className="text-emerald-100">{lastProposal.fileId}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLastProposal(null);
                        setPendingConfirm(null);
                      }}
                      className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                    >
                      Dismiss
                    </button>
                  </div>

                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
                      Confirmation phrase
                    </div>
                    <div className="mt-1 rounded-md bg-black/30 px-2 py-1 font-mono text-[11px] text-emerald-100 break-all">
                    <div className="mt-2">
  <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
    Proposed content (preview)
  </div>
  <div className="mt-1 max-h-[120px] overflow-auto rounded-md bg-black/30 p-2 font-mono text-[11px] text-white/80 whitespace-pre-wrap">
    {lastProposal.content.slice(0, 800)}
    {lastProposal.content.length > 800 ? "\n…(truncated)" : ""}
  </div>
</div>
                      {pendingConfirm}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ChatInput onSend={handleSend} />
              </div>
                {pendingConfirm && !thinking && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!lastProposal) return;
                      const payload = JSON.stringify(lastProposal);
                      setPendingConfirm(null);
                      handleSend(`__APPLY__:${payload}`);
                    }}
                    className="h-[40px] rounded-lg px-4 text-sm font-medium bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-300/40 active:scale-[0.99] transition"
                    title="Send the exact confirmation phrase"
                  >
                    Confirm &amp; Apply
                  </button>
                )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}