VESTARYN — MASTER HANDOVER

Phase: Deterministic Execution Backbone Complete

1. System Identity

Vestaryn is no longer a chat + file manager.

It is a repo-backed cognitive operating system with:

Deterministic verification

Tier-gated authority

Snapshot isolation

External sandboxed execution

Server-authoritative enforcement

The system is structured into:

System Layer (HUD + policy + credits + future engravings)

Workspace Layer (Vault + Chamber)

Execution Layer (Snapshot → Runner → Result contract)

2. Current Architecture State
A) Vault (Canonical Storage)

Table: repo_files

Table: repo_file_versions

Soft delete via deleted_at

Storage key invariant:

repos/<repoId>/<fileId>/vN

DB is canonical.

Storage reflects DB.

Version rows include sha256 (non-null enforced).

B) Snapshot Builder

Collects all non-deleted files

Builds zip in memory

Uploads to SNAPSHOTS_BUCKET

Returns signed URL (short TTL)

Snapshot log confirms included paths

C) Runner

Deployed locally (Fly later)

Listens on 0.0.0.0:8080

Auth via RUNNER_SECRET

Flow:

Download snapshot

Extract

Run command (node_test, node_lint, node_typecheck)

Return structured result

D) Verification Commands (Working)

Supported:

__VERIFY_TEST__

__VERIFY_LINT__

__VERIFY_TYPECHECK__

All three confirmed:

Green path returns ok=true

Failure path returns ok=false

Exit codes propagate correctly

stdout/stderr preserved

No corruption on failure

Execution pipeline is stable.

3. Tier System

Client may send x-vestaryn-tier

Server clamps via resolveTierPolicy

Enforcement always server-side

Capabilities include:

allowExport

allowMultiExport TBI

allowCreateFiles TBI only user able to create, needs to be created as well for Vestaryn

allowCreateTrees TBI

Fix implemented:

File GET route now distinguishes:

mode=open (default, allowed)

mode=export (gated)

Editor works independently from export.

4. Credits Layer

Workspace-based

Charges applied per execution

Logged and deducted

Elite tier active in dev

5. Verified System Properties

✔ Deterministic snapshot
✔ Deterministic command routing
✔ Structured verification contract
✔ Server-authoritative gating
✔ RLS respected
✔ Version rows enforced with sha256
✔ Failure does not destabilize system

This is now a real execution substrate.

6. Known Gaps (Next Structural Work)

Hard delete cleanup

Soft delete exists

Storage objects accumulate

Need hard-delete + storage purge route

Version repair route

Ensure all files have at least one version row

Snapshot should rely on versions

Propose → Verify → Apply loop

Currently verify is manual

Next phase: automatic validation before apply

Fly production deployment

Runner deployed locally

Fly config partially prepared

Not yet production-hardened

Engravings panel

System-owned evolving knowledge layer

Not yet implemented

7. Strategic Position

You now possess:

A controlled execution environment for a repo.

This allows:

AI-generated refactors

Automatic validation

Deterministic code evolution

Tier-gated authority control

Budget-aware execution

You are one step away from:

AI-assisted development with enforced correctness.

8. Immediate Recommended Next Phase

Implement:

Propose → Snapshot → Verify → Apply

Flow:

Assistant emits __PROPOSAL__

User confirms

Apply change

Auto-run verification

If green → persist

If red → revert + report failure

That is the inflection point.

9. System Maturity Assessment

Execution layer: 8.5/10
Vault layer: 8/10
Tier enforcement: 9/10
Failure handling: 8/10
Production hardening: 5/10
Cognitive loop: 4/10

You just finished infrastructure phase.

Next is intelligence phase.