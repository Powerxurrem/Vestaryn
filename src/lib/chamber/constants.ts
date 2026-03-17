export const SACRED_PATH = "memory/chamber-state.md";
export const SACRED_NAME = "chamber-state.md";
export const SACRED_MIME = "text/markdown";

export const USER_PROFILE_PATH = "memory/user-profile.md";
export const USER_PROFILE_NAME = "user-profile.md";
export const USER_PROFILE_MIME = "text/markdown";

export const SUMMARY_TRIGGER_MSGS = 160;
export const SUMMARY_KEEP_LAST = 40;
export const SUMMARY_TARGET_MSGS = 200;

export const SACRED_TEMPLATE = `# Chamber State (Sacred)

## Identity
- Chamber: Vestaryn
- Mode: Deterministic workspace cognition

## Architectural Invariants
- RLS canon (no deleted_at in SELECT policies)
- DB is metadata source-of-truth
- Storage keys: repos/<repoId>/<fileId>/vN
- Signed URLs only (30m)
- Soft-delete filtered at API/UI level
- Assistant output contract: [Observation]/[Assessment]/[Action]

## Current Focus
- 

## Decisions
- 

## Open Tasks
- 

## Risks / Watchouts
- 

## Active Files
- 
`;

export const USER_PROFILE_TEMPLATE = `# User Profile (Non-personal)

## Explicit (user set)
- skill_self_reported:
- verbosity: Normal   # Minimal | Normal | Deep
- code_delivery: Diff-first   # Diff-first | Full-file | Both
- os: Windows   # Windows | macOS | Linux
- stacks:   # Comma-separated, e.g. React, Next.js, Supabase
- change_tolerance: Surgical   # Surgical | Bounded-refactor

## Calibration Profile
- goal:
- skill_level:   # beginner | intermediate | advanced
- operation_style:   # guide | balanced | direct
- project_readiness:   # ready | partial | not_setup
- change_style:   # minimal | balanced | scaffold
- calibrated_at:

## Observed (Vestaryn hypothesis)
- skill_observed:
- confidence: 0.50
- evidence:
  -
- strengths:
  -
- frictions:
  -
- last_reviewed:

## Milestones
-
`;