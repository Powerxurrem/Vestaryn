Master Handover — Vestaryn (Engraving + Reset + Streaming Markers)
Current Goal

Finalize the engraving workflow so that:

__ENGRAVE__ produces a vault proposal marker (__ENGRAVING__:{...}) that the UI can render like a normal proposal.

Clicking Confirm & Apply sends __APPLY__:{proposal} and applies deterministically (no LLM).

If the applied proposal is an engraving (meta.kind="engraving"), the server prunes old chat messages and returns __RESET__ so the UI reloads canonical history.

What Works (Confirmed)
Server (route.ts)

Deterministic short-circuits:

__VERIFY_*__ runs runner + returns __VERIFY__:{json} marker in the response text.

__ENGRAVE__ hits maybeSummarizeAndEngraveProposal(..., { force:true }) and returns __ENGRAVING__:{marker}.

__APPLY__:{proposal} parses JSON, computes expected confirm phrase (confirmPhrase(fileId,nextHash)), calls vault_apply_write, then:

if proposal.meta.kind === "engraving" and keepIds exists → prune repo_messages to keep only those IDs

return normal text + __RESET__ marker

Logs show correct detection:

[engrave_probe] hit ...

[apply] keys= ...

[apply] meta= { kind:'engraving', keepIds:[...] }

[apply] didEngraving= true

Markers & Proposal

Engraving marker is built as a real vault proposal:

marker.proposal contains fileId/content/prevHash/nextHash/confirm

proposal has meta = { kind:"engraving", keepIds } so APPLY can prune after success.

UI (ChatFrame.tsx) — Current State
Markers parsing (works)

Streaming response is accumulated and split into lines.

It strips:

__PROPOSAL__:{json} → setLastProposal(...) + setPendingConfirm(confirm)

__VERIFY__:{json} → setLastVerify(...)

__ENGRAVING__:{json} → setLastEngraving(...) and also extracts engr.proposal into setLastProposal(...)

Confirm & Apply (works)

Button builds payload from lastProposal and sends:

handleSend(__APPLY__:${JSON.stringify(lastProposal)})

Reset (BUG FOUND + FIX REQUIRED)

The reset marker is returned by server as a standalone line: __RESET__

We discovered a critical ordering bug:

UI was stripping __RESET__ early (replace(/\n__RESET__\n/g,"")) before checking for it.

Result: reset block never triggers.

Fix direction:

Detect reset before stripping it.

On reset:

clear proposal/verify/engraving UI state

reload /api/repo/${repoId}/messages with cache:"no-store"

set messages to canonical reloaded list (post-prune)

Key Decisions / Invariants

Contract output is [Observation]/[Assessment]/[Action] enforced server-side at boundary.

Vault apply is deterministic: __APPLY__ bypasses LLM; confirm phrase computed server-side.

Engraving prune happens only after apply success (meta.kind === "engraving").

Markers are streamed as standalone lines and must be stripped before rendering.

Next Steps (High Leverage)

Fix reset detection in ChatFrame:

Remove early accumulated.includes("__RESET__") stripping block.

Add a single block right after accumulated += chunk:

const hasReset = accumulated.replace(/\r/g,"").includes("\n__RESET__\n");

If true: strip marker, clear UI state, reload messages.

Ensure reset doesn’t keep updating the old streaming placeholder (optional polish):

after reload: streamingAssistantIdRef.current = null; setThinking(false); setState("stable");

(Optional) Make reset marker tolerant of chunk boundaries:

check for __RESET__ line even if it arrives without surrounding newlines.

Known Gotchas / Failure Modes

Server uses __APPLY__: (note colon). UI must send exactly that prefix.

Markers parsing expects:

__PROPOSAL__: / __VERIFY__: / __ENGRAVING__:

reset is just __RESET__ (no colon).

Large proposal content can make UI sluggish; preview should be truncated (already done).

Engraving proposal must carry meta.keepIds or prune won’t happen.