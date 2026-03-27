import type { RecentFileRef } from "@/lib/chamber/followupContinuity";

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractMarkerJsonBlocks(content: string, marker: string): any[] {
  const matches = [...String(content ?? "").matchAll(
    new RegExp(`${marker}:(\\{.*?\\})(?=\\n|$)`, "g")
  )];

  const out: any[] = [];
  for (const m of matches) {
    const parsed = safeJsonParse(m[1]);
    if (parsed) out.push(parsed);
  }
  return out;
}

function toTs(input?: string | null): number | undefined {
  if (!input) return undefined;
  const ts = new Date(input).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

export function collectRecentTouchedFilesFromMessages(
  messages: Array<{ role?: string; content?: string; created_at?: string | null }>
): RecentFileRef[] {
  const refs: RecentFileRef[] = [];

  for (const msg of messages) {
    const content = String(msg?.content ?? "");
    const ts = toTs(msg?.created_at ?? undefined);

    const appliedSingles = extractMarkerJsonBlocks(content, "__APPLIED__");
    for (const item of appliedSingles) {
      const path = String(item?.path ?? item?.meta?.path ?? "").trim();
      if (path) refs.push({ path, source: "apply", ts });
    }

    const appliedSets = extractMarkerJsonBlocks(content, "__APPLIED_SET__");
    for (const set of appliedSets) {
      const proposals = Array.isArray(set?.proposals)
        ? set.proposals
        : Array.isArray(set?.files)
        ? set.files
        : [];
      for (const p of proposals) {
        const path = String(p?.path ?? p?.meta?.path ?? "").trim();
        if (path) refs.push({ path, source: "apply", ts });
      }
    }

    const proposalSingles = extractMarkerJsonBlocks(content, "__PROPOSAL__");
    for (const item of proposalSingles) {
      const path = String(item?.path ?? item?.meta?.path ?? "").trim();
      if (path) refs.push({ path, source: "proposal", ts });
    }

    const proposalSets = extractMarkerJsonBlocks(content, "__PROPOSAL_SET__");
    for (const set of proposalSets) {
      const proposals = Array.isArray(set?.proposals) ? set.proposals : [];
      for (const p of proposals) {
        const path = String(p?.path ?? p?.meta?.path ?? "").trim();
        if (path) refs.push({ path, source: "proposal", ts });
      }
    }
  }

  return refs;
}