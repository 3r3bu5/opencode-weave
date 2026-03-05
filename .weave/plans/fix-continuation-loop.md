# Fix Continuation Loop — Stale Progress Detection & Session Scoping

## TL;DR
> **Summary**: Add stale progress detection and session scoping to `checkContinuation()` to prevent infinite "Continue working" prompts when the LLM fails to make progress (GitHub Issue #16).
> **Estimated Effort**: Short

## Context

### Original Request
GitHub Issue #16: The `checkContinuation()` function in `src/hooks/work-continuation.ts` has no loop breaker. When the LLM fails to make progress on plan tasks, the continuation prompt fires endlessly. There's also no session scoping — continuations fire in unrelated sessions.

### Key Findings

1. **`checkContinuation()`** (`src/hooks/work-continuation.ts:30-62`) takes `{ sessionId, directory }` but **completely ignores `sessionId`**. It reads `WorkState` from disk, checks `state.paused` and `getPlanProgress().isComplete`, then returns a continuation prompt with progress stats. There is no tracking of previous progress between calls — every call with incomplete tasks returns a prompt.

2. **`WorkState`** (`src/features/work-state/types.ts:5-20`) currently has: `active_plan`, `started_at`, `session_ids`, `plan_name`, `agent?`, `start_sha?`, `paused?`. It does **not** track continuation count or last-seen progress. New optional fields can be added safely — `readWorkState()` returns whatever is in `state.json` cast as `WorkState`, and `createWorkState()` won't set them (they'll be `undefined`), so backward compat is fine.

3. **`getPlanProgress()`** (`src/features/work-state/storage.ts:138-156`) returns `{ total, completed, isComplete }` by counting markdown checkboxes. This is the progress metric we'll compare between continuation calls.

4. **`session.idle` handler** (`src/plugin/plugin-interface.ts:231-253`) calls `hooks.workContinuation(sessionId)`, gets a `ContinuationResult`, and injects via `client.session.promptAsync`. No filtering by session happens here — it's purely delegated to the hook.

5. **`createWorkState()`** (`src/features/work-state/storage.ts:82-92`) initializes `session_ids: [sessionId]` when work begins. The `appendSessionId()` function adds sessions later. So `state.session_ids` is the authoritative list of sessions working on a plan.

6. **Existing tests** cover: no state, complete plan, missing plan file, paused state, backward compat for missing `paused` field. None test stale detection or session scoping — both are entirely new behaviors.

## Objectives

### Core Objective
Prevent infinite continuation loops by (1) detecting when the LLM is stuck (no checkbox progress over N consecutive continuations) and auto-pausing, and (2) ensuring continuations only fire in sessions that are actually working on the plan.

### Deliverables
- [x] `WorkState` type extended with stale-tracking fields
- [x] `checkContinuation()` tracks progress and auto-pauses after 3 stale rounds
- [x] `checkContinuation()` filters by session ID
- [x] `createWorkState()` initializes new fields correctly
- [x] Full test coverage for both behaviors

### Definition of Done
- [x] `bun test src/hooks/work-continuation.test.ts` passes with new stale + session tests
- [x] `bun test src/features/work-state/storage.test.ts` passes with new field tests
- [x] `bun test src/plugin/plugin-interface.test.ts` passes (no regressions)
- [x] `bun test` — full suite green

### Guardrails (Must NOT)
- Must NOT break backward compatibility with existing `state.json` files missing new fields
- Must NOT change the `ContinuationResult` interface shape (callers remain unchanged)
- Must NOT modify `plugin-interface.ts` — all logic stays in `checkContinuation()`
- Must NOT change the `session.idle` handler wiring in `create-hooks.ts`

## TODOs

- [x] 1. **Extend `WorkState` with stale-tracking fields**
  **What**: Add two optional fields to the `WorkState` interface:
  - `continuation_completed_snapshot?: number` — the `completed` count from `getPlanProgress()` at the time of the last continuation prompt
  - `stale_continuation_count?: number` — how many consecutive continuations have fired without progress changing
  **Files**: `src/features/work-state/types.ts`
  **Acceptance**: Interface compiles. Fields are optional so existing code continues to work. Existing tests pass unchanged.

- [x] 2. **Update `createWorkState()` — no changes needed (verify)**
  **What**: Confirm that `createWorkState()` does NOT need modification. The new fields are optional and should default to `undefined` when a fresh plan starts. The stale counter is initialized lazily in `checkContinuation()` on first use. Just verify this explicitly.
  **Files**: `src/features/work-state/storage.ts` (read-only verification)
  **Acceptance**: `createWorkState()` produces a `WorkState` without the new fields. TypeScript compiles without error.

- [x] 3. **Add session scoping to `checkContinuation()`**
  **What**: After reading state and checking `paused`, add a guard:
  ```
  if (state.session_ids.length > 0 && !state.session_ids.includes(input.sessionId)) {
    return { continuationPrompt: null }
  }
  ```
  This ensures continuations only fire for sessions recorded in the plan's `session_ids`. The `length > 0` guard handles legacy states with empty arrays gracefully (allow continuation rather than block).
  **Files**: `src/hooks/work-continuation.ts`
  **Acceptance**: Calling `checkContinuation({ sessionId: "unrelated", directory })` with a state whose `session_ids` is `["sess_1"]` returns `{ continuationPrompt: null }`.

- [x] 4. **Add stale progress detection to `checkContinuation()`**
  **What**: After confirming the plan is incomplete, compare `progress.completed` against `state.continuation_completed_snapshot`:
  - If `continuation_completed_snapshot` is `undefined` (first call), set it to `progress.completed`, set `stale_continuation_count` to `0`, write state, and return the continuation prompt normally.
  - If `progress.completed > continuation_completed_snapshot`, progress was made. Reset: set `continuation_completed_snapshot = progress.completed`, `stale_continuation_count = 0`, write state, return continuation prompt.
  - If `progress.completed === continuation_completed_snapshot`, no progress. Increment `stale_continuation_count`. If `stale_continuation_count >= 3`, call `pauseWork(directory)` (or set `state.paused = true` and write) and return `{ continuationPrompt: null }`. Otherwise write state and return continuation prompt.

  The constant `3` should be extracted as `const MAX_STALE_CONTINUATIONS = 3` at module level.

  **Important**: The function currently does NOT call `writeWorkState()` — it's read-only. This change makes it read-write. Import `writeWorkState` (already available from `../features/work-state`).
  **Files**: `src/hooks/work-continuation.ts`
  **Acceptance**: After 3 consecutive calls with no progress change, `checkContinuation` returns `null` and the state file has `paused: true`. After progress is made, the counter resets to 0.

- [x] 5. **Add unit tests for session scoping**
  **What**: Add test cases to `work-continuation.test.ts`:
  - `returns null when session is not in state.session_ids` — create state with `session_ids: ["sess_1"]`, call with `sessionId: "sess_other"`, expect null.
  - `returns continuation when session IS in state.session_ids` — create state with `session_ids: ["sess_1"]`, call with `sessionId: "sess_1"`, expect prompt.
  - `returns continuation when session_ids is empty (legacy compat)` — create state with `session_ids: []`, call with any sessionId, expect prompt (graceful degradation).
  **Files**: `src/hooks/work-continuation.test.ts`
  **Acceptance**: All three new tests pass. Existing tests still pass.

- [x] 6. **Add unit tests for stale progress detection**
  **What**: Add test cases to `work-continuation.test.ts`:
  - `returns continuation prompt on first call (initializes snapshot)` — verify first call returns prompt and writes `continuation_completed_snapshot` and `stale_continuation_count: 0` to state.
  - `resets stale counter when progress is made` — set up snapshot at 1, advance plan to 2 completed, call, verify counter reset to 0 and snapshot updated to 2.
  - `increments stale counter when no progress` — call 1x with no progress, verify `stale_continuation_count: 1`, still returns prompt.
  - `auto-pauses after 3 stale continuations` — call 3x with no progress change, verify 3rd call returns null, state has `paused: true`.
  - `auto-pause sets paused flag and stops continuation` — after auto-pause, subsequent calls return null.
  - `resets stale counter after progress even if previously stale` — get to `stale_continuation_count: 2`, then make progress, verify counter resets to 0.
  **Files**: `src/hooks/work-continuation.test.ts`
  **Acceptance**: All new tests pass. Existing tests still pass (they don't have stale state fields, which default to undefined — first continuation call initializes them).

- [x] 7. **Verify backward compatibility with existing state files**
  **What**: Add a test that creates a `state.json` without the new fields (`continuation_completed_snapshot` and `stale_continuation_count` absent), then calls `checkContinuation()`. Verify it works correctly — treats it as a fresh start (initializes snapshot, returns prompt).
  **Files**: `src/hooks/work-continuation.test.ts`
  **Acceptance**: Test passes, confirming no regression for existing deployments with old `state.json` format.

- [x] 8. **Export `MAX_STALE_CONTINUATIONS` for test access**
  **What**: Export the constant `MAX_STALE_CONTINUATIONS = 3` from `work-continuation.ts` so tests can reference it rather than hardcoding magic numbers. This also allows future configuration.
  **Files**: `src/hooks/work-continuation.ts`
  **Acceptance**: Constant is exported and used in both implementation and tests.

- [x] 9. **Run full test suite and verify no regressions**
  **What**: Run `bun test` to confirm all existing tests (including `storage.test.ts`, `plugin-interface.test.ts`, and any others) still pass. The key regression risks are:
  - `checkContinuation` now writes to `state.json` — existing tests that call it may see modified state files (review each existing test for side effects)
  - `createWorkState()` return type now includes optional fields — existing assertions on state shape should still pass since the fields are omitted from creation
  **Files**: N/A (test execution only)
  **Acceptance**: `bun test` exits with 0. No test failures.

## Verification
- [x] `bun test src/hooks/work-continuation.test.ts` — all continuation tests pass
- [x] `bun test src/features/work-state/storage.test.ts` — all storage tests pass
- [x] `bun test src/plugin/plugin-interface.test.ts` — all plugin interface tests pass
- [x] `bun test` — full suite green, no regressions
- [x] Manual review: `state.json` files without new fields don't break anything
