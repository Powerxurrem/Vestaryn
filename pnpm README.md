Vestaryn

Deterministic workspace-based AI cognition system.

Vestaryn combines a structured AI chat layer with a file-backed artifact vault under strict architectural boundaries.

1. System Overview

Vestaryn is composed of three primary layers:

🧠 Cognitive Layer

Structured AI chamber per repository.

Streaming responses via OpenAI Responses API

Deterministic output contract:

[Observation]

[Assessment]

[Action]

Assistant history filtered for contract compliance

Limited context window (performance-controlled)

True streaming via ReadableStream

🗂 Vault Layer

Artifact management for repo-scoped files.

Deterministic storage key format:

repos/<repoId>/<fileId>/vN

Signed URL access (30 min expiry)

DB metadata is canonical

Soft delete via deleted_at

Version table present (v1 active model)

🔐 Storage + Access Boundaries

Postgres RLS controls access only

Soft-delete visibility handled at API level

Storage objects accessed via signed URLs only

No blob proxying

2. Architectural Invariants (Critical)

These rules must not be violated.

RLS Canon

RLS policies control access only.

deleted_at must NOT appear in SELECT RLS policies.

Soft deletes are filtered at API/UI level.

Storage Key Canon

Format is deterministic and security-relevant:

repos/<repoId>/<fileId>/vN

Never construct ad-hoc storage paths.

Metadata Canon

repo_files is source-of-truth for metadata.

UI trusts DB response, not local assumptions.

PUT overwrites blob (v1 model), then DB is updated.

Signed URL Model

30 minute expiry

Generated per request

Never stored client-side

3. Vault File Lifecycle
Create

Insert repo_files row

Upload storage object (v1)

Rollback DB on upload failure

Upload

Upload storage object

Insert repo_files

Insert repo_file_versions

Roll back in reverse order on failure

Edit (PUT)

Overwrite existing storage key (upsert)

Update metadata in DB

Return canonical DB row

Read (GET)

Load DB metadata

Resolve latest version storage_key (if present)

Generate signed URL

Return metadata + signed URL

Delete

Soft delete only (deleted_at)

Storage object is not removed

Visibility filtered by API

4. Cognitive Flow
Message Send

Insert user message

Fetch recent history (limited window)

Filter assistant history to contract-compliant messages

Stream OpenAI response

Persist assistant message after stream completion

Streaming Model

First token transitions UI to “deep”

Placeholder bubble replaced on first chunk

Accumulate deltas

Persist full text after completion

5. UI Planes
Chamber Layout

Left: RepoVault

Right: ChatFrame

Overlay: FileOverlay (tabs)

Tab Authority

ChamberWithVault owns open tabs + active tab

RepoVault emits file metadata

FileOverlay handles fetch + save

6. Current Model Status

Stable:

Streaming

Signed URL model

Soft-delete handling

Deterministic storage key

Metadata canonicalization

Not yet active:

Version bumping on edit

Conflict detection

Autosave

Multi-tab editor layering

Pagination for large chat histories

7. Performance Principles

Limit history window (chat)

Avoid large context windows

No proxying blobs

Fetch signed URLs only when needed

DB index on (repo_id, created_at)

8. Design Philosophy

Vestaryn prioritizes:

Determinism over convenience

Explicit boundaries over hidden behavior

Clear separation of concerns

Structural clarity over feature density

Every new feature must respect:

RLS Canon

Storage Key Canon

Metadata Canon



///// chat handover
🧠 MASTER HANDOVER — VESTARYN (Vault + Tooling Stabilization Phase)
0️⃣ Context

Vestaryn is a deterministic workspace-based AI cognition system.

Architecture:

Cognitive Layer — Structured chamber using OpenAI Responses API

Vault Layer — File-backed artifact system (Supabase Storage + Postgres metadata)

UI Layer — Obsidian-style chamber with overlay editor + streaming cognition

Current state:
Vault tool calls working. Versioned writes implemented. Proposal/apply model functioning.
Remaining instability: chat memory hydration across refresh.

1️⃣ Cognitive Layer (Stable Core)
Streaming

OpenAI Responses API

True streaming via ReadableStream

TTFT + total latency logging

Placeholder bubble replaced on first chunk

Output Contract (Protector)

Assistant MUST return:

[Observation]
...
[Assessment]
...
[Action]
...

Enforced via:

History filter: only assistant messages starting with [Observation] are reused.

Strip duplicate triplets safeguard.

Tooling Layer

Registered tools:

vault_list_files

vault_read_text

vault_propose_write

vault_apply_write

Tool loop:

Single pending tool per pass

Bounded follow-up loop (max 3)

Uses previous_response_id

tool_choice: none after tool execution

Handles streamed argument deltas correctly

Explicit error logging

Apply shortcut:

__APPLY__:{json}

Bypasses LLM

Direct deterministic vault_apply_write

2️⃣ Vault Layer (Operational)
Storage Key Canon
repos/<repoId>/<fileId>/vN

Strict invariant.

Write Model

vault_propose_write → hash + confirmation phrase

vault_apply_write:

optimistic concurrency (prevHash check)

new version upload (no overwrite)

append repo_file_versions

update canonical pointer in repo_files

update version + size_bytes + updated_at

Read Model

Resolve by UUID OR filename

Ignore soft-deleted rows

MIME filter for text-read

MAX_READ_BYTES guard

Download from storage

Empty file returns empty string (not error)

3️⃣ UI Layer
ChamberWithVault

Tabs persisted in localStorage:

vestaryn:vaultTabs:<repoId>

Hydrates on repoId change

Active tab restored

RepoVault

Create

Upload

Export via signed URL

Soft delete

Refresh

ChatFrame

Streams assistant output

Detects __PROPOSAL__: marker

Stores proposal hashes

Confirm & Apply button

Hydrates history via:

GET /api/repo/[repoId]/messages
4️⃣ Current Problem

After full refresh:

Vault files load correctly.

Chat history sometimes appears empty.

/api/repo/[repoId]/messages returns 200.

Supabase RLS active.

No-store headers added.

ChatFrame loader hardened.

Suspected remaining causes:

Supabase auth cookie not present on first load.

supabaseRouteHandler session mismatch.

Race condition: ChatFrame loads before auth context stabilizes.

Edge caching at platform layer.

Inserted messages using different route path (repo vs repos mismatch).

This is now the primary debugging focus.

5️⃣ Architectural Invariants (Do Not Break)

DB is metadata canon.

Storage keys deterministic.

RLS never filters by deleted_at.

Soft-delete handled at API layer.

Tools never fabricate filenames.

Assistant history must be contract-compliant only.

No blob proxying.

No silent tool auto-apply.

Version bump on every mutation.

6️⃣ Performance Principles

Limit history window (16 for LLM, 200 for UI)

No large context windows

Avoid blob proxying

Signed URLs only

Index on (repo_id, created_at)

Stream always, never buffer

7️⃣ Next Focus Options

You can choose direction in the new chat:

🔍 Fix chat memory hydration fully (auth/session deep inspection)

🔒 Add advisory lock to apply_write (concurrency hardening)

🧠 Add vault diff preview before apply

⚙ Activate full version browsing in UI

📜 Add deterministic message pagination

🚀 Optimize TTFT (<1.8s target)
