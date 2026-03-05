# Issue #15: Fix PlanWorkflow / ReviewWorkflow Contradiction

## TL;DR
> **Summary**: Remove "(optional)" from PlanWorkflow's review step and add explicit trigger/skip conditions so it's consistent with ReviewWorkflow.
> **Estimated Effort**: Quick

## Context
### Original Request
GitHub Issue #15: PlanWorkflow marks Weft review as "(optional)" on line 92 of `src/agents/loom/default.ts`, but ReviewWorkflow (lines 105-128) lists mandatory criteria that clearly apply after Pattern produces a plan (multi-step plan, 3+ files). This contradiction causes Loom to skip plan review when it shouldn't.

### Key Findings
1. **The contradiction** — Line 92 says `2. REVIEW (optional): For complex plans, delegate to Weft...` while ReviewWorkflow lines 112-116 list "After completing a multi-step plan" and "After any task that touches 3+ files" as mandatory triggers.

2. **Weft's own prompt** (`src/agents/weft/default.ts`) explicitly defines a "Plan Review" mode (line 21), confirming plan review is a first-class capability, not an afterthought.

3. **`builtin-agents.ts`** (line 112) lists "Before executing a complex plan" as a `useWhen` trigger for Weft — reinforcing that plan review should happen.

4. **`dynamic-prompt-builder.ts`** (line 156-162) builds a "Use Weft when" / "Skip Weft when" section from the metadata in `builtin-agents.ts` — this is consistent and needs no changes.

5. **No tests check the exact wording** of the PlanWorkflow section. The Loom test (`src/agents/loom/index.test.ts`) only verifies the prompt is non-empty. No test will break from this text change, but we should add one to prevent regression.

6. **Single file change** — only `src/agents/loom/default.ts` needs editing. The wording in `builtin-agents.ts`, `dynamic-prompt-builder.ts`, `verification-reminder.ts`, and `src/agents/weft/default.ts` are already consistent and correct.

## Objectives
### Core Objective
Make PlanWorkflow's review step consistent with ReviewWorkflow — explicit trigger conditions, explicit skip condition, no ambiguous "(optional)".

### Deliverables
- [x] Updated PlanWorkflow section in `src/agents/loom/default.ts` with clear trigger/skip conditions
- [x] New test in `src/agents/loom/index.test.ts` to assert the PlanWorkflow review step is not marked optional and contains trigger conditions

### Definition of Done
- [x] The string "(optional)" does not appear in the PlanWorkflow section
- [x] PlanWorkflow explicitly states trigger conditions (3+ files or 5+ tasks)
- [x] PlanWorkflow explicitly states the only skip condition (user says "skip review")
- [x] ReviewWorkflow and PlanWorkflow have no contradictions
- [x] `bun test` passes with no failures
- [x] `bun run build` passes with no errors or warnings

### Guardrails (Must NOT)
- Do not change ReviewWorkflow — it's already correct
- Do not change Weft agent config or prompt
- Do not change `builtin-agents.ts` metadata
- Do not change `dynamic-prompt-builder.ts`
- Do not change `verification-reminder.ts`

## TODOs

- [x] 1. Update PlanWorkflow review step in Loom prompt
  **What**: Replace the `REVIEW (optional)` step (lines 92-94) with an explicit, non-optional version that specifies when Weft review is triggered and when it can be skipped.
  **Files**: `src/agents/loom/default.ts`
  **Exact change**:

  Old text (lines 92-94):
  ```
2. REVIEW (optional): For complex plans, delegate to Weft to validate the plan before execution
   - Weft reads the plan, verifies file references, checks executability
   - If Weft rejects, send issues back to Pattern for revision
  ```

  New text:
  ```
2. REVIEW: Delegate to Weft to validate the plan before execution
   - TRIGGER: Plan touches 3+ files OR has 5+ tasks — Weft review is mandatory
   - SKIP ONLY IF: User explicitly says "skip review"
   - Weft reads the plan, verifies file references, checks executability
   - If Weft rejects, send issues back to Pattern for revision
  ```

  **Acceptance**: `grep -c "optional" src/agents/loom/default.ts` returns 0 for the PlanWorkflow section; new trigger/skip conditions are present in the prompt string.

- [x] 2. Add regression test for PlanWorkflow review wording
  **What**: Add test cases in the Loom agent test file to verify: (a) the PlanWorkflow section does not contain "(optional)" for the REVIEW step, (b) it contains the trigger condition text, and (c) it contains the skip condition text.
  **Files**: `src/agents/loom/index.test.ts`
  **Exact additions** (append inside the existing `describe` block):

  ```typescript
  it("PlanWorkflow review step is not marked optional", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    // Extract PlanWorkflow section
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).not.toContain("(optional)")
  })

  it("PlanWorkflow specifies review trigger conditions", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).toContain("3+ files")
    expect(planWorkflow).toContain("5+ tasks")
  })

  it("PlanWorkflow specifies the only skip condition", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).toContain("skip review")
  })
  ```

  **Acceptance**: `bun test src/agents/loom/index.test.ts` passes with 3 new test cases.

- [x] 3. Verify build and full test suite
  **What**: Run the build and full test suite to confirm no regressions.
  **Files**: N/A (verification only)
  **Acceptance**: `bun run build && bun test` exits with code 0, no warnings.

## Verification
- [x] `grep "(optional)" src/agents/loom/default.ts` returns no matches within `<PlanWorkflow>`
- [x] PlanWorkflow contains "3+ files" and "5+ tasks" trigger conditions
- [x] PlanWorkflow contains "skip review" as the only skip condition
- [x] ReviewWorkflow remains unchanged from current version
- [x] `bun test` — all tests pass (including 3 new ones)
- [x] `bun run build` — no errors or warnings
