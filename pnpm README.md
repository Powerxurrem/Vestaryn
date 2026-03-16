Vestaryn — Master Handover (March 2026)
Project Overview

Vestaryn is an AI-powered autonomous coding chamber combining:

conversational reasoning

deterministic tool execution

repository state awareness

controlled code mutation

automatic verification

The system acts like a hybrid of ChatGPT + VS Code + CI runner.

Core concept:

User request
→ AI reasoning
→ deterministic tool orchestration
→ staged file proposals
→ verify pipeline
→ user approval
→ apply change
Current Architecture
Core Components
1️⃣ Chamber (LLM orchestration)

Location:

app/api/repo/[repoId]/chat/route.ts

Responsibilities:

stream OpenAI responses

execute tool calls

orchestrate deterministic behaviors

stage proposals

run preverify

enforce output contract

Key structure:

ReadableStream
 ├─ pass1 (LLM reasoning)
 ├─ tool execution loop
 ├─ orchestration layers
 ├─ proposal staging
 ├─ preverify
 └─ pass2 (optional LLM completion)
2️⃣ Vault (repository abstraction)

Stores files in Supabase.

Tables:

repo_files
repo_file_versions
repo_changes
repo_messages

Files stored as:

repos/<repoId>/<fileId>/vN

Capabilities:

vault_list_files
vault_read_text
vault_propose_write
vault_propose_create
vault_propose_append

Vault guarantees:

deterministic file references

versioned history

staged proposals

3️⃣ Runner (verification engine)

External service running commands:

lint
typecheck
test

Input:

snapshot zip
overlay proposal files

Output:

verifyPayload

Example result:

{
  ok: false,
  failedStep: "typecheck"
}

Runner integration:

runnerRun()
buildRepoSnapshotSignedUrl()
4️⃣ Preverify System

Before staging proposals:

proposal
→ overlay snapshot
→ run verify
→ optional auto repair
→ return final proposals

Implemented in:

finalizeProposalSet()
Deterministic Orchestration Layers

Vestaryn includes several specialized execution paths:

Generic Rewrite
read file
→ generate rewritten file
→ propose write

Used for:

"edit"
"modify"
"replace"
Create + Modify

Example request:

Create components/Footer.tsx
and use it in app/page.tsx

Flow:

vault_list_files
→ detect missing file
→ generate new file
→ propose create
→ rewrite referencing file
Split File

Example:

Split app/test.js into vault.js and demo.js

Flow:

read source
→ generate multiple files
→ validate split
→ propose create/write
→ preverify
Extract Module

Example:

Extract styles into styles.ts

Flow:

read source
→ generate module
→ rewrite source
→ validate import
Import Refactor

Example:

Replace inline footer with Footer component

Flow:

read source
→ rewrite file
→ propose write
Proposal System

Changes are never applied immediately.

Instead Vestaryn emits:

__PROPOSAL__

or

__PROPOSAL_SET__

Example:

__PROPOSAL__:{ fileId, path, content }

UI then displays staged change.

User must confirm before apply.

Preverify Marker

Before commit the chamber emits:

__PREVERIFY__

Example:

{
  ok: true,
  command: "node_verify",
  exitCode: 0
}
Additional Stream Markers

Vestaryn uses structured stream markers:

__PROPOSAL__
__PROPOSAL_SET__
__PREVERIFY__
__VERIFY__
__ENGRAVING__
__CREDITS__

These are parsed by the frontend.

Credit System

Workspace scoped.

Tables:

workspace_credit_balances
workspace_credit_events
workspace_credit_charges

Charging occurs on:

response.completed

Billing uses token usage if available.

Fallback:

characters / 4
Tier System

Defined in:

lib/membership/tiers.ts

Controls:

models
tool rounds
max output tokens
capabilities

Example capability flags:

allowCreateFiles
allowExport
allowMultiExport
Current UI

Layout:

┌──────────────┬──────────────┐
│ Chat         │ Editor       │
│              │              │
│ Goal cards   │ Tabs         │
│              │ Vault files  │
└──────────────┴──────────────┘

Explorer contains:

Vault file tree
Engraving pane
Current Known Issues
1️⃣ Noop rewrite still triggers pass2

Needs deterministic skip.

2️⃣ Baseline verify detection

Sometimes incorrectly thinks repo broken.

3️⃣ Long route.ts

~4500 lines
should eventually be modularized.

Next Immediate Improvements

(Not required for early access)

Extract orchestration modules
handleSplit()
handleRewrite()
handleCreateModify()
handleExtract()
handleImportRefactor()
Improve baseline verify detection

Fix typecheck detection script.

Add auto-verify after APPLY
proposal → apply → verify
Long Term Vision

Vestaryn becomes:

Autonomous AI development environment

Capabilities planned:

multi-file refactors
dependency installs
test generation
project scaffolding
architecture planning
autonomous repair loops
Current System Status

✔ Streaming stable
✔ Vault deterministic
✔ Proposal system stable
✔ Preverify functional
✔ Runner integrated
✔ Credit accounting active
✔ Tier system active

Vestaryn is now proto-autonomous.

Dev Philosophy

Vestaryn prioritizes:

determinism
traceability
tool-first execution
explicit proposals
verification before apply

LLM reasoning is assistive, not authoritative.

------------------------------------------------------------

Vestaryn operates as a staged AI development environment.

User
  ↓
Chamber (AI reasoning layer)
  ↓
Intent Detection
  ↓
Vault Reads
  ↓
Proposal Generation
  ↓
Proposal Set
  ↓
Pre-Verify
  ↓
User Approval
  ↓
Apply Change
  ↓
Vault Write
  ↓
Repo Snapshot
  ↓
Runner Execution
  ↓
Verify Result
  ↓
Repo File Status Update

This pipeline guarantees:

deterministic code edits

safe execution

recoverable state

traceable history

Vestaryn Repository Structure

Root project structure.

vestaryn
│
├─ engineering_playbook.md
├─ memberships.md
├─ visual-architecture.md
├─ eslint.config.mjs
├─ next.config.ts
├─ middleware.ts
├─ tsconfig.json
├─ postcss.config.mjs
│
├─ sql
│   └─ database definitions / migrations
│
├─ public
│   └─ static assets
│
├─ types
│   └─ shared types
│
└─ src
16.3 Application Layer
src
│
├─ app
│   │
│   ├─ api
│   │   │
│   │   ├─ repos
│   │   │   └─ [repoId]
│   │   │       └─ files
│   │   │           ├─ create
│   │   │           │   └─ route.ts
│   │   │           ├─ upload
│   │   │           │   └─ route.ts
│   │   │           └─ import-zip
│   │   │               └─ route.ts
│   │   │
│   │   └─ repo
│   │       └─ [repoId]
│   │           │
│   │           ├─ memory
│   │           │   ├─ route.ts
│   │           │   └─ bootstrap
│   │           │       └─ route.ts
│   │           │
│   │           ├─ export
│   │           │   └─ route.ts
│   │           │
│   │           └─ changes
│   │               └─ [changeId]
│   │                   ├─ apply
│   │                   │   └─ route.ts
│   │                   ├─ revert
│   │                   │   └─ route.ts
│   │                   └─ verify
│   │                       └─ route.ts
│   │
│   └─ repo
│       └─ [repoId]
│           └─ main repo UI page
│
├─ lib
│ 
│ 
├─ types
│   ├─ goalMarkers.ts
│   ├─ goalPlan.ts
│   └─ goalPlanCard.ts
16.4 Library Layer
src/lib
│
├─ supabase
│   ├─ admin.ts
│   ├─ client.ts
│   └─ middleware.ts
│
├─ vault
│   ├─ buckets.ts
│   ├─ writeVersion.ts
│   └─ vault helpers
│
├─ membership
│   └─ tiers.ts
│
├─ runner
│   ├─ snapshot.ts
│   └─ client.ts
│
└─ other shared helpers
16.5 Frontend Component Architecture

Primary interface layout:

ChamberWithVault
│
├─ RepoHud
│   ├─ tier display
│   ├─ credit usage
│   └─ repo state
│
├─ RepoVault
│   ├─ file explorer
│   ├─ file verification states
│   └─ import/export actions
│
├─ VaultEditorPane
│   ├─ editor
│   ├─ proposal overlays
│   └─ save/apply controls
│
└─ ChatFrame
    ├─ streaming AI responses
    ├─ marker extraction
    ├─ proposal tracking
    ├─ verify state tracking
    └─ chamber maintenance triggers

UI layout resembles a simplified IDE.

Explorer | Editor | Chamber
16.6 Backend API Architecture
File Management
POST /api/repos/[repoId]/files/create
POST /api/repos/[repoId]/files/upload
POST /api/repos/[repoId]/files/import-zip

Handles:

new file creation

file uploads

project imports

Repo Change Execution
POST /api/repo/[repoId]/changes/[changeId]/apply
POST /api/repo/[repoId]/changes/[changeId]/revert
POST /api/repo/[repoId]/changes/[changeId]/verify

Handles:

applying staged changes

reverting changes

running verification

Repo Memory
POST /api/repo/[repoId]/memory/bootstrap
GET  /api/repo/[repoId]/memory

Handles persistent chamber memory.

Repo Export
GET /api/repo/[repoId]/export

Exports conversation history.

16.7 Storage Architecture

Vault files stored in Supabase Storage.

Key format:

repos/<repoId>/<fileId>/vN

Example:

repos/db252773-bced-4d45-8bea-6aec9faa51d9/4f92.../v1

Storage is derived state.

Database remains canonical.

16.8 Database Architecture
Workspace Domain
workspaces
 ├─ workspace_members
 ├─ workspace_credit_balances
 ├─ workspace_credit_charges
 └─ workspace_credit_events

Handles:

team membership

credit accounting

billing state

Repo Domain
repos
 ├─ repo_files
 │   ├─ repo_file_versions
 │   ├─ repo_file_locks
 │   └─ repo_file_status
 │
 ├─ repo_changes
 ├─ repo_runs
 ├─ repo_messages
 ├─ repo_memory_docs
 ├─ repo_chat_state
 └─ repo_chat_summaries

Handles:

code files

change proposals

execution logs

chat history

chamber memory

Global Domain
early_access_users
user_credits
credit_ledger

Handles:

access control

user credit tier

ledger entries

16.9 System Responsibility Map
Frontend UI
  └─ ChamberWithVault
        │
        ├─ ChatFrame
        ├─ RepoVault
        └─ VaultEditorPane
                │
                ↓
API Routes
                │
                ↓
Vault + Repo Changes
                │
                ↓
Database Metadata
                │
                ↓
Storage Files
                │
                ↓
Snapshot Builder
                │
                ↓
Runner Execution
                │
                ↓
Verify Result
                │
                ↓
Repo File Status
Final Architecture Summary

Vestaryn now has a clear layered architecture:

User Interface
    ↓
Chamber AI Layer
    ↓
Proposal / Apply System
    ↓
Vault File System
    ↓
Repo Snapshot Builder
    ↓
Runner Execution
    ↓
Verification
    ↓
Repo Status Updates

Vestaryn Execution Model

Vestaryn operates using a dual-control architecture.

LLM = reasoning engine
Server = execution authority

The LLM can:

read repository
suggest changes
generate file content

The server controls:

repo mutation
proposal validation
apply execution
verification
status updates

----------

