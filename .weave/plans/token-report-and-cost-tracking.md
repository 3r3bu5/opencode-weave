# Token Report Command & Cost Tracking

## TL;DR
> **Summary**: Add `agentName` and dollar `cost` capture to session analytics (Feature B), then build a `/token-report` command that generates a human-readable summary from `session-summaries.jsonl` (Feature A).
> **Estimated Effort**: Medium

## Context
### Original Request
Two follow-up features to the token telemetry merged in PR #17:
1. **Feature B** — Capture `agentName` (from `chat.params`) and `cost` (from `message.updated` `AssistantMessage.cost`) into session state and persist them in `SessionSummary`.
2. **Feature A** — A `/token-report` builtin command that reads JSONL summaries and renders a formatted report with totals, per-agent breakdown, and top-5 costliest sessions.

Feature B must land first since Feature A depends on `agentName` and `totalCost` fields.

### Key Findings

**Session data flow**: `chat.params` fires with `{ sessionID, agent, model, provider, message }` — the `agent` field contains the display name (e.g., `"Loom (Main Orchestrator)"`). We should store this on the `TrackedSession` and persist it into `SessionSummary`.

**Cost data source**: `message.updated` events carry `AssistantMessage` which has `cost: number` (dollar cost per message) and full `tokens: { input, output, reasoning, cache: { read, write } }`. The `cost` field is cumulative per-message, so we accumulate it on the `TrackedSession` and persist the total.

**Command hook**: The OpenCode plugin SDK exposes `"command.execute.before"` hook with signature `(input: { command: string, sessionID: string, arguments: string }, output: { parts: Part[] })`. We need to add this key to the `PluginInterface` Pick type and implement a handler in `createPluginInterface`.

**Existing pattern**: The `/start-work` command is registered via `BUILTIN_COMMANDS` record and wired through `ConfigHandler.applyCommandConfig()`. The new `/token-report` command follows this same pattern but does NOT need agent switching or template substitution — it needs data injection via the `command.execute.before` hook.

**Token report command design**: Unlike `/start-work` which uses `chat.message` to inject context, `/token-report` should use `command.execute.before` to inject the report text into the command's `output.parts`. This is cleaner because `command.execute.before` fires specifically for command execution and has access to the output parts. The command template just needs a minimal instruction; the hook injects the full report.

**JSONL backward compat**: New optional fields (`agentName`, `totalCost`) on `SessionSummary` are backward compatible — old entries missing these fields will simply show as `undefined`/`0` in the report.

**Test assertion**: `plugin-interface.test.ts` line 62 asserts "all 8 required handler keys". After adding `command.execute.before`, this becomes 9.

## Objectives
### Core Objective
Enable dollar cost and agent name tracking in session analytics, then expose this data via a `/token-report` slash command.

### Deliverables
- [x] `agentName` captured from `chat.params` and persisted in `SessionSummary`
- [x] `totalCost` accumulated from `message.updated` `cost` field and persisted in `SessionSummary`
- [x] `TokenUsage` fields (`inputTokens`, `outputTokens`, etc.) captured from `message.updated` `tokens` object and persisted in `SessionSummary`
- [x] `/token-report` command registered and functional
- [x] Report shows overall totals, per-agent breakdown, and top-5 costliest sessions
- [x] `command.execute.before` hook wired in plugin interface

### Definition of Done
- [x] `bun test` passes with no regressions
- [x] `bun run build` succeeds
- [x] New tests cover: agent name capture, cost accumulation, token report generation, command registration, command.execute.before handler

### Guardrails (Must NOT)
- Must NOT change any behavioral hooks — purely observational
- Must NOT break backward compat with existing JSONL entries (all new fields optional)
- Must NOT introduce new storage mechanisms — use existing JSONL infrastructure
- Must NOT add any cost estimation/calculation logic — use the `cost` field directly from OpenCode's `AssistantMessage`

## TODOs

### Phase 1: Feature B — Agent Name & Cost Tracking

- [x] 1. Extend `TrackedSession` and `SessionSummary` types
  **What**: Add `agentName?: string` and `totalCost: number` to `TrackedSession`. Add `agentName?: string` and `totalCost?: number` to `SessionSummary`. Add `tokenUsage?: TokenUsage` to `SessionSummary` (if not already present from PR #17 — verify). Define `TokenUsage` interface with `inputTokens`, `outputTokens`, `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalMessages`.
  **Files**: `src/features/analytics/types.ts`
  **Acceptance**: Types compile. `TrackedSession` has `agentName?: string`, `totalCost: number`. `SessionSummary` has `agentName?: string`, `totalCost?: number`, `tokenUsage?: TokenUsage`. All fields are optional on `SessionSummary` for backward compat.

- [x] 2. Add `setAgentName()` and `trackCost()` methods to `SessionTracker`
  **What**: 
  - `setAgentName(sessionId: string, agentName: string): void` — sets `session.agentName` (only if not already set, to capture the first/primary agent).
  - `trackCost(sessionId: string, cost: number): void` — adds `cost` to `session.totalCost`. Cost from `AssistantMessage` is per-message, so we accumulate.
  - `trackTokenUsage(sessionId: string, tokens: { input: number, output: number, reasoning: number, cache: { read: number, write: number } }): void` — accumulates token counts into `session.tokenUsage` fields and increments `totalMessages`.
  - Update `startSession()` to initialize `totalCost: 0` and `tokenUsage` fields on the `TrackedSession`.
  - Update `endSession()` to include `agentName`, `totalCost`, and `tokenUsage` in the persisted `SessionSummary`.
  **Files**: `src/features/analytics/session-tracker.ts`
  **Acceptance**: `tracker.setAgentName("s1", "Loom")` stores agent name. `tracker.trackCost("s1", 0.05)` accumulates cost. `tracker.trackTokenUsage("s1", { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } })` accumulates tokens. `endSession()` output includes all three fields.

- [x] 3. Wire agent name capture in `plugin-interface.ts` `chat.params` handler
  **What**: In the `chat.params` handler, extract the `agent` field from the input (it's `input.agent` per the SDK type, but we're casting to a narrower type — need to widen the cast). Call `tracker.setAgentName(sessionId, agent)` when tracker and analyticsEnabled are truthy. The `agent` string from `chat.params` is the display name (e.g., `"Loom (Main Orchestrator)"`); store it as-is.
  **Files**: `src/plugin/plugin-interface.ts`
  **Acceptance**: When `chat.params` fires with `{ sessionID: "s1", agent: "Loom (Main Orchestrator)", model: ... }`, the tracker's session for "s1" has `agentName` set to `"Loom (Main Orchestrator)"`. No-op when tracker is absent.

- [x] 4. Wire cost and token capture in `plugin-interface.ts` `message.updated` handler
  **What**: In the existing `message.updated` event handler, after the context-window monitoring block, add a new analytics block. When `tracker && hooks.analyticsEnabled` and the event is `message.updated` with `role === "assistant"`:
  - Extract `cost` from `info.cost` (the `AssistantMessage.cost` field — dollar cost per message).
  - Extract token fields from `info.tokens` (`input`, `output`, `reasoning`, `cache.read`, `cache.write`).
  - Call `tracker.trackCost(sessionId, cost)`.
  - Call `tracker.trackTokenUsage(sessionId, info.tokens)`.
  - Widen the event type cast to include `cost: number` and the full `tokens` shape.
  **Files**: `src/plugin/plugin-interface.ts`
  **Acceptance**: When `message.updated` fires with assistant message data including `cost: 0.05` and `tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } }`, the tracker session accumulates both cost and token usage. No-op when tracker is absent.

- [x] 5. Update barrel exports
  **What**: Export `TokenUsage` type from `src/features/analytics/index.ts` if not already exported.
  **Files**: `src/features/analytics/index.ts`
  **Acceptance**: `import type { TokenUsage } from "../features/analytics"` resolves.

- [x] 6. Write unit tests for Feature B
  **What**: Add tests to `src/features/analytics/session-tracker.test.ts`:
  - `setAgentName` stores agent name on session
  - `setAgentName` is idempotent (first call wins)
  - `trackCost` accumulates cost across multiple calls
  - `trackTokenUsage` accumulates all token fields and increments totalMessages
  - `endSession` includes `agentName`, `totalCost`, and `tokenUsage` in summary
  - `endSession` omits `agentName` when not set (undefined)
  - `endSession` persists `totalCost: 0` when no cost tracked
  
  Add tests to `src/plugin/plugin-interface.test.ts`:
  - `chat.params` calls `tracker.setAgentName` when analytics enabled
  - `message.updated` calls `tracker.trackCost` and `tracker.trackTokenUsage` when analytics enabled
  - Both are no-ops when tracker is absent
  **Files**: `src/features/analytics/session-tracker.test.ts`, `src/plugin/plugin-interface.test.ts`
  **Acceptance**: All new tests pass. All existing tests still pass.

### Phase 2: Feature A — `/token-report` Command

- [x] 7. Create `generateTokenReport()` pure function
  **What**: Create `src/features/analytics/token-report.ts` with a pure function `generateTokenReport(summaries: SessionSummary[]): string`. The function produces a formatted text report with three sections:
  
  **Section 1 — Overall Totals**:
  - Total sessions, total messages (sum of `tokenUsage.totalMessages`)
  - Total input/output/reasoning/cacheRead/cacheWrite tokens (summed from `tokenUsage`)
  - Total cost (sum of `totalCost`)
  - Format costs as `$X.XX`, tokens with locale-aware thousands separators
  
  **Section 2 — Per-Agent Breakdown** (grouped by `agentName`):
  - For each agent: session count, average tokens per session, average cost per session, total cost
  - Sort by total cost descending
  - Sessions without `agentName` grouped under "(unknown)"
  
  **Section 3 — Top 5 Costliest Sessions**:
  - Session ID (truncated to 8 chars), agent name, total cost, total tokens, duration (formatted as Xm Ys)
  - Sorted by `totalCost` descending, take top 5
  
  Handle edge cases:
  - Empty summaries array → return "No session data available."
  - All summaries missing `tokenUsage`/`totalCost` → show what's available with zeros
  
  Also export a convenience function `getTokenReport(directory: string): string` that reads summaries and calls `generateTokenReport`.
  **Files**: `src/features/analytics/token-report.ts` (new)
  **Acceptance**: `generateTokenReport([...])` returns a well-formatted multi-section string. Edge cases produce sensible output.

- [x] 8. Register `/token-report` command
  **What**: 
  - Add `"token-report"` to the `BuiltinCommandName` union type.
  - Add `"token-report"` entry to `BUILTIN_COMMANDS` record. Unlike `/start-work`, this command does NOT need agent switching — it should use the current agent. Set `agent` to `"loom"` (or whatever the default is). The template is minimal since the real content is injected via `command.execute.before`:
    ```
    template: `<command-instruction>
    Display the token usage report that has been injected below. Present it clearly to the user.
    </command-instruction>
    <token-report>$ARGUMENTS</token-report>`
    ```
    Set `description: "Show token usage and cost report across sessions"`.
    No `argumentHint` needed (no arguments).
  **Files**: `src/features/builtin-commands/types.ts`, `src/features/builtin-commands/commands.ts`
  **Acceptance**: `BUILTIN_COMMANDS["token-report"]` is defined with correct shape. TypeScript compiles.

- [x] 9. Add `command.execute.before` to `PluginInterface` type
  **What**: Add `"command.execute.before"` to the `Pick` type in `src/plugin/types.ts`. The current Pick has 8 keys; this becomes 9. The SDK type for this hook is:
  ```ts
  "command.execute.before"?: (input: {
    command: string;
    sessionID: string;
    arguments: string;
  }, output: {
    parts: Part[];
  }) => Promise<void>;
  ```
  **Files**: `src/plugin/types.ts`
  **Acceptance**: `PluginInterface` includes `"command.execute.before"` as a required key. TypeScript compiles.

- [x] 10. Implement `command.execute.before` handler in `createPluginInterface`
  **What**: Add a `"command.execute.before"` handler to the object returned by `createPluginInterface`. The handler:
  - Checks if `input.command === "token-report"` (matching the command name, not the slash prefix)
  - If so, reads session summaries via `readSessionSummaries(directory)` and generates the report via `generateTokenReport(summaries)`
  - Injects the report text into `output.parts` by appending a text part: `output.parts.push({ type: "text", text: reportText })`
  - For other commands, pass through (no-op)
  - Import `readSessionSummaries` from analytics storage and `generateTokenReport` from token-report module
  
  Also update `createPluginInterface` args type if needed — it already receives `directory`.
  **Files**: `src/plugin/plugin-interface.ts`
  **Acceptance**: When `command.execute.before` fires with `{ command: "token-report", sessionID: "s1", arguments: "" }`, the output parts contain the report text. Other commands are unaffected.

- [x] 11. Update barrel exports for token-report
  **What**: Export `generateTokenReport` and `getTokenReport` from `src/features/analytics/index.ts`.
  **Files**: `src/features/analytics/index.ts`
  **Acceptance**: `import { generateTokenReport } from "../features/analytics"` resolves.

- [x] 12. Update key-count test assertion
  **What**: In `src/plugin/plugin-interface.test.ts`, line 62: change `"all 8 required handler keys"` to `"all 9 required handler keys"`. Add `expect(keys).toContain("command.execute.before")` to the assertion block. Also add `expect(typeof iface["command.execute.before"]).toBe("function")` to the handler-type test.
  **Files**: `src/plugin/plugin-interface.test.ts`
  **Acceptance**: Existing key-count test passes with updated assertion.

- [x] 13. Write unit tests for Feature A
  **What**: 
  Create `src/features/analytics/token-report.test.ts`:
  - `generateTokenReport` with empty array returns "No session data available."
  - `generateTokenReport` with sessions shows overall totals section
  - `generateTokenReport` groups by agent name correctly
  - `generateTokenReport` shows "(unknown)" for sessions without agent name
  - `generateTokenReport` shows top 5 costliest sessions sorted by cost
  - `generateTokenReport` handles sessions without tokenUsage/totalCost gracefully
  - `generateTokenReport` limits to top 5 even when more than 5 sessions exist
  - Cost formatting shows dollar amounts with 2 decimal places
  
  Add tests to `src/plugin/plugin-interface.test.ts`:
  - `command.execute.before` injects report for token-report command
  - `command.execute.before` is no-op for other commands
  
  Add tests to `src/features/builtin-commands/commands.test.ts`:
  - `BUILTIN_COMMANDS` has `token-report` command
  - `token-report` has a description
  - `token-report` has name matching its key
  **Files**: `src/features/analytics/token-report.test.ts` (new), `src/plugin/plugin-interface.test.ts`, `src/features/builtin-commands/commands.test.ts`
  **Acceptance**: All tests pass.

## Verification
- [x] `bun test` — all tests pass (new + existing)
- [x] `bun run build` — compiles without errors
- [x] No regressions in existing JSONL handling (old entries without new fields still parse)
- [x] Manual check: `generateTokenReport` output is readable and correctly formatted
- [x] Key-count test in `plugin-interface.test.ts` passes with 9

## Implementation Notes

### Agent Name from `chat.params`
The `agent` field in `chat.params` input is the display name string (e.g., `"Loom (Main Orchestrator)"`). Store it as-is — no reverse mapping needed. The current `chat.params` handler casts input to a narrow type `{ sessionID?, model? }` — this cast needs to be widened to also include `agent?: string`.

### Cost Accumulation
`AssistantMessage.cost` is a per-message dollar cost. Multiple `message.updated` events fire per session (one per assistant response), so we accumulate with `+=`. Initialize `totalCost: 0` in `startSession()`.

### Token Accumulation  
`AssistantMessage.tokens` has `{ input, output, reasoning, cache: { read, write } }`. These are per-message values. Accumulate into `TrackedSession` token fields. Also increment a `totalMessages` counter.

### `command.execute.before` Hook
This hook fires before a registered command is processed. It receives the command name, session ID, and arguments. We use it to inject the report into `output.parts`. The command template provides the instruction wrapper; the hook provides the data.

### File Dependency Order
```
types.ts (1) → session-tracker.ts (2) → plugin-interface.ts (3,4) → index.ts (5)
          → token-report.ts (7) → commands.ts,types.ts (8) → types.ts (9) → plugin-interface.ts (10) → index.ts (11)
```
Tests (6, 12, 13) follow their respective implementation steps.
