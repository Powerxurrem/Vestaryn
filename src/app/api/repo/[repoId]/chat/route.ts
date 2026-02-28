import OpenAI from "openai";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { randomUUID, randomBytes, createHash } from "crypto";
import { resolveTierPolicy, resolveTierPolicyWithMeta } from "@/lib/membership/tiers";
import type { TierPolicy } from "@/lib/membership/tiers";
import { runnerRun } from "@/lib/runner/client";
import { buildRepoSnapshotSignedUrl } from "@/lib/runner/snapshot";
import { createSupabaseAdmin } from "@/lib/supabase/admin";



/**
 * @file app/api/repo/[repoId]/chat/route.ts
 * @purpose Stream assistant output for a repo chat, while enforcing Vestaryn output contract.
 * @exports POST
 */

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────
// OpenAI client
// ─────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ─────────────────────────────────────────────────────────────
// SYSTEM_PROTECTOR (critical contract)
// ─────────────────────────────────────────────────────────────
export const SYSTEM_PROTECTOR_DEFAULT = `
You are Vestaryn: a deterministic cognition chamber.

OUTPUT FORMAT (mandatory):
[Observation]
...
[Assessment]
...
[Action]
...

GLOBAL RULES:
- If your message does not start with [Observation], it is invalid.
- Keep total output <= 10 sentences. Bullets count as sentences.
- Be direct. No politeness padding. No conversational continuation.

SYSTEMS vs NON-SYSTEMS:
- A "systems question" explicitly references software/code/data/APIs/DB/infra/security/architecture/AI models/implementation mechanics.
- If NOT a systems question: [Action] MUST start with "Not a systems question." Then give ONE structural conclusion. No technical mechanisms. No research instructions.

SYSTEMS QUESTIONS (only):
- [Assessment] MUST include >= 3 explicit failure scenarios (what breaks + how it manifests).
- [Action] MUST include >= 2 concrete technical mechanisms chosen from:
  DB constraint, event-id dedupe, transactional upsert, advisory lock, RLS policy pattern.

REAL-WORLD NEWS / CURRENT EVENTS:
- If no verified confirmation exists: say exactly "No verified confirmation exists at this time." and stop.
- This phrase is FORBIDDEN for internal tools/files/DB results.

VAULT RULES (tools are the only file access):
- Never fabricate filenames or file contents.
- If user asks about vault contents: call vault_list_files.
- If user asks to read a text file: call vault_read_text with EXACTLY ONE identifier: fileId OR path OR name (never empty).
- If user asks to append: call vault_propose_append directly (do NOT call vault_read_text first).
  Always pass: { path: "<path or name>", content: "<text to append>" }.
- If a vault/tool returns data: treat it as verified. If a tool fails: report the tool error plainly.

USER PROFILE:
- USER_PROFILE is at memory/user-profile.md. Use it to tune verbosity/style.
- Do NOT update USER_PROFILE frequently. Only at onboarding or major milestones.
- Any USER_PROFILE change MUST be proposed via vault_propose_write(path: memory/user-profile.md) and requires explicit user confirm/apply.
`.trim();

export const SYSTEM_PROTECTOR_ARCH = `
You are Vestaryn: a deterministic cognition chamber operating in ARCHITECTURE MODE.

OUTPUT FORMAT (mandatory):
[Observation]
...
[Assessment]
...
[Action]
...

GLOBAL RULES:
- If your message does not start with [Observation], it is invalid.
- Keep total output <= 25 sentences. Bullets count as sentences.
- Be direct. No politeness padding. No conversational continuation.

SYSTEMS vs NON-SYSTEMS:
- A "systems question" explicitly references software/code/data/APIs/DB/infra/security/architecture/AI models/implementation mechanics.
- If NOT a systems question: [Action] MUST start with "Not a systems question." Then give ONE structural conclusion. No technical mechanisms. No research instructions.

SYSTEMS QUESTIONS (only):
- [Assessment] MUST include:
  - Topology (components/modules involved)
  - Data/control flow (who calls what)
  - >= 3 explicit failure scenarios (what breaks + how it manifests)
  - Primary tradeoff (speed vs safety vs cost vs complexity)

- [Action] MUST include:
  - >= 2 concrete technical mechanisms chosen from:
    DB constraint, event-id dedupe, transactional upsert, advisory lock, RLS policy pattern
  - An ordered implementation plan (step 1..N)
  - If code changes are required: provide either a diff-style patch or clear file-by-file edits (keep it minimal and surgical).

REAL-WORLD NEWS / CURRENT EVENTS:
- If no verified confirmation exists: say exactly "No verified confirmation exists at this time." and stop.
- This phrase is FORBIDDEN for internal tools/files/DB results.

VAULT RULES (tools are the only file access):
- Never fabricate filenames or file contents.
- If user asks about vault contents: call vault_list_files.
- If user asks to read a text file: call vault_read_text with EXACTLY ONE identifier: fileId OR path OR name (never empty).
- If user asks to append: call vault_propose_append directly (do NOT call vault_read_text first).
  Always pass: { path: "<path or name>", content: "<text to append>" }.
- If a vault/tool returns data: treat it as verified. If a tool fails: report the tool error plainly.

USER PROFILE:
- USER_PROFILE is at memory/user-profile.md. Use it to tune verbosity/style.
- Do NOT update USER_PROFILE frequently. Only at onboarding or major milestones.
- Any USER_PROFILE change MUST be proposed via vault_propose_write(path: memory/user-profile.md) and requires explicit user confirm/apply.
`.trim();

const VAULT_BUCKET = "vestaryn-files";
const MAX_READ_BYTES = 200 * 1024;

const SACRED_PATH = "memory/chamber-state.md";
const SACRED_NAME = "chamber-state.md";
const SACRED_MIME = "text/markdown";

const USER_PROFILE_PATH = "memory/user-profile.md";
const USER_PROFILE_NAME = "user-profile.md";
const USER_PROFILE_MIME = "text/markdown";

const SUMMARY_TRIGGER_MSGS = 260;
const SUMMARY_KEEP_LAST = 40;
const SUMMARY_TARGET_MSGS = 200;

const SACRED_TEMPLATE = `# Chamber State (Sacred)

## Identity
- Chamber: Vestaryn
- Mode: Deterministic workspace cognition

## Architectural Invariants
- RLS canon (no deleted_at in SELECT policies)
- DB is metadata source-of-truth
- Storage keys: repos/<repoId>/<fileId>/vN
- Signed URLs only (30m)
- Soft-delete filtered at API/UI level
- Assistant output contract: [Observation]/[Assessment]/[Action]

## Current Focus
- 

## Decisions
- 

## Open Tasks
- 

## Risks / Watchouts
- 

## Active Files
- 
`;

const USER_PROFILE_TEMPLATE = `# User Profile (Non-personal)

## Explicit (user set)
- skill_self_reported: 
- verbosity: Normal   # Minimal | Normal | Deep
- code_delivery: Diff-first  # Diff-first | Full-file | Both
- os: Windows         # Windows | macOS | Linux
- stacks:             # Comma-separated, e.g. React, Next.js, Supabase
- change_tolerance: Surgical # Surgical | Bounded-refactor

## Observed (Vestaryn hypothesis)
- skill_observed: 
- confidence: 0.50
- evidence:
  - 
- strengths:
  - 
- frictions:
  - 
- last_reviewed: 

## Milestones
- 
`;

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function confirmPhrase(fileId: string, nextHash: string) {
  return `APPLY ${fileId} ${nextHash}`;
}

function parseVersionFromKey(key: string | null | undefined) {
  const k = key || "";
  const m = k.match(/\/v(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

function isTextMime(mime: string | null | undefined) {
  const m = (mime || "").toLowerCase();
  return (
    m.startsWith("text/") ||
    m === "application/json" ||
    m.endsWith("+json") ||
    m === "application/xml" ||
    m.endsWith("+xml") ||
    m === "application/yaml" ||
    m === "application/x-yaml" ||
    m === "application/toml" ||
    m === "application/javascript" ||
    m === "text/javascript" ||
    m === "application/typescript" ||
    m === "application/x-typescript"
  );
}

async function resolveFileIdByPathOrName(supabase: any, repoId: string, wanted: string) {
  wanted = (wanted || "").trim();
  wanted = wanted.replace(/^path:\s*/i, "").replace(/^name:\s*/i, "").trim();
  wanted = wanted.replace(/^["'`]+|["'`]+$/g, "").trim();
  wanted = wanted.replace(/^\*\*|\*\*$/g, "").replace(/^\*|\*$/g, "").trim();

  const base = supabase
    .from("repo_files")
    .select("id, created_at")
    .eq("repo_id", repoId)
    .is("deleted_at", null);

  // 1) path exact
  let r = await base
    .eq("path", wanted)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (r.error) throw new Error(`resolve(path) failed: ${r.error.message}`);
  if (r.data?.id) return r.data.id;

  // 2) name exact
  r = await base
    .eq("name", wanted)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (r.error) throw new Error(`resolve(name) failed: ${r.error.message}`);
  if (r.data?.id) return r.data.id;

  return null;
}

async function vault_list_files(supabase: any, repoId: string) {
  console.log("[vault_list_files] ENTER", { repoId });

  const { data, error } = await supabase
    .from("repo_files")
    .select("path, name, mime") // ✅ minimal
    .eq("repo_id", repoId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.log("[vault_list_files] select error:", error.message);
    throw new Error(`vault_list_files failed: ${error.message}`);
  }

  const files = (data ?? []).map((f: any) => ({
    path: String(f.path ?? ""),
    name: String(f.name ?? ""),
    mime: String(f.mime ?? ""),
  }));

  console.log("[vault_list_files] rows:", files.length);
  return { files };
}

async function vault_read_text(supabase: any, repoId: string, fileRef: string) {
  const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  let row: any = null;

  if (isUuid(fileRef)) {
    const { data, error } = await supabase
      .from("repo_files")
      .select(
        "id, repo_id, path, name, mime, size_bytes, storage_key, deleted_at, created_at"
      )
      .eq("repo_id", repoId)
      .eq("id", fileRef)
      .maybeSingle();

    if (error) throw new Error(`vault_read_text metadata failed: ${error.message}`);
    row = data;
  } else {
    const id = await resolveFileIdByPathOrName(supabase, repoId, fileRef);
    if (!id) throw new Error("File not found (by name/path)");

    const { data, error } = await supabase
      .from("repo_files")
      .select(
        "id, repo_id, path, name, mime, size_bytes, storage_key, deleted_at, created_at"
      )
      .eq("repo_id", repoId)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`vault_read_text metadata failed: ${error.message}`);
    row = data;
  }

  if (!row) throw new Error("File not found");
  if (row.deleted_at) throw new Error("File not found");

  if (!isTextMime(row.mime)) throw new Error("Not a text-readable mime");
  if ((row.size_bytes ?? 0) > MAX_READ_BYTES) throw new Error(`File too large (>${MAX_READ_BYTES} bytes)`);
  if (!row.storage_key) throw new Error("Missing storage_key");

  const { data: blob, error: dlErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .download(row.storage_key);

  if (dlErr) throw new Error(`vault_read_text download failed: ${dlErr.message}`);
  if (!blob) return { id: row.id, path: row.path, name: row.name, mime: row.mime, content: "" };

  const ab = await blob.arrayBuffer();
  if (ab.byteLength > MAX_READ_BYTES) throw new Error(`Downloaded bytes too large (>${MAX_READ_BYTES} bytes)`);

  const text = new TextDecoder("utf-8", { fatal: false }).decode(ab);
  return { id: row.id, path: row.path, name: row.name, mime: row.mime, content: text };
}

async function vault_propose_write(supabase: any, repoId: string, fileId: string, newContent: string) {
  const { data: row, error } = await supabase
    .from("repo_files")
    .select("id, repo_id, path, name, mime, size_bytes, storage_key, version")
    .eq("repo_id", repoId)
    .eq("id", fileId)
    .maybeSingle();

  if (error) throw new Error(`vault_propose_write metadata failed: ${error.message}`);
  if (!row) throw new Error("File not found");
  if (!isTextMime(row.mime)) throw new Error("Not a text-readable mime");

  const current = await vault_read_text(supabase, repoId, fileId);
  const prevHash = sha256(current.content);
  const nextHash = sha256(newContent);
  const phrase = confirmPhrase(fileId, nextHash);

  return {
    fileId,
    path: row.path,
    name: row.name,
    mime: row.mime,
    prevHash,
    nextHash,
    confirm: phrase,
    content: newContent,
    bytes: Buffer.byteLength(newContent, "utf8"),
  };
}

async function vault_propose_append(supabase: any, repoId: string, fileRef: string, appendText: string) {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileRef);

  let fileId = fileRef;
  if (!isUuid) {
    const resolved = await resolveFileIdByPathOrName(supabase, repoId, fileRef);
    if (!resolved) throw new Error(`File not found by path/name: ${fileRef}`);
    fileId = resolved;
  }

  const current = await vault_read_text(supabase, repoId, fileId);
  const base = current.content ?? "";
  const glue = base.length === 0 ? "" : base.endsWith("\n") ? "" : "\n";
  const newContent = base + glue + appendText;

  return vault_propose_write(supabase, repoId, fileId, newContent);
}

async function vault_apply_write(
  supabase: any,
  repoId: string,
  userId: string,
  userMessage: string,
  args: { fileId: string; content: string; prevHash: string; nextHash: string; confirm: string }
) {
  const { fileId, content, prevHash, nextHash, confirm } = args;

  const expected = confirmPhrase(fileId, nextHash);
  if (confirm !== expected) throw new Error("Bad confirm phrase");
  if (userMessage.trim() !== expected) throw new Error("User did not confirm apply");

  const { data: row, error } = await supabase
    .from("repo_files")
    .select("id, repo_id, path, name, mime, storage_key, version")
    .eq("repo_id", repoId)
    .eq("id", fileId)
    .maybeSingle();

  if (error) throw new Error(`vault_apply_write metadata failed: ${error.message}`);
  if (!row) throw new Error("File not found");
  if (!isTextMime(row.mime)) throw new Error("Not a text-readable mime");

  const current = await vault_read_text(supabase, repoId, fileId);
  const currentHash = sha256(current.content);

  if (currentHash === nextHash) {
    return {
      ok: true,
      fileId,
      path: row.path,
      version: typeof row.version === "number" ? row.version : parseVersionFromKey(row.storage_key),
      storage_key: row.storage_key,
      nextHash,
      confirm: expected,
      noop: true,
    };
  }

  if (currentHash !== prevHash) throw new Error("Stale proposal: file changed since proposal (hash mismatch)");

  const computedNextHash = sha256(content);
  if (computedNextHash !== nextHash) throw new Error("Proposed content hash mismatch");

  const baseVersion = typeof row.version === "number" ? row.version : parseVersionFromKey(row.storage_key);

  let nextVersion = baseVersion + 1;
  let newKey = `repos/${repoId}/${fileId}/v${nextVersion}`;

  let uploaded = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    newKey = `repos/${repoId}/${fileId}/v${nextVersion}`;
    const blob = new Blob([content], { type: row.mime || "text/plain" });

    const { error: upErr } = await supabase.storage
      .from(VAULT_BUCKET)
      .upload(newKey, blob, { upsert: false, contentType: row.mime || "text/plain" });

    if (!upErr) {
      uploaded = true;
      break;
    }

    const msg = (upErr.message || "").toLowerCase();
    if (msg.includes("already exists")) {
      nextVersion += 1;
      continue;
    }

    throw new Error(`Upload failed: ${upErr.message}`);
  }

  if (!uploaded) throw new Error("Upload failed: version collision retry exhausted");

  const sizeBytes = Buffer.byteLength(content, "utf8");

  const upd = await supabase
    .from("repo_files")
    .update({
      storage_key: newKey,
      size_bytes: sizeBytes,
      mime: row.mime,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fileId)
    .eq("repo_id", repoId);

  if (upd.error) throw new Error(`repo_files update failed: ${upd.error.message}`);

  const verInsert = await supabase.from("repo_file_versions").insert({
    file_id: fileId,
    version: nextVersion,
    storage_key: newKey,
    size_bytes: sizeBytes,
    mime: row.mime,
    actor: "user",
    created_by: userId,
    sha256: nextHash,
  });

  if (verInsert.error) {
    console.log("[vault_apply_write] repo_file_versions insert failed:", verInsert.error.message);
  }

  return {
    ok: true,
    fileId,
    path: row.path,
    version: nextVersion,
    storage_key: newKey,
    size_bytes: sizeBytes,
    nextHash,
    confirm: expected,
  };
}

const TOOLS: any[] = [
  {
    type: "function",
    name: "vault_list_files",
    description:
      "List vault files for this repo. Returns { files: [{id,path,name,mime,updated_at,created_at,size_bytes}] }.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "vault_read_text",
    description:
      "Read a small text file from the vault. Accepts fileId (UUID). If only a filename or path is provided, it will be resolved automatically.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        path: { type: "string" },
        name: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "vault_propose_write",
    description:
      "Propose overwriting a text file with new content. Does NOT write. Returns hashes and a confirmation phrase.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "UUID of the file (preferred if known)" },
        path: { type: "string", description: "File path or name, e.g. miauw.tsx" },
        content: { type: "string" },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "vault_propose_append",
    description:
      "Propose appending text to an existing text file. Does NOT write. Returns hashes and a confirmation phrase.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "UUID of the file (preferred if known)" },
        path: { type: "string", description: "File path or name, e.g. pikachu.txt" },
        content: { type: "string", description: "Text to append" },
      },
      required: ["content", "path"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "vault_apply_write",
    description:
      "Apply a previously proposed overwrite to a text file by creating a new version vN. Requires exact user confirmation phrase.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        content: { type: "string" },
        prevHash: { type: "string" },
        nextHash: { type: "string" },
        confirm: { type: "string" },
      },
      required: ["fileId", "content", "prevHash", "nextHash", "confirm"],
      additionalProperties: false,
    },
  },
];

async function runTool(
  supabase: any,
  repoId: string,
  userId: string,
  userMessage: string,
  name: string,
  args: any,
  tierPolicy: TierPolicy
) {
  const ts = new Date().toISOString();

  try {
    if (name === "vault_list_files") {
      const result = await vault_list_files(supabase, repoId);
      console.log("[tool]", ts, name, { ok: true, count: result.files?.length ?? 0 });
      return result;
    }

    if (name === "vault_read_text") {
      let fileId = String(args?.fileId || "").trim();

      const looksUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId);

      if (!looksUuid) {
        const wanted = String(args?.path || args?.name || fileId).trim();
        const id = await resolveFileIdByPathOrName(supabase, repoId, wanted);
        if (!id) throw new Error(`File not found (by name/path): ${wanted}`);
        fileId = id;
      }

    if (!args || (args.fileId == null && args.path == null && args.name == null)) {
      throw new Error("vault_read_text missing args: provide fileId OR path OR name");
    }
      const result = await vault_read_text(supabase, repoId, fileId);
      console.log("[tool]", ts, name, { ok: true, fileId });
      return result;
    }

    if (name === "vault_propose_write") {
      const content = String(args?.content ?? "");
      if (!content) throw new Error("vault_propose_write missing content");

      const path = String(args?.path ?? "").trim();
      let fileId = String(args?.fileId ?? "").trim();

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId);

      if (!isUuid) {
        const needle = path || fileId;
        if (!needle) throw new Error("vault_propose_write missing fileId/path");

        const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, needle);
        if (!resolvedId) throw new Error(`File not found by path/name: ${needle}`);

        fileId = resolvedId;
      } else {
        if (path) {
          const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, path);
          if (resolvedId && resolvedId !== fileId) {
            console.log("[vault_propose_write] ignoring mismatched fileId, using path", { fileId, resolvedId, path });
            fileId = resolvedId;
          }
        }
      }

      const result = await vault_propose_write(supabase, repoId, fileId, content);
      console.log("[tool]", ts, name, { ok: true, fileId });
      return result;
    }

    if (name === "vault_propose_append") {
      const content = String(args?.content ?? "");
      if (!content) throw new Error("vault_propose_append missing content");

      const path = String(args?.path ?? "").trim();
      const fileId = String(args?.fileId ?? "").trim();

      const fileRef = path || fileId;
      if (!fileRef) throw new Error("vault_propose_append missing fileId/path");

      const result = await vault_propose_append(supabase, repoId, fileRef, content);
      console.log("[tool]", ts, name, { ok: true, fileRef });
      return result;
    }

    if (name === "vault_apply_write") {
      let fileId = String(args?.fileId ?? "").trim();
      const path = String(args?.path ?? "").trim();

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId);

      if (!isUuid) {
        const needle = (path || fileId).trim();
        if (!needle) throw new Error("vault_apply_write missing fileId/path");

        const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, needle);
        if (!resolvedId) throw new Error(`File not found by path/name: ${needle}`);

        fileId = resolvedId;
      } else {
        if (path) {
          const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, path);
          if (resolvedId && resolvedId !== fileId) {
            throw new Error(`vault_apply_write mismatch: fileId does not match path (${path})`);
          }
        }
      }

      const payload = {
        fileId,
        content: String(args?.content ?? ""),
        prevHash: String(args?.prevHash ?? ""),
        nextHash: String(args?.nextHash ?? ""),
        confirm: String(args?.confirm ?? ""),
      };

      if (!payload.content) throw new Error("vault_apply_write missing content");
      if (!payload.prevHash) throw new Error("vault_apply_write missing prevHash");
      if (!payload.nextHash) throw new Error("vault_apply_write missing nextHash");
      if (!payload.confirm) throw new Error("vault_apply_write missing confirm");

      const result = await vault_apply_write(supabase, repoId, userId, payload.confirm, payload);
      console.log("[tool]", ts, name, { ok: true, fileId: payload.fileId });
      return result;
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (e: any) {
    console.log("[tool]", ts, name, { ok: false, error: e?.message });
    return { error: e?.message || "Tool failed" };
  }
}

async function ensureSacredMemoryFile(supabase: any, repoId: string, userId: string) {
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

async function ensureUserProfileFile(supabase: any, repoId: string, userId: string) {
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

type RepoMessageRow = {
  id?: string;
  role: string;
  content: string;
  created_at: string;
};

async function maybeSummarizeAndEngraveProposal(
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

const summaryPrompt = `
You are updating the repository's sacred memory file: memory/chamber-state.md.

This file represents LONG-TERM PROJECT STATE, not temporary user tasks.

Rewrite it as STRICT markdown using exactly this structure:

# Handover Summary
## Current Focus
## Architectural Decisions / Invariants
## Confirmed Working Systems
## Active Problems
## Next Engineering Actions
## Risk Surface

Rules:
- Capture durable project state (architecture, runner behavior, UI markers, vault rules).
- Ignore short-lived user tasks unless they affect core system design.
- Prefer concrete references (routes, markers, runner behavior, invariants).
- Be concise but specific.
- Do NOT include raw logs or conversational fluff.
- Do NOT invent features that were not discussed.
- If something was confirmed working, mark it clearly.
- If something was experimental, mark it clearly.

CHAT CONTEXT:
${toSummarize}
`.trim();

  const resp = await openai.responses.create({
    model: "gpt-4o-mini",
    input: summaryPrompt,
    max_output_tokens: 400,
  });

  const summaryText = (resp.output_text || "").trim() || "# Handover Summary\n\n(Empty summary produced)";

  // OPTIONAL: keep your summary table insert (fine), but this should NOT prune.
  // If you want engraving to replace summaries entirely, you can delete this block later.
  const { data: inserted, error: insErr } = await supabase
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

// Make a normal vault proposal (contains fileId/prevHash/nextHash/confirm/content)
const proposal = await vault_propose_write(supabase, repoId, sacredFileId, summaryText);

// Attach prune plan into proposal.meta so APPLY can prune after success
(proposal as any).meta = { kind: "engraving", keepIds };

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
function ensureTriplet(text: string) {
  const t = (text || "").trim();
  if (!t) return "";
  if (t.startsWith("[Observation]")) return t;

  return `[Observation]\nAssistant produced a non-contract response.\n\n[Assessment]\nThe raw output did not start with the required marker, so it would be hidden by contract-based rendering.\n\n[Action]\n${t}`.trim();
}

function stripDuplicateTriplet(text: string) {
  const first = text.indexOf("[Observation]");
  if (first === -1) return text.trim();

  const second = text.indexOf("[Observation]", first + 12);
  if (second !== -1) return text.slice(0, second).trim();

  return text.trim();
}

// ─────────────────────────────────────────────────────────────
// Route: POST /api/repo/[repoId]/chat
// ─────────────────────────────────────────────────────────────
console.log("[supabase]", process.env.NEXT_PUBLIC_SUPABASE_URL);
export async function POST(req: Request, context: { params: Promise<{ repoId: string }> }) {
  const t0 = performance.now();
  const { repoId } = await context.params;
  const requestId = crypto.randomUUID();

  const supabase = await supabaseServerComponent();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", { _repo_id: repoId });
console.log("[is_repo_member]", { userId: user.id, repoId, isMember, memErr: memErr?.message });

if (memErr) {
  return new Response("Membership check failed", { status: 500 });
}

if (!isMember) {
  return new Response("Forbidden", { status: 403 });
}
  const { content } = await req.json();
  if (!content?.trim()) return new Response("Missing content", { status: 400 });

  console.log("[chat] content_head:", content.slice(0, 40));

  // ─────────────────────────────────────────────────────────────
  // Membership tier policy (server clamp)
  // ─────────────────────────────────────────────────────────────
  const requestedTier = req.headers.get("x-vestaryn-tier");

  const isAdminAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VESTARYN_ALLOW_ADMIN_TIER === "1";

  const tierPolicy = resolveTierPolicy(requestedTier, { isAdminAllowed });

// ─────────────────────────────────────────
// Architecture mode resolver (server-side)
// ─────────────────────────────────────────
const wantsArchitecture =
  /architecture|system design|topology|multi-file|refactor plan|deep dive/i.test(content);

const allowArchitecture =
  tierPolicy.capabilities?.allowArchitectureMode === true;

const useArchitectureMode = allowArchitecture && wantsArchitecture;

const resolvedInstructions = useArchitectureMode
  ? SYSTEM_PROTECTOR_ARCH
  : SYSTEM_PROTECTOR_DEFAULT;

const resolvedMode: "default" | "arch" = useArchitectureMode ? "arch" : "default";

console.log("[policy]", {
  tier: tierPolicy.tier,
  model: tierPolicy.model,
  maxOutputTokens: tierPolicy.output.maxOutputTokens,
  maxToolRounds: tierPolicy.tools.maxToolRounds,
  mode: resolvedMode,
});

console.log("[policy]", {
  tier: tierPolicy.tier,
  model: tierPolicy.model,
  maxOutputTokens: tierPolicy.output.maxOutputTokens,
  maxToolRounds: tierPolicy.tools.maxToolRounds,
  mode: resolvedMode,
});

console.log("[verify_probe] content:", JSON.stringify(content));

const verifyCmd =
  content.trim() === "__VERIFY_TEST__" ? "node_test" :
  content.trim() === "__VERIFY_LINT__" ? "node_lint" :
  content.trim() === "__VERIFY_TYPECHECK__" ? "node_typecheck" :
  null;

console.log("[verify_probe] verifyCmd:", verifyCmd);

if (verifyCmd) {
  const jobId = `verify-${repoId}-${Date.now()}`;
  try {
    console.log("[verify] building snapshot", { repoId, jobId, verifyCmd });


    const supabaseAdmin = createSupabaseAdmin();
    const snap = await buildRepoSnapshotSignedUrl(supabaseAdmin, repoId, jobId, {
      signedUrlTtlSec: 600,
    });

    console.log("[verify] snapshot ready", {
      fileCount: snap.fileCount,
      zipBytes: snap.zipBytes,
      snapshotObjectPath: snap.snapshotObjectPath,
    });

    const result = await runnerRun({
      jobId,
      commandId: verifyCmd,
      snapshotUrl: snap.snapshotSignedUrl,
      timeoutMs: 120_000,
    });

await supabaseAdmin.from("repo_runs").insert({
  repo_id: repoId,
  change_id: null,
  command: verifyCmd,
  ok: Boolean(result.ok),
  exit_code: Number(result.exitCode ?? -1),
  duration_ms: Number(result.durationMs ?? 0),
  stdout: (result.stdout ?? "").slice(0, 8000),
  stderr: (result.stderr ?? "").slice(0, 8000),

  job_id: jobId,
  runner_fingerprint: result.fingerprint ?? null,
  failed_step: result.failedStep ?? null,
  failure_kind: result.failureKind ?? null,
  timed_out: Boolean(result.timedOut),
});

console.log("[verify] runner returned", {
  ok: result.ok,
  exitCode: result.exitCode,
  durationMs: result.durationMs,
  error: result.error ?? null,
  stdoutLen: (result.stdout ?? "").length,
  stderrLen: (result.stderr ?? "").length,
});

const verifyPayload = {
  command: verifyCmd,
  ok: Boolean(result.ok),
  exitCode: Number(result.exitCode ?? -1),
  durationMs: Number(result.durationMs ?? 0),
  stdout: String(result.stdout ?? ""),
  stderr: String(result.stderr ?? ""),
  error: result.error ?? null,

  jobId,
  fingerprint: result.fingerprint ?? null,
  failedStep: result.failedStep ?? null,
  failureKind: result.failureKind ?? null,
  timedOut: Boolean(result.timedOut),
};

// Stream structured marker for UI (same pattern as __PROPOSAL__)
const marker = `\n__VERIFY__:${JSON.stringify(verifyPayload)}\n`;

const txt =
  `[Observation]\nVerification executed.\n\n` +
  `[Assessment]\ncommand=${verifyCmd}\nok=${result.ok} exitCode=${result.exitCode} durationMs=${result.durationMs}\n\n` +
  `[Action]\nstdout:\n${(result.stdout ?? "").slice(0, 3000)}\n\n` +
  `stderr:\n${(result.stderr ?? "").slice(0, 3000)}\n` +
  marker;

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[verify] error", { message: e?.message, name: e?.name });

    const txt =
      `[Observation]\nVerification failed.\n\n` +
      `[Assessment]\n${e?.message ?? "Unknown error"}\n\n` +
      `[Action]\nCheck server logs for [verify] and runner logs.\n`;

    return new Response(txt, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}


// 🔒 Runner connectivity test (deterministic, bypass LLM)
if (content.trim() === "__RUNNER_PING__") {
  try {
    console.log("[runner_ping] calling runnerRun", {
      base: (process.env.RUNNER_URL ?? "").trim(),
      secretLen: ((process.env.RUNNER_SECRET ?? "").trim()).length,
      repoId,
    });

    const result = await runnerRun({
      jobId: `ping-${repoId}-${Date.now()}`,
      commandId: "ping",
      timeoutMs: 30_000,
    });

    console.log("[runner_ping] runnerRun returned", {
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      error: result.error ?? null
    });

    const txt =
      `[Observation]\nVerification executed.\n\n` +
      `[Assessment]\n` +
      `command=${verifyCmd}\n` +
      `ok=${result.ok} exitCode=${result.exitCode} durationMs=${result.durationMs}\n` +
      `error=${result.error ?? "null"}\n\n` +
      `[Action]\nstdout:\n${(result.stdout ?? "").slice(0, 3000)}\n\n` +
      `stderr:\n${(result.stderr ?? "").slice(0, 3000)}\n`;

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[runner_ping] error", {
      name: e?.name,
      message: e?.message,
      code: e?.code,
    });
    console.log("[runner_ping] message:", e?.message);
    console.log("[runner_ping] cause:", e?.cause);

    const txt =
      `[Observation]\nRunner ping failed.\n\n` +
      `[Assessment]\n${e?.message ?? "Unknown error"}\n\n` +
      `[Action]\nCheck RUNNER_URL/RUNNER_SECRET and Fly app status.\n`;

    return new Response(txt, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

  // 🔒 Deterministic short-circuit: current year
  if (/what year|current year/i.test(content)) {
    const year = new Date().getFullYear();

    const txt = `[Observation]\nUser requested current year.\n\n[Assessment]\nThis is deterministic from server clock and should not use the LLM.\n\n[Action]\nNot a systems question. It is currently ${year}.`;

    await supabase.from("repo_messages").insert({ repo_id: repoId, user_id: user.id, role: "user", content });
    await supabase.from("repo_messages").insert({ repo_id: repoId, user_id: user.id, role: "assistant", content: txt });

    return new Response(txt, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  // 🔒 APPLY SHORT-CIRCUIT (deterministic apply, bypass LLM)
if (content.startsWith("__APPLY__:")) {
  const raw = content.slice("__APPLY__:".length);

  try {
    const proposal = JSON.parse(raw);
console.log("[apply] keys=", Object.keys(proposal || {}));
console.log("[apply] meta=", proposal?.meta ?? null);
    const expected = confirmPhrase(proposal.fileId, proposal.nextHash);

    await vault_apply_write(supabase, repoId, user.id, expected, { ...proposal, confirm: expected });

    // ✅ Engraving prune happens ONLY after apply succeeds
if (proposal?.meta?.kind === "engraving" && Array.isArray(proposal?.meta?.keepIds)) {
  const keepIds = proposal.meta.keepIds.map((x: any) => String(x)).filter(Boolean);
  
  if (keepIds.length > 0) {
  const supabaseAdmin = createSupabaseAdmin();

  // Count before (admin)
  const { count: beforeCount, error: beforeErr } = await supabaseAdmin
    .from("repo_messages")
    .select("id", { count: "exact", head: true })
    .eq("repo_id", repoId);

  if (beforeErr) console.log("[engraving] count(before) failed:", beforeErr.message);

  // Step 1: fetch ids to delete (admin, avoids RLS weirdness)
  const { data: delRows, error: listErr } = await supabaseAdmin
    .from("repo_messages")
    .select("id")
    .eq("repo_id", repoId)
    .not("id", "in", `(${keepIds.map((id: string) => `"${id}"`).join(",")})`);

  if (listErr) {
    console.log("[engraving] prune list failed:", listErr.message);
  } else {
    const deleteIds = (delRows ?? []).map((r: any) => String(r.id)).filter(Boolean);

    let actualDeleted = 0;

    if (deleteIds.length > 0) {
      const { data: deletedRows, error: delErr } = await supabaseAdmin
        .from("repo_messages")
        .delete()
        .eq("repo_id", repoId)
        .in("id", deleteIds)
        .select("id");

      if (delErr) {
        console.log("[engraving] prune delete failed:", delErr.message);
      } else {
        actualDeleted = deletedRows?.length ?? 0;
        console.log("[engraving] prune deleted rows:", actualDeleted);
      }
    }

    // Count after (admin)
    const { count: afterCount, error: afterErr } = await supabaseAdmin
      .from("repo_messages")
      .select("id", { count: "exact", head: true })
      .eq("repo_id", repoId);

    if (afterErr) console.log("[engraving] count(after) failed:", afterErr.message);

    console.log("[engraving] prune result", {
      repoId,
      keep: keepIds.length,
      candidates: deleteIds.length,
      deleted: actualDeleted,
      before: beforeCount ?? null,
      after: afterCount ?? null,
    });
  }
}
}

const didEngraving = proposal?.meta?.kind === "engraving";

const txt =
  `[Observation]\nWrite applied.\n\n` +
  `[Assessment]\nVersion advanced.\n\n` +
  `[Action]\nFile updated deterministically.\n` +
  (didEngraving ? `\n__RESET__\n` : "");

  console.log("[apply] didEngraving=", didEngraving);
return new Response(txt, {
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});

  } catch (e: any) {
    return new Response(
      `[Observation]\nApply failed.\n\n[Assessment]\n${e?.message ?? "Unknown error"}\n\n[Action]\nRecreate proposal.`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

// 🔒 Engraving probe (deterministic, bypass LLM)
if (content.trim() === "__ENGRAVE__") {
  try {
    console.log("[engrave_probe] hit", { repoId, userId: user.id });

    const engraving = await maybeSummarizeAndEngraveProposal(
      supabase,
      repoId,
      user.id,
      { force: true }
    );

    const markerLine = engraving?.marker
      ? `\n__ENGRAVING__:${JSON.stringify(engraving.marker)}\n`
      : "";

    const txt =
      `[Observation]\nEngraving probe executed.\n\n` +
      `[Assessment]\nmarker=${Boolean(engraving?.marker)}\n\n` +
      `[Action]\nIf marker=true, UI should render the Engraving panel.\n` +
      markerLine;

    return new Response(txt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    console.log("[engrave_probe] error", e?.message);
    return new Response(
      `[Observation]\nEngraving probe failed.\n\n[Assessment]\n${e?.message ?? "Unknown error"}\n\n[Action]\nCheck server logs.\n`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}
// ─────────────────────────────────────────────
// Credits preflight (workspace pool, server-canonical)
// ─────────────────────────────────────────────

// 1) Get workspace_id for this repo
const { data: repoRow, error: repoErr } = await supabase
  .from("repos")
  .select("workspace_id")
  .eq("id", repoId)
  .single();

if (repoErr || !repoRow?.workspace_id) {
  return new Response("Missing workspace", { status: 500 });
}

const workspaceId = repoRow.workspace_id;

// 2) Compute UTC month start as YYYY-MM-01
const now = new Date();
const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  .toISOString()
  .slice(0, 10); // "YYYY-MM-DD"

// 3) Ensure balance row exists + get remaining
const { data: statusRows, error: stErr } = await supabase.rpc("credits_get_status", {
  _workspace_id: workspaceId,
  _period_start: periodStart,
  _grant: tierPolicy.budget.creditsPerPeriod,
  _tier: tierPolicy.tier,
});

if (stErr) {
  console.log("[credits] get_status failed:", stErr.message);
  return new Response("Credits unavailable", { status: 500 });
}

const creditStatus = Array.isArray(statusRows) ? statusRows[0] : statusRows;
const remaining = Number(creditStatus?.remaining ?? 0);

let runtimePolicy = tierPolicy;

// 4) Hard block if exhausted
if (remaining <= 0) {
  return new Response(
    "[Observation]\nCredits exhausted.\n\n[Assessment]\nWorkspace credit balance is depleted for this period.\n\n[Action]\nUpgrade plan or wait for reset.",
    { status: 402, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

// 5) Soft reserve grace mode
if (remaining <= tierPolicy.budget.softReserveCredits) {
  if (tierPolicy.budget.graceMode === "block") {
    return new Response(
      "[Observation]\nCredits below reserve threshold.\n\n[Assessment]\nGrace mode is block.\n\n[Action]\nUpgrade plan or wait for reset.",
      { status: 402, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  if (tierPolicy.budget.graceMode === "clamp") {
    runtimePolicy = {
      ...tierPolicy,
      output: {
        ...tierPolicy.output,
        maxOutputTokens: Math.max(256, Math.floor(tierPolicy.output.maxOutputTokens * 0.5)),
      },
      tools: {
        ...tierPolicy.tools,
        maxToolRounds: Math.max(1, Math.floor(tierPolicy.tools.maxToolRounds / 2)),
        maxToolCallsPerRound: Math.max(1, Math.floor(tierPolicy.tools.maxToolCallsPerRound / 2)),
      },
    };
  }

  // If you want downgrade later, we can add it using TIER_POLICIES.
}

console.log("[credits]", { workspaceId, periodStart, remaining, runtimeTier: runtimePolicy.tier });

  // Sacred memory + profile
  await ensureSacredMemoryFile(supabase, repoId, user.id);
  await ensureUserProfileFile(supabase, repoId, user.id);

  let sacredText = "";
  try {
    const sacred = await vault_read_text(supabase, repoId, SACRED_PATH);
    sacredText = sacred.content || "";
  } catch (e: any) {
    sacredText = "";
    console.log("[sacred] read failed:", e?.message);
  }

  let profileText = "";
  try {
    const profile = await vault_read_text(supabase, repoId, USER_PROFILE_PATH);
    profileText = profile.content || "";
  } catch (e: any) {
    profileText = "";
    console.log("[profile] read failed:", e?.message);
  }

  const insertUserPromise = supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: user.id,
    role: "user",
    content,
  });

  const historyPromise = supabase
    .from("repo_messages")
    .select("role, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(16);

  const [{ data: history }, insertResult] = await Promise.all([historyPromise, insertUserPromise]);
  if (insertResult.error) return new Response("Failed to save message", { status: 500 });

  const orderedHistory = (history ?? []).slice().reverse();
  const cleanedHistory = orderedHistory.filter((m: any) => {
    if (m.role !== "assistant") return true;
    return String(m.content || "").trim().startsWith("[Observation]");
  });

  const sacredBlock = sacredText.trim()
    ? `=== SACRED_MEMORY (authoritative, user-confirmed) ===\n${sacredText.trim()}\n=== END SACRED_MEMORY ===`
    : `=== SACRED_MEMORY ===\n(empty)\n=== END SACRED_MEMORY ===`;

  const profileBlock = profileText.trim()
    ? `=== USER_PROFILE (non-personal preferences + observed level) ===\n${profileText.trim()}\n=== END USER_PROFILE ===`
    : `=== USER_PROFILE ===\n(empty)\n=== END USER_PROFILE ===`;

  const membershipBlock =
    `=== MEMBERSHIP_TIER (hard caps, server-enforced) ===\n` +
    `tier: ${tierPolicy.tier}\n` +
    `model: ${tierPolicy.model}\n` +
    `max_output_tokens: ${tierPolicy.output.maxOutputTokens}\n` +
    `max_tool_rounds: ${tierPolicy.tools.maxToolRounds}\n` +
    `capabilities:\n` +
    `- export: ${tierPolicy.capabilities.allowExport}\n` +
    `- multi_export: ${tierPolicy.capabilities.allowMultiExport}\n` +
    `- create_files: ${tierPolicy.capabilities.allowCreateFiles}\n` +
    `- create_trees: ${tierPolicy.capabilities.allowCreateTrees}\n` +
    `RULE: These caps override USER_PROFILE preferences.\n` +
    `=== END MEMBERSHIP_TIER ===`;

  const input = [
    { role: "system", content: membershipBlock },
    { role: "system", content: sacredBlock },
    { role: "system", content: profileBlock },
    ...cleanedHistory.map((m: any) => ({ role: m.role, content: m.content })),
    { role: "user", content },
  ];

  const encoder = new TextEncoder();
  const RESET_MARKER = "\n__RESET__\n";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastResponseId: string | null = null;
      let fullText = "";
      let firstTokenTime: number | null = null;
      let creditsCharged = false;
      let pendingTools: { call_id: string; name: string; arguments: string }[] = [];
      const toolArgsByCallId = new Map<string, string>();

      try {

      async function streamResponse(respStream: any, mode: "pass1" | "pass2") {
        let pass1StreamedToClient = false;
        let resetSent = false;
        let sawToolsThisPass = false;
        let sentAnyDelta = false;
        let buffer = "";

        for await (const event of respStream) {
          const e: any = event;

          if ((e.type === "response.created" || e.type === "response.in_progress") && e.response?.id) {
            lastResponseId = e.response.id;
          }

          if (e.type === "response.output_item.added" && e.item?.type === "function_call") {
            sawToolsThisPass = true;

            if (mode === "pass1" && pass1StreamedToClient && !resetSent) {
              resetSent = true;
              controller.enqueue(encoder.encode(RESET_MARKER));
              fullText = "";
              buffer = "";
            }

            const callId = e.item.call_id || e.item.id;
            if (callId) {
              toolArgsByCallId.set(callId, e.item.arguments ?? "");
              pendingTools.push({ call_id: callId, name: e.item.name, arguments: e.item.arguments ?? "" });
              console.log("[tool] queued", { name: e.item.name, callId });
            }
            continue;
          }
            // Some streams provide the full arguments when the output item is done.
            if (e.type === "response.output_item.done" && e.item?.type === "function_call") {
              const callId = e.item.call_id || e.item.id;
              if (callId) {
                const finalArgs = (e.item.arguments ?? "").toString();
                if (finalArgs) toolArgsByCallId.set(callId, finalArgs);
              }
              continue;
            }

            if (e.type === "response.output_item.done" && e.item?.type === "message") {
              // Try to extract any text content parts.
              const parts = Array.isArray(e.item.content) ? e.item.content : [];
              for (const p of parts) {
                // Different SDK versions/models can represent text slightly differently.
                const txt =
                  (typeof p?.text === "string" ? p.text : null) ??
                  (typeof p?.output_text === "string" ? p.output_text : null) ??
                  (typeof p?.content === "string" ? p.content : null);

                if (txt) {
                  if (firstTokenTime === null) {
                    firstTokenTime = performance.now();
                    console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
                  }

                  if (mode === "pass1") {
                    buffer += txt;
                    if (!sawToolsThisPass) {
                      pass1StreamedToClient = true;
                      fullText += txt;
                      controller.enqueue(encoder.encode(txt));
                    }
                  } else {
                    fullText += txt;
                    controller.enqueue(encoder.encode(txt));
                  }
                }
              }
              continue;
            }

            // Some streams provide a dedicated "done" event for arguments.
            if (e.type === "response.function_call_arguments.done") {
              const callId = e.call_id || e.item_id;
              if (callId) {
                const finalArgs = (e.arguments ?? "").toString();
                if (finalArgs) toolArgsByCallId.set(callId, finalArgs);
              }
              continue;
            }

          if (e.type === "response.function_call_arguments.delta") {
            const callId = e.call_id || e.item_id;
            if (callId) toolArgsByCallId.set(callId, (toolArgsByCallId.get(callId) ?? "") + (e.delta ?? ""));
            continue;
          }

          if (e.type === "response.output_text.delta") {
            if (firstTokenTime === null) {
              firstTokenTime = performance.now();
              console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
            }

            sentAnyDelta = true;
            const chunk = e.delta ?? "";
            if (!chunk) continue;

            if (mode === "pass1") {
              buffer += chunk;
              if (!sawToolsThisPass) {
                pass1StreamedToClient = true;
                fullText += chunk;
                controller.enqueue(encoder.encode(chunk));
              }
            } else {
              fullText += chunk;
              controller.enqueue(encoder.encode(chunk));
            }
            continue;
          }

          if (e.type === "response.output_text.done") {
            if (sentAnyDelta) continue;
            const txt = e.text ?? "";
            if (!txt) continue;

            if (firstTokenTime === null) {
              firstTokenTime = performance.now();
              console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
            }

            if (mode === "pass1") {
              buffer += txt;
              if (!sawToolsThisPass) {
                pass1StreamedToClient = true;
                fullText += txt;
                controller.enqueue(encoder.encode(txt));
              }
            } else {
              fullText += txt;
              controller.enqueue(encoder.encode(txt));
            }
            continue;
          }

          if (e.type === "response.completed") {
            const finalText = (e.response?.output_text ?? "").toString();

            // If we never saw deltas/done text events, grab the final output_text.
            if (finalText && !fullText.trim()) {
              if (firstTokenTime === null) {
                firstTokenTime = performance.now();
                console.log("TTFT (ms):", Math.round(firstTokenTime - t0));
              }

              if (mode === "pass1") {
                buffer += finalText;
                if (!sawToolsThisPass) {
                  pass1StreamedToClient = true;
                  fullText += finalText;
                  controller.enqueue(encoder.encode(finalText));
                }
              } else {
                fullText += finalText;
                controller.enqueue(encoder.encode(finalText));
              }
            }

            if (!creditsCharged) {
              creditsCharged = true;

              const usage = e.response?.usage ?? null;

              const inputTokens =
                Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0) || 0;

              const outputTokens =
                Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0) || 0;

              // v1 cost model: 1 credit per token (simple + deterministic)
              // If usage is missing, fall back to an estimate based on output size.
              const estimated = inputTokens === 0 && outputTokens === 0;

              const amount = estimated
                ? Math.max(1, Math.ceil(fullText.length / 4))
                : Math.max(1, inputTokens + outputTokens);

              const meta = {
                requestId,
                mode,
                tier: tierPolicy.tier,
                runtimeTier: runtimePolicy.tier,
                model: runtimePolicy.model,
                estimated,
                inputTokens,
                outputTokens,
                responseId: lastResponseId,
              };

              const { data: chargeRows, error: chErr } = await supabase.rpc("credits_charge", {
                _workspace_id: workspaceId,
                _period_start: periodStart,
                _request_id: requestId,
                _amount: amount,
                _repo_id: repoId,
                _meta: meta,
              });

              if (chErr) {
                console.log("[credits] charge failed:", chErr.message);
              } else {
                const charge = Array.isArray(chargeRows) ? chargeRows[0] : chargeRows;
                console.log("[credits] charged", { amount, ok: charge?.ok, duplicated: charge?.duplicated, remaining: charge?.remaining });
              }
            }

            break;
          }
        }

        return { sawToolsThisPass, buffer };
      }
        let resp = await openai.responses.create({
          model: runtimePolicy.model,
          instructions: resolvedInstructions,
          input,
          tools: TOOLS,
          tool_choice: "auto",
          stream: true,
          max_output_tokens: runtimePolicy.output.maxOutputTokens,
        });

        const pass1 = await streamResponse(resp, "pass1");
        const initialHadTools = pendingTools.length > 0 || pass1.sawToolsThisPass;

        if (!initialHadTools) {
          fullText = ensureTriplet(stripDuplicateTriplet(fullText));
        } else {
          fullText = "";
        }
        if (!initialHadTools) {
          fullText = fullText.trim();
          if (!fullText.startsWith("[Observation]")) {
            console.log("[contract] violation: pass1 missing [Observation]");
            fullText =
              "[Observation]\nContract violation detected.\n\n" +
              "[Assessment]\nAssistant output did not start with [Observation].\n\n" +
              "[Action]\nRetry the request or adjust prompt to conform to the output contract.";
          }
        }
        
        console.log("[pass1] hadTools=", initialHadTools, "bufLen=", pass1.buffer?.length ?? 0);

         for (let round = 0; round < runtimePolicy.tools.maxToolRounds; round++) {
          if (pendingTools.length === 0) break;

          let toolsToRun = pendingTools;
          pendingTools = [];

          let truncated = false;

          // 🔒 Enforce per-round tool call cap
          if (toolsToRun.length > runtimePolicy.tools.maxToolCallsPerRound) {
            console.log("[tool] per-round cap exceeded", {
              requested: toolsToRun.length,
              allowed: tierPolicy.tools.maxToolCallsPerRound,
            });

            truncated = true;
            toolsToRun = toolsToRun.slice(0, tierPolicy.tools.maxToolCallsPerRound);
          }

          if (pendingTools.length > 0) {
            console.log("[tool] max rounds reached, terminating deterministically", {
              remaining: pendingTools.length,
              maxRounds: tierPolicy.tools.maxToolRounds,
            });

            const terminationNotice =
              "[Observation]\nTool execution depth limit reached.\n\n" +
              "[Assessment]\nThe current tier does not allow additional tool rounds.\n\n" +
              "[Action]\nRefine the request or upgrade tier for deeper operations.";

            controller.enqueue(encoder.encode(terminationNotice));
            fullText = terminationNotice;
          }
          const toolOutputs: any[] = [];

          for (const tool of toolsToRun) {
            const callId = tool.call_id;
            const toolName = tool.name;
            if (truncated) {

              toolOutputs.push({
                type: "function_call_output",
                call_id: "tier_cap_notice",
                output: JSON.stringify({
                  error: "Tool call limit per round exceeded for this tier.",
                  code: "TIER_TOOL_ROUND_LIMIT",
                  allowed: runtimePolicy.tools.maxToolCallsPerRound,
                }),
              });
            }
      // 1) build argsJson as a *let*
      let argsJson = (toolArgsByCallId.get(callId) ?? tool.arguments ?? "").trim();

      // ✅ If the tool takes no args, empty means "{}"
      if (!argsJson) {
        if (toolName === "vault_list_files") {
          argsJson = "{}";
        } else {
          toolOutputs.push({
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ error: `Empty arguments for ${toolName}` }),
          });
          continue;
        }
      }

      console.log("[tool] args", { toolName, callId, argsJson });

      // 2) parse
      let parsedArgs: any;
      try {
        parsedArgs = JSON.parse(argsJson);
      } catch {
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ error: `Invalid JSON arguments for ${toolName}` }),
        });
        continue;
      }

      
// ─────────────────────────────────────────────────────────────
// Tier clamp: Pro+ can create new files; Free/Builder can only edit existing files.
// Applies to vault_propose_write when path is new.
// ─────────────────────────────────────────────────────────────
if (toolName === "vault_propose_write" && !tierPolicy.capabilities.allowCreateFiles) {
  const path = String(parsedArgs?.path ?? "").trim();

  // If path is missing, let your tool handler deal with validation.
  if (path) {
    try {
      // If it exists, allow overwrite proposal.
      await vault_read_text(supabase, repoId, path);
    } catch (e: any) {
      // If it doesn't exist, block creation.
      const blocked = {
        error:
          "This tier cannot create new files from scratch. Ask to modify an existing file or upgrade to Pro.",
        code: "TIER_CREATE_FILE_BLOCKED",
        path,
      };

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(blocked),
      });
        if (truncated) {
          toolOutputs.push({
            type: "function_call_output",
            call_id: "tier_cap_notice",
            output: JSON.stringify({
              error: "Tool call limit per round exceeded for this tier.",
              code: "TIER_TOOL_ROUND_LIMIT",
              allowed: tierPolicy.tools.maxToolCallsPerRound,
            }),
          });
        }
      continue; // skip actual tool execution for this call
    }
  }
}

// Tier clamp: export gated
if (toolName === "export_chat" && !tierPolicy.capabilities.allowExport) {
  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify({ error: "Export is not available on this tier.", code: "TIER_EXPORT_BLOCKED" }),
  });
  continue;
}

if (toolName === "export_multi" && !tierPolicy.capabilities.allowMultiExport) {
  toolOutputs.push({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify({ error: "Multi-export is not available on this tier.", code: "TIER_MULTI_EXPORT_BLOCKED" }),
  });
  continue;
}

      // 3) run tool
      const out = await runTool(supabase, repoId, user.id, content, toolName, parsedArgs, tierPolicy);

      const hasError = typeof out === "object" && out !== null && "error" in out;

      if (
        (toolName === "vault_propose_write" || toolName === "vault_propose_append") &&
        out &&
        !hasError
      ) {
          controller.enqueue(encoder.encode(`\n__PROPOSAL__:${JSON.stringify(out)}\n`));
        }

            toolOutputs.push({
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(out),
            });
          }

          if (!lastResponseId) throw new Error("Missing response id; cannot send tool output");

          resp = await openai.responses.create({
            model: runtimePolicy.model,
            instructions: resolvedInstructions,
            previous_response_id: lastResponseId as string,
            input: toolOutputs,
            tools: TOOLS,
            tool_choice: "none",
            stream: true,
            max_output_tokens: runtimePolicy.output.maxOutputTokens,
          });

          await streamResponse(resp, "pass2");
        }

        if (!fullText.trim()) {
          const fallback =
            "[Observation]\nTool executed but produced no assistant text.\n\n" +
            "[Assessment]\nThe tool-call stream resolved without output_text deltas.\n\n" +
            "[Action]\nReturn deterministic fallback and close.";
          fullText = fallback;
          controller.enqueue(encoder.encode(fallback));
        }

        // ✅ Normalize + enforce contract at server boundary
        fullText = fullText.trim();

        // If the model violated contract, replace with deterministic flagged triplet.
        // (We do NOT silently accept non-contract output.)
        if (!fullText.startsWith("[Observation]")) {
          console.log("[contract] violation: assistant output missing [Observation]");
          fullText =
            "[Observation]\nContract violation detected.\n\n" +
            "[Assessment]\nAssistant output did not start with [Observation].\n\n" +
            "[Action]\nRetry the request or adjust prompt to conform to the output contract.";
        }

        fullText = ensureTriplet(stripDuplicateTriplet(fullText));

const { error: aInsErr } = await supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: user.id,
    role: "assistant",
    content: fullText,
  });

  if (aInsErr) console.log("[repo_messages] assistant insert failed:", aInsErr.message);

  // 🔥 Engraving marker (best-effort; do NOT kill stream)
  try {
    const engraving = await maybeSummarizeAndEngraveProposal(supabase, repoId, user.id);
    if (engraving?.marker) {
      controller.enqueue(encoder.encode(`\n__ENGRAVING__:${JSON.stringify(engraving.marker)}\n`));
    }
  } catch (e: any) {
    console.log("[engraving] skipped:", e?.message);
  }

} catch (err: any) {
  console.error("LLM error:", err?.message);
  controller.enqueue(encoder.encode("System: LLM unavailable. Check billing/quota."));
} finally {
  console.log("Total request time (ms):", Math.round(performance.now() - t0));
  controller.close();
}
    },   // <-- closes start(controller)
  });    // <-- closes new ReadableStream

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}