🧠 MASTER HANDOVER — VESTARYN (Chat Route + Vault Confirm + Streaming Fixes)
0) Context

We stabilized the /api/repo/[repoId]/chat route around:

deterministic Vault writes (proposal → explicit apply)

streaming Responses API with tool follow-ups

contract-safe assistant persistence ([Observation]/[Assessment]/[Action])

summary/prune as a fire-and-forget DB-only task (no stream blocking)

Goal: tools + streaming must never hang or duplicate output, and Vault apply must be deterministic + stale-safe.

1) Current Status (Working)

✅ Vault apply flow working end-to-end

vault_propose_write / vault_propose_append return { prevHash, nextHash, confirm, content }

UI sends __APPLY__:{...} JSON payload (not raw APPLY ...)

Server short-circuits on __APPLY__: and calls vault_apply_write() directly

vault_apply_write checks:

confirm phrase exact match

userMessage matches expected confirm

idempotent retry: if currentHash === nextHash => no-op success

stale protection: currentHash must equal prevHash

content hash must match nextHash

Uploads new storage version repos/<repoId>/<fileId>/vN collision-safe

Updates canonical repo_files pointer + best-effort repo_file_versions insert with actor: "user" / created_by

✅ Streaming PASS1 buffering fixed

PASS1 text is buffered and only flushed if no tool calls

If tools are used, PASS1 buffer is discarded and only tool follow-ups are streamed (PASS2)

✅ Summary/prune fixed to not break stream

maybeSummarizeAndPrune(...) runs fire-and-forget

No enqueue after close, no timeouts required

✅ Contract renderer behavior

UI hides non-contract assistant messages unless they start with [Observation]

We now detect/display non-contract output as “Assistant produced a non-contract response” (UI improvement already applied)

2) Recent Bug Fixes (Important)

Fixed Postgres UUID query mistake (repo_id = '...' invalid uuid) — confirmed rowcount works.

Fixed “Bad confirm phrase” and “Stale proposal” issues by:

forcing confirmPhrase(fileId, nextHash) to be the single source of truth

passing correct “userMessage” into vault_apply_write on both tool-path + short-circuit path

Fixed build error caused by extra );) in summary block

3) Current Known Issue / Next Focus

🔶 Chat response not visible immediately, but response exists

Network tab shows response payload arrives correctly.

DB messages endpoint increments message count (e.g. 68 → 70), so persistence works.

Likely UI issue: stream consumption / state update / rendering pipeline not appending streamed text to visible transcript reliably (especially on refresh / hydration).

Next task: front-end streaming consumer (where ReadableStream is read and appended to UI state).

Ensure stream chunks update the displayed assistant message in realtime

Ensure final full message persists and is rendered from /messages reload

Confirm contract filtering doesn’t hide legit content

4) Key Files / Areas

app/api/repo/[repoId]/chat/route.ts

PASS1 buffer + tool-follow-up loop + persistence

__APPLY__: deterministic shortcut

summary/prune fire-and-forget

app/api/repo/[repoId]/messages/route.ts

returns { messages } up to 300, no-store headers

UI chat page + stream reader (NEXT TARGET)

5) Current Design Constraints (Keep)

Stream must always close cleanly, never hang UI

Tool calls must not leak duplicate PASS1 text

Vault writes must be 2-step confirm, hash safe

Only persist contract-compliant assistant messages (or explicitly mark as non-contract)