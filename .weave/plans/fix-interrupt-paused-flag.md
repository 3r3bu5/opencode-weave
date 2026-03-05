# Fix Interrupt/Cancel Bug: Replace `pendingInterrupt` with `paused` Flag on WorkState

## TL;DR
> **Summary**: Replace the in-memory `pendingInterrupt` boolean in `plugin-interface.ts` with a persistent `paused` field on `WorkState` (stored in `.weave/state.json`), eliminating the race condition and consumed-after-one-idle bugs.
> **Estimated Effort**: Short

## Context
### Original Request
When a user interrupts Tapestry or Loom (Ctrl+C / Escape), the work-continuation hook should stop auto-resuming. The current implementation (commit c16e89a) uses an in-memory `pendingInterrupt` boolean that has two bugs:
1. **Race condition**: `session.idle` can arrive before `tui.command.execute`, so the flag isn't set in time.
2. **Flag consumed after one idle**: The boolean is consumed on the first `session.idle`, so subsequent idles resume continuation despite the interrupt.

### Key Findings
- **`plugin-interface.ts`** (line 29): `let pendingInterrupt = false` — in-memory flag, consumed in the `session.idle` handler (lines 198-199). Set in `tui.command.execute` handler (line 190).
- **`createPluginInterface`** does NOT receive `directory` — it receives `{ pluginConfig, hooks, tools, configHandler, agents, client }`. The `directory` is available in `src/index.ts` (line 15, `ctx.directory`) but is not passed through to `createPluginInterface`. It must be added as a new parameter.
- **`createHooks`** receives `directory` (line 20) and closes over it in the `workContinuation` and `startWork` lambdas — so hooks already have access to directory.
- **`WorkState` type** (`types.ts`): has `active_plan`, `started_at`, `session_ids`, `plan_name`, optional `agent`, optional `start_sha`. No `paused` field yet.
- **`storage.ts`**: provides `readWorkState`, `writeWorkState`, `clearWorkState`, `appendSessionId`, `createWorkState`. All take `directory` as first param.
- **`checkContinuation`** (`work-continuation.ts`): reads work state, checks plan progress, returns continuation prompt. Does not check any paused flag.
- **`handleStartWork`** (`start-work-hook.ts`): when resuming existing state (line 54-78), calls `appendSessionId` but does NOT clear any paused flag. When creating fresh state via `createWorkState`, the factory does not set `paused`.
- **`index.ts`** barrel (`features/work-state/index.ts`): re-exports from `storage.ts` and `types.ts`.
- **Test patterns**: `plugin-interface.test.ts` uses a `makeHooks()` factory with nullable hook overrides. Three interrupt tests at lines 456-569 test the current `pendingInterrupt` behavior. `storage.test.ts` uses temp dirs with beforeEach/afterEach cleanup. `work-continuation.test.ts` also uses temp dirs.

## Objectives
### Core Objective
Make interrupt suppression reliable by persisting the `paused` state to the filesystem instead of relying on an in-memory flag.

### Deliverables
- [x] Add `paused?: boolean` to `WorkState` type
- [x] Add `pauseWork(directory)` and `resumeWork(directory)` helpers to `storage.ts`
- [x] Export new helpers from `index.ts`
- [x] Update `checkContinuation` to respect `paused` flag
- [x] Pass `directory` into `createPluginInterface` and update interrupt handler to call `pauseWork`
- [x] Remove `pendingInterrupt` boolean and its usage from `plugin-interface.ts`
- [x] Clear `paused` flag on `/start-work` resume
- [x] Update all affected tests

### Definition of Done
- [x] `bun test` passes with zero failures
- [x] Interrupt sets `paused: true` in `.weave/state.json`
- [x] `checkContinuation` returns `null` when `paused` is `true`
- [x] `/start-work` resume clears `paused` to `false`
- [x] Subsequent `session.idle` events after interrupt do NOT resume continuation (no more one-shot consumption)
- [x] No in-memory `pendingInterrupt` flag remains in codebase

### Guardrails (Must NOT)
- Must NOT break backward compatibility — existing `state.json` files without `paused` field are treated as `paused: false`
- Must NOT change the `createWorkState` factory to include `paused` — new states should omit it (defaults to not paused)
- Must NOT add `paused` to `/clear-work` or `clearWorkState` — clearing state deletes the file entirely

## TODOs

- [x] 1. **Add `paused` field to `WorkState` type**
  **What**: Add `paused?: boolean` as an optional field to the `WorkState` interface.
  **Files**: `src/features/work-state/types.ts`
  **Acceptance**: TypeScript compiles. Existing code that creates/reads `WorkState` without `paused` still works.

- [x] 2. **Add `pauseWork` and `resumeWork` helpers to storage**
  **What**: Create two new functions in `storage.ts`:
  - `pauseWork(directory: string): boolean` — reads state, sets `paused: true`, writes back. Returns `false` if no state exists.
  - `resumeWork(directory: string): boolean` — reads state, sets `paused: false`, writes back. Returns `false` if no state exists.
  Both functions are atomic read-modify-write operations using the existing `readWorkState`/`writeWorkState` helpers.
  **Files**: `src/features/work-state/storage.ts`
  **Acceptance**: Functions exist, compile, and follow the same pattern as `appendSessionId`.

- [x] 3. **Export new helpers from barrel**
  **What**: Add `pauseWork` and `resumeWork` to the exports in `index.ts`.
  **Files**: `src/features/work-state/index.ts`
  **Acceptance**: `import { pauseWork, resumeWork } from "../features/work-state"` resolves correctly.

- [x] 4. **Update `checkContinuation` to check `paused` flag**
  **What**: After reading the work state (line 25-28 of `work-continuation.ts`), add a check: if `state.paused` is `true`, return `{ continuationPrompt: null }`. This check should come after the `!state` null check but before the progress check.
  **Files**: `src/hooks/work-continuation.ts`
  **Acceptance**: When `state.paused === true`, `checkContinuation` returns `{ continuationPrompt: null }` regardless of plan progress.

- [x] 5. **Pass `directory` into `createPluginInterface` and update interrupt handler**
  **What**: 
  1. Add `directory: string` to the `createPluginInterface` args type (line 16-23 of `plugin-interface.ts`).
  2. Destructure `directory` from `args` (line 24).
  3. Remove `let pendingInterrupt = false` (line 29) and the comments above it (lines 26-28).
  4. In the `tui.command.execute` handler (lines 187-193): replace `pendingInterrupt = true` with a call to `pauseWork(directory)`. Import `pauseWork` from `../features/work-state`.
  5. In the `session.idle` handler (lines 196-224): remove the `if (pendingInterrupt)` block (lines 198-200). The `checkContinuation` hook (called via `hooks.workContinuation`) already handles it now because it checks `state.paused`.
  6. Update `src/index.ts` to pass `directory: ctx.directory` to `createPluginInterface`.
  **Files**: `src/plugin/plugin-interface.ts`, `src/index.ts`
  **Acceptance**: `pendingInterrupt` no longer exists in the codebase. Interrupt event calls `pauseWork`. `session.idle` delegates entirely to `hooks.workContinuation` without pre-filtering.

- [x] 6. **Clear `paused` flag on `/start-work` resume**
  **What**: In `handleStartWork` (`start-work-hook.ts`), when resuming existing work state (the `if (existingState)` block, lines 54-78), call `resumeWork(directory)` after `appendSessionId(directory, sessionId)` (line 66). This ensures that when the user explicitly runs `/start-work`, any previous interrupt-pause is cleared. Also do this in `handleExplicitPlan` (line 138-139, after `writeWorkState`) and in `handlePlanDiscovery` single-plan case (line 193-194, after `writeWorkState`). For newly created states, `paused` is already `undefined`/absent so no action needed — but call `resumeWork` after `writeWorkState` anyway for explicitness and to handle edge cases where a previous state's paused flag lingers. Actually, since `createWorkState` creates a fresh object without `paused`, and `writeWorkState` overwrites the entire file, this is already handled for explicit plan and discovery cases. Only the resume case (line 54-78) needs `resumeWork` because it reads the existing state and doesn't overwrite it.
  Import `resumeWork` from `"../features/work-state"`.
  **Files**: `src/hooks/start-work-hook.ts`
  **Acceptance**: After `/start-work` resumes an existing plan, `state.json` has `paused: false` (or `paused` absent).

- [x] 7. **Add tests for `pauseWork` and `resumeWork` in `storage.test.ts`**
  **What**: Add a new `describe("pauseWork")` and `describe("resumeWork")` block:
  - `pauseWork` returns `false` when no state exists
  - `pauseWork` sets `paused: true` on existing state
  - `pauseWork` preserves other state fields
  - `resumeWork` returns `false` when no state exists
  - `resumeWork` sets `paused: false` on existing state
  - `resumeWork` clears paused even when it was already `false`
  **Files**: `src/features/work-state/storage.test.ts`
  **Acceptance**: All new tests pass.

- [x] 8. **Add `paused` state test to `work-continuation.test.ts`**
  **What**: Add a test case: "returns null when work state has paused: true". Create a plan with incomplete tasks, write work state, then manually set `paused: true` on the state (via `readWorkState` → mutate → `writeWorkState`), and verify `checkContinuation` returns `{ continuationPrompt: null }`.
  **Files**: `src/hooks/work-continuation.test.ts`
  **Acceptance**: Test passes. Continuation is suppressed when paused.

- [x] 9. **Update interrupt tests in `plugin-interface.test.ts`**
  **What**: The three interrupt tests (lines 456-569) must be rewritten to work with the filesystem-based `paused` flag instead of the in-memory boolean:
  
  **Test 1** ("suppresses work continuation after user interrupt", lines 456-491):
  - The `workContinuation` mock must use a real temp directory with a plan and work state, since `pauseWork` will try to read/write `.weave/state.json`.
  - Alternative: mock `pauseWork` by making `workContinuation` check `readWorkState(dir).paused`. Since `workContinuation` is already a hook mock, the simplest approach is: (a) set up a temp dir with state, (b) pass `directory` to `createPluginInterface`, (c) let `tui.command.execute` call `pauseWork(dir)`, (d) have `workContinuation` check `readWorkState(dir).paused` (or just check that the state file has `paused: true`).
  - But actually, the plugin's `session.idle` handler no longer checks `pendingInterrupt` — it just calls `hooks.workContinuation(sessionId)`. So the mock `workContinuation` always returns a prompt, and the test should verify that `pauseWork` was called (state file has `paused: true`). The actual suppression now happens inside `checkContinuation` (tested in `work-continuation.test.ts`). So the test focus shifts: verify that `tui.command.execute` with `session.interrupt` causes `state.json` to have `paused: true`.
  
  **Test 2** ("resumes work continuation after interrupt flag is consumed", lines 493-532):
  - This test's premise changes completely. With the `paused` flag, interrupts are NOT consumed after one idle. The paused state persists until `/start-work` is called. So this test should be **replaced** with a test that verifies: after interrupt, ALL subsequent idle events are suppressed (continuationPrompt is null), not just the first one. To test this properly, use a real `workContinuation` that calls `checkContinuation` with the temp dir, or mock it to read the paused flag.
  - Simplest: create a test where `workContinuation` is wired to `checkContinuation` with a real temp dir. After interrupt, multiple idles should all return null.
  
  **Test 3** ("does not suppress for non-interrupt TUI commands", lines 534-569):
  - This test should still pass conceptually — non-interrupt commands don't call `pauseWork`. But the test needs `directory` passed to `createPluginInterface`. Since no state file exists (no `pauseWork` called), `checkContinuation` would return null too. The mock `workContinuation` that always returns a prompt would still work because the plugin no longer pre-filters — it just calls the hook. So this test should still work with minimal changes (just adding `directory` to the constructor).
  
  **Implementation approach**: Add `directory` to `createPluginInterface` calls in all test instances. For the interrupt tests, create a temp directory with work state. Wire `workContinuation` to the real `checkContinuation` or keep the mock but verify state file changes.
  
  **Files**: `src/plugin/plugin-interface.test.ts`
  **Acceptance**: All three updated interrupt tests pass. Test 1 verifies `paused: true` in state file. Test 2 verifies persistent suppression (not one-shot). Test 3 verifies non-interrupt commands don't pause.

- [x] 10. **Fix remaining `createPluginInterface` calls in tests**
  **What**: Since `createPluginInterface` now requires `directory: string`, every existing call to `createPluginInterface` in `plugin-interface.test.ts` needs `directory` added. Use a constant like `directory: "/tmp/test"` or `directory: ""` for tests that don't exercise work state (since `pauseWork` would silently fail with no state file, which is fine). Alternatively, make `directory` optional with a default — but explicit is better.
  **Files**: `src/plugin/plugin-interface.test.ts`
  **Acceptance**: All existing tests still pass with the new `directory` parameter added.

## Verification
- [x] `bun test` — all tests pass
- [x] `grep -r "pendingInterrupt" src/` returns zero results
- [x] Manual check: `WorkState` type includes `paused?: boolean`
- [x] Manual check: `checkContinuation` returns null when `state.paused === true`
- [x] Manual check: interrupt handler calls `pauseWork` instead of setting boolean
- [x] Manual check: `session.idle` handler has no `pendingInterrupt` check
- [x] Manual check: `/start-work` resume calls `resumeWork`
