# Wire Context Window Monitor to Real Token Data

## TL;DR
> **Summary**: Replace the hardcoded `{ usedTokens: 0, maxTokens: 0 }` in `plugin-interface.ts` with real token data sourced from OpenCode's `chat.params` (model context limit) and `message.updated` events (actual token usage), enabling the existing threshold logic to fire warnings at 80% and critical alerts at 95%.
> **Estimated Effort**: Short

## Context
### Original Request
GitHub Issue #1: "Wire context window monitor to real token data". The context window monitor (`context-window-monitor.ts`) has correct threshold logic but is called with hardcoded zeros, so it never fires warnings.

### Key Findings

1. **`checkContextWindow()` is called in `chat.message` hook** (plugin-interface.ts:45-51) with `{ usedTokens: 0, maxTokens: 0 }`. Token data is NOT available in the `chat.message` hook — it only has `sessionID`, `agent`, `model` (IDs only), and message parts.

2. **Model context limit** is available in the `chat.params` hook via `input.model.limit.context` (SDK type `Model.limit.context: number`). This is the `maxTokens` value.

3. **Token usage** is available in two places:
   - **`message.part.updated`** events with `StepFinishPart` — per-step token data (`tokens.input`, `tokens.output`, `tokens.reasoning`, `tokens.cache.{read,write}`)
   - **`message.updated`** events with `AssistantMessage` — accumulated token data for the entire message (`tokens.input`, `tokens.output`, `tokens.reasoning`, `tokens.cache.{read,write}`)

4. **Best approach**: Use `message.updated` events. The `AssistantMessage.tokens.input` field represents the input tokens sent to the model for that call, which includes the entire conversation context. The **latest** assistant message's `input` tokens effectively represents current context window usage — we don't need to sum across messages. This is simpler and avoids deduplication issues with streaming `step-finish` parts.

5. **State bridging**: Need to store `maxTokens` (from `chat.params`) and `usedTokens` (from `message.updated`) per session. A simple in-memory `Map<string, SessionTokenState>` is sufficient. Both hooks run in the same plugin process.

6. **Config thresholds**: Already defined in schema (`experimental.context_window_warning_threshold`, `experimental.context_window_critical_threshold`) but the hardcoded `{ warningPct: 0.8, criticalPct: 0.95 }` in `create-hooks.ts` doesn't read from config. This should also be wired.

7. **Existing patterns**: The `event` hook already handles `session.created`, `session.deleted`, and `session.idle` events with type narrowing. The `chat.params` hook is a pass-through stub.

## Objectives
### Core Objective
Make the context window monitor fire real warnings by feeding it actual token data from OpenCode's event system.

### Deliverables
- [x] Per-session token state tracker (in-memory Map)
- [x] `chat.params` hook captures `model.limit.context` per session
- [x] `event` hook processes `message.updated` events to extract token usage
- [x] `checkContextWindow()` called from event handler with real data
- [x] Config thresholds (`experimental.context_window_*`) wired to monitor
- [x] Remove hardcoded zero call from `chat.message`
- [x] Tests covering the full data flow

### Definition of Done
- [x] `bun test` passes with no failures
- [x] `bun run typecheck` passes with no errors
- [x] `bun run build` succeeds with no warnings
- [x] Manual verification: when a session approaches 80% of model context limit, a warning fires

### Guardrails (Must NOT)
- Must NOT change the `checkContextWindow()` pure function signature or its threshold logic (it works correctly)
- Must NOT introduce external persistence (file/DB) — in-memory Map is fine
- Must NOT break existing hooks or their tests
- Must NOT accumulate tokens across messages (latest `input` tokens IS the current usage)

## TODOs

- [x] 1. **Create per-session token state tracker**
  **What**: Create a new file `src/hooks/session-token-state.ts` that exports a class/module managing per-session token state. It should:
  - Store `Map<string, { maxTokens: number; usedTokens: number }>` 
  - `setContextLimit(sessionId: string, maxTokens: number)` — called from `chat.params`
  - `updateUsage(sessionId: string, inputTokens: number)` — called from `message.updated` event; stores the latest input token count (NOT cumulative)
  - `getState(sessionId: string): { usedTokens: number, maxTokens: number } | undefined`
  - `clearSession(sessionId: string)` — called on `session.deleted`
  - `clear()` — for testing
  **Files**: Create `src/hooks/session-token-state.ts`
  **Acceptance**: Module exports all four functions, unit tests pass

- [x] 2. **Write unit tests for session token state tracker**
  **What**: Create `src/hooks/session-token-state.test.ts` with tests for:
  - Setting context limit stores it per session
  - Updating usage stores latest input tokens (not cumulative)
  - `getState` returns undefined for unknown sessions
  - `clearSession` removes a session
  - Multiple sessions tracked independently
  - `updateUsage` only updates `usedTokens`, doesn't overwrite `maxTokens`
  - `setContextLimit` doesn't overwrite existing `usedTokens`
  **Files**: Create `src/hooks/session-token-state.test.ts`
  **Acceptance**: `bun test src/hooks/session-token-state.test.ts` passes

- [x] 3. **Wire `chat.params` hook to capture model context limit**
  **What**: In `plugin-interface.ts`, update the `chat.params` handler (currently a pass-through on line 110-112) to:
  - Extract `input.model.limit.context` as `maxTokens`
  - Extract `input.sessionID` 
  - Call the session token state tracker's `setContextLimit(sessionID, maxTokens)`
  - Log the capture: `log("[context-window] Captured context limit", { sessionId, maxTokens })`
  
  This requires the plugin interface to receive the session token state tracker. Update `createPluginInterface` args to accept it, and update `index.ts` to create and pass it.
  **Files**: Modify `src/plugin/plugin-interface.ts` (lines 110-112), modify `src/index.ts`
  **Acceptance**: When `chat.params` is called, context limit is stored in the tracker

- [x] 4. **Wire `event` hook to process `message.updated` events**
  **What**: In `plugin-interface.ts`, add handling in the `event` handler (line 118-155) for `message.updated` events:
  - Check `event.type === "message.updated"`
  - Narrow the event to `EventMessageUpdated` type
  - Check `event.properties.info.role === "assistant"` (only assistant messages have tokens)
  - Extract `sessionID` from `event.properties.info.sessionID`
  - Extract `event.properties.info.tokens.input` as `usedTokens`
  - Call `sessionTokenState.updateUsage(sessionID, usedTokens)`
  - Get full state via `sessionTokenState.getState(sessionID)`
  - If state exists with both `maxTokens > 0` and `usedTokens > 0`, call `hooks.checkContextWindow({ usedTokens, maxTokens, sessionId })`
  - Log the result if action is not "none"
  
  Also handle `session.deleted` to clean up: call `sessionTokenState.clearSession(sessionId)`.
  **Files**: Modify `src/plugin/plugin-interface.ts` (event handler, lines 118-155)
  **Acceptance**: When `message.updated` fires with assistant message tokens, `checkContextWindow` is called with real data

- [x] 5. **Remove hardcoded zero call from `chat.message` hook**
  **What**: Remove lines 45-51 in `plugin-interface.ts` that call `checkContextWindow({ usedTokens: 0, maxTokens: 0, sessionId })`. This call is now handled in the `event` hook with real data.
  **Files**: Modify `src/plugin/plugin-interface.ts` (lines 45-51)
  **Acceptance**: No more hardcoded zero calls; `chat.message` no longer calls `checkContextWindow`

- [x] 6. **Wire config thresholds to monitor creation**
  **What**: In `create-hooks.ts`, read `pluginConfig.experimental?.context_window_warning_threshold` and `pluginConfig.experimental?.context_window_critical_threshold` to set the thresholds instead of hardcoding `0.8` and `0.95`:
  ```
  const contextWindowThresholds: ContextWindowThresholds = {
    warningPct: pluginConfig.experimental?.context_window_warning_threshold ?? 0.8,
    criticalPct: pluginConfig.experimental?.context_window_critical_threshold ?? 0.95,
  }
  ```
  **Files**: Modify `src/hooks/create-hooks.ts` (lines 25-28)
  **Acceptance**: Custom thresholds from config are applied; defaults preserved when not set

- [x] 7. **Update `plugin-interface.test.ts` for new behavior**
  **What**: Update existing tests and add new tests:
  - Remove/update test expectations around `checkContextWindow` being called from `chat.message` (it no longer is)
  - Add test: `chat.params` captures model context limit into session token state
  - Add test: `event` handler processes `message.updated` with assistant tokens and calls `checkContextWindow` with real data
  - Add test: `event` handler ignores `message.updated` for user messages (no tokens)
  - Add test: `event` handler cleans up session token state on `session.deleted`
  - Add test: no call to `checkContextWindow` when maxTokens is still 0 (chat.params not yet called)
  - Add test: warning fires when usage exceeds 80% threshold
  - Add test: recover fires when usage exceeds 95% threshold
  **Files**: Modify `src/plugin/plugin-interface.test.ts`
  **Acceptance**: `bun test src/plugin/plugin-interface.test.ts` passes

- [x] 8. **Update `create-hooks.test.ts` for config threshold wiring**
  **What**: Add test that verifies custom thresholds from `pluginConfig.experimental` are applied:
  - Create hooks with `pluginConfig: { experimental: { context_window_warning_threshold: 0.6, context_window_critical_threshold: 0.9 } }`
  - Call `checkContextWindow` with 65% usage → should return `warn` (with 0.6 threshold)
  - Call `checkContextWindow` with 65% usage with default config → should return `none`
  **Files**: Modify `src/hooks/create-hooks.test.ts`
  **Acceptance**: `bun test src/hooks/create-hooks.test.ts` passes

- [x] 9. **Export session token state from hooks index**
  **What**: Add exports for the new session token state module in `src/hooks/index.ts` so it's accessible from the plugin interface.
  **Files**: Modify `src/hooks/index.ts`
  **Acceptance**: Import from `../hooks` works in plugin-interface.ts

- [x] 10. **Final verification**
  **What**: Run the full test suite and build to ensure no regressions:
  - `bun test` — all tests pass
  - `bun run typecheck` — no type errors  
  - `bun run build` — successful build
  **Files**: None (verification only)
  **Acceptance**: All three commands succeed with zero errors

## Implementation Order

```
1. session-token-state.ts (new module, no deps)
2. session-token-state.test.ts (tests for #1)
3. create-hooks.ts config wiring (#6, independent)
4. create-hooks.test.ts (#8, tests for #6)
5. hooks/index.ts exports (#9)
6. plugin-interface.ts: wire chat.params (#3)
7. plugin-interface.ts: wire event handler (#4)
8. plugin-interface.ts: remove hardcoded zeros (#5)
9. index.ts: pass token state to plugin interface (#3)
10. plugin-interface.test.ts (#7)
11. Final verification (#10)
```

Steps 1-5 are independent of each other and can be done first. Steps 6-9 depend on step 1 and modify the same file (`plugin-interface.ts`), so they should be done together. Step 10 depends on all prior steps.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `message.updated` fires many times during streaming (partial updates) | The `input` token count on partial updates may be 0 or stale. Only update usage when `tokens.input > 0`. Additionally, the monitor is idempotent — calling it multiple times with the same values just returns the same result. |
| `chat.params` may fire before `message.updated` for the same session, or not at all for some edge cases | `checkContextWindow` is only called when `getState()` returns a state with `maxTokens > 0`. If `chat.params` never fired, we simply don't check. |
| In-memory Map resets on plugin restart | Acceptable for v1. Context data rebuilds quickly as the first `chat.params` and `message.updated` fire in the new session. Document this as a known limitation. |
| `message.updated` may fire for child sessions (subtasks) with their own context limits | Each session has its own entry in the Map keyed by `sessionID`. Child sessions get their own `chat.params` call with their model's limit. This is correct behavior. |
| Deduplication of `step-finish` parts during streaming | **Avoided entirely** — we use `message.updated` with `AssistantMessage.tokens` instead of `message.part.updated` with `StepFinishPart`. The message-level tokens are already accumulated by OpenCode. |

## Verification
- [x] All tests pass (`bun test`)
- [x] No type errors (`bun run typecheck`)
- [x] Build succeeds (`bun run build`)
- [x] No regressions in existing plugin-interface tests
- [x] Context window monitor fires warnings with real token data in integration
