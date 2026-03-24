"use client";

import { useEffect, useRef, useState } from "react";
import ChatInput from "./ChatInput";
import { flushSync } from "react-dom";
import TierSwitcher from "@/components/dev/TierSwitcher";
import GoalPlanCard from "@/types/GoalPlanCard";
import type { GoalPlan, GoalStatus, GoalStep } from "@/types/goalPlan";
import {
  extractGoalPlan,extractGoalStatus,extractGoalDone,extractGoalExecute,containsGoalMarker} from "@/types/goalMarkers";
  import VerifyCard from "./VerifyCard";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
};

type ProposalItem = {
  fileId: string;
  content: string;
  prevHash: string;
  nextHash: string;
  confirm: string;
  meta?: any;
  path?: string | null;
  name?: string | null;
  mime?: string | null;
};

type ActiveAssistantTurn = {
  turnId: string;
  status: "streaming" | "resolved" | "superseded";
  proposalSet: Record<string, ProposalItem>;
  proposalList: ProposalItem[];
  selectedProposalFileId: string | null;
  pendingConfirm: string | null;
  verify: any | null;
  preverify: any | null;
  engraving: any | null;
  suggestedPrompts: string[];
  applied: {
    ok: boolean;
    touchedFileIds: string[];
    appliedFiles: Array<{ fileId: string; path?: string | null }>;
    changeId?: string | null;
  } | null;
};

type ChatFrameProps = {
  repoId: string;
  onFileUpdated?: (fileId: string) => void;
  onFileStatus?: (fileId: string, status: "ok" | "error", reason?: string) => void;

  refreshFiles?: () => void | Promise<void>;
  openFileById?: (fileId: string) => void;
  onMaintenance?: (payload: any) => void;
  onPreviewRefresh?: () => void;
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
  onPreviewRefresh?: () => void;

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
  onPreviewRefresh,
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
  const [lastPreverify, setLastPreverify] = useState<any | null>(null);
  const [lastPreverifyMsgId, setLastPreverifyMsgId] = useState<string | null>(null);
  const [activeTurn, setActiveTurn] = useState<ActiveAssistantTurn | null>(null);
  const [goalPlan, setGoalPlan] = useState<GoalPlan | null>(null);
  const messagesRef = useRef<Message[]>([]);
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
useEffect(() => {
  messagesRef.current = messages;

  
}, [messages]);
  const [lastVerify, setLastVerify] = useState<any | null>(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const sawGoalInTurnRef = useRef(false);
  // hard lock to prevent double-submit / overlapping requests
  const sendingRef = useRef(false);
  const renderAssistantIdRef = useRef<string | null>(null);
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

function goalStatusRank(status?: GoalStatus | null) {
  switch (status) {
    case "completed":
      return 4;
    case "running":
      return 3;
    case "awaiting_approval":
      return 2;
    case "cancelled":
      return 0;
    default:
      return 0;
  }
}

function dispatchGoalInstructionWhenIdle(instruction: string, tries = 0) {
  if (!instruction.trim()) return;

  if (!sendingRef.current) {
    console.log("[goal_execute dispatch]", { instruction, tries });
    handleSend(instruction);
    return;
  }

  if (tries >= 20) {
    console.log("[goal_execute dispatch aborted]", { instruction });
    return;
  }

  window.setTimeout(() => {
    dispatchGoalInstructionWhenIdle(instruction, tries + 1);
  }, 100);
}

function emptyActiveTurn(turnId: string): ActiveAssistantTurn {
  return {
    turnId,
    status: "streaming",
    proposalSet: {},
    proposalList: [],
    selectedProposalFileId: null,
    pendingConfirm: null,
    verify: null,
    preverify: null,
    engraving: null,
    suggestedPrompts: [],
    applied: null,
  };
}

function reconcileGoalPlanState(
  prev: GoalPlan,
  patch: Partial<GoalPlan> & {
    goalId?: string;
    status?: GoalStatus;
    currentStepId?: string | null;
    completedStepIds?: string[];
  }
): GoalPlan {
  if (!prev) return prev;

  if (patch.goalId && prev.goalId !== patch.goalId) {
    return prev;
  }

  const completedSet: Set<string> = new Set<string>(
  Array.isArray(patch.completedStepIds)
    ? patch.completedStepIds.map((x) => String(x))
    : Array.isArray(prev.completedStepIds)
    ? prev.completedStepIds.map((x) => String(x))
    : []
);

  const nextStatus: GoalStatus =
  patch.status ?? prev.status;

  const nextCurrentStepId =
    patch.currentStepId === null
      ? null
      : typeof patch.currentStepId === "string"
      ? patch.currentStepId
      : prev.currentStepId ?? null;

  const nextSteps: GoalStep[] = prev.steps.map((step) => {
    const id = String(step.id);

    if (completedSet.has(id)) {
      return { ...step, status: "verified" as const };
    }

    if (nextStatus === "completed") {
      return { ...step, status: "verified" as const };
    }

    if (nextStatus === "cancelled") {
      if (step.status === "verified") return step;
      return { ...step, status: "skipped" as const };
    }

    if (nextStatus === "running" && nextCurrentStepId === id) {
      return { ...step, status: "running" as const };
    }

    return { ...step, status: "pending" as const };
  });

  return {
    ...prev,
    ...patch,
    status: nextStatus,
    currentStepId: nextCurrentStepId,
    completedStepIds: Array.from(completedSet),
    steps: nextSteps,
  };
}

function patchActiveTurn(
  turnId: string,
  updater: (prev: ActiveAssistantTurn) => ActiveAssistantTurn
) {
  setActiveTurn((prev) => {
    const base =
      prev && prev.turnId === turnId ? prev : emptyActiveTurn(turnId);

    const next = updater(base);

    console.log("[patchActiveTurn]", {
      turnId,
      prevTurnId: prev?.turnId ?? null,
      basePendingConfirm: base.pendingConfirm ?? null,
      baseProposalCount: base.proposalList?.length ?? 0,
      nextPendingConfirm: next.pendingConfirm ?? null,
      nextProposalCount: next.proposalList?.length ?? 0,
      nextStatus: next.status,
    });

    return next;
  });
}



function applyParsedProposals(
  proposals: ProposalItem[],
  assistantId: string
) {
  if (!Array.isArray(proposals) || proposals.length === 0) return;

  const nextMap: Record<string, ProposalItem> = {};

  for (const proposal of proposals) {
    if (!proposal?.fileId) continue;
    if (proposal?.meta?.kind === "engraving") continue;

    nextMap[proposal.fileId] = {
      fileId: proposal.fileId,
      content: proposal.content,
      prevHash: proposal.prevHash,
      nextHash: proposal.nextHash,
      confirm: proposal.confirm,
      meta: proposal.meta ?? null,
      path: proposal.path ?? proposal.meta?.path ?? null,
      name: proposal.name ?? null,
      mime: proposal.mime ?? proposal.meta?.mime ?? null,
    };
  }

  const proposalList = Object.values(nextMap);
  if (proposalList.length === 0) return;

  const first = proposalList[0];
  const targetAssistantId = renderAssistantIdRef.current;
    if (!targetAssistantId) {
      console.log("[applyParsedProposals missing render anchor]", {
        passedAssistantId: assistantId,
        renderAssistantId: renderAssistantIdRef.current,
      });
      return;
    }

  console.log("[applyParsedProposals anchor]", {
    passedAssistantId: assistantId,
    renderAssistantId: renderAssistantIdRef.current,
    targetAssistantId,
    count: proposalList.length,
    ids: proposalList.map((p) => p.fileId),
    paths: proposalList.map((p) => p.path),
  });

  patchActiveTurn(targetAssistantId, (prev) => ({
    ...prev,
    turnId: targetAssistantId,
    proposalSet: nextMap,
    proposalList,
    selectedProposalFileId:
      prev.selectedProposalFileId && nextMap[prev.selectedProposalFileId]
        ? prev.selectedProposalFileId
        : first.fileId,
    pendingConfirm: proposalList.length > 1 ? "APPLY_SET" : first.confirm,
  }));

  onProposalPreview?.(
    Object.fromEntries(
      proposalList.map((p) => [
        p.fileId,
        {
          fileId: p.fileId,
          content: p.content,
          path: p.path ?? null,
          op: p.meta?.op ?? null,
          appendPreview: p.meta?.appendPreview ?? null,
        },
      ])
    )
  );

  if (openFileById) {
    for (const p of proposalList) openFileById(p.fileId);
    if (first?.fileId) openFileById(first.fileId);
  }
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
  t.startsWith("__PREVERIFY__:") ||
  t.startsWith("__VERIFY__:") ||
  t.startsWith("__ENGRAVING__:") ||
  t.startsWith("__APPLY__:") ||
  t.startsWith("__APPLIED__:") ||
  t.startsWith("__RESET__") ||
  t.startsWith("__GOAL_PLAN__:") ||
  t.startsWith("__GOAL_STATUS__:") ||
  t.startsWith("__GOAL_DONE__:") ||
  t.startsWith("__GOAL_EXECUTE__:") ||
  t.startsWith("__APPLY_SET__:") ||
  t.startsWith("__APPLIED_SET__:") 
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

function collectBalancedJson(
  lines: string[],
  startIndex: number,
  marker: string
) {
  const firstLine = lines[startIndex] ?? "";
  const afterMarker = firstLine.slice(marker.length);

  const collected: string[] = [];
  if (afterMarker.trim()) collected.push(afterMarker);

  let braceBalance =
    (afterMarker.match(/{/g)?.length ?? 0) -
    (afterMarker.match(/}/g)?.length ?? 0);

  let endIndex = startIndex;

  while (braceBalance > 0 && endIndex + 1 < lines.length) {
    endIndex += 1;
    const nextLine = lines[endIndex] ?? "";
    collected.push(nextLine);

    braceBalance += nextLine.match(/{/g)?.length ?? 0;
    braceBalance -= nextLine.match(/}/g)?.length ?? 0;
  }

  return {
    jsonText: collected.join("\n"),
    endIndex,
  };
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
 
useEffect(() => {
  let latestPlan: GoalPlan | null = null;
  let latestPlanIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    const plan = extractGoalPlan(String(msg.content ?? ""));
    if (plan) {
      latestPlan = plan;
      latestPlanIndex = i;
    }
  }

  setGoalPlan((prev) => {
    if (!latestPlan) {
      console.log("[goalPlan derived from messages] no latest plan found");
      return null;
    }

    let merged: GoalPlan = { ...latestPlan };
    const activeGoalId = merged.goalId;

    for (let i = latestPlanIndex + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "assistant") continue;

      const text = String(msg.content ?? "");

      const status = extractGoalStatus(text);
      if (status) {
        if ((status as any).goalId && (status as any).goalId !== activeGoalId) {
          continue;
        }

        merged = reconcileGoalPlanState(merged, status);
        continue;
      }

      const done = extractGoalDone(text);
      if (done) {
        if ((done as any).goalId && (done as any).goalId !== activeGoalId) {
          continue;
        }

        merged = reconcileGoalPlanState(merged, {
          ...done,
          status: "completed",
          currentStepId: null,
        });
      }
    }

    // IMPORTANT:
    // Do not let stale persisted plan data downgrade a newer in-memory state
    if (prev?.goalId === merged.goalId) {
      const prevRank = goalStatusRank(prev.status);
      const mergedRank = goalStatusRank(merged.status);

      const prevCompleted = Array.isArray(prev.completedStepIds)
        ? prev.completedStepIds.length
        : 0;

      const mergedCompleted = Array.isArray(merged.completedStepIds)
        ? merged.completedStepIds.length
        : 0;

      const shouldKeepPrevState =
        prevRank > mergedRank ||
        prevCompleted > mergedCompleted;

      if (shouldKeepPrevState) {
        merged = reconcileGoalPlanState(merged, {
          status: prev.status,
          currentStepId: prev.currentStepId ?? merged.currentStepId ?? null,
          completedStepIds: prev.completedStepIds ?? merged.completedStepIds ?? [],
        });
      }
    }

    console.log("[goalPlan derived from messages]", merged);
    return merged;
  });
}, [messages]);

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

const isControlCommand =
  trimmed.startsWith("__APPLY__:") ||
  trimmed.startsWith("__APPLY_SET__:") ||
  trimmed === "__GOAL_APPROVE__" ||
  trimmed === "__GOAL_CONTINUE__" ||
  trimmed === "__GOAL_REPAIR__" ||
  trimmed === "__GOAL_STOP__";

if (sendingRef.current) {
  console.log("[handleSend blocked] sendingRef.current=true", { trimmed });
  return;
}

console.log("[handleSend proceed]", {
  isControlCommand,
  trimmedHead: trimmed.slice(0, 40),
});
  sendingRef.current = true;
  const assistantId = makeId();
const shouldCreateAssistantBubble = !isControlCommand;

const turnAnchorId = shouldCreateAssistantBubble
  ? assistantId
  : applyOriginMsgIdRef.current ?? renderAssistantIdRef.current ?? assistantId;

if (shouldCreateAssistantBubble) {
  renderAssistantIdRef.current = assistantId;
}
  setPendingConfirm(null);
  sawGoalInTurnRef.current = false;

if (!isControlCommand) {
  console.log("[handleSend reset proposal preview]", {
    assistantId,
    trimmed,
    isControlCommand,
  });

  setActiveTurn((prev) =>
    prev ? { ...prev, status: "superseded" } : prev
  );

  setActiveTurn(emptyActiveTurn(assistantId));

  setPendingConfirm(null);
  setPendingConfirmMsgId(null);
  setLastProposal(null);
  setLastProposalSet(null);
  setProposalSet({});
  setLastEngraving(null);
  setLastVerify(null);
  setLastVerifyMsgId(null);
  setLastPreverify(null);
  setLastPreverifyMsgId(null);
  setSuggestedPrompts([]);

  console.log("[handleSend clear proposal preview]", {
    assistantId,
    isControlCommand,
    trimmedHead: trimmed.slice(0, 80),
  });

  onProposalPreview?.(null);

  const userMsg: Message = {
    id: makeId(),
    role: "user",
    content: trimmed,
    createdAt: Date.now(),
  };

  const assistantMsg: Message = {
    id: assistantId,
    role: "assistant",
    content: ASSISTANT_PLACEHOLDER,
    createdAt: Date.now(),
  };

  flushSync(() => {
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
  });

  console.log("[messages inserted atomically]", {
    userId: userMsg.id,
    assistantId,
  });
}



streamingAssistantIdRef.current = assistantId;
setThinking(true);
setState("analyzing");

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

  setThinking(false);
  setState("stable");

  setMessages((prev) => [
    ...prev,
    {
      id: makeId(),
      role: "system",
      content: errText || `Request failed (${res.status})`,
      createdAt: Date.now(),
    },
  ]);

  sendingRef.current = false;
  streamingAssistantIdRef.current = null;
  return;
}
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let accumulated = "";
    let sawFirstChunk = false;
    let rawAccumulated = "";

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

      rawAccumulated += chunk;
      accumulated += chunk;

      console.log("[marker scan raw]", {
  hasProposalMarker: accumulated.includes("__PROPOSAL__:"),
  hasProposalSetMarker: accumulated.includes("__PROPOSAL_SET__:"),
  hasApplyMarker: accumulated.includes("__APPLY__:"),
  tail: accumulated.slice(-300),
});
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
setActiveTurn((prev) =>
  prev && prev.turnId === assistantId
    ? { ...prev, status: "resolved" }
    : prev
);
  setActiveTurn(null);
  setPendingConfirm(null);
  setPendingConfirmMsgId(null);
  setLastProposal(null);
  setLastProposalSet(null);
  setProposalSet({});
  setLastVerify(null);
  setLastVerifyMsgId(null);
  setLastPreverify(null);
  setLastPreverifyMsgId(null);
  setLastEngraving(null);
  onProposalPreview?.(null);

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
  setPendingConfirmMsgId(turnAnchorId); // ✅ anchor to this assistant message
  
}

// ─────────────────────────────────────────────
// Marker extraction (proposal + verify)
// Markers are injected as standalone lines:
//   __PROPOSAL__:{json}\n
//   __VERIFY__:{json}\n
// We strip them out so they never render as chat text.
// ─────────────────────────────────────────────
const lines = accumulated.split("\n");
console.log("[proposal scan]", {
  assistantId,
  hasProposalMarker: accumulated.includes("__PROPOSAL__:"),
  hasProposalSetMarker: accumulated.includes("__PROPOSAL_SET__:"),
  last400: accumulated.slice(-400),
});
let changed = false;



for (let i = 0; i < lines.length; i++) {
  const line = lines[i] ?? "";

  // Proposal marker
  if (line.includes("__PROPOSAL__:")) {
  const idx = line.indexOf("__PROPOSAL__:");
  const before = line.slice(0, idx).trimEnd();
  const jsonStr = line.slice(idx + "__PROPOSAL__:".length).trim();

  try {
    const proposal = JSON.parse(jsonStr);

    console.log("[proposal branch hit]", {
      assistantId,
      lineHead: line.slice(0, 160),
      before,
      jsonHead: jsonStr.slice(0, 160),
    });

    const proposalKey = `PROPOSAL:${repoId}:${proposal?.fileId ?? "?"}:${proposal?.nextHash ?? "?"}:${assistantId}`;

    onceMarker(proposalKey, () => {
      const confirm = String(proposal?.confirm || proposal?.pendingConfirmPhrase || "");
      const op = String(proposal?.meta?.op ?? "");

      const isConfirmable =
        confirm.startsWith("APPLY ") ||
        confirm.startsWith("CREATE ") ||
        op === "create";

      if (proposal?.meta?.kind === "engraving") {
        return;
      }

      console.log("[proposal marker detected]", {
        assistantId,
        fileId: proposal?.fileId,
        path: proposal?.path ?? proposal?.meta?.path ?? null,
        confirm,
      });

      if (
        isConfirmable &&
        proposal?.fileId &&
        proposal?.content != null &&
        proposal?.prevHash &&
        proposal?.nextHash &&
        confirm
      ) {
        applyParsedProposals(
          [
            {
              fileId: proposal.fileId,
              content: proposal.content,
              prevHash: proposal.prevHash,
              nextHash: proposal.nextHash,
              confirm,
              meta: proposal.meta ?? null,
              path: proposal.path ?? proposal.meta?.path ?? undefined,
              name: proposal.name ?? undefined,
              mime: proposal.mime ?? proposal.meta?.mime ?? undefined,
            },
          ],
          assistantId
        );
      }
    });
  } catch (e) {
    console.log("[proposal parse failed]", {
      error: e,
      jsonStr,
      line,
    });
  }

  lines[i] = before;
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
        patchActiveTurn(turnAnchorId, (prev) => ({
          ...prev,
          suggestedPrompts: prompts.filter((x) => typeof x === "string").slice(0, 3),
        }));
      }
    } catch (e) {
      console.log("[suggestedPrompts parse failed]", e);
    }

    lines[i] = "";
    changed = true;
    continue;
  }

  if (line.includes("__PROPOSAL_SET__:")) {
  const idx = line.indexOf("__PROPOSAL_SET__:");
  const before = line.slice(0, idx).trimEnd();
  const jsonStr = line.slice(idx + "__PROPOSAL_SET__:".length).trim();
    const isLastLine = i === lines.length - 1;
    const streamEndsWithNewline = accumulated.endsWith("\n");

    if (isLastLine && !streamEndsWithNewline) {
      continue;
    }

    try {
      const payload = JSON.parse(jsonStr);
      const proposals = Array.isArray(payload?.proposals)
        ? payload.proposals
        : Array.isArray(payload?.creates)
        ? payload.creates
        : [];

      const filtered = proposals.filter(
        (p: any) => p?.meta?.kind !== "engraving"
      );

      const nextMap: Record<string, any> = {};

      console.log("[proposalSet raw]", payload);
      console.log("[proposalSet proposals]", proposals);
      console.log("[proposalSet filtered]", filtered);

      for (const proposal of filtered) {
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
            confirm: proposal.confirm,
            meta: proposal.meta ?? null,
            path: proposal.path ?? proposal.meta?.path ?? undefined,
            name: proposal.name ?? undefined,
            mime: proposal.mime ?? proposal.meta?.mime ?? undefined,
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
          filteredCount: filtered.length,
          payload,
        });
      }

      if (proposalList.length > 0) {
        applyParsedProposals(proposalList, assistantId);
      }
          } catch (e) {
            console.log("[proposalSet parse failed]", e);
          }

          lines[i] = "";
          changed = true;
          continue;
        }

  // Apply marker (REQUEST or RESULT) — strip always; auto-verify only on RESULT.
     if (
  line.startsWith("__APPLY__:") ||
  line.startsWith("__APPLY_SET__:") ||
  line.startsWith("__APPLIED__:") ||
  line.startsWith("__APPLIED_SET__:")
) {
  const marker = line.startsWith("__APPLIED_SET__:")
    ? "__APPLIED_SET__:"
    : line.startsWith("__APPLIED__:")
    ? "__APPLIED__:"
    : line.startsWith("__APPLY_SET__:")
    ? "__APPLY_SET__:"
    : "__APPLY__:";

  const idx = line.indexOf(marker);
  const before = line.slice(0, idx).trimEnd();
  const jsonStr = line.slice(idx + marker.length).trim();

  try {
    const payload = JSON.parse(jsonStr);

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

          const visibleTurnId = applyOriginMsgIdRef.current ?? turnAnchorId;

          patchActiveTurn(visibleTurnId, (prev) => ({
            ...prev,
            proposalSet: {},
            proposalList: [],
            selectedProposalFileId: null,
            pendingConfirm: null,
            applied: {
              ok: true,
              touchedFileIds,
              appliedFiles: appliedFiles.map((f: any) => ({
                fileId: String(f.fileId),
                path: f.path ?? null,
              })),
              changeId: changeId || null,
            },
          }));

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

            onPreviewRefresh?.();
          });

          applyOriginMsgIdRef.current = null;
        });
      }
    }
  } catch {}

  lines[i] = before;
  changed = true;
  continue;
}

  if (line.includes("__PREVERIFY__:")) {
    const idx = line.indexOf("__PREVERIFY__:");
    const before = line.slice(0, idx).trimEnd();
    const jsonStr = line.slice(idx + "__PREVERIFY__:".length).trim();

    try {
      const preverify = JSON.parse(jsonStr);

      console.log("[preverify parsed]", {
        assistantId,
        ok: preverify?.ok,
        baseline: preverify?.baseline,
        failedStep: preverify?.failedStep,
      });

      patchActiveTurn(turnAnchorId, (prev) => ({
        ...prev,
        preverify,
      }));

      setLastPreverify(preverify);
      setLastPreverifyMsgId(turnAnchorId);

      console.log("[preverify ui state set]", {
        turnAnchorId,
        lastPreverifyMsgId: turnAnchorId,
      });
    } catch (e) {
      console.log("[preverify parse failed]", e);
    }

    lines[i] = before;
    changed = true;
    continue;
  }

  if (line.includes("__VERIFY__:")) {
    const idx = line.indexOf("__VERIFY__:");
    const before = line.slice(0, idx).trimEnd();
    const jsonStr = line.slice(idx + "__VERIFY__:".length).trim();

    try {
      const verify = JSON.parse(jsonStr);

      patchActiveTurn(turnAnchorId, (prev) => ({
        ...prev,
        verify,
      }));
      setLastVerify(verify);
      setLastVerifyMsgId(turnAnchorId);

      console.log("[verify marker parsed in turn]", {
        assistantId,
        verify,
      });

      const ids =
        Array.isArray(verify?.fileIds) && verify.fileIds.length
          ? verify.fileIds
          : Array.isArray(verify?.touchedFileIds) && verify.touchedFileIds.length
          ? verify.touchedFileIds
          : lastProposalSet?.proposals?.length
          ? lastProposalSet.proposals.map((p) => p.fileId).filter(Boolean)
          : lastProposal?.fileId
          ? [lastProposal.fileId]
          : [];

      console.log("VERIFY payload", verify);

      if (typeof onFileStatus === "function") {
        if (verify?.skipped) {
          for (const fid of ids) {
            onFileStatus(fid, "ok", "verify skipped");
          }
        } else if (verify?.pending) {
          for (const fid of ids) {
            onFileStatus(fid, "pending", "Verifying…");
          }
        } else {
          const ok = Boolean(verify?.ok);
          const reason =
            (verify?.failureKind ? String(verify.failureKind) : "") ||
            (verify?.error ? String(verify.error) : "") ||
            (verify?.stderr ? String(verify.stderr).slice(0, 200) : "") ||
            (verify?.stdout ? String(verify.stdout).slice(0, 200) : "");

          for (const fid of ids) {
            onFileStatus(fid, ok ? "ok" : "error", ok ? undefined : reason);
          }
        }
      }
    } catch (e) {
      console.log("[verify parse failed]", e);
    }

    lines[i] = before;
    changed = true;
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

if (line.startsWith("__GOAL_PLAN__:")) {
  sawGoalInTurnRef.current = true;

  const { endIndex } = collectBalancedJson(lines, i, "__GOAL_PLAN__:");

  for (let k = i; k <= endIndex; k++) {
    lines[k] = "";
  }

  i = endIndex;
  changed = true;
  continue;
}

  if (line.startsWith("__GOAL_STATUS__:")) {
    const isLastLine = i === lines.length - 1;
    const streamEndsWithNewline = accumulated.endsWith("\n");



    if (isLastLine && !streamEndsWithNewline) {
      continue;
    }

    const jsonStr = line.slice("__GOAL_STATUS__:".length).trim();

    try {
      const status = JSON.parse(jsonStr);
      console.log("[goal_status parsed inline]", status);

      setGoalPlan((prev) => {
        if (!prev) return prev;
        return reconcileGoalPlanState(prev, status);
      });
    } catch (e) {
      console.log("[goal_status parse failed]", e);
    }

    lines[i] = "";
    changed = true;
    continue;
  }

  if (line.startsWith("__GOAL_DONE__:")) {
    const isLastLine = i === lines.length - 1;
    const streamEndsWithNewline = accumulated.endsWith("\n");


    if (isLastLine && !streamEndsWithNewline) {
      continue;
    }

    const jsonStr = line.slice("__GOAL_DONE__:".length).trim();

    try {
      const done = JSON.parse(jsonStr);
      console.log("[goal_done parsed inline]", done);

      setGoalPlan((prev) => {
        if (!prev) return prev;
        return reconcileGoalPlanState(prev, {
          ...done,
          status: "completed",
          currentStepId: null,
        });
      });
    } catch (e) {
      console.log("[goal_done parse failed]", e);
    }

    lines[i] = "";
    changed = true;
    continue;
  }

  if (line.startsWith("__GOAL_EXECUTE__:")) {
  const jsonStr = line.slice("__GOAL_EXECUTE__:".length).trim();

  try {
    const execute = JSON.parse(jsonStr);
    console.log("[goal_execute parsed inline]", execute);

    const instruction = String(execute.instruction ?? "").trim();
    const executeKey = `${execute.goalId}:${execute.stepId}:${instruction}`;

    if (instruction && !seenGoalExecuteRef.current.has(executeKey)) {
      seenGoalExecuteRef.current.add(executeKey);
      dispatchGoalInstructionWhenIdle(instruction);
    }
  } catch (e) {
    console.log("[goal_execute parse failed]", jsonStr, e);
  }

  lines[i] = "";
  changed = true;
  continue;
}

  // Engraving marker
  if (line.startsWith("__ENGRAVING__:")) {
    const jsonStr = line.slice("__ENGRAVING__:".length).trim();
    try {
      const engr = JSON.parse(jsonStr);
      patchActiveTurn(turnAnchorId, (prev) => ({
        ...prev,
        engraving: engr,
      }));
    } catch {}

    lines[i] = "";
    changed = true;
    continue;
  }
}

let nextText = changed ? lines.join("\n") : accumulated;

if (!nextText.trim() && sawGoalInTurnRef.current) {
  nextText =
    "[Observation]\nGoal planning started.\n\n" +
    "[Assessment]\nA structured goal plan was prepared for this request.\n\n" +
    "[Action]\nReview the goal plan below and approve to continue.";
}

console.log("[stream update target]", {
  assistantId,
  existsInMessages: messagesRef.current.some((m) => m.id === assistantId),
  lastMessageIds: messagesRef.current.slice(-6).map((m) => m.id),
});



flushSync(() => {
  setMessages((prev) =>
    prev.map((m) => (m.id === assistantId ? { ...m, content: nextText } : m))
  );
});

accumulated = nextText; // keep accumulated in sync

if (sawGoalInTurnRef.current || containsGoalMarker(rawAccumulated)) {
  console.log("[goal marker final parse] tail", rawAccumulated.slice(-1200));

  const plan = extractGoalPlan(rawAccumulated);
  if (plan) {
    console.log("[goal_plan parsed after stream]", plan);
    setGoalPlan(plan);
  }

  const status = extractGoalStatus(rawAccumulated);
  if (status) {
    console.log("[goal_status parsed after stream]", status);
    setGoalPlan((prev) => {
      if (!prev) return prev;
      return reconcileGoalPlanState(prev, status);
    });
  }

  const done = extractGoalDone(rawAccumulated);
  if (done) {
    console.log("[goal_done parsed after stream]", done);
    setGoalPlan((prev) => {
      if (!prev) return prev;
      return reconcileGoalPlanState(prev, {
        ...done,
        status: "completed",
        currentStepId: null,
      });
    });
  }

  const execute = extractGoalExecute(rawAccumulated);
  if (execute) {
    console.log("[goal_execute parsed after stream]", execute);

    const instruction = String(execute.instruction ?? "").trim();
    const executeKey = `${execute.goalId}:${execute.stepId}:${instruction}`;

    if (instruction && !seenGoalExecuteRef.current.has(executeKey)) {
      seenGoalExecuteRef.current.add(executeKey);
      dispatchGoalInstructionWhenIdle(instruction);
    }
  }
}

        } // closes while

    if (isControlCommand && containsGoalMarker(rawAccumulated)) {
      const hiddenAssistantMsg: Message = {
        id: makeId(),
        role: "assistant",
        content: rawAccumulated.trim(),
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, hiddenAssistantMsg]);
    }

    setThinking(false);
    setState("stable");
    setActiveTurn((prev) =>
      prev && prev.turnId === turnAnchorId
        ? { ...prev, status: "resolved" }
        : prev
    );
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
    setActiveTurn((prev) =>
  prev && prev.turnId === turnAnchorId
    ? { ...prev, status: "resolved" }
    : prev
);
  } finally {
    streamingAssistantIdRef.current = null;
    sendingRef.current = false;
  }
};

// ─────────────────────────────────────────────────────────────
// Marker dedupe (prevents double-trigger on reconnect / chunk replay)
// ─────────────────────────────────────────────────────────────
const seenMarkerKeysRef = useRef<Set<string>>(new Set());
const seenGoalExecuteRef = useRef<Set<string>>(new Set());


const goalContinueBlocked =
  thinking ||
  !!activeTurn?.pendingConfirm ||
  !!pendingConfirm ||
  !!lastProposal ||
  !!lastProposalSet?.proposals?.length;

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

        const turnState =
          activeTurn && msg.id === activeTurn.turnId
            ? activeTurn
            : null;
        const turnProposal =
          turnState?.selectedProposalFileId
            ? turnState.proposalSet[turnState.selectedProposalFileId] ?? turnState?.proposalList?.[0] ?? null
            : turnState?.proposalList?.[0] ?? null;
        const turnProposalSet =
          turnState?.proposalList?.length ? { proposals: turnState.proposalList } : null;

const safeContent = stripMarkersForRender(msg.content).trim();
const parsed = msg.role === "assistant" ? parseSections(safeContent) : null;

const hasVisibleProposal =
  !!turnState?.pendingConfirm &&
  !!turnProposal &&
  !thinking &&
  turnState.status !== "superseded";
const hasVisibleApplied =
  !!turnState?.applied?.ok &&
  !thinking;
const hasVisibleVerify =
  !!turnState?.verify &&
  !thinking;

const hasVisiblePreverify =
  !!turnState?.preverify &&
  !thinking;

const hasVisibleSuggestions =
  suggestedPrompts.length > 0 &&
  !thinking &&
  messages[messages.length - 1]?.id === msg.id;

const hasVisibleBody =
  msg.role !== "assistant"
    ? true
    : Boolean(
        safeContent &&
          (
            parsed?.observation ||
            parsed?.assessment ||
            parsed?.action ||
            safeContent.replace(/\s/g, "").length > 0
          )
      );

const isGoalOnlyMessage =
  msg.role === "assistant" &&
  !hasVisibleBody &&
  !!goalPlan &&
  messages[messages.length - 1]?.id === msg.id;

const shouldHideEmptyAssistantBubble =
  msg.role === "assistant" &&
  !isThinkingBubble &&
  !hasVisibleBody &&
  !hasVisibleProposal &&
  !hasVisibleApplied &&
  !hasVisibleVerify &&
  !hasVisiblePreverify &&
  !hasVisibleSuggestions &&
  !isGoalOnlyMessage;

if (shouldHideEmptyAssistantBubble) {
  return null;
}

        let previewText =
          turnProposal?.meta?.op === "append"
            ? String(turnProposal?.meta?.appendPreview ?? "")
            : (turnProposal?.content ?? lastProposal?.content ?? "");

        if (!previewText) {
          previewText = turnProposal?.content ?? lastProposal?.content ?? "";
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

                    const safe = safeContent;
                    const s = parsed ?? parseSections(safe);

                    const displayAction =
                      turnState?.applied?.ok
                        ? "Changes were applied successfully."
                        : s.action;
                    
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

                        {displayAction && (
                          <div className="border-l-2 border-emerald-400/50 pl-3">
                            <div className="text-[10px] uppercase tracking-widest text-emerald-300/70 mb-1">
                              Action
                            </div>
                            <div className="text-white/95 whitespace-pre-wrap">{displayAction}</div>
                          </div>
                        )}

                        {turnState?.applied?.ok && !thinking && (
                          <div className="mt-3 rounded-lg border border-sky-400/25 bg-sky-500/10 p-3 text-xs text-sky-100/90">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[10px] uppercase tracking-widest opacity-80">
                                  Applied
                                </div>
                                <div className="mt-1 truncate">
                                  {turnState.applied.appliedFiles.length > 1
                                    ? `${turnState.applied.appliedFiles.length} files updated successfully`
                                    : `${
                                        turnState.applied.appliedFiles[0]?.path ||
                                        turnState.applied.touchedFileIds[0] ||
                                        "Change"
                                      } updated successfully`}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  patchActiveTurn(msg.id, (prev) => ({
                                    ...prev,
                                    applied: null,
                                  }));
                                }}
                                className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ✅ Anchored VERIFY (inside the bubble) */}
{turnState?.verify && !thinking && (
  <VerifyCard v={turnState.verify} />
)}

{lastPreverify &&
  !thinking &&
  lastPreverifyMsgId === msg.id && (
    <div
      className={`mt-3 rounded-lg border p-3 text-xs ${
        lastVerify.skipped
          ? "border-amber-400/25 bg-amber-500/10 text-amber-100/90"
          : lastVerify.ok
          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100/90"
          : "border-rose-400/25 bg-rose-500/10 text-rose-100/90"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest opacity-80">
            Pre-verify
          </div>
            <div className="mt-1 truncate">
            {lastVerify.skipped
              ? "SKIPPED · Static site preview only"
              : `${lastVerify.ok ? "PASS" : "FAIL"} · ${String(lastVerify.command ?? "")}`}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setLastPreverify(null);
            setLastPreverifyMsgId(null);
          }}
          className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-2 text-[11px] opacity-80 flex flex-wrap gap-x-3 gap-y-1">
        {lastVerify.skipped ? (
          <>
            <span>{String(lastVerify.reason ?? "static site (no verify pipeline)")}</span>
            {Array.isArray(lastVerify.fileIds) ? <span>{lastVerify.fileIds.length} file(s)</span> : null}
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

          {!lastPreverify.ok ? (
            <div className="mt-2 space-y-2 text-[11px] opacity-80">
              {lastPreverify.baseline ? (
                <div className="rounded-md border border-amber-300/20 bg-black/20 px-2 py-2">
                  <div className="font-medium text-amber-100/90">
                    Baseline repository issue detected
                  </div>
                  <div className="mt-1 text-amber-100/70">
                    This failure appears unrelated to only the staged change.
                  </div>
                </div>
              ) : null}

              <div className="whitespace-pre-wrap">
                {String(
                  lastPreverify.error ||
                    lastPreverify.stderr ||
                    lastPreverify.stdout ||
                    "Pre-verify failed."
                ).slice(0, 600)}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[11px] opacity-80">
              Proposal passes sandbox verification before apply.
            </div>
          )}
    </div>
  )}

{(() => {
console.log("[proposal render gate]", {
  msgId: msg.id,
  activeTurnId: activeTurn?.turnId ?? null,
  match: msg.id === activeTurn?.turnId,
  thinking,
  turnStatus: turnState?.status ?? null,
  pendingConfirm: turnState?.pendingConfirm ?? null,
  proposalCount: turnState?.proposalList?.length ?? 0,
  selectedProposalFileId: turnState?.selectedProposalFileId ?? null,
  hasTurnProposal: !!turnProposal,
});
  return null;
})()}

{/* ✅ Anchored PROPOSAL (inside the bubble) */}
{turnState?.pendingConfirm &&
  turnProposal &&
  !thinking &&
  turnState.status !== "superseded" && (
    <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 text-xs text-emerald-100/90">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
            Pending change
          </div>
          <div className="mt-1 truncate">
            File:{" "}
            <span className="text-emerald-100">
              {turnProposal.path || turnProposal.name || turnProposal.fileId}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            patchActiveTurn(msg.id, (prev) => ({
              ...prev,
              proposalSet: {},
              proposalList: [],
              selectedProposalFileId: null,
              pendingConfirm: null,
            }));

            setLastProposal(null);
            setLastProposalSet(null);
            setProposalSet({});
            setPendingConfirm(null);
            setPendingConfirmMsgId(null);
            console.log("[proposal preview cleared]", {
  source: "dismiss_or_apply_or_reset",
  msgId: msg.id,
});
            onProposalPreview?.(null);
          }}
          className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
        >
          Dismiss
        </button>
      </div>

      {turnState.proposalList.length > 1 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
            Staged files
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {turnState.proposalList.map((p) => {
              const selected = p.fileId === turnState.selectedProposalFileId;

              return (
                <button
                  key={p.fileId}
                  type="button"
                  onClick={() => {
                    patchActiveTurn(msg.id, (prev) => ({
                      ...prev,
                      selectedProposalFileId: p.fileId,
                    }));

                    if (p.fileId) openFileById?.(p.fileId);
                  }}
                  className={`rounded-md border px-2 py-1 text-[11px] transition ${
                    selected
                      ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100"
                      : "border-white/10 bg-black/20 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {p.path || p.name || p.fileId}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2">
        <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
          Confirmation phrase
        </div>
        <div className="mt-1 rounded-md bg-black/30 px-2 py-1 font-mono text-[11px] text-emerald-100 break-all">
          {turnState.pendingConfirm}
        </div>

        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-widest text-emerald-200/70">
            {turnProposal?.meta?.op === "append"
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
              if (!turnState || !turnProposal) return;

              applyOriginMsgIdRef.current = msg.id;

              patchActiveTurn(msg.id, (prev) => ({
                ...prev,
                verify: null,
                preverify: null,
                pendingConfirm: null,
              }));

              setLastVerify(null);
              setLastVerifyMsgId(null);
              setLastPreverify(null);
              setLastPreverifyMsgId(null);

              setPendingConfirm(null);
              setPendingConfirmMsgId(null);

              const proposalCount = turnState.proposalList.length;

              if (proposalCount > 1) {
                const payload = JSON.stringify(turnProposalSet);
                handleSend(`__APPLY_SET__:${payload}`);
                return;
              }

              const payload = JSON.stringify(turnProposal);
              handleSend(`__APPLY__:${payload}`);
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
            {goalPlan && (
              <div className="mb-4">
                <GoalPlanCard
                  goal={goalPlan}
                  continueDisabled={goalContinueBlocked}
                 onApprove={() => {
                  if (!goalPlan || goalPlan.status !== "awaiting_approval") {
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: makeId(),
                        role: "system",
                        content:
                          "[Observation]\nGoal approval failed.\n\n[Assessment]\nNo pending goal plan was found.\n\n[Action]\nCreate a plan first.",
                        createdAt: Date.now(),
                      },
                    ]);
                    return;
                  }

                  setGoalPlan((prev) => {
                    if (!prev) return prev;

                    const firstStepId = prev.steps?.[0]?.id ?? null;

                    return {
                      ...prev,
                      status: "running",
                      currentStepId: firstStepId,
                      completedStepIds: [],
                      steps: prev.steps.map((step, idx) => ({
                        ...step,
                        status: idx === 0 ? "running" : "pending",
                      })),
                    };
                  });

                  handleSend("__GOAL_APPROVE__");
                }}
                  onContinue={() => {
                    if (goalContinueBlocked) {
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: makeId(),
                          role: "system",
                          content:
                            "Current goal step has a pending proposal. Apply or dismiss it before continuing.",
                          createdAt: Date.now(),
                        },
                      ]);
                      return;
                    }

                    handleSend("__GOAL_CONTINUE__");
                  }}
                  onRepair={() => handleSend("__GOAL_REPAIR__")}
                  onStop={() => handleSend("__GOAL_STOP__")}
                />
              </div>
            )}
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