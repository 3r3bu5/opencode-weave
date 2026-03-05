# Loom Dynamic Delegation — Wire Custom Agent Triggers into Loom's Prompt

## TL;DR
> **Summary**: Wire the existing dynamic prompt builder functions (`buildDelegationTable()`, `buildToolSelectionTable()`, `buildKeyTriggersSection()`) into `composeLoomPrompt()` so that custom agents defined in `weave-opencode.json` appear in Loom's delegation instructions alongside the 8 builtins.
> **Estimated Effort**: Short

## Context

### Original Request
Custom agents defined in `weave-opencode.json` with `triggers` are registered in the agent map and have metadata stored via `registerCustomAgentMetadata()`, but Loom's system prompt is never updated to include them. The dynamic prompt builder functions exist and are tested — they just aren't called from `composeLoomPrompt()`.

### Key Findings

1. **The timing problem**: `LOOM_DEFAULTS.prompt` is computed at module-load time via `composeLoomPrompt()` with no arguments. Custom agents are registered later during `createManagers()`. However, when custom agents exist, `createBuiltinAgents()` calls `createLoomAgentWithOptions(model, disabledSet, fingerprint)` which re-composes the prompt — this is the correct injection point.

2. **Data flow gap**: `createLoomAgentWithOptions()` receives `disabledAgents` and `fingerprint`, but does NOT receive custom agent metadata. The `composeLoomPrompt()` function's `LoomPromptOptions` interface has no field for custom agent data. The metadata lives in the module-level `CUSTOM_AGENT_METADATA` map in `builtin-agents.ts`.

3. **Two approaches** for getting metadata into the prompt:
   - **Option A (parameter passing)**: Add a `customAgents` field to `LoomPromptOptions`, thread it from `createBuiltinAgents()` → `createLoomAgentWithOptions()` → `composeLoomPrompt()`. Clean, testable, no global state dependency.
   - **Option B (read global)**: Have `composeLoomPrompt()` import `getAllAgentMetadata()` and extract custom agents by diffing against `AGENT_METADATA` keys. Simpler call chain but couples prompt composition to global mutable state.

   **Decision: Option A (parameter passing)** — it's more explicit, easier to test, and avoids hidden dependencies on mutation order.

4. **Existing dynamic builder functions** are ready to consume `AvailableAgent[]`:
   - `buildDelegationTable(agents)` — formats triggers as `**Domain** → \`agent-name\` — trigger text`
   - `buildToolSelectionTable(agents, tools, skills)` — formats cost-sorted agent table
   - `buildKeyTriggersSection(agents, skills)` — formats key triggers for Phase 0 checks
   These functions are already tested in `dynamic-prompt-builder.test.ts`.

5. **The `buildDelegationSection()` in prompt-composer.ts** is the hardcoded builtin delegation section using `isAgentEnabled()` checks. The dynamic `buildDelegationTable()` from `dynamic-prompt-builder.ts` is a separate, additive section. They serve different purposes:
   - `buildDelegationSection()` — prescriptive rules (e.g., "Use thread for fast codebase exploration")
   - `buildDelegationTable()` — tabular trigger mapping (e.g., "**Code Review** → `code-reviewer` — Quality review...")

6. **Where to place custom sections**: After `buildDelegationSection()` and before `buildPlanWorkflowSection()`. This keeps builtins as the baseline and adds custom agents as extensions.

7. **Disabled agents filtering**: `disabledAgents` set is already passed through. Custom agents are pre-filtered in `createManagers()` (skipped if in `disabledSet`), so metadata is never registered for disabled custom agents. However, `composeLoomPrompt()` should still filter the passed-in metadata against `disabledAgents` for safety.

## Objectives

### Core Objective
Make Loom aware of custom agent triggers so it can delegate to them appropriately.

### Deliverables
- [x] Custom agent triggers appear in Loom's system prompt when configured
- [x] No prompt change when no custom agents are configured (zero-custom-agents invariant)
- [x] Custom agents respect `disabled_agents` filtering
- [x] All existing tests continue to pass unchanged

### Definition of Done
- [x] `bun test src/agents/loom/prompt-composer.test.ts` passes
- [x] `bun test src/agents/loom/index.test.ts` passes
- [x] `bun test src/agents/dynamic-prompt-builder.test.ts` passes
- [x] `bun test` (full suite) passes
- [x] Manual verification: composing a prompt with custom agent metadata produces delegation table entries

### Guardrails (Must NOT)
- Must NOT modify existing hardcoded section builders (`buildDelegationSection`, `buildPlanWorkflowSection`, etc.)
- Must NOT change the output of `composeLoomPrompt()` when no custom agents are provided (backward compatibility)
- Must NOT change the `LOOM_DEFAULTS` static prompt (it's the zero-config baseline)
- Must NOT modify `dynamic-prompt-builder.ts` — those functions are already correct
- Must NOT break the existing test files
- Must NOT introduce circular imports between `prompt-composer.ts` and `builtin-agents.ts`

## TODOs

- [x] 1. **Extend `LoomPromptOptions` interface to accept custom agent metadata**
  **What**: Add an optional `customAgents` field to the `LoomPromptOptions` interface in `prompt-composer.ts`. This field carries an array of `AvailableAgent` objects representing custom agents with their metadata.
  **Files**: `src/agents/loom/prompt-composer.ts`
  **Changes**:
  ```typescript
  // In the imports, add:
  import type { AvailableAgent } from "../dynamic-prompt-builder"

  export interface LoomPromptOptions {
    disabledAgents?: Set<string>
    fingerprint?: ProjectFingerprint | null
    /** Custom agent metadata for dynamic delegation sections */
    customAgents?: AvailableAgent[]
  }
  ```
  **Acceptance**: Interface compiles. No runtime behavior change yet. Existing callers still work (field is optional).

- [x] 2. **Add a `buildCustomAgentDelegationSection()` function in `prompt-composer.ts`**
  **What**: Create a new section builder that takes `AvailableAgent[]` and the `disabledAgents` set, filters out disabled agents, and produces a `<CustomDelegation>` XML section using `buildDelegationTable()` from `dynamic-prompt-builder.ts`. Returns empty string if no custom agents remain after filtering.
  **Files**: `src/agents/loom/prompt-composer.ts`
  **Changes**:
  ```typescript
  import { buildProjectContextSection, buildDelegationTable } from "../dynamic-prompt-builder"

  export function buildCustomAgentDelegationSection(
    customAgents: AvailableAgent[],
    disabled: Set<string>,
  ): string {
    const enabledAgents = customAgents.filter((a) => isAgentEnabled(a.name, disabled))
    if (enabledAgents.length === 0) return ""

    const table = buildDelegationTable(enabledAgents)

    return `<CustomDelegation>
  Custom agents available for delegation:

  ${table}

  Delegate to these agents when their domain matches the task. Use the same delegation pattern as built-in agents.
  </CustomDelegation>`
  }
  ```
  **Acceptance**: Function returns empty string for empty array. Function returns formatted section for non-empty array. Function filters out disabled agents.

- [x] 3. **Wire `buildCustomAgentDelegationSection()` into `composeLoomPrompt()`**
  **What**: Insert the custom delegation section into the sections array in `composeLoomPrompt()`, positioned after `buildDelegationNarrationSection()` and before `buildPlanWorkflowSection()`. Only call it when `customAgents` is provided and non-empty.
  **Files**: `src/agents/loom/prompt-composer.ts`
  **Changes**: In `composeLoomPrompt()`, extract `customAgents` from options and add the new section to the sections array:
  ```typescript
  export function composeLoomPrompt(options: LoomPromptOptions = {}): string {
    const disabled = options.disabledAgents ?? new Set()
    const fingerprint = options.fingerprint
    const customAgents = options.customAgents ?? []

    const sections = [
      buildRoleSection(),
      buildProjectContextSection(fingerprint),
      buildDisciplineSection(),
      buildSidebarTodosSection(),
      buildDelegationSection(disabled),
      buildDelegationNarrationSection(disabled),
      buildCustomAgentDelegationSection(customAgents, disabled),  // NEW
      buildPlanWorkflowSection(disabled),
      buildReviewWorkflowSection(disabled),
      buildStyleSection(),
    ].filter((s) => s.length > 0)

    return sections.join("\n\n")
  }
  ```
  **Acceptance**: When `customAgents` is empty or undefined, `composeLoomPrompt()` output is identical to before (empty string filtered out). When custom agents are provided, `<CustomDelegation>` section appears between `</DelegationNarration>` and `<PlanWorkflow>`.

- [x] 4. **Thread custom agent metadata through `createLoomAgentWithOptions()`**
  **What**: Add a `customAgents` parameter to `createLoomAgentWithOptions()` and pass it to `composeLoomPrompt()`.
  **Files**: `src/agents/loom/index.ts`
  **Changes**:
  ```typescript
  import type { AvailableAgent } from "../dynamic-prompt-builder"

  export function createLoomAgentWithOptions(
    model: string,
    disabledAgents?: Set<string>,
    fingerprint?: ProjectFingerprint | null,
    customAgents?: AvailableAgent[],
  ): AgentConfig {
    if ((!disabledAgents || disabledAgents.size === 0) && !fingerprint && (!customAgents || customAgents.length === 0)) {
      return { ...LOOM_DEFAULTS, model, mode: "primary" }
    }
    return {
      ...LOOM_DEFAULTS,
      prompt: composeLoomPrompt({ disabledAgents, fingerprint, customAgents }),
      model,
      mode: "primary",
    }
  }
  ```
  Also re-export `AvailableAgent` type from `index.ts` if needed by callers.
  **Acceptance**: When called without `customAgents`, behavior is identical. When called with custom agents, prompt includes the custom delegation section.

- [x] 5. **Build `AvailableAgent[]` from custom metadata in `createBuiltinAgents()` and pass to Loom**
  **What**: In `createBuiltinAgents()` in `builtin-agents.ts`, after the main agent loop, collect custom agent metadata from `CUSTOM_AGENT_METADATA` and convert it to `AvailableAgent[]`. Pass this to `createLoomAgentWithOptions()`.
  **Files**: `src/agents/builtin-agents.ts`
  **Changes**:
  The challenge here is that `createBuiltinAgents()` builds the Loom agent in the loop, but custom agents are registered by `createManagers()` AFTER `createBuiltinAgents()` returns. This is the critical ordering issue.

  **Solution**: The Loom agent must be built (or rebuilt) AFTER custom agents are registered. Two sub-approaches:

  **Approach 5a (Preferred — pass metadata explicitly)**: Instead of relying on `CUSTOM_AGENT_METADATA` global state, have `createBuiltinAgents()` accept custom agent metadata as a parameter. Then `createManagers()` builds custom agent metadata first, passes it into `createBuiltinAgents()`, which passes it to Loom.

  In `createManagers.ts`:
  ```typescript
  export function createManagers(options: { ... }): WeaveManagers {
    const { pluginConfig, resolveSkills, fingerprint, configDir } = options

    // Step 1: Build custom agent metadata FIRST
    const customAgentMeta: Array<{ name: string; config: CustomAgentConfig; metadata: AgentPromptMetadata }> = []
    if (pluginConfig.custom_agents) {
      const disabledSet = new Set(pluginConfig.disabled_agents ?? [])
      for (const [name, customConfig] of Object.entries(pluginConfig.custom_agents)) {
        if (disabledSet.has(name)) continue
        const metadata = buildCustomAgentMetadata(name, customConfig)
        customAgentMeta.push({ name, config: customConfig, metadata })
      }
    }

    // Step 2: Build builtins WITH custom agent metadata for Loom's prompt
    const agents = createBuiltinAgents({
      disabledAgents: pluginConfig.disabled_agents,
      agentOverrides: pluginConfig.agents,
      resolveSkills,
      fingerprint,
      customAgentMetadata: customAgentMeta.map(({ name, config, metadata }) => ({
        name,
        description: config.description ?? config.display_name ?? name,
        metadata,
      })),
    })

    // Step 3: Build custom agent configs and register metadata
    if (pluginConfig.custom_agents) {
      const disabledSet = new Set(pluginConfig.disabled_agents ?? [])
      for (const [name, customConfig] of Object.entries(pluginConfig.custom_agents)) {
        if (disabledSet.has(name)) continue
        if (agents[name] !== undefined) continue

        agents[name] = buildCustomAgent(name, customConfig, {
          resolveSkills,
          disabledSkills: pluginConfig.disabled_skills ? new Set(pluginConfig.disabled_skills) : undefined,
          configDir,
        })

        const metadata = buildCustomAgentMetadata(name, customConfig)
        registerCustomAgentMetadata(name, metadata)
      }
    }

    // ... rest unchanged
  }
  ```

  In `builtin-agents.ts`, add to `CreateBuiltinAgentsOptions`:
  ```typescript
  export interface CreateBuiltinAgentsOptions {
    // ... existing fields ...
    /** Custom agent metadata for Loom's dynamic delegation prompt */
    customAgentMetadata?: AvailableAgent[]
  }
  ```

  And in the Loom branch of the loop:
  ```typescript
  if (name === "loom") {
    built = createLoomAgentWithOptions(resolvedModel, disabledSet, fingerprint, options.customAgentMetadata)
  }
  ```
  **Acceptance**: When custom agents are configured, Loom's prompt contains `<CustomDelegation>` with their triggers. When no custom agents are configured, Loom's prompt is identical to before.

- [x] 6. **Add unit tests for `buildCustomAgentDelegationSection()`**
  **What**: Add tests to `prompt-composer.test.ts` verifying the new section builder.
  **Files**: `src/agents/loom/prompt-composer.test.ts`
  **Tests to add**:
  ```typescript
  import { buildCustomAgentDelegationSection } from "./prompt-composer"
  import type { AvailableAgent } from "../dynamic-prompt-builder"

  describe("buildCustomAgentDelegationSection", () => {
    const makeCustomAgent = (name: string, domain: string, trigger: string): AvailableAgent => ({
      name,
      description: `${name} agent`,
      metadata: {
        category: "specialist",
        cost: "CHEAP",
        triggers: [{ domain, trigger }],
      },
    })

    it("returns empty string when no custom agents", () => {
      expect(buildCustomAgentDelegationSection([], new Set())).toBe("")
    })

    it("returns formatted section for custom agents", () => {
      const agents = [makeCustomAgent("code-reviewer", "Code Review", "Code quality review")]
      const result = buildCustomAgentDelegationSection(agents, new Set())
      expect(result).toContain("<CustomDelegation>")
      expect(result).toContain("</CustomDelegation>")
      expect(result).toContain("Code Review")
      expect(result).toContain("`code-reviewer`")
    })

    it("filters out disabled custom agents", () => {
      const agents = [
        makeCustomAgent("code-reviewer", "Code Review", "Quality review"),
        makeCustomAgent("doc-writer", "Documentation", "Write docs"),
      ]
      const result = buildCustomAgentDelegationSection(agents, new Set(["code-reviewer"]))
      expect(result).not.toContain("code-reviewer")
      expect(result).toContain("doc-writer")
    })

    it("returns empty string when all custom agents are disabled", () => {
      const agents = [makeCustomAgent("code-reviewer", "Code Review", "Quality review")]
      expect(buildCustomAgentDelegationSection(agents, new Set(["code-reviewer"]))).toBe("")
    })
  })
  ```
  **Acceptance**: All new tests pass.

- [x] 7. **Add integration tests for `composeLoomPrompt()` with custom agents**
  **What**: Add tests to `prompt-composer.test.ts` verifying that the composed prompt includes custom delegation when custom agents are provided, and is unchanged when they aren't.
  **Files**: `src/agents/loom/prompt-composer.test.ts`
  **Tests to add**:
  ```typescript
  describe("composeLoomPrompt with custom agents", () => {
    it("does not include CustomDelegation when no custom agents provided", () => {
      const prompt = composeLoomPrompt()
      expect(prompt).not.toContain("<CustomDelegation>")
    })

    it("does not include CustomDelegation when custom agents array is empty", () => {
      const prompt = composeLoomPrompt({ customAgents: [] })
      expect(prompt).not.toContain("<CustomDelegation>")
    })

    it("includes CustomDelegation section when custom agents provided", () => {
      const prompt = composeLoomPrompt({
        customAgents: [{
          name: "code-reviewer",
          description: "Reviews code quality",
          metadata: {
            category: "advisor",
            cost: "CHEAP",
            triggers: [{ domain: "Code Review", trigger: "Code quality review and best practices" }],
          },
        }],
      })
      expect(prompt).toContain("<CustomDelegation>")
      expect(prompt).toContain("Code Review")
      expect(prompt).toContain("`code-reviewer`")
      expect(prompt).toContain("</CustomDelegation>")
    })

    it("places CustomDelegation between DelegationNarration and PlanWorkflow", () => {
      const prompt = composeLoomPrompt({
        customAgents: [{
          name: "test-agent",
          description: "Test agent",
          metadata: {
            category: "specialist",
            cost: "CHEAP",
            triggers: [{ domain: "Testing", trigger: "Run tests" }],
          },
        }],
      })
      const narrationEnd = prompt.indexOf("</DelegationNarration>")
      const customStart = prompt.indexOf("<CustomDelegation>")
      const planStart = prompt.indexOf("<PlanWorkflow>")
      expect(customStart).toBeGreaterThan(narrationEnd)
      expect(customStart).toBeLessThan(planStart)
    })

    it("produces identical output to default when customAgents is empty", () => {
      const defaultPrompt = composeLoomPrompt()
      const withEmptyCustom = composeLoomPrompt({ customAgents: [] })
      expect(withEmptyCustom).toBe(defaultPrompt)
    })
  })
  ```
  **Acceptance**: All new tests pass. Existing tests remain unchanged and passing.

- [x] 8. **Add test for `createLoomAgentWithOptions()` with custom agents**
  **What**: Add a test to `index.test.ts` verifying that passing custom agents results in them appearing in the prompt.
  **Files**: `src/agents/loom/index.test.ts`
  **Tests to add**:
  ```typescript
  import { createLoomAgentWithOptions } from "./index"

  describe("createLoomAgentWithOptions", () => {
    it("includes custom agent triggers in prompt when provided", () => {
      const config = createLoomAgentWithOptions("claude-opus-4", undefined, null, [{
        name: "code-reviewer",
        description: "Reviews code",
        metadata: {
          category: "advisor",
          cost: "CHEAP",
          triggers: [{ domain: "Code Review", trigger: "Code quality review" }],
        },
      }])
      expect(config.prompt).toContain("<CustomDelegation>")
      expect(config.prompt).toContain("code-reviewer")
    })

    it("returns LOOM_DEFAULTS when no custom agents, disabled, or fingerprint", () => {
      const config = createLoomAgentWithOptions("claude-opus-4")
      expect(config.prompt).not.toContain("<CustomDelegation>")
    })
  })
  ```
  **Acceptance**: Tests pass.

## Implementation Order

```
TODO 1 (interface)
  ↓
TODO 2 (section builder)
  ↓
TODO 3 (wire into composeLoomPrompt)
  ↓
TODO 4 (thread through createLoomAgentWithOptions)
  ↓
TODO 5 (thread through createBuiltinAgents + createManagers)
  ↓
TODO 6–8 (tests — can be written in parallel)
```

TODOs 1–3 are the core prompt-composer changes. TODO 4 is the Loom index bridge. TODO 5 is the data plumbing from config → Loom. TODOs 6–8 are tests.

## Verification

- [x] `bun test src/agents/loom/prompt-composer.test.ts` — all existing + new tests pass
- [x] `bun test src/agents/loom/index.test.ts` — all existing + new tests pass
- [x] `bun test src/agents/dynamic-prompt-builder.test.ts` — all existing tests pass (no changes to this file)
- [x] `bun test src/agents/builtin-agents.test.ts` — if exists, all tests pass
- [x] `bun test src/create-managers.test.ts` — if exists, all tests pass
- [x] `bun test` — full suite, no regressions
- [x] `bun run build` or `bunx tsc --noEmit` — no type errors
- [x] Manual spot check: call `composeLoomPrompt({ customAgents: [{ name: "x", description: "x", metadata: { category: "specialist", cost: "CHEAP", triggers: [{ domain: "D", trigger: "T" }] } }] })` and verify output contains `<CustomDelegation>` with `**D** → \`x\` — T`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ordering: Loom built before custom agents registered | Custom triggers missing from prompt | TODO 5 restructures `createManagers()` to build metadata BEFORE builtins |
| LOOM_DEFAULTS computed at module load (no custom agents) | N/A — this is correct, defaults should be zero-config | The fast-path in `createLoomAgentWithOptions()` returns defaults when no customization needed |
| Circular imports | Build failure | `prompt-composer.ts` imports from `dynamic-prompt-builder.ts` (already does for `buildProjectContextSection`). No new circular risk. |
| Custom agent with same domain as builtin | Duplicate delegation entries | Acceptable — both entries appear, Loom picks the most relevant. Custom agents should use distinct domain names. |
| Large number of custom agents bloats prompt | Context window pressure | Not a concern for MVP — users define 1-3 custom agents typically. Can add limits later if needed. |
