# Skill Loading: OpenCode SDK Integration

## TL;DR
> **Summary**: Replace Weave's custom filesystem skill scanning with OpenCode's `GET /skill` API (v2 SDK `app.skills()`), removing the `weave-opencode/skills/` user directory and dead config code. Weave keeps its agent-specific skill injection — it just sources skills from OpenCode instead of scanning the filesystem itself.
> **Estimated Effort**: Medium

## Context

### Original Request
Weave currently scans two filesystem paths for skills:
1. `<project>/.opencode/skills/` (project scope)
2. `~/.config/opencode/weave-opencode/skills/` (user scope)

This duplicates OpenCode's own skill discovery. The decision is to:
1. Replace filesystem scanning with OpenCode's SDK skill API
2. Keep Weave's agent-specific skill assignment (config-driven: `agents.tapestry.skills: ["verify-steps"]`)
3. Keep existing override skill resolution in `builtin-agents.ts` (commit `62765f1`) — it's independent of how skills are discovered

### Key Findings

**SDK situation**: The `skills()` API is only available on the **v2 SDK** (`@opencode-ai/sdk/v2`). The v1 `OpencodeClient` (which `ctx.client` is typed as via `@opencode-ai/plugin`) has `app.agents()` and `app.log()` but **no `app.skills()`**.

**The `/skill` endpoint**: Under the hood, `app.skills()` is just `GET /skill?directory=<dir>` returning:
```typescript
Array<{
  name: string
  description: string
  location: string
  content: string
}>
```

**Three approaches** to call the skills API:
1. **Import v2 `createOpencodeClient`** from `@opencode-ai/sdk/v2/client` and create a v2 client pointing at `ctx.serverUrl`. This is cleanest but adds a v2 dependency.
2. **Direct HTTP fetch** to `${ctx.serverUrl}/skill?directory=${ctx.directory}`. Simplest, no new imports, but bypasses SDK patterns.
3. **Cast `ctx.client` and hope v1 client has the method at runtime** — fragile, not recommended.

**Recommendation**: Use approach **2 (direct fetch)** wrapped in a thin helper. The endpoint is trivial (`GET /skill`), the response shape is simple, and it avoids coupling to a different SDK version than the plugin system expects. Wrap it in a `fetchSkillsFromOpenCode(serverUrl, directory)` function for testability.

**Current flow** (sync):
```
index.ts → createTools() → loadSkills() [sync FS scan] → createSkillResolver() → resolveSkillsFn
         → createManagers(resolveSkillsFn) → createBuiltinAgents(resolveSkills) → agents
```

**New flow** (async):
```
index.ts → fetchSkillsFromOpenCode(serverUrl, directory) [async HTTP] → createSkillResolver() → resolveSkillsFn
         → createManagers(resolveSkillsFn) → createBuiltinAgents(resolveSkills) → agents
```

The plugin entry point (`WeavePlugin`) is already `async`, and `createTools()` already returns `Promise<ToolsResult>`, so the async barrier is not a problem.

**Dead code identified**:
- `SkillsConfigSchema` / `SkillsConfig` in `src/config/schema.ts` — defined but never imported anywhere
- `weave-opencode/skills/` user path in `loader.ts` — being removed
- `discovery.ts` `scanDirectory()` and `parseFrontmatter()` — no longer needed (OpenCode parses the files)
- `merger.ts` `mergeSkills()` — no longer needed (OpenCode handles priority)
- `builtin-skills.ts` `createBuiltinSkills()` — returns empty array, vestigial

**Code to preserve**:
- `resolver.ts` — `createSkillResolver()` and `resolveMultipleSkills()` still needed (maps skill names → content for agent prompt injection)
- `agent-builder.ts` — skill injection into prompts, untouched
- `builtin-agents.ts` — override skill resolution from commit `62765f1`, works as-is (uses `resolveSkills` which is source-agnostic)

## Objectives

### Core Objective
Replace Weave's filesystem-based skill discovery with OpenCode's `GET /skill` API while preserving agent-specific skill injection and existing override skill resolution.

### Deliverables
- [x] New `fetchSkillsFromOpenCode()` function that calls `GET /skill`
- [x] Refactored `createTools()` using the new SDK-based discovery
- [x] Removal of filesystem scanning code (`discovery.ts`, `merger.ts`, `builtin-skills.ts`)
- [x] Removal of dead config schema (`SkillsConfigSchema`, `SkillsConfig`, `skills` field in `WeaveConfigSchema`)
- [x] Updated tests for the new skill loading path
- [x] Clean build with no warnings

### Definition of Done
- [x] `bun run build` succeeds with no errors or warnings
- [x] `bun test` passes all tests
- [x] No references to `weave-opencode/skills/` remain in source code
- [x] No filesystem scanning (`fs.readdirSync`, `fs.readFileSync`) in skill-loader code
- [x] Skills are fetched via HTTP from OpenCode's API

### Guardrails (Must NOT)
- Must NOT change how agents declare their skill requirements (`skills: ["name"]` in agent config/factories)
- Must NOT change how skills are injected into agent prompts (`agent-builder.ts` prepend logic)
- Must NOT remove the `disabled_skills` config — it still filters SDK results
- Must NOT touch existing override skill resolution in `builtin-agents.ts` — it works as-is

## TODOs

- [x] 1. **Create `fetchSkillsFromOpenCode()` helper**
  **What**: Create a new file `src/features/skill-loader/opencode-client.ts` with a function that fetches skills from OpenCode's HTTP API. This replaces the filesystem scanning.
  ```typescript
  // Shape of the response from GET /skill
  interface OpenCodeSkill {
    name: string
    description: string
    location: string
    content: string
  }

  export async function fetchSkillsFromOpenCode(
    serverUrl: string | URL,
    directory: string,
  ): Promise<LoadedSkill[]> {
    // GET ${serverUrl}/skill?directory=${directory}
    // Map OpenCodeSkill[] → LoadedSkill[]
    // Scope: derive from location (contains ".opencode" → project, else user)
    // Graceful fallback: if fetch fails, log warning and return []
  }
  ```
  **Files**: Create `src/features/skill-loader/opencode-client.ts`
  **Acceptance**: Unit test in `src/features/skill-loader/opencode-client.test.ts` verifying the mapping logic and error handling.
  **Risk**: The OpenCode server might not be running during tests. Mock the fetch call. Also need to handle the case where the endpoint doesn't exist (older OpenCode versions) — return empty array gracefully.

- [x] 2. **Refactor `loader.ts` to use SDK instead of filesystem scanning**
  **What**: Change `loadSkills()` from sync to async. Replace filesystem scanning with a call to `fetchSkillsFromOpenCode()`. Remove the `scanDirectory()` and `mergeSkills()` calls. Keep the `disabledSkills` filtering.
  ```typescript
  // Before (sync):
  export function loadSkills(options): SkillDiscoveryResult { ... }

  // After (async):
  export async function loadSkills(options): Promise<SkillDiscoveryResult> {
    const skills = await fetchSkillsFromOpenCode(options.serverUrl, options.directory)
    if (disabledSkills.length === 0) return { skills }
    const disabledSet = new Set(disabledSkills)
    return { skills: skills.filter(s => !disabledSet.has(s.name)) }
  }
  ```
  **Files**: Modify `src/features/skill-loader/loader.ts`
  **Acceptance**: `loadSkills()` is async and no longer imports from `discovery.ts` or `merger.ts`.
  **Note**: `LoadSkillsOptions` needs a new `serverUrl` field (was `directory` only).

- [x] 3. **Update `createTools()` to pass `serverUrl`**
  **What**: Pass `ctx.serverUrl` through to `loadSkills()`. The function is already async so no structural change needed.
  ```typescript
  const skillResult = await loadSkills({
    serverUrl: ctx.serverUrl.toString(),
    directory: ctx.directory ?? process.cwd(),
    disabledSkills: pluginConfig.disabled_skills ?? [],
  })
  ```
  **Files**: Modify `src/create-tools.ts`
  **Acceptance**: `createTools()` passes serverUrl to loadSkills and awaits the result.

- [x] 4. **Update `index.ts` to pass `serverUrl` in ctx flow**
  **What**: Ensure `ctx.serverUrl` is available in the `createTools()` call. Currently `createTools` receives `{ ctx, pluginConfig }` and `ctx` already has `serverUrl`, so this may require no change — just verify.
  **Files**: Verify `src/index.ts` (likely no change needed)
  **Acceptance**: Type-check passes.

- [x] 5. **Delete dead filesystem scanning files**
  **What**: Remove files that are no longer needed:
  - `src/features/skill-loader/discovery.ts` — filesystem scanning, replaced by SDK
  - `src/features/skill-loader/discovery.test.ts` — tests for removed code
  - `src/features/skill-loader/merger.ts` — priority merging, OpenCode handles this
  - `src/features/skill-loader/builtin-skills.ts` — returns `[]`, vestigial
  **Files**: Delete the 4 files listed above
  **Acceptance**: No imports of these files remain in the codebase. Build succeeds.

- [x] 6. **Update `index.ts` barrel exports**
  **What**: Update `src/features/skill-loader/index.ts` to remove exports of deleted modules (`scanDirectory`, `parseFrontmatter`, `mergeSkills`, `createBuiltinSkills`). Add export for new `fetchSkillsFromOpenCode`.
  **Files**: Modify `src/features/skill-loader/index.ts`
  **Acceptance**: Only valid exports remain. No broken imports.

- [x] 7. **Clean up `types.ts` — remove `SkillScope`**
  **What**: The `SkillScope` type (`"builtin" | "user" | "project"`) was used for filesystem-based priority merging. With SDK-based loading, we may still want to keep `scope` on `LoadedSkill` for logging/debugging but derive it from the `location` field returned by the API. Alternatively, simplify `LoadedSkill` to drop `scope` entirely since merging is no longer our responsibility. Decision: keep `scope` but make it optional, derive it in `fetchSkillsFromOpenCode()` from the `location` field.
  **Files**: Modify `src/features/skill-loader/types.ts`
  **Acceptance**: `SkillScope` type is retained but `LoadedSkill.scope` is optional.
  **Risk**: Check if anything reads `skill.scope` elsewhere — search for `.scope` usage in skill-related code.

- [x] 8. **Remove dead config schema code**
  **What**: Remove `SkillsConfigSchema`, `SkillsConfig` type export, and the `skills: SkillsConfigSchema.optional()` field from `WeaveConfigSchema`. These are defined but never used anywhere in the codebase.
  **Files**: Modify `src/config/schema.ts`
  **Acceptance**: No `SkillsConfig` references remain. `WeaveConfig` type no longer has a `skills` field. Build succeeds.

- [x] 9. **Update `loader.test.ts` for async + SDK-based loading**
  **What**: Rewrite the loader tests to mock `fetchSkillsFromOpenCode()` instead of creating temp directories with SKILL.md files. Tests should verify:
  - Returns skills from the SDK response
  - Filters disabled skills
  - Handles empty response
  - Handles fetch errors gracefully (returns empty array)
  **Files**: Modify `src/features/skill-loader/loader.test.ts`
  **Acceptance**: All loader tests pass with mocked HTTP responses.

- [x] 10. **Update `resolver.test.ts` (if needed)**
  **What**: The resolver tests use `makeSkill()` helpers that set `scope`. If `scope` becomes optional, update the helpers. Otherwise these tests should pass unchanged since they don't depend on how skills are discovered.
  **Files**: Verify `src/features/skill-loader/resolver.test.ts` (likely minimal changes)
  **Acceptance**: All resolver tests pass.

- [x] 11. **Verify build and full test suite**
  **What**: Run `bun run build` and `bun test` to confirm everything compiles and passes.
  **Files**: None (verification step)
  **Acceptance**: `bun run build` exits 0 with no warnings. `bun test` shows all tests passing.

## Execution Order

```
1. Create opencode-client.ts (new SDK helper)
2. Refactor loader.ts (sync → async, use SDK helper)
3. Update create-tools.ts (pass serverUrl)
4. Verify index.ts (should work as-is)
5. Delete dead files (discovery.ts, merger.ts, builtin-skills.ts)
6. Update index.ts barrel exports
7. Simplify types.ts
8. Remove dead config schema
9. Update loader.test.ts
10. Update resolver.test.ts
11. Final build + test verification
```

Steps 1-4 form the core refactor and should be done together.
Steps 5-8 are cleanup and can be done in parallel.
Step 11 is the final gate.

Note: The existing override skill resolution in `builtin-agents.ts` (commit `62765f1`) is left untouched — it uses `resolveSkills()` which is source-agnostic and works regardless of whether skills come from the filesystem or the SDK.

## Verification
- [x] `bun run build` succeeds with no errors/warnings
- [x] `bun test` passes all tests
- [x] `grep -r "weave-opencode/skills" src/` returns no results
- [x] `grep -r "scanDirectory\|readdirSync" src/features/skill-loader/` returns no results
- [x] `grep -r "SkillsConfigSchema" src/` returns no results (except in tests if needed)
- [x] Skills are fetched via `GET /skill` endpoint (verified by test mock or integration test)
- [x] Agent skill injection still works: config `agents.pattern.skills: ["test-skill"]` resolves correctly

## Open Questions

1. **v2 SDK vs raw fetch**: This plan recommends raw fetch for simplicity. If the team prefers using the v2 SDK client (`@opencode-ai/sdk/v2`), the `fetchSkillsFromOpenCode()` function would instead create a v2 `OpencodeClient` and call `client.app.skills()`. The trade-off: cleaner SDK usage vs importing a different SDK version than the plugin system uses.

2. **Fallback for older OpenCode versions**: If the `/skill` endpoint doesn't exist (404), should we fall back to filesystem scanning? This plan says no — if OpenCode doesn't support the endpoint, skills simply won't load, and a warning is logged. This keeps the code simple.

3. **`scope` field**: With SDK-based loading, the `scope` distinction (project/user/builtin) becomes less important since OpenCode handles merging. We could remove `scope` entirely from `LoadedSkill`. This plan keeps it as optional for debugging purposes.
