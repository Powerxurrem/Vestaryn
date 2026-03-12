Vestaryn — Master Handover

(Status: Early Access Phase / Phase 1 Complete)

1. Core Concept

Vestaryn is an AI-driven development environment designed to behave like a structured engineering partner, not a chat assistant.

The system focuses on:

deterministic repository state

safe AI-driven edits

human approval loops

automated verification

scalable architecture

Core workflow:

User request
   ↓
Observation
   ↓
Assessment
   ↓
Action (proposal)
   ↓
User approval
   ↓
Apply change
   ↓
Verify (runner)
   ↓
Next suggestions

The AI never directly edits files.
All edits go through the proposal → apply → verify pipeline.

2. System Architecture
Chamber

The reasoning environment.

Responsibilities:

interpret user intent

read repository

generate proposals

orchestrate tools

maintain structured reasoning contract

Output contract:

[Observation]
[Assessment]
[Action]

Markers emitted during execution:

__PROPOSAL__
__PROPOSAL_SET__
__APPLY__
__APPLIED__
__VERIFY__
__ENGRAVING__
__RESET__
__MAINTENANCE__
Vault (Repository System)

Deterministic file system abstraction.

Storage structure:

repos/<repoId>/<fileId>/vN

Database table:

repo_files

File lifecycle:

create
read
propose_write
apply_write
version bump
verify

Important properties:

deterministic storage

version tracking

sha256 hashing

metadata in DB

file content in Supabase storage

signed URLs for editor

Vault tools currently implemented:

vault_read_text
vault_list_files
vault_propose_write
vault_propose_append
vault_apply_write

Path resolution:

resolveFileIdByPathOrName()

Supports both:

fileId
path
filename
3. Proposal System

Vestaryn does not edit files immediately.

Instead it generates proposals.

Single file:

__PROPOSAL__:{json}

Multi-file:

__PROPOSAL_SET__:{json}

Example proposal:

{
  "fileId": "...",
  "content": "...",
  "prevHash": "...",
  "nextHash": "...",
  "confirm": "APPLY <fileId> <hash>"
}

User confirms via:

Confirm & Apply

which sends:

__APPLY__:{proposal}

or

__APPLY_SET__:{proposalSet}
4. Runner / Verify System

Runner executes verification commands.

Current command:

node_verify

Runner pipeline:

snapshot repo
↓
run lint/tests
↓
return result
↓
emit marker

Verify marker:

__VERIFY__:{json}

Verify result fields:

ok
exitCode
durationMs
failureKind
failedStep
stdout
stderr

Verify results update UI file status:

ok
error
pending
5. ChatFrame (Frontend Chamber)

Handles streaming assistant responses.

Key responsibilities:

Marker parsing

Parses:

__PROPOSAL__
__PROPOSAL_SET__
__APPLY__
__APPLIED__
__VERIFY__
__ENGRAVING__
__CREDITS__
__MAINTENANCE__

Markers are removed from visible chat.

Proposal handling

Stores:

lastProposal
lastProposalSet
proposalSet

Used to show:

Pending change
Confirm phrase
Preview
Apply flow
Confirm & Apply
   ↓
handleSend("__APPLY__")
   ↓
applyOriginMsgIdRef
   ↓
runVerify()
Verify flow
runVerify()
↓
/api/repo/[repoId]/verify
↓
__VERIFY__ marker
↓
UI status update
6. Multi-File Execution

Vestaryn can now handle:

multiple proposals
multiple file edits
proposal sets

Example operations tested successfully:

fix multiple scripts
split file into modules
refactor code
add features

Edge cases encountered:

file already exists
path resolution mismatch
create vs write

Handled via:

vault_propose_write fallback logic
7. Credit System

Workspace scoped credits.

Tables:

workspace_credit_balances
workspace_credit_events
workspace_credit_charges

HUD endpoint:

/api/credits/balance

Current tier:

early_access

Credits configured:

1,000,000
8. Current Capabilities (Validated)

Vestaryn can:

✓ read repository
✓ modify multiple files
✓ propose edits safely
✓ apply confirmed edits
✓ run verification pipeline
✓ detect lint failures
✓ fix broken scripts
✓ perform small refactors
✓ split files
✓ suggest improvements

Recent tests performed:

fix broken scripts
split module
refactor tracker system
vault management example
multi-file edits
9. Known Issues / Bugs
1. Maintenance system

Auto summarization currently failing.

Errors:

Failed to parse URL from undefined/api/.../maintenance/resummarize
permission denied for repo_chat_summaries

Needs:

service role
or RLS adjustment
2. Multi-file preview UI

Preview for newly created files not always showing.

Likely due to:

proposalSet preview mapping
3. Split file logic

Split detection recently added.

Helpers implemented:

isSplitFileIntent()
extractSplitTargets()
generateSplitFileContents()

Needs further real-world testing.

10. Architectural Strengths

Vestaryn already includes 4 of the 5 core AI engineering patterns:

Repository state      ✓ Vault
Tool interface        ✓ Vault tools
Execution environment ✓ Runner
Verification loop     ✓ Verify
Iteration loop        partial
Planning layer        future

This architecture is closer to AI engineering systems than typical AI coding assistants.

11. Next Development Priorities

Recommended next phases:

Phase 2 — Iteration Engine

Enable automatic repair loops.

edit
↓
verify
↓
failure
↓
AI reads error
↓
propose repair
Phase 3 — Task Planning

Introduce structured plan generation.

Example:

Task
↓
AI generates plan
↓
step execution
Phase 4 — Repository Intelligence

Add repository graph awareness.

imports
dependencies
entrypoints
tests
Phase 5 — Task Memory

Persistent tasks across sessions.

task
progress
state
completion
12. Current Development Status

Vestaryn is currently at:

Phase 1: Engineering foundation

Major systems completed:

Vault
Chamber
Runner
Proposal system
Verify system
UI integration
Credits system

System is functionally operational.

13. Immediate Next Work Session

Next development focus recommended:

1️⃣ improve multi-file proposal reliability
2️⃣ strengthen split-file system
3️⃣ implement first iteration loop
4️⃣ fix maintenance summarization system

14. Long-Term Vision

Vestaryn aims to evolve from:

AI code assistant

to:

AI engineering system

Where AI can:

plan tasks
execute code changes
run verification
iterate until success
Final Note

Vestaryn already has a solid architectural base.

Key foundations are in place:

deterministic repo state
safe editing pipeline
execution environment
verification loop

Future work will focus on intelligence layers, not infrastructure.