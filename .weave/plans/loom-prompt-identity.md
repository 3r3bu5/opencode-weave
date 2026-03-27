# Rework Loom's Role & Discipline Sections for Positive Identity

## TL;DR
> **Summary**: Replace Loom's thin 3-line identity + negative guardrails with a strong positive identity that naturally prevents the "executing plan tasks directly" failure mode.
> **Estimated Effort**: Short

## Context
### Original Request
Rework `buildRoleSection()` and `buildDisciplineSection()` in the Loom prompt composer to lead with a clear, strong positive identity as a coordinator/router. The current prompt is 5% identity, 95% process — which causes Loom to sometimes execute plan tasks directly instead of delegating, because the prompt doesn't establish *who Loom is* strongly enough.

### Key Findings

**Current `buildRoleSection()`** (3 lines):
```
Loom — main orchestrator for Weave.
Plan tasks, coordinate work, and delegate to specialized agents.
You are the team lead. Understand the request, break it into tasks, delegate intelligently.
```
- Generic. "Plan tasks" and "coordinate work" are verbs, not identity.
- "Team lead" is the only identity statement but it's buried after two action lines.
- No clear mental model for *when* to delegate vs. *when* to act directly.

**Current `buildDisciplineSection()`** (10 lines):
```
TODO OBSESSION (NON-NEGOTIABLE):
- 2+ steps → todowrite FIRST, atomic breakdown
- Mark in_progress before starting (ONE at a time)
- Mark completed IMMEDIATELY after each step
- NEVER batch completions

PLANS: Never execute plan tasks directly — always /start-work → Tapestry.

No todos on multi-step work = INCOMPLETE WORK.
```
- Mixes two unrelated concerns: todo tracking and plan execution guardrails.
- The plan guardrail is a NEGATIVE rule ("Never...") — easy for models to miss or override under pressure.
- "TODO OBSESSION" label is procedural, not identity-reinforcing.

**The "NEVER execute" guardrail appears in 3 places total** across the prompt:
1. `buildDisciplineSection()` line 39 — `"PLANS: Never execute plan tasks directly"`
2. `buildPlanWorkflowSection()` line 216 — `"IMPORTANT: NEVER execute plan tasks directly"`
3. The `<PlanWorkflow>` section also has a "When to use this workflow vs. direct execution" note at the end

This redundancy confirms the negative-guardrail-patching pattern we're trying to fix.

**Comparison with other agent identities** — all lead with *what they ARE*:
- **Pattern**: "strategic planner... You analyze requirements, research the codebase, and produce detailed implementation plans. You think before acting. Plans should be concrete, not abstract. You NEVER implement — you produce plans ONLY." — Strong identity, clear boundary, ONE negative (and it's really identity: "I am a planner, not an implementer").
- **Tapestry**: "execution orchestrator... You manage todo-list driven execution of multi-step plans. Break plans into atomic tasks, track progress rigorously, execute sequentially. You do NOT spawn subagents — you execute directly." — Identity + one boundary.
- **Thread**: "codebase explorer... You navigate and analyze code fast. Read-only access only." — Identity + access scope.

The pattern: **strong noun identity → what you do → one crisp boundary**. Loom's current prompt skips the first part.

**Tests that will need updating** (5 assertions across 3 test cases):

1. `it("contains delegation guardrail preventing direct plan execution")` — asserts `composeLoomPrompt()` contains `"NEVER execute plan tasks directly"`. This guardrail text currently appears in both `buildDisciplineSection()` and `buildPlanWorkflowSection()`. If we only remove it from `buildDisciplineSection()`, the composite test still passes (it finds it in `buildPlanWorkflowSection()`). However...

2. `it("buildDisciplineSection contains TODO OBSESSION")` — asserts `buildDisciplineSection()` contains `"TODO OBSESSION"`. This needs updating since we're reworking the section.

3. `it("buildDisciplineSection contains plan delegation guardrail")` — asserts two things:
   - `section.toContain("PLANS: Never execute plan tasks directly")`
   - `section.toContain("/start-work")`
   This test directly checks the `buildDisciplineSection()` output for the guardrail text we're removing.

4. `it("buildRoleSection contains Loom identity")` — asserts `"Loom"` and `"orchestrator"`. This test should still pass if the new Role section contains both words (it should).

## Objectives
### Core Objective
Replace Loom's Role and Discipline sections with a positive-identity-first prompt that makes the "execute plan tasks directly" failure mode impossible because the model *understands what it is*, not because a rule says "NEVER".

### Deliverables
- [ ] New `buildRoleSection()` text — positive identity as coordinator/router
- [ ] New `buildDisciplineSection()` text — work tracking discipline without negative plan guardrails
- [ ] Updated tests to match the new section content

### Definition of Done
- [ ] `bun test src/agents/loom/prompt-composer.test.ts` passes
- [ ] `buildRoleSection()` output establishes Loom as a coordinator who delegates substantial work and handles simple tasks directly
- [ ] `buildDisciplineSection()` output contains todo-tracking discipline without "NEVER execute plan tasks" language
- [ ] No changes to function signatures, exports, or other sections
- [ ] The `buildPlanWorkflowSection()` "NEVER execute" line is also softened to match the new identity approach

### Guardrails (Must NOT)
- Do NOT change function signatures or exports
- Do NOT modify any section builder other than `buildRoleSection()`, `buildDisciplineSection()`, and the one guardrail line in `buildPlanWorkflowSection()`
- Do NOT remove todowrite tracking requirements — Loom still needs them
- Do NOT make the Role section longer than ~12 lines — conciseness matters

## TODOs

- [ ] 1. Replace `buildRoleSection()` body
  **What**: Replace the current 3-line role with a strong positive identity. The new text should follow the pattern established by other Weave agents (identity noun → what you do → decision framework → one crisp boundary).

  **New text**:
  ```typescript
  export function buildRoleSection(): string {
    return `<Role>
  Loom — coordinator and router for Weave.
  You are the user's primary interface. You understand intent, make routing decisions, and keep the user informed.

  Your core loop:
  1. Understand what the user needs
  2. Decide: can you handle this in a single action, or does it need specialists?
  3. Simple tasks (quick answers, single-file fixes, small edits) — do them yourself
  4. Substantial work (multi-file changes, research, planning, review) — delegate to the right agent
  5. Summarize results back to the user

  You coordinate. You don't do deep work — that's what your agents are for.
  </Role>`
  }
  ```

  **Why this works**:
  - "coordinator and router" is the identity, not "orchestrator" (which implies doing the work)
  - "user's primary interface" establishes the communication role
  - The 5-step core loop gives a positive decision framework
  - "Simple tasks... do them yourself" gives explicit permission for direct work
  - "Substantial work... delegate" makes delegation the natural choice, not a rule
  - "You coordinate. You don't do deep work" is a single crisp boundary (like Pattern's "You NEVER implement — you produce plans ONLY")

  **Files**: `src/agents/loom/prompt-composer.ts` (lines 23–29)
  **Acceptance**: `buildRoleSection()` contains "Loom", "coordinator", "router", and "delegate"

- [ ] 2. Replace `buildDisciplineSection()` body
  **What**: Replace the current discipline section with one focused purely on work-tracking discipline. Remove the plan execution guardrail — it now emerges naturally from the Role identity ("you don't do deep work") and the PlanWorkflow section's routing instructions.

  **New text**:
  ```typescript
  export function buildDisciplineSection(): string {
    return `<Discipline>
  WORK TRACKING:
  - Multi-step work → todowrite FIRST with atomic breakdown
  - Mark in_progress before starting each step (one at a time)
  - Mark completed immediately after finishing
  - Never batch completions — update as you go

  Plans live at \`.weave/plans/*.md\`. Execution goes through /start-work → Tapestry.
  </Discipline>`
  }
  ```

  **Why this works**:
  - "WORK TRACKING" is a descriptive label instead of "TODO OBSESSION (NON-NEGOTIABLE)" which was performatively urgent
  - Same four rules, same meaning, less shouting
  - The plan routing note is now *informational* ("Plans live at... Execution goes through...") not prohibitive ("NEVER execute..."). This tells Loom *how plans work* rather than *what not to do*.
  - Removes the redundant "No todos on multi-step work = INCOMPLETE WORK" — covered by "Multi-step work → todowrite FIRST"

  **Files**: `src/agents/loom/prompt-composer.ts` (lines 31–43)
  **Acceptance**: `buildDisciplineSection()` contains "WORK TRACKING", "todowrite", "/start-work", "Tapestry" and does NOT contain "NEVER execute" or "TODO OBSESSION"

- [ ] 3. Soften the `buildPlanWorkflowSection()` guardrail line
  **What**: Replace the "IMPORTANT: NEVER execute plan tasks directly. Always delegate to /start-work → Tapestry." line in `buildPlanWorkflowSection()` with a routing instruction that's consistent with the positive identity.

  **Old text** (line 216):
  ```
  IMPORTANT: NEVER execute plan tasks directly. Always delegate to /start-work → Tapestry.
  ```

  **New text**:
  ```
  Plans are executed by Tapestry, not Loom. Tell the user to run /start-work to begin.
  ```

  **Why this works**: Same information, framed as a routing fact ("Tapestry does this") rather than a prohibition ("NEVER do this"). Consistent with the Role identity of "you coordinate, you don't do deep work."

  **Files**: `src/agents/loom/prompt-composer.ts` (line 216)
  **Acceptance**: `buildPlanWorkflowSection()` output contains "Plans are executed by Tapestry" and does NOT contain "NEVER execute plan tasks directly"

- [ ] 4. Update tests
  **What**: Update 4 test assertions that check for the old text, plus remove or rework the test that specifically asserted the negative guardrail.

  **Files**: `src/agents/loom/prompt-composer.test.ts`

  **Changes**:

  **(a)** Test at line 53–56 — `"contains delegation guardrail preventing direct plan execution"`:
  The composite prompt test. Currently asserts `expect(prompt).toContain("NEVER execute plan tasks directly")`. After our changes, this text no longer appears anywhere. Replace with:
  ```typescript
  it("contains plan execution routing in PlanWorkflow", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("Plans are executed by Tapestry")
  })
  ```

  **(b)** Test at line 142–146 — `buildPlanWorkflowSection` — `"contains delegation guardrail at the top"`:
  Currently asserts `expect(section).toContain("NEVER execute plan tasks directly")`. Replace with:
  ```typescript
  it("contains plan routing statement", () => {
    const section = buildPlanWorkflowSection(new Set())
    expect(section).toContain("Plans are executed by Tapestry")
    expect(section).toContain("/start-work")
  })
  ```

  **(c)** Test at line 233–235 — `"buildDisciplineSection contains TODO OBSESSION"`:
  Replace with:
  ```typescript
  it("buildDisciplineSection contains work tracking rules", () => {
    expect(buildDisciplineSection()).toContain("WORK TRACKING")
  })
  ```

  **(d)** Test at line 237–241 — `"buildDisciplineSection contains plan delegation guardrail"`:
  Replace with:
  ```typescript
  it("buildDisciplineSection contains plan routing note", () => {
    const section = buildDisciplineSection()
    expect(section).toContain("/start-work")
    expect(section).toContain("Tapestry")
  })
  ```

  **(e)** Test at line 228–231 — `"buildRoleSection contains Loom identity"`:
  Currently asserts `"Loom"` and `"orchestrator"`. The new Role uses "coordinator" instead. Update:
  ```typescript
  it("buildRoleSection contains Loom identity", () => {
    expect(buildRoleSection()).toContain("Loom")
    expect(buildRoleSection()).toContain("coordinator")
  })
  ```

  **Acceptance**: `bun test src/agents/loom/prompt-composer.test.ts` passes with all updated assertions

## Verification
- [ ] `bun test src/agents/loom/prompt-composer.test.ts` — all tests pass
- [ ] `bun test src/agents/` — no regressions in other agent tests
- [ ] Manual review: the composite prompt (`composeLoomPrompt()`) reads as a coherent identity, not a rule list
- [ ] Grep the final `prompt-composer.ts` for "NEVER" — should only appear in sections we didn't touch (e.g., `buildSidebarTodosSection` "BEFORE FINISHING" block, `buildDelegationNarrationSection` "no exceptions"), NOT in Role, Discipline, or the PlanWorkflow guardrail line
