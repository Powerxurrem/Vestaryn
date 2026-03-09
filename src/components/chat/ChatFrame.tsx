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

type ChatFrameProps = {
  repoId: string;
  onFileUpdated?: (fileId: string) => void;
  onFileStatus?: (fileId: string, status: "ok" | "error", reason?: string) => void;

  refreshFiles?: () => void | Promise<void>;
  openFileById?: (fileId: string) => void;
  onMaintenance?: (payload: any) => void;
};

type Props = {
  repoId: string;
  reloadToken?: number;

  onFileUpdated?: (fileId: string) => void;
  onFileStatus?: (
    fileId: string,
    status: "ok" | "warn" | "error" | "pending",
    reason?: string
  ) => void;

  refreshFiles?: () => void | Promise<void>;
  openFileById?: (fileId: string) => void;
  onMessageStats?: (s: { total: number; user: number; assistant: number; system: number }) => void;
  onMaintenance?: (payload: any) => void;

onProposalPreview?: (
  proposals:
    | Record<
        string,
        {
          fileId: string;
          content: string;
          path?: string | null;
          op?: string | null;
          appendPreview?: string | null;
        }
      >
    | null
) => void;
};

type ChamberState = "stable" | "analyzing" | "deep" | "archive";

export default function ChatFrame({
  repoId,
  reloadToken,
  onFileUpdated,
  onFileStatus,
  refreshFiles,
  openFileById,
  onMessageStats,
  onMaintenance,
  onProposalPreview,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [state, setState] = useState<ChamberState>("stable");
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [pendingConfirmMsgId, setPendingConfirmMsgId] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const [lastEngraving, setLastEngraving] = useState<any | null>(null);
  const RESET_LINE_RE = /(?:^|\n)\s*__RESET__\s*(?=\n|$)/;
  const [lastVerifyMsgId, setLastVerifyMsgId] = useState<string | null>(null);

  // when user clicks “Confirm & Apply”, we remember which assistant bubble it belonged to
  const applyOriginMsgIdRef = useRef<string | null>(null);

    const [lastProposal, setLastProposal] = useState<{
    fileId: string;
    content: string;
    prevHash: string;
    nextHash: string;
    confirm: string;
    meta?: any;
    path?: string;
    name?: string,
    mime?: string,
  } | null>(null);

const [lastProposalSet, setLastProposalSet] = useState<
  {
    proposals: Array<{
      fileId: string;
      content: string;
      prevHash: string;
      nextHash: string;
      confirm: string;
      meta?: any;
      path?: string | null;
      name?: string | null;
      mime?: string | null;
    }>;
  } | null
>(null);

  const [proposalSet, setProposalSet] = useState<
  Record<
    string,
    {
      fileId: string;
      content: string;
      prevHash: string;
      nextHash: string;
      confirm: string;
      meta?: any;
      path?: string | null;
      name?: string | null;
      mime?: string | null;
    }
  >
>({});

  const [lastVerify, setLastVerify] = useState<any | null>(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);
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

const stagedPhrase = "A staged change is ready. Confirm to apply.";
if (sections.action.includes(stagedPhrase)) {
  sections.action = stagedPhrase;
}

  return sections;
}


function stripMarkersForRender(s: string) {
  const lines = (s || "").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    const t = l.trim();

    // Drop marker line even if it's mid-line
    if (l.includes("__MAINTENANCE__:")) {
      // If marker was appended to text, keep only the text before it
      const before = l.split("__MAINTENANCE__:")[0]?.trimEnd();
      if (before) out.push(before);

      // Also drop next line if it's the JSON payload
      const next = (lines[i + 1] ?? "").trim();
      if (next.startsWith("{") && next.endsWith("}")) i++;

      continue;
    }

    // Existing marker drops
    if (
      t.startsWith("__CREDITS__:") ||
      t.startsWith("__PROPOSAL__:") ||
      t.startsWith("__PROPOSAL_SET__:") ||
      t.startsWith("__VERIFY__:") ||
      t.startsWith("__ENGRAVING__:") ||
      t.startsWith("__APPLY__:") ||
      t.startsWith("__APPLIED__:") ||
      t.startsWith("__RESET__")
    ) {
      continue;
    }

    out.push(l);
  }

  return out.join("\n");
}

function extractConfirmPhrase(text: string) {
  const m = text.match(/\b(APPLY|CREATE)\s+[0-9a-f-]{8,}\s+[0-9a-f]{32,}\b/i);
  return m ? m[0].trim() : null;
}

async function runVerify(changeId: string, touchedFileIds: string[], originMsgId?: string) {
  try {
    // mark touched files as verifying/pending immediately
    if (typeof onFileStatus === "function") {
      for (const fid of touchedFileIds) {
        onFileStatus(fid, "pending", "verifying");
      }
    }

console.log("[runVerify] start", {
  changeId,
  touchedFileIds,
  originMsgId,
});

    const res = await fetch(`/api/repo/${repoId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "node_verify",
        ...(changeId ? { changeId } : {}),
        touchedFileIds,
      }),
    });   

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(errText || `verify failed (${res.status})`);
    }
    if (!res.body) throw new Error("verify: no response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Verify route emits a single marker line: __VERIFY__:{json}
      const idx = buf.lastIndexOf("\n__VERIFY__:");
      const alt = buf.lastIndexOf("__VERIFY__:");
      const start = idx !== -1 ? idx + 1 : alt; // tolerate no leading newline
      if (start !== -1) {
        const line = buf.slice(start).split("\n")[0] ?? "";
        const jsonStr = line.slice("__VERIFY__:".length).trim();
        try {
          const verify = JSON.parse(jsonStr);
          setLastVerify(verify);
          setLastVerifyMsgId(originMsgId ?? null);
          const ok = Boolean(verify?.ok);
          const reason =
            (verify?.failureKind ? String(verify.failureKind) : "") ||
            (verify?.error ? String(verify.error) : "") ||
            (verify?.stderr ? String(verify.stderr).slice(0, 200) : "") ||
            (verify?.stdout ? String(verify.stdout).slice(0, 200) : "");
console.log("[runVerify] parsed verify", {
  verify,
  fallbackTouchedFileIds: touchedFileIds,
});
          const ids =
            Array.isArray(verify?.touchedFileIds) && verify.touchedFileIds.length
              ? verify.touchedFileIds
              : touchedFileIds;

console.log("[runVerify] applying file status", {
  ids,
  nextStatus: ok ? "ok" : "error",
  reason,
});

          if (typeof onFileStatus === "function") {
            for (const fid of ids) {
              onFileStatus(fid, ok ? "ok" : "error", ok ? undefined : reason);
            }
          }
        } catch {}
        break; // we got the marker; we're done
      }
    }
  } catch (e: any) {
    console.log("[auto-verify] failed", e?.message ?? e);
    if (typeof onFileStatus === "function") {
      for (const fid of touchedFileIds) {
        onFileStatus(fid, "error", String(e?.message ?? "auto-verify failed"));
      }
    }
  }
}

function isContractComplete(t: string) {
  return (
    t.includes("[Observation]") &&
    t.includes("[Assessment]") &&
    t.includes("[Action]")
  );
}

function isVerifiablePath(path?: string | null) {
  const p = String(path ?? "").toLowerCase();

  return (
    p.endsWith(".ts") ||
    p.endsWith(".tsx") ||
    p.endsWith(".js") ||
    p.endsWith(".jsx") ||
    p.endsWith(".mjs") ||
    p.endsWith(".cjs") ||
    p.endsWith(".json") ||
    p.endsWith(".css") ||
    p.endsWith(".scss") ||
    p.endsWith(".sql") ||
    p.endsWith(".yml") ||
    p.endsWith(".yaml")
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
}, [repoId, reloadToken]);

  // ─────────────────────────────────────────────────────────────
  // Effects: autoscroll
  // ─────────────────────────────────────────────────────────────
useEffect(() => {
  const id = window.setTimeout(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, 20);

  return () => window.clearTimeout(id);
}, [
  messages.length,
  pendingConfirm,
  pendingConfirmMsgId,
  lastProposal?.nextHash,
  lastVerifyMsgId,
  lastVerify?.fingerprint,
]);
useEffect(() => {
  if (!onMessageStats) return;

  let user = 0, assistant = 0, system = 0;
  for (const m of messages) {
    if (m.role === "user") user++;
    else if (m.role === "assistant") assistant++;
    else system++;
  }

  onMessageStats({ total: messages.length, user, assistant, system });
}, [messages, onMessageStats]);

  // ─────────────────────────────────────────────────────────────
  // Action: send message + stream assistant response
  // ─────────────────────────────────────────────────────────────

const handleSend = async (text: string) => {
  
const trimmed = text.trim();
console.log("[handleSend] sending:", trimmed);
if (!trimmed) return;
setSuggestedPrompts([]);

const isApplyCommand =
  trimmed.startsWith("__APPLY__:") || trimmed.startsWith("__APPLY_SET__:");

if (sendingRef.current) {
  console.log("[handleSend blocked] sendingRef.current=true", { trimmed });
  return;
}

console.log("[handleSend proceed]", {
  isApplyCommand,
  trimmedHead: trimmed.slice(0, 40),
});
  sendingRef.current = true;
  const assistantId = makeId();
  setPendingConfirm(null);

if (!isApplyCommand) {
  setPendingConfirm(null);
  setPendingConfirmMsgId(null);
  setLastProposal(null);
  setLastProposalSet(null);
  setProposalSet({});
  onProposalPreview?.(null);

  const userMsg: Message = {
    id: makeId(),
    role: "user",
    content: trimmed,
    createdAt: Date.now(),
  };
  setMessages((prev) => [...prev, userMsg]);
}

  
  streamingAssistantIdRef.current = assistantId;

  setThinking(true);
  setState("analyzing");

  setMessages((prev) => [
    ...prev,
    {
      id: assistantId,
      role: "assistant",
      content: ASSISTANT_PLACEHOLDER,
      createdAt: Date.now(),
    },
  ]);

  try {
const tier =
  typeof window !== "undefined"
    ? localStorage.getItem("vestaryn.tier") ?? "early_access"
    : "early_access";

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
// ✅ RESET: detect before any stripping/parsing
const normalized = accumulated.replace(/\r/g, "");
if (RESET_LINE_RE.test(normalized)) {
  // Remove reset marker so it never renders
  accumulated = normalized.replace(RESET_LINE_RE, "\n");

  // Stop streaming UI updates immediately
  try { await reader.cancel(); } catch {}

  streamingAssistantIdRef.current = null;
  setThinking(false);
  setState("stable");


  setPendingConfirm(null);
  setLastVerify(null);
  setLastEngraving(null);

  // Reload canonical history (post-prune)
  try {
    const res2 = await fetch(`/api/repo/${repoId}/messages`, { cache: "no-store" });
    if (res2.ok) {
      const data = await res2.json();
      const rows = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(
        rows.map((m: any) => ({
          id: String(m.id),
          role: m.role,
          content: String(m.content ?? ""),
          createdAt: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
        }))
      );
    }
  } catch (e) {
    console.log("[reset] reload failed", e);
  }

  break; // 🔥 hard interrupt: do NOT continue parsing/updating placeholder
}


const maybeConfirm = extractConfirmPhrase(accumulated);
if (maybeConfirm) {
  setPendingConfirm(maybeConfirm);
  setPendingConfirmMsgId(assistantId); // ✅ anchor to this assistant message
  
}

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

    console.log("[proposalPreview]", {
      fileId: proposal?.fileId,
      op: proposal?.meta?.op,
      path: proposal?.path ?? proposal?.meta?.path ?? null,
      contentHead: String(proposal?.content ?? "").slice(0, 80),
    });

    const proposalKey = `PROPOSAL:${repoId}:${proposal?.fileId ?? "?"}:${proposal?.nextHash ?? "?"}:${assistantId}`;

    onceMarker(proposalKey, () => {
      const confirm = String(proposal?.confirm || proposal?.pendingConfirmPhrase || "");
      const op = String(proposal?.meta?.op ?? "");

      const isConfirmable =
        confirm.startsWith("APPLY ") ||
        confirm.startsWith("CREATE ") ||
        op === "create";

      if (
        isConfirmable &&
        proposal?.fileId &&
        proposal?.content &&
        proposal?.prevHash &&
        proposal?.nextHash &&
        confirm
      ) {
        setLastProposal({
          fileId: proposal.fileId,
          content: proposal.content,
          prevHash: proposal.prevHash,
          nextHash: proposal.nextHash,
          confirm,
          meta: proposal.meta ?? null,
          path: proposal.path ?? proposal.meta?.path ?? null,
          name: proposal.name ?? null,
          mime: proposal.mime ?? proposal.meta?.mime ?? null,
        });

        onProposalPreview?.({
          fileId: proposal.fileId,
          content: proposal.content,
          path: proposal.path ?? proposal.meta?.path ?? null,
          op: proposal.meta?.op ?? null,
          appendPreview: proposal.meta?.appendPreview ?? null,
        });

        setPendingConfirm(confirm);
        setPendingConfirmMsgId(assistantId);

        if (proposal?.fileId && openFileById) {
          openFileById(proposal.fileId);
        }
      }
    });
  } catch {}

  lines[i] = "";
  changed = true;
  continue;
}

if (line.startsWith("__SUGGESTED_PROMPTS__:")) {
  const isLastLine = i === lines.length - 1;
  const streamEndsWithNewline = accumulated.endsWith("\n");

  if (isLastLine && !streamEndsWithNewline) {
    continue;
  }

  const jsonStr = line.slice("__SUGGESTED_PROMPTS__:".length).trim();

  console.log("[suggestedPrompts raw]", jsonStr);

  try {
    const prompts = JSON.parse(jsonStr);

    console.log("[suggestedPrompts parsed]", prompts);

    if (Array.isArray(prompts)) {
      setSuggestedPrompts(
        prompts.filter((x) => typeof x === "string").slice(0, 3)
      );
    }
  } catch (e) {
    console.log("[suggestedPrompts parse failed]", e);
  }

  lines[i] = "";
  changed = true;
  continue;
}

if (line.startsWith("__PROPOSAL_SET__:")) {
  const isLastLine = i === lines.length - 1;
  const streamEndsWithNewline = accumulated.endsWith("\n");

  if (isLastLine && !streamEndsWithNewline) {
    continue;
  }

  const jsonStr = line.slice("__PROPOSAL_SET__:".length).trim();

  try {
    const payload = JSON.parse(jsonStr);
    const proposals = Array.isArray(payload?.proposals)
      ? payload.proposals
      : Array.isArray(payload?.creates)
      ? payload.creates
      : [];

    const nextMap: Record<string, any> = {};

    console.log("[proposalSet raw]", payload);
    console.log("[proposalSet proposals]", proposals);

for (const proposal of proposals) {
  const confirm = String(proposal?.confirm || proposal?.pendingConfirmPhrase || "");
  const op = String(proposal?.meta?.op ?? "");

  const isConfirmable =
    confirm.startsWith("APPLY ") ||
    confirm.startsWith("CREATE ") ||
    op === "create";

  const missing = {
    isConfirmable,
    fileId: !proposal?.fileId,
    content: proposal?.content == null,
    prevHash: !proposal?.prevHash,
    nextHash: !proposal?.nextHash,
    confirm: !confirm,
  };

  if (
    isConfirmable &&
    proposal?.fileId &&
    proposal?.content != null &&
    proposal?.prevHash &&
    proposal?.nextHash &&
    confirm
  ) {
    nextMap[proposal.fileId] = {
      fileId: proposal.fileId,
      content: proposal.content,
      prevHash: proposal.prevHash,
      nextHash: proposal.nextHash,
      confirm,
      meta: proposal.meta ?? null,
      path: proposal.path ?? proposal.meta?.path ?? null,
      name: proposal.name ?? null,
      mime: proposal.mime ?? proposal.meta?.mime ?? null,
    };
  } else {
    console.log("[proposalSet rejected]", {
      fileId: proposal?.fileId,
      path: proposal?.path,
      op,
      confirm,
      missing,
      proposal,
    });
  }
}

    const proposalList = Object.values(nextMap);

    console.log("[proposalSet parsed]", {
      count: proposalList.length,
      ids: proposalList.map((p: any) => p.fileId),
      paths: proposalList.map((p: any) => p.path),
    });

if (proposalList.length === 0) {
  console.log("[proposalSet empty after filtering]", {
    rawCount: proposals.length,
    payload,
  });
}

if (proposalList.length > 0) {
  setProposalSet(nextMap);
  setLastProposalSet({ proposals: proposalList });

  const first = proposalList[0];
  setLastProposal(first);
  setPendingConfirm("APPLY_SET");
  setPendingConfirmMsgId(assistantId);

  onProposalPreview?.(nextMap);

  if (openFileById) {
    for (const p of proposalList) {
      openFileById(p.fileId);
    }

    if (first?.fileId) {
      openFileById(first.fileId);
    }
  }
}
  } catch (e) {
    console.log("[proposalSet parse failed]", e);
  }

  lines[i] = "";
  changed = true;
  continue;
}

// Apply marker (REQUEST or RESULT) — strip always; auto-verify only on RESULT.
if (line.startsWith("__APPLY__:") || line.startsWith("__APPLIED__:")) {
  const jsonStr = line
    .slice(line.startsWith("__APPLIED__:") ? "__APPLIED__:".length : "__APPLY__:".length)
    .trim();

  try {
    const payload = JSON.parse(jsonStr);

    // Detect request-shape (proposal) vs result-shape (apply response)
    const looksLikeRequest =
      payload &&
      typeof payload === "object" &&
      typeof payload.fileId === "string" &&
      typeof payload.prevHash === "string" &&
      typeof payload.nextHash === "string";

    if (!looksLikeRequest) {
      const ok = Boolean(payload?.ok);
      const changeId = typeof payload?.changeId === "string" ? payload.changeId : "";
      const touchedFileIds = Array.isArray(payload?.touchedFileIds)
        ? payload.touchedFileIds.filter((x: any) => typeof x === "string")
        : [];

      const applyKey = `APPLIED:${repoId}:${changeId || payload?.nextHash || `${touchedFileIds.join(",")}:${assistantId}`}`;

      if (ok) {
  onceMarker(applyKey, () => {
    const appliedFiles = Array.isArray(payload?.appliedFiles)
      ? payload.appliedFiles
      : payload?.appliedFile
      ? [payload.appliedFile]
      : [];

    const verifiableIds = appliedFiles
      .filter((f: any) => isVerifiablePath(f?.path))
      .map((f: any) => String(f.fileId))
      .filter(Boolean);

const skippedIds = touchedFileIds.filter(
  (fid: string) => !verifiableIds.includes(fid)
);

    console.log("[apply_result]", {
      changeId,
      touchedFileIds,
      appliedFiles,
      verifiableIds,
      skippedIds,
      originMsgId: applyOriginMsgIdRef.current ?? assistantId,
    });

    setPendingConfirm(null);
    setPendingConfirmMsgId(null);
    setLastProposal(null);
    setLastProposalSet(null);
    setProposalSet({});
    onProposalPreview?.(null);

    for (const fid of touchedFileIds) {
      onFileUpdated?.(fid);
    }

    if (typeof onFileStatus === "function") {
      for (const fid of skippedIds) {
        onFileStatus(fid, "ok", "verify skipped (non-code file)");
      }
      for (const fid of verifiableIds) {
        onFileStatus(fid, "pending", "verifying");
      }
    }

    Promise.resolve(refreshFiles?.()).finally(() => {
      const firstAppliedId =
        appliedFiles[0]?.fileId ??
        touchedFileIds[0] ??
        null;

      console.log("[apply_result after refresh]", {
        firstAppliedId,
        touchedFileIds,
        appliedFiles,
        verifiableIds,
        skippedIds,
      });

      if (firstAppliedId) {
        openFileById?.(firstAppliedId);
      }
    });

    if (verifiableIds.length > 0) {
      runVerify(
        changeId,
        verifiableIds,
        applyOriginMsgIdRef.current ?? assistantId
      );
    } else {
      setLastVerify(null);
      setLastVerifyMsgId(null);
    }

    applyOriginMsgIdRef.current = null;
  });
}
    }
  } catch {}

  lines[i] = "";
  changed = true;
  continue;
}

// Verify marker
if (line.startsWith("__VERIFY__:")) {
  const jsonStr = line.slice("__VERIFY__:".length).trim();
  try {
    const verify = JSON.parse(jsonStr);
    setLastVerify(verify);
    
    // ✅ Bridge into file status (best-effort)
    // We attribute the verify result to the "last proposal file" if we have one.
    const ok = Boolean(verify?.ok);
    const reason =
      (verify?.failureKind ? String(verify.failureKind) : "") ||
      (verify?.error ? String(verify.error) : "") ||
      (verify?.stderr ? String(verify.stderr).slice(0, 200) : "") ||
      (verify?.stdout ? String(verify.stdout).slice(0, 200) : "");

    // lastProposal is already in your state (you set it in __PROPOSAL__ / __ENGRAVING__)
const ids =
  Array.isArray(verify?.touchedFileIds) && verify.touchedFileIds.length
    ? verify.touchedFileIds
    : (lastProposal?.fileId ? [lastProposal.fileId] : []);
console.log("VERIFY payload", verify);
if (typeof onFileStatus === "function") {
  for (const fid of ids) {
    onFileStatus(fid, ok ? "ok" : "error", ok ? undefined : reason);
  }
}
  } catch {}

  lines[i] = ""; // strip line
  changed = true;
  continue;
}

if (line.startsWith("__CREDITS__:")) {
  try {
    const payload = JSON.parse(line.slice("__CREDITS__:".length));
    window.dispatchEvent(new CustomEvent("vestaryn:credits", { detail: payload }));
  } catch {}

  lines[i] = "";     // ✅ strip it
  changed = true;    // ✅ ensure accumulated gets rebuilt
  continue;
}

// Maintenance marker (recommend prune)
if (line.startsWith("__MAINTENANCE__:")) {
  let jsonStr = line.split("__MAINTENANCE__:")[1]?.trim() ?? "";

  if (!jsonStr && (lines[i + 1] ?? "").trim().startsWith("{")) {
    jsonStr = (lines[i + 1] ?? "").trim();
  }

  try {
    const payload = JSON.parse(jsonStr);

      console.log("[ChatFrame] maintenance parsed", payload);

      onMaintenance?.(payload);

      window.dispatchEvent(
        new CustomEvent("vestaryn:maintenance", { detail: payload })
      );

  } catch (e) {
    console.log("[ChatFrame] maintenance parse failed", jsonStr, e);
  }

  lines[i] = line.split("__MAINTENANCE__:")[0]?.trimEnd() ?? "";
  changed = true;

  const next = (lines[i + 1] ?? "").trim();
  if (next.startsWith("{") && next.endsWith("}")) {
    lines[i + 1] = "";
  }

  continue;
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
          meta: p.meta ?? null,
        });

        setPendingConfirm(confirm);
      }
    } catch {}

    lines[i] = ""; // strip line
    changed = true;
  }
}

const nextText = changed ? lines.join("\n") : accumulated;

flushSync(() => {
  setMessages((prev) =>
    prev.map((m) => (m.id === assistantId ? { ...m, content: nextText } : m))
  );
});

accumulated = nextText; // keep accumulated in sync

    } // closes while

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
// Marker dedupe (prevents double-trigger on reconnect / chunk replay)
// ─────────────────────────────────────────────────────────────
const seenMarkerKeysRef = useRef<Set<string>>(new Set());

function onceMarker(key: string, fn: () => void) {
  const s = seenMarkerKeysRef.current;
  if (s.has(key)) return false;
  s.add(key);

  // keep memory bounded
  if (s.size > 2000) {
    // simple strategy: clear (good enough for now)
    s.clear();
    s.add(key);
  }

  fn();
  return true;
}

 // ─────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────
return (
  <section className="relative h-[70vh] w-full rounded-xl overflow-hidden bg-gradient-to-b from-[#0a0f14] via-[#05080c] to-[#020304] shadow-[0_20px_40px_rgba(0,0,0,0.55),0_0_40px_rgba(59,130,246,0.12)] ring-1 ring-blue-500/15">
    <div className="fixed right-6 top-6 z-[10001]">
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
              thinking &&
              msg.role === "assistant" &&
              streamingAssistantIdRef.current === msg.id;

          let previewText =
            lastProposal?.meta?.op === "append"
              ? String(lastProposal?.meta?.appendPreview ?? "")
              : (lastProposal?.content ?? "");

          if (!previewText) {
            previewText = lastProposal?.content ?? "";
          }

          const previewShort =
            previewText.length > 800
              ? previewText.slice(0, 800) + "\n…(truncated)"
              : previewText;

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

                    if (isStreamingThis && !isContractComplete(msg.content)) {
                      return (
                        <div className="whitespace-pre-wrap text-white/80">
                          {stripMarkersForRender(msg.content)}
                        </div>
                      );
                    }

                    const safe = stripMarkersForRender(msg.content);
                    const s = parseSections(safe);

                    return (
                      <div className="space-y-3">
                        {s.observation && (
                          <div className="border-l-2 border-white/20 pl-3">
                            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
                              Observation
                            </div>
                            <div className="text-white/80 whitespace-pre-wrap">{s.observation}</div>
                          </div>
                        )}
                          {suggestedPrompts.length > 0 &&
                            !thinking &&
                            messages[messages.length - 1]?.id === msg.id && (
                              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                <div className="mb-2 text-[10px] uppercase tracking-widest text-white/40">
                                  Next steps
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  {suggestedPrompts.map((prompt) => (
                                    <button
                                      key={prompt}
                                      type="button"
                                      onClick={() => handleSend(prompt)}
                                      className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1.5 text-[12px] text-blue-100/90 transition hover:border-blue-300/30 hover:bg-blue-500/15"
                                    >
                                      {prompt}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                        <div className="h-px bg-white/5 my-2" />

                        {s.assessment && (
                          <div className="border-l-2 border-blue-400/40 pl-3">
                            <div className="text-[10px] uppercase tracking-widest text-blue-300/60 mb-1">
                              Assessment
                            </div>
                            <div className="text-white/85 whitespace-pre-wrap">{s.assessment}</div>
                          </div>
                        )}

                        <div className="h-px bg-white/5 my-2" />

                        {s.action && (
                          <div className="border-l-2 border-emerald-400/50 pl-3">
                            <div className="text-[10px] uppercase tracking-widest text-emerald-300/70 mb-1">
                              Action
                            </div>
                            <div className="text-white/95 whitespace-pre-wrap">{s.action}</div>
                          </div>
                        )}

                        {/* ✅ Anchored VERIFY (inside the bubble) */}
                        {lastVerify &&
                          !thinking &&
                          lastVerifyMsgId === msg.id && (
                            <div
                              className={`mt-3 rounded-lg border p-3 text-xs ${
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
                                    {lastVerify.ok ? "PASS" : "FAIL"} ·{" "}
                                    {String(lastVerify.command ?? "")}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setLastVerify(null);
                                    setLastVerifyMsgId(null);
                                  }}
                                  className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                                >
                                  Dismiss
                                </button>
                              </div>

                              <div className="mt-2 text-[11px] opacity-80 flex flex-wrap gap-x-3 gap-y-1">
                                <span>exit {Number(lastVerify.exitCode ?? -1)}</span>
                                <span>{Number(lastVerify.durationMs ?? 0)}ms</span>
                                {lastVerify.failureKind ? (
                                  <span>{String(lastVerify.failureKind)}</span>
                                ) : null}
                                {lastVerify.failedStep ? (
                                  <span>({String(lastVerify.failedStep)})</span>
                                ) : null}
                                {lastVerify.fingerprint ? (
                                  <span>{String(lastVerify.fingerprint)}</span>
                                ) : null}
                              </div>
                            </div>
                          )}

                        {/* ✅ Anchored PROPOSAL (inside the bubble) */}
                        {pendingConfirm &&
                          lastProposal &&
                          !thinking &&
                          pendingConfirmMsgId === msg.id && (
                            <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 text-xs text-emerald-100/90">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
                                    Pending change
                                  </div>
                                  <div className="mt-1 truncate">
                                    File:{" "}
                                    <span className="text-emerald-100">
                                      {lastProposal.fileId}
                                    </span>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setLastProposal(null);
                                    setPendingConfirm(null);
                                    setPendingConfirmMsgId(null);
                                    onProposalPreview?.(null);
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
                                  {pendingConfirm}
                                </div>

                                <div className="mt-2">
                              <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
                                {lastProposal?.meta?.op === "append"
                                  ? "Appended content"
                                  : "Proposed content (preview)"}
                              </div>
                                  <div className="mt-1 max-h-[120px] overflow-auto rounded-md bg-black/30 p-2 font-mono text-[11px] text-white/80 whitespace-pre-wrap">
                                    {previewShort}
                                  </div>
                                </div>

                                <div className="mt-3 flex justify-end">
                                  <button
                                  disabled={thinking}
                                    onClick={() => {
                                      
                                      applyOriginMsgIdRef.current = pendingConfirmMsgId;

                                      setLastVerify(null);
                                      setLastVerifyMsgId(null);

                                      setPendingConfirm(null);
                                      setPendingConfirmMsgId(null);
                                      console.log("[apply_set send]", lastProposalSet);
                                      if (lastProposalSet?.proposals?.length) {
                                        const payload = JSON.stringify(lastProposalSet);
                                        handleSend(`__APPLY_SET__:${payload}`);
                                        return;
                                      }

                                      if (lastProposal) {
                                        const payload = JSON.stringify(lastProposal);
                                        handleSend(`__APPLY__:${payload}`);
                                      }
                                    }}
                                    className="h-[36px] rounded-lg px-3 text-[12px] font-medium bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-300/40 active:scale-[0.99] transition"
                                  >
                                    Confirm &amp; Apply
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                      </div>
                    );
                  })()
                ) : (
                  stripMarkersForRender(msg.content)
                )}
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Footer: only input */}
      <div className="relative px-6 pb-5 pt-4">
        <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-black/60" />
        <div className="pointer-events-none absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent" />
        <div className="pointer-events-none absolute top-0 left-6 right-6 h-10 bg-gradient-to-b from-blue-400/12 to-transparent" />

        <div className="relative rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-md shadow-[0_-18px_45px_rgba(0,0,0,0.75),0_0_25px_rgba(59,130,246,0.08),inset_0_0_30px_rgba(59,130,246,0.05)]">
          <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/[0.06]" />

          <div className="flex items-center gap-2 p-3">
            <div className="flex-1">
              <ChatInput onSend={handleSend} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);
}