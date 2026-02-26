🧠 MASTER HANDOVER — Vestaryn Canon v3

(Tier-Governed Deterministic Cognition Engine)

1️⃣ Core Invariants (Must Never Break)

Authority

Server is canonical.

Client tier header is advisory only.

All execution limits derive from resolved tierPolicy.

Determinism

Vault writes are 2-step confirm.

Apply is hash-verified and stale-safe.

Idempotent retries must no-op safely.

Tool Discipline

Tools must never fabricate state.

File operations require explicit identifiers.

Tool depth capped by tier policy.

No duplicate PASS1/PASS2 streaming.

Streaming Integrity

Stream must close cleanly.

PASS1 text discarded if tools execute.

Only tool-followup output is streamed when tools run.

Contract Enforcement

Assistant messages must start with [Observation].

Non-contract output is flagged, not silently accepted.

2️⃣ Tier Governance Layer (Server-Resolved)

Flow:

Client → x-vestaryn-tier
Server → resolveTierPolicy(requestedTier, { isAdminAllowed })

const tierPolicy = resolveTierPolicy(requestedTier, { isAdminAllowed });

All runtime behavior derives from:

model

max_output_tokens

maxToolRounds

capabilities

No client authority.
Production clamps admin escalation via env.

3️⃣ Capability Matrix (Concrete Levers)
Tier	Model	Tokens	Tool Rounds	Arch Mode	Export	Multi-file
Free	Mini	Low	Low	❌	❌	❌
Builder	Mini	Medium	Medium	❌	Basic	❌
Pro	Mini	High	Higher	❌	Yes	Yes
Elite	Reasoning Default	Highest	Highest	✅	Multi	Yes

Enterprise tier reserved above Elite.

Capabilities enforced server-side:

allowExport
allowMultiExport
allowCreateFiles
allowCreateTrees
allowArchitectureMode
4️⃣ Architecture Mode Resolver (Server Clamp)

Architecture Mode is:

Intent-detected

Tier-gated

Server-resolved

Applied to both PASS1 + PASS2

const useArchitectureMode =
  allowArchitecture && wantsArchitecture;

Protector selection:

const instructions =
  useArchitectureMode
    ? SYSTEM_PROTECTOR_ARCH
    : SYSTEM_PROTECTOR_DEFAULT;

Client cannot force architecture mode.

5️⃣ Export Enforcement (Dual Layer)

Client:

Button disabled if capability false.

Server:

Tier re-resolved.

403 returned if not allowed.

Server is canonical.

6️⃣ Vault Deterministic Apply Invariant

Apply is valid only if:

currentHash === prevHash

Proposed nextHash matches content hash

Confirm phrase matches exactly

Retry safe if currentHash === nextHash

Collision safety enforced via:

Versioned storage key vN

DB constraints / transactional update

7️⃣ Credit System (Not Yet Enforced)

HUD displays placeholder credits.
Future enforcement must include:

Server-side credit ledger

Token usage accounting

Per-period limits

Hard clamp on exhaustion

Until then:
Tier is policy enforcement, not economic enforcement.

8️⃣ Logging & Observability (Required)

Each request must log:

resolved tier

model

maxOutputTokens

maxToolRounds

mode (default | arch)

This prevents silent policy drift.

9️⃣ System Identity

Vestaryn is:

A tier-governed deterministic cognition engine
with structured output contracts
capability-gated behavior
server-enforced authority
and tool-discipline guarantees.

Not a chatbot.
Not a UI wrapper.
Not a toy.

🔟 Next Enforcement Layer (When Ready)

Server-side credit ledger

Storage quota enforcement

Architecture-mode manual override toggle (Elite only)

Multi-instance atomic safety (DB-level)