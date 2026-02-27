🧠 MASTER HANDOVER — Vestaryn Runner Integration (Execution Sandbox Phase v1)
Goal

Integrate a remote execution sandbox (“runner”) so Vestaryn can verify code changes (tests/lint/typecheck) deterministically via HTTP, instead of guessing. Runner is deployed on Fly; Vestaryn runs on Vercel/local.

✅ What’s Done
1) Runner Service (Fly)

Runner is an Express service with:

GET /health → { ok: true }

POST /run → executes allowlisted commands in an isolated temp dir

Auth:

Requires header: Authorization: Bearer <RUNNER_SECRET>

Supports:

snapshotUrl (optional): downloads zip, extracts into workDir, then runs command

Captures stdout/stderr and returns them inline (snippets)

Zip extraction uses unzipper (and @types/unzipper installed)

Tested locally with a dummy zip served via python -m http.server:

snapshotUrl worked

npm test printed TEST_OK

Deployed to Fly under stable app name:

Base URL: https://vestaryn-runner.fly.dev

GET /health returns ok:true

2) Vestaryn (Main App) — Runner Client + Ping Route Shortcut

Added src/lib/runner/client.ts with runnerRun():

Reads RUNNER_URL and RUNNER_SECRET from env

Calls ${RUNNER_URL}/run

Throws error on non-200 (includes HTTP status + body)

Added deterministic command in the chat route:

If chat content is __RUNNER_PING__, Vestaryn calls runner with commandId: "ping" and returns a triplet response.

Placement is correct:

After tier policy resolution

Before credits, sacred/profile reads, and LLM stream

3) Dev Productivity

Added a Windows .bat launcher to open two terminals:

Terminal A → Vestaryn main pnpm dev

Terminal B → runner npm start

❌ Current Blocking Issue (Must Fix Next)

__RUNNER_PING__ returns:

Runner HTTP 401 Unauthorized

Meaning:

Vestaryn can reach runner (network OK)

But the Bearer token Vestaryn sends does not match the runner’s RUNNER_SECRET on Fly.

This is NOT a fetch/network issue anymore; it’s strictly auth/secret sync.

🔒 Intended Secret Locations (Only These Matter)

Per environment, there are only two places:

Runner (Fly)

RUNNER_SECRET stored as Fly secret

Runner process reads it at startup

Vestaryn server runtime

Local dev: .env.local in Vestaryn project root

Vercel prod: Vercel env vars for Vestaryn project

No .env.local needed in runner repo unless running runner locally.

✅ Next Steps (Do These in Order)
Step 1 — Make secret mismatch impossible to hide (fingerprint logs)

Add temporary logs (no full secret leaks):

In Vestaryn src/lib/runner/client.ts before fetch:

log:

RUNNER_URL

secretLen

secretHead (first 6)

secretTail (last 6)

In Runner server.ts on boot:

log:

secretLen

secretHead

secretTail

Then compare. They must match.

Step 2 — Rotate secret from single source of truth

Generate new secret S locally:

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Set it:

Fly

flyctl secrets set RUNNER_SECRET=S -a vestaryn-runner

Vestaryn local

.env.local:

RUNNER_URL=https://vestaryn-runner.fly.dev

RUNNER_SECRET=S

Restart pnpm dev (env loads only on boot)

Vercel (Vestaryn project)

Set same:

RUNNER_URL

RUNNER_SECRET

Redeploy

Also add .trim() on both sides:

runner: (process.env.RUNNER_SECRET ?? "").trim()

vestaryn client: (process.env.RUNNER_SECRET ?? "").trim()

Step 3 — Confirm __RUNNER_PING__ returns ok:true

Expected:

[Observation] Runner ping executed

stdout contains pong

After Ping Is Green (Next Feature Work)

Implement “verify loop” with real repo snapshot:

Build repo snapshot zip from Vault (Supabase storage / repo_files)

Upload zip to storage

Create signed URL (10 min)

Call runner with commandId: node_test and snapshotUrl

Return stdout/stderr to user

Later: tier-gate + credit-charge runner usage

Runner Allowlist Commands (Current)

ping (should print pong)

node_test

node_lint

node_typecheck

(Exact mapping exists in runner COMMANDS.)

Known Notes / Past Issues Resolved

Earlier “fetch failed” was due to missing env or wrong secret; now it’s consistently a 401 mismatch.

Fly initially had multiple apps and multiple machines; cleaned up to a single app and single machine.

Fly UI hides secret values after setting; use rotation via CLI to ensure correctness.

Runner local npm run dev with ts-node ESM is annoying; recommended path is build + start. (Optional: use tsx for dev.)