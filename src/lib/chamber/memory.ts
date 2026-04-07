import OpenAI from "openai";
import { randomUUID, randomBytes } from "crypto";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { VAULT_BUCKET } from "@/lib/vault/buckets";
import { sha256 } from "@/lib/vault/utils";
import { vault_read_text, vault_propose_write } from "@/lib/vault/tools";
import { SACRED_PATH, SACRED_NAME, SACRED_MIME, USER_PROFILE_PATH, USER_PROFILE_NAME, USER_PROFILE_MIME, SUMMARY_TRIGGER_MSGS, SUMMARY_KEEP_LAST, SUMMARY_TARGET_MSGS, SACRED_TEMPLATE, USER_PROFILE_TEMPLATE
} from "@/lib/chamber/constants";
import type { ChamberProfile } from "@/lib/chamber/profile";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function ensureSacredMemoryFile(supabase: any, repoId: string, userId: string) {
  const { data: existing, error: findErr } = await supabase
    .from("repo_files")
    .select("id, path, name, mime, storage_key, version")
    .eq("repo_id", repoId)
    .eq("path", SACRED_PATH)
    .is("deleted_at", null)
    .maybeSingle();

  if (findErr) throw new Error(`ensureSacredMemoryFile lookup failed: ${findErr.message}`);
  if (existing?.id) return existing;

  const fileId = typeof randomUUID === "function" ? randomUUID() : randomBytes(16).toString("hex");
  const storageKey = `repos/${repoId}/${fileId}/v1`;
  const sizeBytes = Buffer.byteLength(SACRED_TEMPLATE, "utf8");
  const fileSha = sha256(SACRED_TEMPLATE);

  const { error: createErr } = await supabase.from("repo_files").insert({
    id: fileId,
    repo_id: repoId,
    path: SACRED_PATH,
    name: SACRED_NAME,
    mime: SACRED_MIME,
    size_bytes: sizeBytes,
    storage_key: storageKey,
    version: 1,
    created_by: userId,
    updated_at: new Date().toISOString(),
  });

  if (createErr) throw new Error(`ensureSacredMemoryFile create failed: ${createErr.message}`);

  const blob = new Uint8Array(Buffer.from(SACRED_TEMPLATE, "utf8"));
  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(storageKey, blob, { upsert: false, contentType: SACRED_MIME });

  if (upErr) {
    await supabase.from("repo_files").delete().eq("id", fileId).eq("repo_id", repoId);
    throw new Error(`ensureSacredMemoryFile upload failed: ${upErr.message}`);
  }

  const ver = await supabase.from("repo_file_versions").insert({
    file_id: fileId,
    version: 1,
    storage_key: storageKey,
    size_bytes: sizeBytes,
    mime: SACRED_MIME,
    actor: "system",
    created_by: userId,
    sha256: fileSha,
  });

  if (ver.error) console.log("[ensureSacredMemoryFile] versions insert failed:", ver.error.message);

  return { id: fileId, path: SACRED_PATH, storage_key: storageKey, version: 1 };
}

export async function updateUserCalibrationProfile(
  supabase: any,
  repoId: string,
  profile: ChamberProfile
) {
  // read current user-profile.md
  // replace only the "## Calibration Profile" block
  // upsert updated content
}

export async function ensureUserProfileFile(supabase: any, repoId: string, userId: string) {
  const { data: existing, error: findErr } = await supabase
    .from("repo_files")
    .select("id, path, name, mime, storage_key, version")
    .eq("repo_id", repoId)
    .eq("path", USER_PROFILE_PATH)
    .is("deleted_at", null)
    .maybeSingle();

  if (findErr) throw new Error(`ensureUserProfileFile lookup failed: ${findErr.message}`);
  if (existing?.id) return existing;

  const fileId = typeof randomUUID === "function" ? randomUUID() : randomBytes(16).toString("hex");
  const storageKey = `repos/${repoId}/${fileId}/v1`;
  const sizeBytes = Buffer.byteLength(USER_PROFILE_TEMPLATE, "utf8");
  const fileSha = sha256(USER_PROFILE_TEMPLATE);

  const { error: createErr } = await supabase.from("repo_files").insert({
    id: fileId,
    repo_id: repoId,
    path: USER_PROFILE_PATH,
    name: USER_PROFILE_NAME,
    mime: USER_PROFILE_MIME,
    size_bytes: sizeBytes,
    sha256: fileSha,
    storage_key: storageKey,
    version: 1,
    created_by: userId,
    updated_at: new Date().toISOString(),
  });

  if (createErr) throw new Error(`ensureUserProfileFile create failed: ${createErr.message}`);

  const blob = new Uint8Array(Buffer.from(USER_PROFILE_TEMPLATE, "utf8"));
  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(storageKey, blob, { upsert: false, contentType: USER_PROFILE_MIME });

  if (upErr) {
    await supabase.from("repo_files").delete().eq("id", fileId).eq("repo_id", repoId);
    throw new Error(`ensureUserProfileFile upload failed: ${upErr.message}`);
  }

  const ver = await supabase.from("repo_file_versions").insert({
    file_id: fileId,
    version: 1,
    storage_key: storageKey,
    size_bytes: sizeBytes,
    mime: USER_PROFILE_MIME,
    actor: "system",
    created_by: userId,
    sha256: fileSha,
  });

  if (ver.error) console.log("[ensureUserProfileFile] versions insert failed:", ver.error.message);

  return { id: fileId, path: USER_PROFILE_PATH, storage_key: storageKey, version: 1 };
}

export async function upsertRepoMemoryDoc(
  supabase: any,
  repoId: string,
  key: "master-summary" | "path-tree" | "chamber-state" | "ledger",
  content: string
) {
  const body = String(content ?? "").trim();

  const { error } = await supabase
    .from("repo_memory_docs")
    .upsert(
      {
        repo_id: repoId,
        key,
        content: body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "repo_id,key" }
    );

  if (error) {
    console.log("[memory-doc] upsert failed", {
      repoId,
      key,
      message: error.message,
    });
    throw new Error(`repo_memory_docs upsert failed for ${key}: ${error.message}`);
  }
}

export async function updateChamberStateDoc(
  supabase: any,
  repoId: string,
  patch: {
    activeEngineeringArea?: string;
    importantFiles?: string[];
    recentChanges?: string[];
    immediateNextSteps?: string[];
  }
) {
  const { data: existing, error: readErr } = await supabase
    .from("repo_memory_docs")
    .select("content")
    .eq("repo_id", repoId)
    .eq("key", "chamber-state")
    .maybeSingle();

  if (readErr) {
    console.log("[chamber-state] read failed:", readErr.message);
    return;
  }

  const current = String(existing?.content ?? "").trim();

  function extractSection(doc: string, heading: string) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`, "m");
    const m = doc.match(re);
    return m?.[1]?.trim() ?? "";
  }

  function parseBullets(sectionBody: string) {
    return sectionBody
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^- /, "").trim())
      .filter((s) => s && s.toLowerCase() !== "not yet confirmed.");
  }

  function unique(items: string[]) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      const clean = item.trim();
      const key = clean.toLowerCase();
      if (!clean) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
    return out;
  }

  const currentArea = extractSection(current, "Active Engineering Area");
  const currentFiles = parseBullets(extractSection(current, "Important Files"))
    .map((s) => s.replace(/^`|`$/g, ""));
  const currentChanges = parseBullets(extractSection(current, "Recent Changes"));
  const currentSteps = parseBullets(extractSection(current, "Immediate Next Steps"));

  const nextArea = patch.activeEngineeringArea?.trim() || currentArea || "Not yet confirmed.";

  const nextFiles = unique([
    ...currentFiles,
    ...(patch.importantFiles ?? []).map((s) => s.trim()).filter(Boolean),
  ]);

  const nextChanges = unique([
    ...(patch.recentChanges ?? []).map((s) => s.trim()).filter(Boolean),
    ...currentChanges,
  ]).slice(0, 8);

  const nextSteps = unique([
    ...(patch.immediateNextSteps ?? []).map((s) => s.trim()).filter(Boolean),
    ...currentSteps,
  ]).slice(0, 8);

  const body = `# Chamber State

## Active Engineering Area
${nextArea}

## Important Files
${nextFiles.length ? nextFiles.map((f) => `- \`${f}\``).join("\n") : "Not yet confirmed."}

## Recent Changes
${nextChanges.length ? nextChanges.map((x) => `- ${x}`).join("\n") : "Not yet confirmed."}

## Immediate Next Steps
${nextSteps.length ? nextSteps.map((x) => `- ${x}`).join("\n") : "Not yet confirmed."}
`.trim();

  const { error: upsertErr } = await supabase
    .from("repo_memory_docs")
    .upsert(
      {
        repo_id: repoId,
        key: "chamber-state",
        content: body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "repo_id,key" }
    );

  if (upsertErr) {
    console.log("[chamber-state] upsert failed:", upsertErr.message);
  }
}

export async function maybeSummarizeAndEngraveProposal(
  supabase: any,
  repoId: string,
  userId: string,
  opts?: { force?: boolean }
) {
  const SUMMARY_TABLE = "repo_chat_summaries";

  // 1) count messages
  const { count, error: countErr } = await supabase
    .from("repo_messages")
    .select("id", { count: "exact", head: true })
    .eq("repo_id", repoId);

  if (countErr) {
    console.log("[engraving] count failed:", countErr.message);
    return null;
  }

  const force = Boolean(opts?.force);
    if (!force && (count ?? 0) < SUMMARY_TRIGGER_MSGS) return null;

  // 2) fetch recent messages to summarize
  const { data: recent, error: recentErr } = await supabase
    .from("repo_messages")
    .select("role, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(SUMMARY_TARGET_MSGS);

  if (recentErr) {
    console.log("[engraving] recent fetch failed:", recentErr.message);
    return null;
  }

  const ordered = (recent ?? []).slice().reverse();
  const clip = (s: string, n = 700) => (s.length > n ? s.slice(0, n) + "…" : s);

  const toSummarize = ordered
    .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${clip(m.content)}`)
    .join("\n\n");

const engravingPrompt = `
You are generating repository memory docs for Vestaryn.

Return ONLY valid JSON with exactly this shape:
{
  "master-summary": "...markdown...",
  "path-tree": "...markdown...",
  "chamber-state": "...markdown...",
  "ledger": "...markdown..."
}

Rules:
- Each value must be markdown text.
- Do not include markdown fences.
- Do not include explanation outside the JSON.
- Prefer durable engineering state over conversational fluff.
- Be concrete and specific.
- If path tree information is not available, write "No path tree produced."
- If a section truly has no signal, write a minimal placeholder instead of inventing facts.

Meaning of the docs:
- master-summary: broad project handover and current state
- path-tree: important files / subsystem map / where logic lives
- chamber-state: active engineering area, recent changes, next steps
- ledger: engineering decisions, fixes, regressions, notable changes

CHAT CONTEXT:
${toSummarize}
`.trim();

const resp = await openai.responses.create({
  model: "gpt-5-mini",
  input: engravingPrompt,
  max_output_tokens: 2600,
});

let engravingDocs: Record<string, string> | null = null;

try {
  engravingDocs = JSON.parse((resp.output_text || "").trim());
} catch (e: any) {
  console.log("[engraving] JSON parse failed:", e?.message);
  return null;
}

const masterSummary = String(engravingDocs?.["master-summary"] ?? "").trim() || "# Master Summary\n\nNo summary produced.";
const pathTree = String(engravingDocs?.["path-tree"] ?? "").trim() || "# Path Tree\n\nNo path tree produced.";
const chamberState = String(engravingDocs?.["chamber-state"] ?? "").trim() || "# Chamber State\n\nNo chamber state produced.";
const ledger = String(engravingDocs?.["ledger"] ?? "").trim() || "# Engineering Ledger\n\nNo ledger produced.";


const supabaseAdmin = createSupabaseAdmin();

const summaryText = masterSummary;

const { data: inserted, error: insErr } = await supabaseAdmin
  .from(SUMMARY_TABLE)
  .insert({ repo_id: repoId, created_by: userId, summary_md: summaryText })
  .select("id")
  .single();

  if (insErr) {
    const msg = insErr.message || "";
    if (msg.includes("schema cache") || msg.includes("Could not find the table")) {
      console.log("[engraving] disabled (table missing in schema cache)");
      // do NOT bail; you can still propose engraving even if table missing
    } else {
      console.log("[engraving] insert failed:", msg);
      // also do NOT bail; still propose engraving
    }
  }

  
  // 3) compute prune plan (same logic), BUT DO NOT DELETE HERE
  const { data: keep, error: keepErr } = await supabase
    .from("repo_messages")
    .select("id")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(SUMMARY_KEEP_LAST);

  if (keepErr) {
    console.log("[engraving] keep fetch failed:", keepErr.message);
    return null; // pruning plan is required for safe apply->prune
  }

  const keepIds = (keep ?? []).map((x: any) => x.id).filter(Boolean);
  if (keepIds.length === 0) return null;

// 4) Build engraving marker using a REAL vault proposal (so __APPLY__ works)
const sacred = await ensureSacredMemoryFile(supabase, repoId, userId);
const sacredFileId = sacred.id;

// keep a normal proposal so APPLY has something concrete to confirm/prune against
const proposal = await vault_propose_write(
  supabase,
  repoId,
  sacredFileId,
  masterSummary
);

(proposal as any).meta = {
  kind: "engraving",
  keepIds,
  engravingDocs: {
    "master-summary": masterSummary,
    "path-tree": pathTree,
    "chamber-state": chamberState,
    "ledger": ledger,
  },
};

const marker = {
  kind: "engraving",
  reason: `Message threshold reached (${count}). Suggest engraving into sacred memory.`,
  stats: { messageCount: count },
  proposal, // ✅ vault proposal shape
  prune: { keepIds },
  summaryId: inserted?.id ?? null,
};

return { marker };
}