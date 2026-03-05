# E2E Regression Tests for Configurable Weave Plugin

## TL;DR
> **Summary**: Add comprehensive E2E tests that exercise `WeavePlugin()` from `src/index.ts` end-to-end — covering config loading, analytics opt-in/opt-out, hook→tracker→JSONL persistence, configDir prompt resolution, JSONL rotation, agent name variant registration, and a full combined-features smoke test. These tests close the gap between unit tests and the real plugin initialization flow.
> **Estimated Effort**: Medium

## Context
### Original Request
After fixing 14 review findings on PR #12 (feat/configurable-weave), thread analysis identified critical E2E test gaps. The existing `src/e2e.test.ts` (562 lines) starts at the `createManagers()` level and never exercises `WeavePlugin()` — meaning the full orchestration path (config loading → hooks → analytics → agents wiring) is untested at the integration level.

### Key Findings

1. **`WeavePlugin()` flow is barely tested**: `src/index.test.ts` has only 3 tests — "is a function", "returns 8 handlers", and "handles missing config". None of them verify analytics wiring, hook creation with `analyticsEnabled`, fingerprint injection, or configDir resolution.

2. **Analytics opt-in is never E2E validated**: `createHooks.test.ts` tests `analyticsEnabled` as a unit property, but nothing proves that when `analytics.enabled: true` is in a config file, the entire chain works — `loadWeaveConfig` → `WeavePlugin` reads it → `createHooks` gets `analyticsEnabled: true` → `createAnalytics` returns a tracker → `createPluginInterface` receives the tracker.

3. **Session tracker persistence is untested E2E**: `e2e.test.ts` L392-447 tests `createSessionTracker` directly, but never validates that `endSession()` actually writes to `.weave/analytics/session-summaries.jsonl` on disk and that the data can be read back.

4. **`configDir` prompt loading works in unit tests** (`prompt-loader.ts`) but is never E2E tested through `createManagers` → `buildCustomAgent` → `loadPromptFile`. The existing test at L85-110 creates a prompt file but doesn't pass `configDir` to `createManagers`.

5. **JSONL rotation** (`MAX_SESSION_ENTRIES = 1000`) is unit tested in storage tests but never exercised through the real tracker → `appendSessionSummary` → rotation path.

6. **`registerAgentNameVariants()`** is called in `custom-agent-factory.ts:107` during `buildCustomAgent()`, but no E2E test validates that after building a custom agent, its name variants are actually registered and `stripDisabledAgentReferences` works for that custom agent.

7. **AGENT_NAME_VARIANTS is module-level mutable state**: The `const AGENT_NAME_VARIANTS` map in `agent-builder.ts` is not exported, so cleanup in tests must go through the public API. Custom variants registered by `buildCustomAgent` persist across tests. The existing `e2e.test.ts` cleans up `AGENT_DISPLAY_NAMES` but NOT `AGENT_NAME_VARIANTS`.

8. **`loadWeaveConfig` reads from `.opencode/weave-opencode.json(c)`**: To test `WeavePlugin()` with a real config file, we need to write `{testDir}/.opencode/weave-opencode.json` before calling `WeavePlugin(makeMockCtx(testDir))`.

9. **`createTools` makes a network call** (`loadSkills` hits `ctx.serverUrl`): When testing `WeavePlugin()` directly, `ctx.serverUrl` should be `"http://localhost:3000"` (the existing mock pattern). `loadSkills` is designed to gracefully fail if the server isn't available, so this should work but may produce log noise.

10. **Plugin interface type**: `WeavePlugin()` returns a `PluginInterface` (defined in `src/plugin/types.ts`) with keys: `tool`, `config`, `chat.message`, `chat.params`, `chat.headers`, `event`, `tool.execute.before`, `tool.execute.after`. The `config` handler mutates its input object to set `config.agent`, `config.command`, and `config.default_agent`.

## Objectives
### Core Objective
Close E2E test gaps identified in PR #12 review by adding regression tests that exercise the full `WeavePlugin()` initialization flow and key integration paths, preventing the specific classes of bugs that were fixed.

### Deliverables
- [x] New test file `src/e2e-regression.test.ts` with 7 test scenarios (~330-470 lines)
- [x] Tests covering all 7 gap areas at priority levels Critical, High, and Medium

### Definition of Done
- [x] `bun test` passes with all existing 803 tests + new tests (zero failures) → 817 tests pass
- [x] `bun run build` succeeds without errors
- [x] Each new test exercises a real integration path (not just unit assertions)
- [x] No mocking beyond `PluginInput` context (consistent with existing E2E pattern)

### Guardrails (Must NOT)
- Must NOT modify existing test files (`e2e.test.ts`, `index.test.ts`, `integration.test.ts`, etc.)
- Must NOT modify any source code files
- Must NOT import non-exported internals (e.g., `AGENT_NAME_VARIANTS` map directly)
- Must NOT leave temp directories on disk after test runs (always `rmSync` in `afterEach`)
- Must NOT introduce flaky tests (no timing-dependent assertions, no network dependency for assertions)

## TODOs

- [x] 1. **Create `src/e2e-regression.test.ts` with shared test infrastructure**
  **What**: Create the new test file with imports, `makeMockCtx` helper, temp directory setup/teardown patterns, and a helper to write a `.opencode/weave-opencode.json` config file into a temp dir so `loadWeaveConfig` can discover it when `WeavePlugin(makeMockCtx(testDir))` is called.
  **Files**: Create `src/e2e-regression.test.ts`
  **Details**:
  - Import from `bun:test`: `describe`, `it`, `expect`, `beforeEach`, `afterEach`
  - Import from `fs`: `mkdirSync`, `mkdtempSync`, `writeFileSync`, `rmSync`, `existsSync`, `readFileSync`
  - Import from `path`: `join`
  - Import from `os`: `tmpdir`
  - Import `WeavePlugin` from `./index`
  - Import `{ AGENT_DISPLAY_NAMES, getAgentDisplayName }` from `./shared/agent-display-names`
  - Import `{ createSessionTracker }` from `./features/analytics/session-tracker`
  - Import `{ readSessionSummaries, appendSessionSummary, MAX_SESSION_ENTRIES }` from `./features/analytics/storage`
  - Import `{ generateFingerprint }` from `./features/analytics/fingerprint`
  - Import `{ createManagers }` from `./create-managers`
  - Import `{ WeaveConfigSchema }` from `./config/schema`
  - Import `{ stripDisabledAgentReferences }` from `./agents/agent-builder`
  - Import `type { PluginInput }` from `@opencode-ai/plugin`
  - Import `{ ANALYTICS_DIR, SESSION_SUMMARIES_FILE }` from `./features/analytics/types`
  - Define `makeMockCtx(directory: string): PluginInput` — same pattern as existing tests
  - Define `writeProjectConfig(testDir: string, config: Record<string, unknown>): void` — writes `config` as JSON to `{testDir}/.opencode/weave-opencode.json`, creating the `.opencode` dir if needed
  - Define `cleanupCustomDisplayNames(registeredKeys: string[]): void` — same pattern as existing `e2e.test.ts` L31-35
  **Acceptance**: File compiles with `bun test src/e2e-regression.test.ts` (even if empty describe blocks)

- [x] 2. **Test: Full `WeavePlugin()` initialization flow (default config)**
  **What**: Call `WeavePlugin(makeMockCtx(testDir))` with no config file present and verify the returned plugin interface has all 8 handler keys, that the `config` handler produces all builtin agents with correct display names, and that analytics is NOT active (disabled by default).
  **Files**: `src/e2e-regression.test.ts`
  **Details**:
  - `describe("E2E Regression: WeavePlugin full initialization", () => { ... })`
  - Use `mkdtempSync(join(tmpdir(), "weave-e2e-"))` for test isolation
  - `beforeEach`: create temp dir
  - `afterEach`: `rmSync(testDir, { recursive: true, force: true })`
  - Test: `"WeavePlugin() returns all 8 handlers and config produces all builtin agents"`:
    - `const plugin = await WeavePlugin(makeMockCtx(testDir))`
    - Assert all 8 keys exist: `tool`, `config`, `chat.message`, `chat.params`, `chat.headers`, `event`, `tool.execute.before`, `tool.execute.after`
    - Call `plugin.config(configObj)` where `configObj = {}` (the config handler mutates it)
    - Assert `configObj.agent` is an object
    - Assert `configObj.agent[getAgentDisplayName("loom")]` is defined and has a `.prompt` containing `<Role>`
    - Assert `configObj.agent[getAgentDisplayName("tapestry")]` is defined
    - Assert `configObj.default_agent` equals `getAgentDisplayName("loom")`
    - Assert all 8 builtin agents are present: loom, tapestry, shuttle, pattern, thread, spindle, warp, weft
  - Test: `"WeavePlugin() with no config file does NOT create analytics directory"`:
    - `await WeavePlugin(makeMockCtx(testDir))`
    - Assert `existsSync(join(testDir, ".weave/analytics"))` is `false` — proves analytics is disabled by default
  **Acceptance**: Both tests pass, validating the full init flow from `WeavePlugin()` down to agent registration

- [x] 3. **Test: Analytics opt-in/opt-out E2E through WeavePlugin()**
  **What**: Write a config file with `analytics.enabled: true` to `{testDir}/.opencode/weave-opencode.json`, call `WeavePlugin()`, then verify that analytics infrastructure was initialized (fingerprint file created, tracker wired into plugin hooks). Then test with `analytics.enabled: false` (or omitted) to confirm analytics stays off.
  **Files**: `src/e2e-regression.test.ts`
  **Details**:
  - `describe("E2E Regression: Analytics opt-in/opt-out", () => { ... })`
  - `beforeEach`: create temp dir + write `package.json` and `tsconfig.json` (so fingerprint detection has something to find)
  - `afterEach`: rmSync temp dir + cleanup display names
  - Test: `"analytics.enabled: true creates analytics directory and fingerprint"`:
    - Call `writeProjectConfig(testDir, { analytics: { enabled: true } })`
    - `await WeavePlugin(makeMockCtx(testDir))`
    - Assert `existsSync(join(testDir, ANALYTICS_DIR))` is `true`
    - Assert `existsSync(join(testDir, ANALYTICS_DIR, "fingerprint.json"))` is `true`
    - Read and parse `fingerprint.json` — assert it has `stack` array, `primaryLanguage`, `packageManager` fields
  - Test: `"analytics.enabled: false (default) does NOT create analytics artifacts"`:
    - Call `writeProjectConfig(testDir, {})` (no analytics key)
    - `await WeavePlugin(makeMockCtx(testDir))`
    - Assert `existsSync(join(testDir, ANALYTICS_DIR))` is `false`
  - Test: `"analytics.enabled: true injects fingerprint into Loom prompt"`:
    - Write `package.json`, `tsconfig.json`, `bun.lockb` into testDir
    - Call `writeProjectConfig(testDir, { analytics: { enabled: true } })`
    - `const plugin = await WeavePlugin(makeMockCtx(testDir))`
    - `const configObj: any = {}; await plugin.config(configObj)`
    - Assert `configObj.agent[getAgentDisplayName("loom")].prompt` contains `<ProjectContext>`
    - Assert it contains `typescript` and `bun`
  **Acceptance**: Three tests pass, proving analytics opt-in/opt-out works end-to-end through the real config loading + plugin init path

- [x] 4. **Test: Hook → Tracker → JSONL persistence flow**
  **What**: Create a `SessionTracker` pointed at a temp dir, simulate a session lifecycle (start → tool calls → end), then verify the JSONL file exists on disk with parseable session summary data. Also verify that `readSessionSummaries()` correctly reads back what was written.
  **Files**: `src/e2e-regression.test.ts`
  **Details**:
  - `describe("E2E Regression: Tracker → JSONL persistence", () => { ... })`
  - `beforeEach`: create temp dir
  - `afterEach`: rmSync temp dir
  - Test: `"endSession() persists summary to JSONL file on disk"`:
    - `const tracker = createSessionTracker(testDir)`
    - `tracker.startSession("persist-test-1")`
    - `tracker.trackToolStart("persist-test-1", "read", "c1")`
    - `tracker.trackToolEnd("persist-test-1", "read", "c1")`
    - `tracker.trackToolStart("persist-test-1", "task", "c2", "thread")`
    - `tracker.trackToolEnd("persist-test-1", "task", "c2", "thread")`
    - `const summary = tracker.endSession("persist-test-1")`
    - Assert `summary` is not null
    - Assert `existsSync(join(testDir, ANALYTICS_DIR, SESSION_SUMMARIES_FILE))` is `true`
    - Read the JSONL file contents directly with `readFileSync`
    - Parse each line as JSON — assert the first line's `sessionId` is `"persist-test-1"`
    - Assert `totalToolCalls` is `2` and `totalDelegations` is `1`
  - Test: `"readSessionSummaries() reads back persisted data correctly"`:
    - Create tracker, run 2 separate sessions with different tool profiles
    - End both sessions
    - `const summaries = readSessionSummaries(testDir)`
    - Assert `summaries.length` is `2`
    - Assert first summary's `sessionId` and `totalToolCalls` match
    - Assert second summary's `sessionId` and `totalToolCalls` match
  - Test: `"multiple sessions accumulate in the same JSONL file"`:
    - Create tracker, run 3 sessions, end each
    - Read JSONL file — assert 3 lines
    - Use `readSessionSummaries(testDir)` — assert length 3
  **Acceptance**: Three tests pass, proving the full persistence chain from tracker API to disk I/O and read-back

- [x] 5. **Test: `configDir` wiring — prompt_file resolution through createManagers**
  **What**: Create a temp dir structure with a config that specifies `prompt_file: "prompts/my-agent.md"` and a corresponding file at `{configDir}/prompts/my-agent.md`. Call `createManagers` with `configDir` pointing to the temp dir. Verify the custom agent's prompt contains the file content.
  **Files**: `src/e2e-regression.test.ts`
  **Details**:
  - `describe("E2E Regression: configDir prompt_file resolution", () => { ... })`
  - `beforeEach`: create temp dir + subdirectory `prompts/` + write `prompts/my-agent.md` with known content (e.g., `"You are a database optimization specialist.\n\nFocus on query performance."`)
  - `afterEach`: rmSync temp dir + cleanup registered display names
  - Test: `"prompt_file resolved relative to configDir through createManagers"`:
    - Parse config: `{ custom_agents: { "db-helper": { prompt_file: "prompts/my-agent.md", display_name: "DB Helper" } } }`
    - `const managers = createManagers({ ctx: makeMockCtx(testDir), pluginConfig: config, configDir: testDir })`
    - Assert `managers.agents["db-helper"]` is defined
    - Assert `managers.agents["db-helper"].prompt` contains `"database optimization specialist"`
    - Assert `managers.agents["db-helper"].prompt` contains `"query performance"`
  - Test: `"prompt_file with missing file results in empty prompt (graceful fallback)"`:
    - Parse config: `{ custom_agents: { "missing-prompt": { prompt_file: "nonexistent.md", display_name: "Missing" } } }`
    - `const managers = createManagers({ ctx: makeMockCtx(testDir), pluginConfig: config, configDir: testDir })`
    - Assert `managers.agents["missing-prompt"]` is defined (agent still built)
    - Assert `managers.agents["missing-prompt"].prompt` is undefined or empty
  - Track registered keys: push `"db-helper"`, `"missing-prompt"` to `registeredKeys` for cleanup
  **Acceptance**: Both tests pass, proving `configDir` is correctly threaded through `createManagers` → `buildCustomAgent` → `loadPromptFile`

- [x] 6. **Test: JSONL rotation through real tracker flow**
  **What**: Verify that when more than `MAX_SESSION_ENTRIES` (1000) session summaries are written via the tracker → `appendSessionSummary` path, the JSONL file is rotated to keep only the last 1000 entries.
  **Files**: `src/e2e-regression.test.ts`
  **Details**:
  - `describe("E2E Regression: JSONL rotation through tracker", () => { ... })`
  - `beforeEach`: create temp dir
  - `afterEach`: rmSync temp dir
  - Test: `"JSONL file rotates to MAX_SESSION_ENTRIES when threshold exceeded"`:
    - Use `appendSessionSummary` directly (not the tracker — to avoid creating 1001 real sessions) to write 1001 minimal summaries in a loop. Each summary: `{ sessionId: "s-${i}", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 100, toolUsage: [], delegations: [], totalToolCalls: 0, totalDelegations: 0 }`
    - `const summaries = readSessionSummaries(testDir)`
    - Assert `summaries.length` is `1000` (trimmed)
    - Assert `summaries[0].sessionId` is `"s-1"` (the oldest kept entry — zero-indexed, the first entry `s-0` was trimmed)
    - Assert `summaries[999].sessionId` is `"s-1000"` (the newest entry)
    - Note: rotation happens on every `appendSessionSummary` call once the file exceeds 1000 lines, so after writing entry 1001, the file should have exactly 1000 entries (entries 1-1000, not 0-999)
  **Acceptance**: Test passes, proving rotation works through the real storage API with correct boundary behavior

- [x] 7. **Test: Custom agent name variant registration E2E**
  **What**: Build a custom agent through `createManagers` and verify that `registerAgentNameVariants` was called (by checking that `stripDisabledAgentReferences` correctly strips lines mentioning that custom agent when it's in the disabled set). This validates the registration side-effect of `buildCustomAgent`.
  **Files**: `src/e2e-regression.test.ts`
  **Details**:
  - `describe("E2E Regression: Custom agent name variant registration", () => { ... })`
  - `beforeEach`: create temp dir
  - `afterEach`: rmSync temp dir + cleanup display names
  - Test: `"buildCustomAgent via createManagers registers name variants for stripDisabledAgentReferences"`:
    - Parse config: `{ custom_agents: { "code-reviewer": { prompt: "Review code.", display_name: "Code Reviewer" } } }`
    - Track `"code-reviewer"` for cleanup
    - `createManagers({ ctx: makeMockCtx(testDir), pluginConfig: config })`
    - After building, `registerAgentNameVariants` should have been called with `["code-reviewer", "Code Reviewer"]`
    - Verify by calling `stripDisabledAgentReferences("Use code-reviewer for reviews\nUse Code Reviewer for reviews\nKeep this", new Set(["code-reviewer"]))`
    - Assert result does NOT contain `"code-reviewer"` or `"Code Reviewer"`
    - Assert result contains `"Keep this"`
  - Test: `"custom agent with same name as display_name gets auto-generated variants"`:
    - Parse config: `{ custom_agents: { "helper": { prompt: "Help.", display_name: "helper" } } }`
    - Track `"helper"` for cleanup
    - `createManagers({ ctx: makeMockCtx(testDir), pluginConfig: config })`
    - `const result = stripDisabledAgentReferences("Use helper for tasks\nUse Helper for tasks\nKeep", new Set(["helper"]))`
    - Assert result does NOT contain `"helper"` or `"Helper"`
    - Assert result contains `"Keep"`
  **Acceptance**: Both tests pass, proving the full registration chain `createManagers` → `buildCustomAgent` → `registerAgentNameVariants` → `stripDisabledAgentReferences` works

- [x] 8. **Test: All features combined — overrides + custom agents + disabled agents + fingerprint + analytics**
  **What**: A comprehensive smoke test that combines all configurable features in a single `WeavePlugin()` call via a config file, verifying they all work together without conflicts.
  **Files**: `src/e2e-regression.test.ts`
  **Details**:
  - `describe("E2E Regression: All features combined through WeavePlugin", () => { ... })`
  - `beforeEach`: create temp dir + write project marker files (`tsconfig.json`, `package.json` with react dep, `bun.lockb`)
  - `afterEach`: rmSync temp dir + cleanup display names
  - Test: `"overrides + custom agents + disabled agents + fingerprint + analytics together"`:
    - Write config to `{testDir}/.opencode/weave-opencode.json`:
      ```json
      {
        "agents": { "loom": { "model": "override-test-model" } },
        "custom_agents": {
          "my-specialist": {
            "prompt": "I handle specialized tasks.",
            "display_name": "My Specialist",
            "category": "specialist",
            "cost": "CHEAP"
          }
        },
        "disabled_agents": ["spindle"],
        "analytics": { "enabled": true }
      }
      ```
    - Track `"my-specialist"` for display name cleanup
    - `const plugin = await WeavePlugin(makeMockCtx(testDir))`
    - `const configObj: any = {}; await plugin.config(configObj)`
    - **Agent overrides**: Assert `configObj.agent[getAgentDisplayName("loom")].model` is `"override-test-model"`
    - **Custom agents**: Assert `configObj.agent["My Specialist"]` is defined with prompt containing `"specialized tasks"`
    - **Disabled agents**: Assert `configObj.agent[getAgentDisplayName("spindle")]` is undefined
    - **Non-disabled agents still present**: Assert `configObj.agent[getAgentDisplayName("loom")]` is defined, `configObj.agent[getAgentDisplayName("thread")]` is defined
    - **Fingerprint injection** (because analytics.enabled: true triggers fingerprint): Assert `configObj.agent[getAgentDisplayName("loom")].prompt` contains `<ProjectContext>` and `typescript`
    - **Analytics directory created**: Assert `existsSync(join(testDir, ANALYTICS_DIR))` is `true`
    - **Disabled agent not in Loom prompt**: Assert `configObj.agent[getAgentDisplayName("loom")].prompt` does NOT contain `spindle`
    - **Default agent set**: Assert `configObj.default_agent` is `getAgentDisplayName("loom")`
  **Acceptance**: Single comprehensive test passes, proving all features compose correctly through the real `WeavePlugin()` entry point

## Verification
- [x] `bun test` — all existing 803 tests + ~12 new tests pass (zero failures) → 817 total
- [x] `bun run build` — builds successfully with no type errors
- [x] No temp directories left on disk after test runs
- [x] Each test scenario is independent — can run in isolation with `bun test src/e2e-regression.test.ts`
- [x] No new dependencies introduced
- [x] Existing test files are completely unchanged

## Implementation Notes

### Test File Structure
```
src/e2e-regression.test.ts
├── Shared helpers (makeMockCtx, writeProjectConfig, cleanupCustomDisplayNames)
├── E2E Regression: WeavePlugin full initialization (2 tests)
├── E2E Regression: Analytics opt-in/opt-out (3 tests)
├── E2E Regression: Tracker → JSONL persistence (3 tests)
├── E2E Regression: configDir prompt_file resolution (2 tests)
├── E2E Regression: JSONL rotation through tracker (1 test)
├── E2E Regression: Custom agent name variant registration (2 tests)
└── E2E Regression: All features combined through WeavePlugin (1 test)
```

### Potential Pitfalls
1. **`loadSkills` network call**: `WeavePlugin()` calls `createTools()` which calls `loadSkills({ serverUrl: "http://localhost:3000" })`. This will fail to connect but is designed to be non-fatal. Verify this doesn't cause test failures. If it does, the tests should still work because `loadSkills` returns an empty result on failure.

2. **AGENT_DISPLAY_NAMES global state pollution**: Custom agents register display names in the global `AGENT_DISPLAY_NAMES` map. Tests MUST clean up in `afterEach` by deleting registered keys. The existing `cleanupCustomDisplayNames` pattern handles this.

3. **AGENT_NAME_VARIANTS global state**: `registerAgentNameVariants` adds to a module-level map that is NOT exported. Entries persist across tests. Since `registerAgentNameVariants` is idempotent for builtins (returns early if key exists) and custom agents only add new keys, this is acceptable — but tests should be aware that custom variants registered in earlier tests may still be present. The `registerAgentNameVariants` guard (`if (AGENT_NAME_VARIANTS[name]) return`) means re-registration is harmless.

4. **`registerAgentDisplayName` throws for builtin keys**: If a test accidentally tries to register a display name for a builtin agent key (e.g., "loom"), it will throw. The `buildCustomAgent` function in `createManagers` already skips agents whose key matches a builtin (`if (agents[name] !== undefined) continue`), but `registerAgentDisplayName` itself has a stricter check. Custom agent names must not collide with builtin keys.

5. **JSONL rotation test performance**: Writing 1001 entries in a loop via `appendSessionSummary` involves 1001 file writes + reads for rotation checks. This should complete in <1 second on any modern system but is worth noting.

6. **Temp directory isolation**: Use `mkdtempSync(join(tmpdir(), "weave-e2e-"))` for proper OS-level temp dir isolation, matching the pattern used in other tests. This avoids conflicts with concurrent test runs.

7. **Config handler mutation pattern**: The `plugin.config(configObj)` call mutates `configObj` — it sets `configObj.agent`, `configObj.command`, and `configObj.default_agent`. Tests must pass a plain `{}` object and read properties after the call.
