import type { RecentFileRef } from "@/lib/chamber/followupContinuity";

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractMarkerJsonBlocks(content: string, marker: string): any[] {
  const text = String(content ?? "");
  const out: any[] = [];

  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startNeedle = `${marker}:`;
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const markerIndex = text.indexOf(startNeedle, searchIndex);
    if (markerIndex === -1) break;

    const jsonStart = markerIndex + startNeedle.length;
    const firstChar = text[jsonStart];

    if (firstChar !== "{" && firstChar !== "[") {
      searchIndex = jsonStart;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let endIndex = -1;

    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{" || ch === "[") {
        depth += 1;
      } else if (ch === "}" || ch === "]") {
        depth -= 1;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    if (endIndex !== -1) {
      const rawJson = text.slice(jsonStart, endIndex);
      const parsed = safeJsonParse(rawJson);
      if (parsed) out.push(parsed);
      searchIndex = endIndex;
      continue;
    }

    const regexMatches = [...text.matchAll(
      new RegExp(`${escapedMarker}:(\\{.*?\\}|\\[.*?\\])(?=\\n|$)`, "g")
    )];

    for (const m of regexMatches) {
      const parsed = safeJsonParse(m[1]);
      if (parsed) out.push(parsed);
    }
    break;
  }

  return out;
}

function toTs(input?: string | null): number | undefined {
  if (!input) return undefined;
  const ts = new Date(input).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

function pushPath(
  refs: RecentFileRef[],
  pathLike: unknown,
  source: RecentFileRef["source"],
  ts?: number
) {
  const path = String(pathLike ?? "").trim();
  if (!path) return;
  refs.push({ path, source, ts });
}

function collectPathsFromPayload(
  payload: any,
  source: RecentFileRef["source"],
  ts?: number
): RecentFileRef[] {
  const refs: RecentFileRef[] = [];

  if (!payload || typeof payload !== "object") return refs;

  pushPath(refs, payload?.path, source, ts);
  pushPath(refs, payload?.meta?.path, source, ts);

  if (payload?.appliedFile) {
    pushPath(refs, payload.appliedFile?.path, source, ts);
    pushPath(refs, payload.appliedFile?.meta?.path, source, ts);
  }

  if (Array.isArray(payload?.appliedFiles)) {
    for (const item of payload.appliedFiles) {
      pushPath(refs, item?.path, source, ts);
      pushPath(refs, item?.meta?.path, source, ts);
    }
  }

  if (Array.isArray(payload?.proposals)) {
    for (const p of payload.proposals) {
      pushPath(refs, p?.path, source, ts);
      pushPath(refs, p?.meta?.path, source, ts);
    }
  }

  if (Array.isArray(payload?.files)) {
    for (const f of payload.files) {
      pushPath(refs, f?.path, source, ts);
      pushPath(refs, f?.meta?.path, source, ts);
    }
  }

  return refs;
}

function extractPathsFromAssistantSummary(content: string): string[] {
  const text = String(content ?? "");
  const found = new Set<string>();

  const fileLikeMatches = text.matchAll(
    /\b([a-zA-Z0-9_./-]+\.(html|css|js|jsx|ts|tsx|txt|md|json))\b/g
  );

  for (const m of fileLikeMatches) {
    const path = String(m[1] ?? "").trim();
    if (path) found.add(path);
  }

  return [...found];
}

export function collectRecentTouchedFilesFromMessages(
  messages: Array<{ role?: string; content?: string; created_at?: string | null }>
): RecentFileRef[] {
  const refs: RecentFileRef[] = [];

  for (const msg of messages) {
    const content = String(msg?.content ?? "");
    const ts = toTs(msg?.created_at ?? undefined);
    const role = String(msg?.role ?? "");

    // New / actual apply payloads commonly sent as user control messages
    const applySingles = extractMarkerJsonBlocks(content, "__APPLY__");
    for (const item of applySingles) {
      refs.push(...collectPathsFromPayload(item, "apply", ts));
    }

    const applySets = extractMarkerJsonBlocks(content, "__APPLY_SET__");
    for (const set of applySets) {
      refs.push(...collectPathsFromPayload(set, "apply", ts));
    }

    // Older / alternate applied markers
    const appliedSingles = extractMarkerJsonBlocks(content, "__APPLIED__");
    for (const item of appliedSingles) {
      refs.push(...collectPathsFromPayload(item, "apply", ts));
    }

    const appliedSets = extractMarkerJsonBlocks(content, "__APPLIED_SET__");
    for (const set of appliedSets) {
      refs.push(...collectPathsFromPayload(set, "apply", ts));
    }

    // Proposal markers
    const proposalSingles = extractMarkerJsonBlocks(content, "__PROPOSAL__");
    for (const item of proposalSingles) {
      refs.push(...collectPathsFromPayload(item, "proposal", ts));
    }

    const proposalSets = extractMarkerJsonBlocks(content, "__PROPOSAL_SET__");
    for (const set of proposalSets) {
      refs.push(...collectPathsFromPayload(set, "proposal", ts));
    }

    // Plain assistant summaries as fallback
    if (role === "assistant") {
      const summaryPaths = extractPathsFromAssistantSummary(content);
      for (const path of summaryPaths) {
        const lower = path.toLowerCase();

        if (
          /\b(write applied|staged change to|applied staged change to|version advanced)\b/i.test(
            content
          )
        ) {
          refs.push({ path, source: "apply", ts });
        } else if (
          /\b(proposals were prepared|staged change is ready|required repository changes were staged)\b/i.test(
            content
          )
        ) {
          refs.push({ path, source: "proposal", ts });
        } else if (
          lower.endsWith(".html") ||
          lower.endsWith(".css") ||
          lower.endsWith(".ts") ||
          lower.endsWith(".tsx") ||
          lower.endsWith(".js") ||
          lower.endsWith(".jsx")
        ) {
          refs.push({ path, source: "read", ts });
        }
      }
    }
  }

  return refs;
}