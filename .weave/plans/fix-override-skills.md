# Fix Config-Defined Agent Skills Never Resolved

## TL;DR
> **Summary**: Config-defined `skills` on agent overrides are silently ignored because `createBuiltinAgents` never reads `override.skills`. Add skill resolution to the override block in `builtin-agents.ts` and cover with tests.
> **Estimated Effort**: Quick

## Context
### Original Request
When a user configures skills for an agent via their config file (e.g., `weave-opencode.jsonc`):
```jsonc
{
  "agents": {
    "tapestry": {
      "skills": ["release-build"]
    }
  }
}
```
The `skills` array is parsed and validated by the schema (`AgentOverrideConfigSchema` at `src/config/schema.ts:8`), flows into `agentOverrides`, and reaches `createBuiltinAgents()` — but the override block (lines 179-186) only handles `prompt_append` and `temperature`. It never reads `override.skills`, so config-defined skills are silently dropped.

### Key Findings
- **Schema is correct**: `AgentOverrideConfigSchema` already includes `skills: z.array(z.string()).optional()` (schema.ts:8).
- **`resolveSkills` and `disabledSkills` are already in scope**: Destructured at lines 152-153 of `builtin-agents.ts`.
- **`buildAgent()` handles skills from factory base** (agent-builder.ts:38-43), but no factory currently sets `skills`, so this codepath is only useful for future factory-level skills. The config override path is a separate concern.
- **Skill prepend pattern is established**: `agent-builder.ts:41` prepends skills before the base prompt. The override block should follow the same pattern.
- **Existing tests** cover `prompt_append`, `temperature`, model overrides, and disabled agents — but zero coverage for skills.

## Objectives
### Core Objective
Ensure skills defined in agent config overrides are resolved and injected into the agent's prompt.

### Deliverables
- [x] Skills from `override.skills` are resolved and prepended to the agent prompt
- [x] Test coverage for skill injection via overrides

### Definition of Done
- [x] `bun test src/agents/builtin-agents.test.ts` passes with new test cases
- [x] `bun run build` succeeds with no warnings
- [x] Manual verification: setting `skills` on an agent in config results in skill content appearing at the top of the agent's prompt

### Guardrails (Must NOT)
- Do NOT modify `agent-builder.ts` — it handles factory-level skills correctly
- Do NOT change the schema — `skills` is already defined
- Do NOT change skill resolution order within `buildAgent` — that's a separate concern

## TODOs

- [x] 1. Add skill resolution to override block in `builtin-agents.ts`
  **What**: Inside the `if (override)` block (line 179), add skill resolution **before** the existing `prompt_append` handling. This ensures the final prompt order is:
  1. Override skills (prepended — highest priority)
  2. Base agent prompt
  3. `prompt_append` (appended — lowest priority)

  Insert the following code at line 180 (before the `prompt_append` block):
  ```ts
  if (override.skills?.length && resolveSkills) {
    const skillContent = resolveSkills(override.skills, disabledSkills)
    if (skillContent) {
      built.prompt = skillContent + (built.prompt ? "\n\n" + built.prompt : "")
    }
  }
  ```
  **Files**: `src/agents/builtin-agents.ts`
  **Acceptance**: The override block now handles `skills`, `prompt_append`, and `temperature` (in that order). The code compiles with `bun run build`.

- [x] 2. Add test cases for override skills in `builtin-agents.test.ts`
  **What**: Add a new `describe` block or individual `it` cases within the existing `createBuiltinAgents` describe block. Tests need a mock `resolveSkills` function.

  Test cases to add:
  - **Skills are resolved and prepended**: Pass `agentOverrides: { pattern: { skills: ["test-skill"] } }` with a `resolveSkills` mock that returns `"SKILL_CONTENT"`. Assert `agents["pattern"].prompt` starts with `"SKILL_CONTENT"`.
  - **Skills appear before base prompt**: Same setup as above. Assert the prompt contains `"SKILL_CONTENT"` before a known substring of pattern's base prompt.
  - **Skills work alongside prompt_append**: Pass both `skills: ["test-skill"]` and `prompt_append: "APPENDED"`. Assert prompt starts with `"SKILL_CONTENT"` and ends with `"APPENDED"`, with base prompt content in between.
  - **Empty skills array doesn't affect prompt**: Pass `skills: []` and verify the prompt is unchanged from default.
  - **resolveSkills returning empty string doesn't affect prompt**: Pass `skills: ["disabled-skill"]` with a mock that returns `""`. Verify prompt is unchanged.
   - **Disabled skills are passed through**: Verify the `disabledSkills` set is forwarded to the `resolveSkills` mock by checking the second argument in the mock call.
   - **Skills no-op when resolveSkills is not provided**: Pass `agentOverrides: { pattern: { skills: ["test-skill"] } }` without providing a `resolveSkills` function. Verify the prompt is unchanged from default — documents that the silent no-op when `resolveSkills` is absent is intentional.

   **Files**: `src/agents/builtin-agents.test.ts`
  **Acceptance**: `bun test src/agents/builtin-agents.test.ts` passes with all new tests green.

- [x] 3. Full build and test verification
  **What**: Run the full build and test suite to ensure no regressions.
  **Files**: None (verification step)
  **Acceptance**: `bun run build` succeeds with no warnings. `bun test` passes.

## Verification
- [x] `bun test src/agents/builtin-agents.test.ts` — all tests pass (including new skill tests)
- [x] `bun run build` — no errors or warnings
- [x] No regressions in other agent tests
