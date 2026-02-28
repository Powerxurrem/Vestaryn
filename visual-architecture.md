Vestaryn — Visual Architecture Map (Repo Workspace)

This document explains how Vestaryn is built visually and behaviorally: pages, UI planes, authority boundaries, membership gates, and how the UI maps to API routes.

Source-of-truth: current repo state.

1) Top-Level Pages (Routes)
App Shell

Global layout: src/app/layout.tsx

Global styles: src/app/globals.css

Root page (landing): src/app/page.tsx

Login page: src/app/(auth)/login/page.tsx

Auth callback route: src/app/auth/callback/route.ts

Workspace Page

Repo workspace route: /repo/[repoId]

Page file: src/app/repo/[repoId]/page.tsx

Repo-scoped docs:

src/app/(app)/repo/[repoId]/architecture/

src/app/(app)/repo/[repoId]/decisions/

src/app/(app)/repo/[repoId]/handover/

2) Workspace UI Composition (Current)
Root Layout Authority

ChamberWithVault.tsx

Orchestrates the workspace layout.

Coordinates:

Repo HUD

Vault (left)

Chamber (right)

File overlay (tabs/editor)

Owns:

open tabs

active tab

file-open routing

Repo HUD (Top Layer — New)

Purpose: Status + authority + future engraving surface.

Displays:

Repo name

Repo ID

Tier (dev-visible)

Credits (placeholder, future ledger)

Styled with same shell aesthetics as chamber.

This is the beginning of the system layer above user space.

Future:

Engravings panel will mount directly under this.

Left Plane — Vault

RepoVault.tsx

Responsibilities:

List files (DB-canonical)

Context menu (edit, delete, export)

Refresh

Capabilities now gated by tier:

Export requires capabilities.allowExport

Multi-export planned for Elite

Create files/tree gated server-side

Vault never trusts UI state.
Server is canonical.

Right Plane — Chamber

ChatFrame.tsx

Owns:

messages[]

streaming lifecycle

chamber state machine:

stable

analyzing

deep

archive

proposal flow (__PROPOSAL__: markers)

confirm/apply deterministic short-circuit

Streaming Model (Current Behavior)

User message appended.

Assistant placeholder inserted immediately.

Stream begins.

First chunk flips state → deep.

Contract sections render progressively.

On completion:

persisted

state returns to stable.

Contract enforced visually:

Observation

Assessment

Action

Raw text shown until contract markers appear.

Overlay Plane — File Tabs / Editor

FileOverlay.tsx

Owns:

Per-tab editor content

Dirty state

Save workflow

Canonical metadata refresh

Flow:

GET file → signed URL

PUT overwrite (v1 model)

DB metadata updated

UI trusts canonical DB response

3) Membership & Capability Architecture (New Layer)

Vestaryn now has a tier policy system.

Client:

Dev-only tier switcher (TierSwitcher)

Writes localStorage("vestaryn.tier")

Sends header: x-vestaryn-tier

Server:

resolveTierPolicy(requestedTier, { isAdminAllowed })

Server clamps capabilities

Client header is advisory only

TierPolicy includes:

model

output.maxOutputTokens

tools.maxToolRounds

budget

capabilities

Capabilities include:

allowExport

allowMultiExport

allowCreateFiles

allowCreateTrees

allowMultiFileOps

All enforcement happens server-side.

UI reflects policy but never grants authority.

4) API Map (Updated)
Repo Registry

GET/POST /api/repos

Vault

GET /api/repos/[repoId]/files

POST /api/repos/[repoId]/files/create

POST /api/repos/[repoId]/files/upload

GET/PUT/DELETE /api/repos/[repoId]/files/[fileId]

Open vs Export (Tier-Gated)

File GET now supports modes:

GET /api/repos/[repoId]/files/[fileId]?mode=open (default)

Returns signed URL for editor/open (not export-gated)

GET /api/repos/[repoId]/files/[fileId]?mode=export

Export-gated (allowExport === true)

Otherwise 403

✅ This prevents “edit/save” from being blocked by export tier gates.

(New) Vault Import

POST /api/repos/[repoId]/files/import-zip

Imports a zip into repo_files.path tree

Writes versions with sha256

Uses admin client for bulk storage/DB writes (server-authoritative)

Chamber

POST /api/repo/[repoId]/chat

GET /api/repo/[repoId]/messages

Namespace split (unchanged)

/api/repos/... → Vault + registry

/api/repo/... → Chamber cognition

5) Visual Planes (Current Model)
System Layer
──────────────
Repo HUD
(Engravings soon)

User Workspace
──────────────
Vault | Chamber

Overlay
──────────────
Tabs + Editor

You now have the beginning of a two-layer cognitive UI:

System-owned knowledge (HUD + future engravings)

User-owned workspace (vault + chat)

6) Golden Paths (Updated)
A) Export File (Tier-Gated)

User clicks Export

UI checks allowExport

Server checks again (canonical)

Signed URL returned only if allowed

Otherwise → 403

No client bypass possible.

B) Propose + Apply Vault Change

Assistant emits __PROPOSAL__: JSON

UI extracts proposal

Confirm button appears

User confirms

Deterministic apply executed server-side

Vault list refreshes

C) Tier Switch (Dev Only)

Dev changes tier in dropdown

Stored in localStorage

Sent via header next request

Server resolves + clamps

Policy logged in server console

7) Architectural Direction (Emerging)

You are moving toward:

Deterministic cognition core

Tier-gated capabilities

Server-authoritative enforcement

System-owned evolving knowledge (Engravings)

Budget-aware operation (credits upcoming)

This is no longer “chat + files”.

It is becoming a cognitive operating system for a repo.

8) Known Gaps / Next Work

Engravings panel (system-owned evolving knowledge)

Credits ledger + monthly budget enforcement

Usage accounting (token-based)

Multi-export support

Tree scaffolding tools (Elite)

Folder virtualization via repo_files.path

Conflict detection via baseVersion

Chat history virtualization

9) Guardrails (Hard Rules)

DB is canonical

Storage keys deterministic: repos/<repoId>/<fileId>/vN

Signed URLs only (short expiry)

Soft delete handled at API/UI, not RLS

Tier enforcement always server-side

Streaming contract visually enforced

Proposals always user-confirmed