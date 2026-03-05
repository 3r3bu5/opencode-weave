# Fix PR #12 Review Findings

## TL;DR
> **Summary**: Address 12 findings from the PR #12 review — bugs, missing features, hardcoded references, unbounded growth, and docs. Prioritised by severity: bugs first, then correctness, then polish.
> **Estimated Effort**: Large

## Context
### Original Request
Fix all findings from the PR #12 code review of the opencode-weave project. The PR transformed Weave from hardcoded agents into a configurable framework, and the review surfaced 12 issues ranging from a variable-shadowing bug to unbounded JSONL growth.

### Key Findings
- `plugin-interface.ts` line 230 shadows the outer `args` parameter — confusing but not a runtime bug since outer `args` is destructured at line 28 and never referenced again. Inner `args` is used at lines 232–233 and 261–278. The `tool.execute.after` handler at line 288 already uses `inputArgs` as the variable name — good precedent.
- `createManagers` at line 43 calls `buildCustomAgent(name, customConfig, { resolveSkills, disabledSkills })` without passing `configDir`. The `BuildCustomAgentOptions` interface already has an optional `configDir?: string` field. The config loader resolves config from `~/.config/opencode/weave-opencode.json[c]` or `<project>/.opencode/weave-opencode.json[c]` — the directory containing the *project* config is `join(directory, ".opencode")`.
- Analytics defaults to enabled via `isHookEnabled("analytics")` which returns `true` unless `"analytics"` is in `disabled_hooks`. The `isHookEnabled` function at `index.ts:13` is `(name) => !disabledHooks.has(name)` — a simple negation of membership. To make analytics opt-in, the simplest approach: add `analytics` config section to schema, default `enabled: false`, and check that in `index.ts` instead of (or in addition to) the hook system.
- `ProjectFingerprint` in `types.ts` has no `os` field. `process.platform` and `os.arch()` are available in Node/Bun.
- `isEnabled(name, disabled)` is duplicated identically at `loom/prompt-composer.ts:19` and `tapestry/prompt-composer.ts:14`.
- `AGENT_NAME_VARIANTS` in `agent-builder.ts` is a static `Record` with only builtin names. Custom agents registered via `registerAgentDisplayName` won't have entries, so `stripDisabledAgentReferences` won't strip their names from prompts.
- `buildDelegationNarrationSection()` in `loom/prompt-composer.ts` (line 108) takes no parameters and hardcodes "Pattern", "Spindle", "Weft/Warp", "Thread" in duration hints regardless of which agents are disabled.
- `ensureAnalyticsDir` in `storage.ts` has a TOCTOU race: `existsSync` check + `mkdirSync`. Since `mkdirSync({ recursive: true })` is already a no-op for existing dirs, the check is unnecessary.
- `session-summaries.jsonl` grows unbounded — no size/entry limit.
- Analytics docs at the website describe opt-out behavior; needs updating for opt-in.
- `dotnet` marker in `fingerprint.ts` has `files: []` so file-based detection never fires. `react` detection is done outside the marker loop.
- `getOrCreateFingerprint` is called in `index.ts:16` and again inside `createAnalytics()` at `features/analytics/index.ts:55`.

## Objectives
### Core Objective
Fix all 12 review findings without breaking existing tests or behaviour for users who haven't opted into analytics.

### Deliverables
- [x] All 12 findings addressed with code changes
- [x] Existing tests updated where affected
- [x] New tests added for new behaviour (JSONL rotation, OS fingerprint, opt-in analytics)
- [x] Analytics docs updated on the website

### Definition of Done
- [x] `bun test` passes with no failures
- [x] `bun run build` succeeds with no errors
- [x] Analytics is opt-in (disabled by default, enabled via config)
- [x] No CodeQL variable-shadowing warnings on `plugin-interface.ts`

### Guardrails (Must NOT)
- Must NOT change the external behaviour for users with no config file (analytics was on by default → now off by default; this is intentional)
- Must NOT break any existing agent prompt output when no agents are disabled
- Must NOT introduce breaking changes to the `WeaveConfig` schema (new fields are additive)
- Must NOT modify test infrastructure or test helpers

## TODOs

### Group A: Bugs & Correctness (P0)

- [x] 1. Fix `args` variable shadowing in `plugin-interface.ts`
  **What**: Rename the inner `const args` at line 230 to `const toolArgs` to match the naming convention used in the `tool.execute.after` handler at line 288 (`inputArgs`). Update all references within the `tool.execute.before` handler (lines 231–282) that use `args` to use `toolArgs` instead.
  **Files**: `src/plugin/plugin-interface.ts`
  **Changes**:
  - Line 230: `const args = _output.args ...` → `const toolArgs = _output.args ...`
  - Lines 232–233: `args?.file_path` / `args?.path` → `toolArgs?.file_path` / `toolArgs?.path`
  - Line 261: `if (input.tool === "task" && args)` → `if (input.tool === "task" && toolArgs)`
  - Lines 263–264: `args.subagent_type` / `args.description` → `toolArgs.subagent_type` / `toolArgs.description`
  - Line 276: `if (tracker && hooks.analyticsEnabled) {` block — `args` references at lines 276–278 → `toolArgs`
  **Acceptance**: No variable named `args` inside the `tool.execute.before` handler. `bun test` passes. Grep for `const args` inside `plugin-interface.ts` returns only the outer function parameter usage (if any).

- [x] 2. Wire `configDir` through `createManagers` to `buildCustomAgent`
  **What**: The config loader knows where the project config file lives (`join(directory, ".opencode")`). Pass this directory through to `buildCustomAgent` so `prompt_file` paths resolve relative to the config directory, not `process.cwd()`.
  **Files**: `src/create-managers.ts`, `src/index.ts`
  **Changes**:
  - In `src/index.ts`: The `loadWeaveConfig` call at line 11 uses `ctx.directory`. The config is loaded from `join(directory, ".opencode", "weave-opencode.json[c]")`, so the config directory is `join(ctx.directory, ".opencode")`. Pass a new field `configDir: join(ctx.directory, ".opencode")` when calling `createManagers`.
  - In `src/create-managers.ts`:
    - Add `configDir?: string` to the options object at line 19.
    - Destructure it at line 25.
    - Pass it at line 43: `buildCustomAgent(name, customConfig, { resolveSkills, disabledSkills: ..., configDir })`.
  **Acceptance**: When a custom agent config has `prompt_file: "prompts/my-agent.md"`, it resolves relative to the `.opencode/` directory (or project root — pick the one that makes most sense for users; the config *file* lives in `.opencode/` so resolving relative to that directory is correct). `bun test` passes.

- [x] 3. Fix TOCTOU race in `storage.ts`
  **What**: Remove the `existsSync(dir)` check in `ensureAnalyticsDir` — just call `mkdirSync(dir, { recursive: true, mode: 0o700 })` directly. `recursive: true` makes `mkdirSync` a no-op if the directory already exists.
  **Files**: `src/features/analytics/storage.ts`
  **Changes**:
  - Lines 12–14: Replace `if (!existsSync(dir)) { mkdirSync(dir, { recursive: true, mode: 0o700 }) }` with just `mkdirSync(dir, { recursive: true, mode: 0o700 })`.
  - The `existsSync` import can be removed from line 1 if no other usages remain (check: `readSessionSummaries` at line 41 and `readFingerprint` at line 80 still use `existsSync`).
  **Acceptance**: `ensureAnalyticsDir` no longer has a TOCTOU race. Existing tests in `storage.test.ts` still pass (the idempotency test at line 61 should still work).

- [x] 4. Fix duplicated fingerprint loading in `index.ts`
  **What**: `getOrCreateFingerprint` is called at `index.ts:16` and again inside `createAnalytics()` at `features/analytics/index.ts:55`. Remove the duplicate.
  **Files**: `src/index.ts`, `src/features/analytics/index.ts`
  **Changes**:
  - Option A (preferred — simpler): Modify `createAnalytics` to accept an optional `fingerprint` parameter. If provided, use it; if not, call `getOrCreateFingerprint`.
    - In `src/features/analytics/index.ts`: Change signature to `createAnalytics(directory: string, fingerprint?: ProjectFingerprint | null): Analytics`. Use `fingerprint ?? getOrCreateFingerprint(directory)` for the fingerprint field.
    - In `src/index.ts`: Pass `fingerprint` to `createAnalytics(ctx.directory, fingerprint)` at line 23.
  **Acceptance**: `getOrCreateFingerprint` is called exactly once per plugin init (not twice). `bun test` passes.

### Group B: Analytics Opt-In (P1)

- [x] 5. Add analytics config section to schema
  **What**: Add an `analytics` field to `WeaveConfigSchema` with an `enabled` boolean that defaults to `false`.
  **Files**: `src/config/schema.ts`
  **Changes**:
  - Add a new schema:
    ```
    export const AnalyticsConfigSchema = z.object({
      enabled: z.boolean().optional(),
    })
    ```
  - Add to `WeaveConfigSchema`: `analytics: AnalyticsConfigSchema.optional()`
  - Add type export: `export type AnalyticsConfig = z.infer<typeof AnalyticsConfigSchema>`
  **Acceptance**: `WeaveConfigSchema.parse({ analytics: { enabled: true } })` succeeds. `WeaveConfigSchema.parse({})` succeeds with `analytics` as `undefined`.

- [x] 6. Make analytics opt-in in `index.ts`
  **What**: Change the analytics enabled check from `isHookEnabled("analytics")` (opt-out) to `pluginConfig.analytics?.enabled === true` (opt-in). This makes analytics off by default.
  **Files**: `src/index.ts`
  **Changes**:
  - Line 16: Change `isHookEnabled("analytics") ? getOrCreateFingerprint(ctx.directory) : null` to `pluginConfig.analytics?.enabled === true ? getOrCreateFingerprint(ctx.directory) : null`
  - Line 23: Change `isHookEnabled("analytics") ? createAnalytics(ctx.directory, fingerprint) : null` to `pluginConfig.analytics?.enabled === true ? createAnalytics(ctx.directory, fingerprint) : null`
  - The `isHookEnabled("analytics")` check on the `hooks.analyticsEnabled` property in `create-hooks.ts` line 64 should also be updated:
    - Either pass `analyticsEnabled` as a direct boolean to `createHooks` (cleaner), or
    - Keep `isHookEnabled("analytics")` for the hooks but make it consistent — the entry point in `index.ts` is the gatekeeper.
  - Actually, the cleanest approach: keep `hooks.analyticsEnabled` driven by `isHookEnabled("analytics")` since that controls whether the plugin-interface tracks tool calls. But the *gatekeeper* for creating the analytics services should be `pluginConfig.analytics?.enabled === true`. Update `isHookEnabled` to treat `"analytics"` specially: it's enabled only if `pluginConfig.analytics?.enabled === true`, regardless of `disabled_hooks`.
  - Simplest consistent approach:
    - In `index.ts`, define `const analyticsEnabled = pluginConfig.analytics?.enabled === true`
    - Use `analyticsEnabled` for both fingerprint creation (line 16) and analytics creation (line 23)
    - Pass `analyticsEnabled` as a field into `createHooks` args (or override `isHookEnabled` for "analytics")
    - In `create-hooks.ts`, accept an optional `analyticsEnabled?: boolean` and use it for line 64 instead of `isHookEnabled("analytics")`
  **Files**: `src/index.ts`, `src/hooks/create-hooks.ts`
  **Acceptance**: With no config, analytics is disabled. With `{ analytics: { enabled: true } }`, analytics is enabled. The old `disabled_hooks: ["analytics"]` pattern still works as a secondary override (if `enabled: true` but also in `disabled_hooks`, it should be disabled — but this is a minor edge case; document that `analytics.enabled` is the canonical toggle). `bun test` passes.

- [x] 7. Update `create-hooks.test.ts` for analytics opt-in
  **What**: Update tests that check `analyticsEnabled` to reflect the new opt-in behaviour.
  **Files**: `src/hooks/create-hooks.test.ts`
  **Changes**:
  - Add test: `analyticsEnabled` defaults to `false` when no `analyticsEnabled` override is passed.
  - Add test: `analyticsEnabled` is `true` when `analyticsEnabled: true` is passed to `createHooks`.
  - Update any existing tests that assume analytics is enabled by default.
  **Acceptance**: `bun test src/hooks/create-hooks.test.ts` passes.

### Group C: Fingerprint Improvements (P1)

- [x] 8. Add OS detection to fingerprint
  **What**: Add `os` and `arch` fields to `ProjectFingerprint`. Populate them using `process.platform` and `os.arch()`.
  **Files**: `src/features/analytics/types.ts`, `src/features/analytics/fingerprint.ts`, `src/agents/dynamic-prompt-builder.ts`
  **Changes**:
  - In `types.ts`, add to `ProjectFingerprint` interface:
    ```
    /** Operating system (e.g., "darwin", "win32", "linux") */
    os?: string
    /** CPU architecture (e.g., "arm64", "x64") */
    arch?: string
    ```
  - In `fingerprint.ts`:
    - Add `import { arch } from "os"` at top.
    - In `generateFingerprint()`, add `os: process.platform` and `arch: arch()` to the returned object.
  - In `dynamic-prompt-builder.ts`, in `buildProjectContextSection()`:
    - After the monorepo check (~line 322), add:
      ```
      if (fingerprint.os) {
        const archSuffix = fingerprint.arch ? ` (${fingerprint.arch})` : ""
        parts.push(`Platform: ${fingerprint.os}${archSuffix}.`)
      }
      ```
  **Acceptance**: `generateFingerprint("/some/dir")` returns an object with `os` and `arch` fields. `buildProjectContextSection` includes "Platform: darwin (arm64)" (or equivalent) in its output. Update `fingerprint.test.ts` with a test for the new fields. `bun test` passes.

- [x] 9. Fix dotnet and react fingerprint detection gaps
  **What**: The `dotnet` marker has `files: []` so file-based detection never fires. Add `.csproj` and `.fsproj` glob patterns. The `react` detection is done as a special case outside the marker loop — this is fine architecturally (it needs to parse `package.json`) but the marker's `files: []` is misleading.
  **Files**: `src/features/analytics/fingerprint.ts`
  **Changes**:
  - For `dotnet` marker (line 81–85): Change `files: []` to `files: ["*.sln"]`. Note: The current detection loop uses `existsSync(join(directory, file))` which doesn't support globs. So we can't use `*.csproj` directly. Instead:
    - Add common dotnet files to the `files` array: something detectable at root level. `.sln` files are the most common root-level dotnet marker. But `existsSync` needs exact names. The best approach: add a post-loop check (similar to the react check) that scans for `.csproj`/`.fsproj` files using `readdirSync` + filter, OR add `global.json`, `Directory.Build.props` as exact-name markers that dotnet projects commonly have.
    - Simplest fix: Add `"global.json", "Directory.Build.props", "Directory.Packages.props"` to the `files` array for dotnet. These are common dotnet convention files. Also add a post-loop check similar to the react one: scan `readdirSync(directory)` for files ending in `.csproj`, `.fsproj`, or `.sln`.
  - For `react` marker: Add a comment to the `files: []` marker explaining that react detection is handled specially below via `package.json` parsing (lines 124–140). This is documentation, not a code change.
  **Acceptance**: A directory containing `global.json` or a `.csproj`/`.fsproj`/`.sln` file is detected as dotnet. Add tests in `fingerprint.test.ts`. `bun test` passes.

### Group D: Prompt Cleanup (P2)

- [x] 10. Extract shared `isEnabled` helper
  **What**: The identical `function isEnabled(name: string, disabled: Set<string>): boolean { return !disabled.has(name) }` appears in both `loom/prompt-composer.ts` (line 19) and `tapestry/prompt-composer.ts` (line 14). Extract to a shared location.
  **Files**: `src/agents/prompt-utils.ts` (new file), `src/agents/loom/prompt-composer.ts`, `src/agents/tapestry/prompt-composer.ts`
  **Changes**:
  - Create `src/agents/prompt-utils.ts` with:
    ```typescript
    /** Check whether an agent is enabled (not in the disabled set). */
    export function isAgentEnabled(name: string, disabled: Set<string>): boolean {
      return !disabled.has(name)
    }
    ```
    (Use `isAgentEnabled` to be more descriptive than just `isEnabled`)
  - In `loom/prompt-composer.ts`:
    - Remove the local `isEnabled` function (line 19–21).
    - Add import: `import { isAgentEnabled } from "../prompt-utils"`.
    - Replace all calls to `isEnabled(` with `isAgentEnabled(` throughout the file.
  - In `tapestry/prompt-composer.ts`:
    - Remove the local `isEnabled` function (line 14–16).
    - Add import: `import { isAgentEnabled } from "../prompt-utils"`.
    - Replace all calls to `isEnabled(` with `isAgentEnabled(` throughout the file.
  **Acceptance**: No duplicate `isEnabled` functions. Both prompt-composer files import from the shared utility. `bun test src/agents/loom/prompt-composer.test.ts` and `bun test src/agents/tapestry/prompt-composer.test.ts` pass.

- [x] 11. Make `AGENT_NAME_VARIANTS` extensible for custom agents
  **What**: `stripDisabledAgentReferences` only knows builtin agent names. Custom agents registered via config won't be stripped from prompts when disabled.
  **Files**: `src/agents/agent-builder.ts`
  **Changes**:
  - Make `AGENT_NAME_VARIANTS` mutable (it already is, as a `const` object — just add a registration function).
  - Add a function:
    ```typescript
    export function registerAgentNameVariants(name: string, variants?: string[]): void {
      if (AGENT_NAME_VARIANTS[name]) return // don't override builtins
      // Auto-generate variants: lowercase + Title Case
      const titleCase = name.charAt(0).toUpperCase() + name.slice(1)
      AGENT_NAME_VARIANTS[name] = variants ?? [name, titleCase]
    }
    ```
  - In `src/agents/custom-agent-factory.ts`, after `registerAgentDisplayName(name, displayName)` at line 105:
    - Add import: `import { registerAgentNameVariants } from "./agent-builder"`
    - Call: `registerAgentNameVariants(name, displayName !== name ? [name, displayName] : undefined)`
  **Acceptance**: Custom agents have name variants registered. `stripDisabledAgentReferences` strips custom agent names when they're in the disabled set. Add a test in `agent-builder.test.ts`. `bun test` passes.

- [x] 12. Make `buildDelegationNarrationSection` conditional on enabled agents
  **What**: Duration hints in `buildDelegationNarrationSection()` hardcode "Pattern", "Spindle", "Weft/Warp", "Thread" even when those agents are disabled.
  **Files**: `src/agents/loom/prompt-composer.ts`
  **Changes**:
  - Change signature: `buildDelegationNarrationSection(disabled: Set<string>): string`
  - Import `isAgentEnabled` from `../prompt-utils` (after task 10 is done).
  - Make each duration hint line conditional:
    ```typescript
    const hints: string[] = []
    if (isAgentEnabled("pattern", disabled)) {
      hints.push('- Pattern (planning): "This may take a moment — Pattern is researching the codebase and writing a detailed plan..."')
    }
    if (isAgentEnabled("spindle", disabled)) {
      hints.push('- Spindle (web research): "Spindle is fetching external docs — this may take a moment..."')
    }
    if (isAgentEnabled("weft", disabled) || isAgentEnabled("warp", disabled)) {
      hints.push('- Weft/Warp (review): "Running review — this will take a moment..."')
    }
    if (isAgentEnabled("thread", disabled)) {
      hints.push('- Thread (exploration): Fast — no duration hint needed.')
    }
    const hintsBlock = hints.length > 0
      ? `\nDURATION HINTS — tell the user when something takes time:\n${hints.join("\n")}`
      : ""
    ```
  - Update the call in `composeLoomPrompt` (line 280): `buildDelegationNarrationSection(disabled)`
  **Acceptance**: When pattern is disabled, its duration hint doesn't appear in the Loom prompt. Update `loom/prompt-composer.test.ts` with a test. `bun test` passes.

### Group E: Unbounded Growth Fix (P2)

- [x] 13. Add JSONL entry limit to `appendSessionSummary`
  **What**: `session-summaries.jsonl` grows forever. Add a rotation mechanism.
  **Files**: `src/features/analytics/storage.ts`
  **Changes**:
  - Add a constant: `const MAX_SESSION_ENTRIES = 1000`
  - After appending in `appendSessionSummary`, check the file size or entry count. The simplest approach:
    - After `appendFileSync`, read the file, count lines. If > `MAX_SESSION_ENTRIES`, keep only the last `MAX_SESSION_ENTRIES` entries and rewrite the file.
    - Performance-conscious alternative: Only check every Nth append (e.g., every 50th). Use a simple modulo on the number of lines.
    - Simplest correct approach:
      ```typescript
      // Rotate if needed — check line count after append
      try {
        const content = readFileSync(filePath, "utf-8")
        const lines = content.split("\n").filter((l) => l.trim().length > 0)
        if (lines.length > MAX_SESSION_ENTRIES) {
          const trimmed = lines.slice(-MAX_SESSION_ENTRIES).join("\n") + "\n"
          writeFileSync(filePath, trimmed, "utf-8")
        }
      } catch {
        // rotation failure is non-fatal
      }
      ```
  - Export `MAX_SESSION_ENTRIES` for testing.
  **Acceptance**: After appending the 1001st entry, the file contains exactly 1000 entries (the most recent). Add a test in `storage.test.ts` that writes 1005 entries and verifies only 1000 remain. `bun test` passes.

### Group F: Documentation (P3)

- [x] 14. Update analytics documentation for opt-in behaviour
  **What**: Current docs say analytics is on by default and show `disabled_hooks` to turn it off. Update to reflect opt-in.
  **Files**: `/Users/pgermishuys/source/weave-website/docs-src/guide/analytics.md`
  **Changes**:
  - Update the intro paragraph: remove "automatically" — change to explain analytics is opt-in.
  - Update the "Disabling Analytics" section → rename to "Enabling Analytics" and show:
    ```jsonc
    {
      "analytics": {
        "enabled": true
      }
    }
    ```
  - Keep the privacy notice and `.gitignore` section.
  - Add mention of new data collected: OS platform and architecture in the fingerprint.
  - Update the example fingerprint JSON to include `"os": "darwin"` and `"arch": "arm64"`.
  - Add a note about session summary rotation (max 1000 entries).
  - Mention that `disabled_hooks: ["analytics"]` still works as a secondary override.
  - Update the "Detected technologies" line if the dotnet detection improvements (task 9) add new markers.
  **Acceptance**: Documentation accurately reflects opt-in behaviour. Example config shows how to enable analytics.

## Implementation Order

```
Group A (Bugs):       1 → 2 → 3 → 4     (independent, can be done in any order)
Group B (Opt-in):     5 → 6 → 7          (sequential — schema first, then usage, then tests)
Group C (Fingerprint): 8, 9              (independent of each other, depend on nothing)
Group D (Prompts):    10 → 11, 12        (10 first since 12 imports from it; 11 is independent)
Group E (Growth):     13                  (independent)
Group F (Docs):       14                  (depends on 5, 6, 8, 9, 13 being done)
```

Recommended execution order: A → B → C → D → E → F (bugs first, docs last).

## Verification
- [x] `bun test` — all tests pass (no regressions)
- [x] `bun run build` — build succeeds with no errors
- [x] Manual check: default config (no `analytics` section) → no `.weave/analytics/` directory created
- [x] Manual check: `{ "analytics": { "enabled": true } }` → analytics works as before
- [x] Grep for `const args` in `plugin-interface.ts` — should not appear inside `tool.execute.before`
- [x] Grep for `existsSync` in `ensureAnalyticsDir` — should not appear
- [x] Grep for `isEnabled` in `loom/prompt-composer.ts` and `tapestry/prompt-composer.ts` — should only appear as import, not as local function
