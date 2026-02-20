# Vestaryn — Visual Architecture Map (Repo Workspace)

This document explains how Vestaryn is built **visually**: pages, UI planes, component authority, and how the UI maps to API routes.

Source-of-truth: current repo tree snapshot.

---

## 1) Top-Level Pages (Routes)

### App Shell
- **Global layout:** `src/app/layout.tsx`
- **Global styles:** `src/app/globals.css`
- **Root page (landing):** `src/app/page.tsx`
- **Login page:** `src/app/(auth)/login/page.tsx`
- **Auth callback route:** `src/app/auth/callback/route.ts`

### Workspace Page
- **Repo workspace route:** `/repo/[repoId]`
- **Page file:** `src/app/repo/[repoId]/page.tsx`

Repo-scoped docs live at:
- `src/app/(app)/repo/[repoId]/architecture/`
- `src/app/(app)/repo/[repoId]/decisions/`
- `src/app/(app)/repo/[repoId]/handover/`

> Note: there is also an API namespace under `/api/repo/[repoId]` used for chamber chat and repo notes.

---

## 2) Workspace UI Composition

### Root layout authority (Workspace)
- **`ChamberWithVault`** — `src/components/ChamberWithVault.tsx`
  - Orchestrates the workspace layout: Vault + Chat + Overlay.
  - Owns tab authority and delegates behavior to subcomponents.

### Left plane: Vault (file navigator)
- **`RepoVault`** — `src/components/RepoVault.tsx`
  - Lists repo files, context menu actions, refresh list.
  - Emits “open file” signals upward.

### Right plane: Chamber (chat + streaming)
- **`ChatFrame`** — `src/components/chat/ChatFrame.tsx`
  - Message history + streaming bubble + state machine (stable/analyzing/deep/archive)
- **`ChatInput`** — `src/components/chat/ChatInput.tsx`
  - Input deck; triggers send action only
- **`CoreAnchor`** — `src/components/chat/CoreAnchor.tsx`
  - (Anchor/identity/guardrail support; chamber identity mount)

### Overlay plane: Tabs + editor surface
- **`FileOverlay`** — `src/components/FileOverlay.tsx`
  - Tab strip + editor view
  - Fetches signed URLs + content and performs saves.

---

## 3) UI Planes (Spatial Model)

### Back plane: Memory / History
Component: `ChatFrame.tsx`
- Scrollable message history
- Assistant bubbles include contract sections:
  - Observation / Assessment / Action
- Streaming lifecycle:
  - placeholder bubble appears immediately
  - first chunk flips to “deep”
  - deltas accumulate
  - persist on completion

### Front plane: Input deck
Component: `ChatInput.tsx`
- Always present
- Sends message → handled by ChatFrame

### Left plane: Vault
Component: `RepoVault.tsx`
- Lists files from API
- Soft-delete triggered via API
- Refresh list pulls canonical DB view

### Overlay: File tabs/editor
Component: `FileOverlay.tsx`
- Open files are rendered as tabs
- File content opened via signed URL
- Saves are PUT overwrites (v1 model currently)

---

## 4) Component Authority (State Ownership)

### `ChamberWithVault.tsx`
Owns:
- open tabs list
- active tab
- routing of file-open events
Coordinates:
- RepoVault → open file
- FileOverlay → view/edit/save
- ChatFrame → independent cognition state

### `RepoVault.tsx`
Owns:
- `files[]` list state
- `refresh()` list fetch
- delete/menu UI state

Does NOT own:
- open tabs
- file editor content

### `ChatFrame.tsx`
Owns:
- `messages[]`
- `thinking` boolean
- chamber state machine: `stable | analyzing | deep | archive`
- streaming accumulation

### `FileOverlay.tsx`
Owns:
- per-tab editor content + dirty state
- save action and returned canonical metadata
- signed URL open workflow

---

## 5) API Map (What the UI talks to)

### Repo registry
- `GET/POST /api/repos` → `src/app/api/repos/route.ts`

### Vault: file list + file operations
- `GET /api/repos/[repoId]/files` → `src/app/api/repos/[repoId]/files/route.ts`
- `POST /api/repos/[repoId]/files/create` → `src/app/api/repos/[repoId]/files/create/route.ts`
- `POST /api/repos/[repoId]/files/upload` → `src/app/api/repos/[repoId]/files/upload/route.ts`
- `GET/PUT/DELETE /api/repos/[repoId]/files/[fileId]`
  → `src/app/api/repos/[repoId]/files/[fileId]/route.ts`
- `GET/PUT (?) /api/repos/[repoId]/files/[fileId]/edit`
  → `src/app/api/repos/[repoId]/files/[fileId]/edit/route.ts`

### Chamber: chat + messages
- `POST /api/repo/[repoId]/chat` → `src/app/api/repo/[repoId]/chat/route.ts`
- `GET /api/repo/[repoId]/messages` → `src/app/api/repo/[repoId]/messages/route.ts`

### Debug
- `GET /api/debug/env` → `src/app/api/debug/env/route.ts`

> Note the two namespaces:
> - `/api/repos/...` = Vault + repo registry
> - `/api/repo/...` = Chamber chat + message history
> Keep them intentionally separated.

---

## 6) Visual Glossary (Chamber aesthetics)

### Chamber status seam (top line)
Driven by ChatFrame state machine:
- stable → muted
- analyzing → blue glow
- deep → strong glow
- archive → purple tint

### Assistant contract sections
Rendered inside assistant bubble:
- Observation: neutral accent
- Assessment: blue accent
- Action: emerald accent

Placeholder before first token:
- `[Observation] … [Assessment] … [Action] …`

---

## 7) Golden Paths (User Journeys)

### A) Open a file
1. RepoVault calls `GET /api/repos/[repoId]/files`
2. User selects a file → ChamberWithVault opens a tab
3. FileOverlay fetches content (signed URL from file GET)
4. Editor displays content

### B) Save a file
1. FileOverlay issues PUT overwrite (v1 model) to file endpoint
2. API updates blob then updates DB metadata
3. RepoVault refreshes list (updated_at changes)
4. UI trusts DB canonical response

### C) Chat with Vestaryn
1. ChatFrame appends user message
2. Inserts assistant placeholder bubble
3. Streams `POST /api/repo/[repoId]/chat`
4. First chunk flips to deep + content accumulates
5. Completion → persist + state stable

---

## 8) Known Gaps / Next Work
- Chat history pagination / virtualization
- Version bump activation (v2+)
- Conflict detection via baseVersion
- Folder/tree view from `repo_files.path` (virtual folders)
- Multi-tab editor layering
- Autosave policy

---

## 9) Guardrails (Visual + Data)
- Vault is DB-canonical (`repo_files`)
- Storage keys remain deterministic: `repos/<repoId>/<fileId>/vN`
- Signed URLs only (short expiry)
- Soft delete filtered at API/UI level (never in RLS SELECT)
- Chamber output contract is visually enforced (sections)