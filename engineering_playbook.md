🧠 Vestaryn Engineering Playbook

Version: v1
Date: March 2026
Author: Romano

1. Core Philosophy

Vestaryn is not a chatbot.

Vestaryn is a deterministic AI development environment.

Everything in the system must prioritize:

determinism
safety
observability
iteration
low token cost

Vestaryn should always behave like an engineering system, not a conversational assistant.

The system is built around a strict development loop:

request
↓
observe
↓
assess
↓
propose
↓
verify
↓
approve
↓
apply
↓
iterate

No component should bypass this loop.

2. Golden System Rules

These rules protect Vestaryn from becoming unstable.

Rule 1 — No Direct File Mutation

Vestaryn never edits files directly.

All changes must go through:

proposal
approval
apply

Markers enforce this:

__PROPOSAL__
__PROPOSAL_SET__
__APPLY__
__APPLY_SET__
Rule 2 — Verification Is Mandatory

Every change must eventually pass the verification runner.

Verification pipeline:

npm ci
npm lint
npm typecheck
npm test

Vestaryn should never trust its own edits without verification.

Rule 3 — Repository State Is The Source Of Truth

Vestaryn must always reason from:

vault state

Not from:

chat memory

Vault is the canonical source.

Rule 4 — Deterministic Execution Only

Operations must produce predictable results.

Avoid:

random edits
context guessing
hidden behavior

Prefer:

explicit tools
explicit paths
explicit proposals
3. Architectural Layering

Vestaryn follows strict system layering.

Frontend UI
↓
Chamber (AI reasoning)
↓
Vault (repo abstraction)
↓
Runner (verification sandbox)
↓
Storage + Database

Responsibilities must never bleed across layers.

Example:

UI must not mutate repo state
Vault must not call models
Runner must not modify database
4. File Size Discipline

Large files break AI systems.

Hard limits

Recommended limits:

500 lines → ideal
1000 lines → warning
2000 lines → split required
Absolute maximum
3000 lines

Files exceeding this must be split.

The previous 5000+ line route.ts is a warning example.

5. Orchestration vs Logic Separation

Routes should only orchestrate.

They must not contain heavy logic.

Bad:

route.ts
   5000 lines
   business logic
   parsing
   generation
   validation

Good:

route.ts
   request parsing
   orchestration calls

lib/chamber/*
   real logic
6. Module Structure

Recommended module structure:

lib/
  chamber/
     generation.ts
     proposalFlow.ts
     verify.ts
     chatIntent.ts
     refactorIntent.ts
     extraction.ts

  runner/
     snapshot.ts
     runnerClient.ts

  vault/
     vaultClient.ts
     vaultPaths.ts

Each module should have one responsibility.

7. Tool-First Architecture

Vestaryn should prefer tools over chat reasoning.

Bad flow:

user
↓
model writes explanation
↓
model writes code

Good flow:

user
↓
model selects tool
↓
tool executes deterministic action

Goal:

AI orchestrates tools
tools perform work
8. Proposal Discipline

Proposal generation must obey strict rules.

A proposal must contain:

fileId
content
prevHash
nextHash
confirm phrase
operation type

Operations allowed:

create
overwrite
append

Grouped changes use:

__PROPOSAL_SET__
9. Multi-File Refactor Rules

When modifying multiple files:

Vestaryn must:

generate proposals
preverify the entire set
only then allow apply

Never apply partial refactors.

Example valid flow:

create helper file
rewrite source file
preverify both
apply both
verify repo
10. Verification Philosophy

Verification is Vestaryn’s safety net.

The runner must run in:

isolated sandbox

Verification ensures:

syntax correctness
lint compliance
type safety
tests passing

Vestaryn must never assume correctness.

11. Generation Guardrails

Model output must be validated before staging.

Reject outputs containing:

...
rest unchanged
placeholder comments
truncated files

For large rewrites also verify structural anchors remain.

Example:

export async function POST
const TOOLS
streamResponse

If anchors disappear → reject proposal.

12. Token Economy

Vestaryn is designed to run cheaply.

Guidelines:

Avoid:

large prompts
full repo context
repeated retries

Prefer:

file-specific context
targeted generation
small proposals
13. Repair-Driven Iteration

Vestaryn should fix its own mistakes.

Flow:

proposal
↓
preverify
↓
failure detected
↓
repair proposal
↓
reverify

The user should ideally only see valid proposals.

14. Observability

Every important action should produce logs.

Examples:

proposal created
proposal rejected
verify started
verify finished
runner error

This allows debugging of AI behavior.

15. Early Access Strategy

Vestaryn should launch as:

invite-only

Reasons:

control costs
observe behavior
collect feedback
stabilize system

Suggested tester group:

10–30 developers
16. Development Workflow

Recommended workflow for Vestaryn itself:

implement feature
↓
verify repo
↓
run system locally
↓
test real user prompt
↓
observe behavior
↓
adjust prompts/tools

Vestaryn should always be tested using real prompts, not only unit tests.

17. Safety Boundaries

Vestaryn must never:

delete repo content automatically
execute arbitrary shell commands
write outside repo root
modify system files

The runner must only allow:

whitelisted commands
18. Scaling Vision

Vestaryn’s long-term architecture supports:

multi-repo reasoning
architecture planning
autonomous refactoring
project scaffolding
team-level AI engineering

But the system must grow incrementally and safely.

19. The Vestaryn Principle

Vestaryn’s biggest strength is not generation.

It is structured iteration.

Traditional AI coding:

prompt
↓
code dump

Vestaryn workflow:

idea
↓
proposal
↓
verify
↓
approve
↓
apply
↓
improve

This loop turns AI from a tool into a development partner.

20. Final Engineering Rule

If something feels fragile:

make it deterministic

If something feels expensive:

reduce context

If something feels chaotic:

split the system

Vestaryn succeeds by structure, not clever prompts.