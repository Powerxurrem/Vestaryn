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