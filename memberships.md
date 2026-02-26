Tier Matrix (MVP + Future-Proof)
🟢 Free

Credits: 7,500 / month (range: 5k–10k)
Models: mini only
Compute: no reasoning
Tools: vault allowed, single-file ops only
Export: none
Storage cap (recommended):

25 files

5 MB total

max file size: 256 KB

Overage behavior: hard block

🔵 Builder

Credits: 100,000 / month
Models: mini only
Compute: no reasoning
Tools: limited multi-file proposals (optional cap: 2–3 files)
Export: basic export allowed
Storage cap (recommended):

250 files

250 MB total

max file size: 2 MB

Overage behavior: grace downgrade or block (config)

🟣 Pro

Credits: 500,000 / month
Models: mini default
Compute: reasoning allowed (credit multiplier)
Tools: multi-file proposals enabled
Export: full export
Storage cap (recommended):

2,000 files

2 GB total

max file size: 10 MB

Overage behavior: grace downgrade (disable reasoning + clamp tools)

🔴 Elite

Credits: 2,000,000 / month
Models: reasoning default (or premium default)
Compute: architecture-tier operation
Tools: multi-file ops + higher tool rounds
Export: multi-export enabled
Scaffolding: folder/tree creation allowed
Storage cap (recommended):

10,000 files

20 GB total

max file size: 50 MB

Overage behavior: grace downgrade (switch to mini-only) + optional credit packs

🏢 Enterprise (future; after Elite)

Credits: pooled + negotiated
Billing: annual / invoice
Credits scope: org pool + per-workspace caps
Storage: pooled (e.g., 1–10 TB)
Controls:

workspace quotas

team seats

audit logs

retention policies

private model routing (future)

Overage behavior: paid credit packs / overage billing


Capability Matrix (Mapped to TierPolicy)

These flags are server-enforced and override client UI state.

capabilities: {
  allowVault: boolean,
  allowExport: boolean,
  allowMultiExport: boolean,
  allowCreateFiles: boolean,
  allowCreateTrees: boolean,
  allowMultiFileOps: boolean,
  allowReasoning: boolean,
  allowArchitectureMode: boolean,
  allowUserProfileEdits: boolean,
}
🟢 Free
allowVault: true,
allowExport: false,
allowMultiExport: false,
allowCreateFiles: false,
allowCreateTrees: false,
allowMultiFileOps: false,
allowReasoning: false,
allowArchitectureMode: false,
allowUserProfileEdits: false,

Behavior:

Single-file edits only

No file creation from scratch

No reasoning multiplier

No exports

Minimal cognition surface

🔵 Builder
allowVault: true,
allowExport: true,
allowMultiExport: false,
allowCreateFiles: false,
allowCreateTrees: false,
allowMultiFileOps: false,
allowReasoning: false,
allowArchitectureMode: false,
allowUserProfileEdits: true,

Behavior:

Basic export allowed

No reasoning

No tree scaffolding

No large multi-file operations

User profile editable

🟣 Pro
allowVault: true,
allowExport: true,
allowMultiExport: false,
allowCreateFiles: true,
allowCreateTrees: false,
allowMultiFileOps: true,
allowReasoning: true,
allowArchitectureMode: false,
allowUserProfileEdits: true,

Behavior:

Reasoning allowed (credit multiplier)

Multi-file proposals enabled

File creation from scratch enabled

Still no full architecture scaffolding

Multi-export still restricted

🔴 Elite
allowVault: true,
allowExport: true,
allowMultiExport: true,
allowCreateFiles: true,
allowCreateTrees: true,
allowMultiFileOps: true,
allowReasoning: true,
allowArchitectureMode: true,
allowUserProfileEdits: true,

Behavior:

Architecture-tier prompts unlocked

Folder scaffolding allowed

Multi-export enabled

Highest tool round limits

Full cognition surface

🏢 Enterprise (Future)
allowVault: true,
allowExport: true,
allowMultiExport: true,
allowCreateFiles: true,
allowCreateTrees: true,
allowMultiFileOps: true,
allowReasoning: true,
allowArchitectureMode: true,
allowUserProfileEdits: true,
allowOrgPooling: true,
allowWorkspaceQuotas: true,
allowAuditLogs: true,
allowPrivateModelRouting: true,

Behavior:

Org-wide credit pooling

Workspace caps

Audit logging

Advanced governance

Model routing controls