🧠 Vestaryn – Master Handover (Phase: Pricing + Credits Integrated)
1️⃣ System State Overview

Vestaryn is a workspace-based AI coding system with:

Obsidian Chamber (structured AI interaction contract)

Deterministic Vault (repo_files + repo_file_versions canonical)

Snapshot-based Verify Runner

Workspace-scoped credit accounting

Tier-enforced policy gating

Pricing page generated directly from TIER_POLICIES

All core subsystems are operational.

2️⃣ Auth & Workspace

Auth: Google, GitHub, Magic Link via Supabase

workspace_members determines user → workspace

repos belong to workspace

Credits are workspace-scoped

Current balance source of truth:
workspace_credit_balances (workspace_id, period_start)

3️⃣ Tier Policy Engine

Single source of truth:
lib/membership/tiers.ts

Tiers:

free

builder

pro

elite

admin (internal)

Each tier defines:

model + modelClass

output caps (tokens, verbosity, detail ceiling)

tool limits (rounds, calls)

budget (credits/month, soft reserve, grace mode)

capability flags (export, createFiles, createTrees, architectureMode, etc.)

Pricing page renders directly from this.

No marketing drift possible.

4️⃣ Credits System

Tables in use:

workspace_credit_balances

workspace_credit_charges

workspace_credit_events

Balance endpoint:
/api/credits/balance

Returns:

tier

remaining credits

HUD now shows:

Tier (from DB)

Live credits (from API + event listener)

Grace modes:

clamp

downgrade

System is functional and green.

5️⃣ Vault & Verify

Vault:

Deterministic storage key: repos/<repoId>/<fileId>/vN

repo_files is metadata canonical

sha256 NOT NULL

soft delete via deleted_at

version integer tracked

signed URL model stable

Verify:

Snapshot-based

VERIFY marker extraction

Structured result pipeline

npm wrapper (Windows safe)

ESLint v9 flat config

End-to-end working

Next planned:

Auto-verify after APPLY

File-level status tracking gating

6️⃣ Pricing Page

Route:
/pricing

Features:

Plan cards (Free, Builder, Pro, Elite)

Current plan detection via workspace_credit_balances

Full comparison matrix auto-generated from TIER_POLICIES

Linked from RepoHud → Account → Pricing

No billing integration yet (Stripe not added).

7️⃣ Known Clean State

Build: green

Credits: decrementing

Pricing: rendering

Auth: working

No active 500 errors

Tier enforcement live

8️⃣ Next Direction Options (To Decide Tomorrow)

A. Usage Page

Show credit ledger

Pull from workspace_credit_charges

B. Auto-Verify After APPLY

Runner trigger integration

Status propagation to fileStatusById

C. Tier Upgrade UX

Soft gate messaging

Upgrade nudges inside blocked actions

D. Workspace Tier Persistence Outside Billing Period

Add workspaces.tier column?

Or keep billing table as canonical?

E. Architecture Mode Hard Gate Enforcement

Ensure SYSTEM_PROTECTOR_ARCH fully tier-gated

9️⃣ Open Architectural Questions

Should tier be derived only from billing?

Should admin tier remain invisible in pricing?

Should downgrade grace auto-switch model caps?

10️⃣ Mental Context

Current build phase:
"Feature integration & structural coherence"

Not:

UI polish

Marketing optimization

Billing monetization

Primary goal:
System solidity.