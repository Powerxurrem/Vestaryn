Vestaryn — Master Handover (March 2026)
1. Project Overview

Vestaryn is an AI-driven development environment that behaves more like a structured coding partner than a chat assistant.

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
Verify
   ↓
Next suggestions

The system operates on deterministic repository state rather than loose text responses.

Primary goals:

Safe AI-driven file editing

Deterministic repository lifecycle

Human approval loop

Autonomous improvement suggestions

Cheap, scalable token usage

2. System Architecture
Core Components
Chamber

AI reasoning environment.

Handles:

conversation

Observation / Assessment / Action contract

tool orchestration

proposal generation

Vault

Repository file system abstraction.

Features:

deterministic file lifecycle

versioned storage

Supabase storage backend

metadata in database

signed URL editing

Storage format:

repos/<repoId>/<fileId>/vN

Currently:

overwrite v1

Versioning planned later.

Runner / Verify

Runner executes validation commands.

Pipeline:

proposal
   ↓
apply
   ↓
snapshot
   ↓
runner
   ↓
verify markers

Allowed commands:

npm lint
npm typecheck
npm test
npm run build

Verification markers returned:

__VERIFY__

UI displays:

PASS / FAIL
exit code
duration
failure fingerprint
ChatFrame UI

The main interaction interface.

Sections rendered:

Observation
Assessment
Action
Pending Change
Verification
Next Steps (suggested prompts)

ChatFrame parses special markers:

__PROPOSAL__
__PROPOSAL_SET__
__VERIFY__
__SUGGESTED_PROMPTS__

Markers are stripped from visible chat.

3. Recent Major Features Implemented
1. Next Step Suggestion Pills

Vestaryn now emits:

__SUGGESTED_PROMPTS__:[ ... ]

ChatFrame parses this and renders clickable suggestion pills.

UI example:

Next steps
[ Make this page mobile responsive ]
[ Add a footer with an about section ]
[ Explain how the HTML works ]

Clicking a pill automatically sends that prompt.

Result:

continuous improvement loop
2. Multi-file Proposal Sets

Vestaryn can stage:

__PROPOSAL_SET__

Instead of single file proposals.

Apply logic:

__APPLY_SET__

This supports complex changes such as:

create file
modify file
append file

in one approval.

3. Proposal UI Improvements

Pending change block shows:

fileId
confirmation phrase
preview
Confirm & Apply button

Preview displays truncated code diff.

4. Verification UI

Verification panel now appears inside the assistant bubble.

Displays:

PASS / FAIL
command
exit code
duration
failure step
fingerprint

Dismiss button resets verification state.

5. Suggested Prompt Engine

Assistant now ends responses with suggestion markers.

Example output:

__SUGGESTED_PROMPTS__:[
"Make this page mobile responsive",
"Add animations to the button",
"Explain how this layout works"
]

These power the suggestion pills.

4. Credit System

Vestaryn uses a workspace-scoped credit ledger.

Database table:

workspace_credit_balances

Columns:

workspace_id
period_start
tier
credits_granted
credits_spent
credits_reserved
updated_at

Remaining credits computed as:

credits_granted - credits_spent - credits_reserved
Early Access Tier

Runtime tier currently forced:

early_access

Model:

gpt-4.1-mini

Credit allowance planned:

100k / week
≈ 30–50 changes

Cost observed:

250k credits ≈ €0.34

Very cheap due to structured token usage.

Admin Mode

Developer workspace set to:

tier = admin
credits_granted = 99,999,999

Allows unlimited development without worrying about credits.

5. Chat API Pipeline

Chat endpoint:

/api/repo/[repoId]/chat

Pipeline:

request
↓
tier resolution
↓
model execution
↓
stream response
↓
parse tool markers
↓
charge credits
↓
send verification markers

Credits charged through RPC:

credits_charge

Usage metadata recorded:

input_tokens
output_tokens
model
requestId
estimated usage flag
6. Current Model Strategy

Active model:

gpt-4.1-mini

Chosen because:

cheap

consistent reasoning

good for structured editing

ideal for incremental coding loops

Future model escalation:

default → mini
complex tasks → stronger model
architecture mode → premium model

Not implemented yet.

7. Known Behavioral Observations

Vestaryn performs best when prompts include file path or context.

Example:

Bad:

add a footer

Better:

add a footer to my-first-website/index.html

Reason:

Model does not always infer repository targets automatically.

Potential future improvement:

automatic vault file discovery
8. Current Working Features Demonstrated

Vestaryn successfully:

created a website project

edited HTML

added styling

created navigation

added learning sections

generated README

proposed file edits

verified changes

suggested next steps

Example output:

A beginner website with:

navigation
landing card
learning section
styled button
dark theme

All built iteratively through the AI loop.

9. Current UI Layout

Left:

Chamber chat

Right:

Vault explorer
file editor
diff preview

Explorer includes:

Vault files
memory files

Editor shows:

live code
proposal diffs
10. Current Stability

System status:

Vault: stable
Runner: stable
Chat pipeline: stable
Proposal system: stable
Verification: stable
Suggested prompts: working

Remaining issues mostly behavioral rather than architectural.

11. Next Development Priorities
1. Improve file discovery

Vestaryn should automatically understand repo files without needing explicit file paths.

Possible step:

vault_list_files tool
2. Improve suggestion engine

Better categorized suggestions:

Improve
Features
Learn
3. Multi-file reliability

Ensure proposal sets consistently execute.

4. Architecture Mode

Future capability:

Vestaryn can perform larger system design changes.

5. Better prompt guidance

Vestaryn could proactively suggest:

possible next improvements

based on repository state.

12. Key Insight From This Session

Vestaryn’s biggest strength is structured iteration.

Instead of:

prompt → code dump

Vestaryn enables:

idea → change → approve → verify → iterate

This makes it feel like:

AI pair programmer

rather than a code generator.

13. Current Dev Environment

Stack:

Next.js
TypeScript
Supabase
OpenAI API
Fly.io runner
Vercel frontend

Core systems already validated in production.

14. Developer Context

Developer:

Romano

Location:

Netherlands

Goal:

Build Vestaryn into a fully autonomous coding environment capable of creating and evolving complete software systems.