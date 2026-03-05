# TodoWrite Sidebar Integration

## TL;DR
> **Summary**: Enhance agent prompts and context injection to make agents use `todowrite` deliberately, surfacing Weave orchestration state in OpenCode's sidebar todo section.
> **Estimated Effort**: Medium

## Context
### Original Request
Make the OpenCode sidebar's "Todo" section useful for tracking Weave's orchestration state. Today, agents have generic "use todowrite" instructions but no strategy for *what* to surface. We need Tier 1 (LLM-driven): better prompts and context injection so agents call `todowrite` at the right moments with concise, human-useful content.

### Key Findings
1. **Weave cannot call `todowrite` programmatically** — it's a built-in OpenCode tool that only the LLM can invoke. Weave can only influence behavior via prompt text (system prompts + context injection).
2. **Context injection works** — `chat.message` hook mutates `parts[idx].text += "\n\n---\n${contextInjection}"`. The `start-work-hook.ts` already uses this pattern successfully.
3. **Current todowrite prompts are generic** — Loom says "2+ steps → todowrite FIRST" and Tapestry says "Load existing todos first". Neither gives guidance on *content format*, *sidebar width*, or *when to update*.
4. **Sidebar constraints**: ~38 chars usable width, `in_progress` (yellow) is the only visually distinct status, section hides when all items are completed, collapsible when > 2 items.
5. **Unhoooked hooks exist** — `context-window-monitor` builds messages but only logs them. `work-continuation` builds prompts but has no delivery mechanism. `verification-reminder` is built but unused. These are opportunities to add todowrite instructions.
6. **`getPlanProgress`** already counts checkboxes in plan files — this data is available in `buildFreshContext` and `buildResumeContext` and can be included in injection text.

### Architecture Notes
- **Agent prompts** live in `src/agents/{name}/default.ts` as string templates in the `prompt` field.
- **Context injection** happens in `src/plugin/plugin-interface.ts` in the `chat.message` handler, which calls hooks and mutates output parts.
- **Hook creation** is centralized in `src/hooks/create-hooks.ts` — each hook is gated by `isHookEnabled()`.
- **Tests** exist for every hook (`*.test.ts` alongside each hook file) and for the plugin interface (`plugin-interface.test.ts`).

## Objectives
### Core Objective
Make agents produce sidebar todos that give the human a clear, glanceable view of: what's happening now, what's next, and overall progress — at key orchestration moments.

### Deliverables
- [x] Updated Loom prompt with todowrite sidebar strategy
- [x] Updated Tapestry prompt with todowrite sidebar strategy
- [x] Enhanced start-work context injection with todowrite bootstrapping instructions
- [x] Enhanced context-window-monitor messages with todowrite instructions
- [x] Enhanced work-continuation prompts with todowrite instructions
- [x] Tests updated for all changed hook output strings

### Definition of Done
- [x] `bun test` passes with no failures
- [x] `bun run build` succeeds with no warnings
- [x] All 5 files modified, no new files created
- [x] Injected todowrite instructions respect 38-char content constraint
- [x] Each hook's test file validates the new todowrite-related text

### Guardrails (Must NOT)
- Must NOT modify OpenCode itself — only Weave plugin code
- Must NOT create new tools or hooks — only modify existing prompts and hook output strings
- Must NOT use priority field strategically (not visually distinct in UI)
- Must NOT produce todos longer than ~35 chars of content (leave margin for the 38-char sidebar)
- Must NOT add more than 7 concurrent visible todos at any point

## TODOs

- [x] 1. **Update Tapestry's prompt with todowrite sidebar strategy**
  **What**: Replace the generic `<Discipline>` section with specific todowrite instructions that tell Tapestry *when* and *what* to write to todos during plan execution. Tapestry is the primary executor, so its todo behavior matters most.
  **Files**: `src/agents/tapestry/default.ts`
  **Changes**: Replace the existing `<Discipline>` block (lines 17-25) with the new version below. The new block gives Tapestry a concrete todo strategy for plan execution.

  Replace this:
  ```
  <Discipline>
  TODO OBSESSION (NON-NEGOTIABLE):
  - Load existing todos first — never re-plan if a plan exists
  - Mark in_progress before starting EACH task (ONE at a time)
  - Mark completed IMMEDIATELY after finishing
  - NEVER skip steps, NEVER batch completions

  Execution without todos = lost work.
  </Discipline>
  ```

  With this:
  ```
  <Discipline>
  TODO OBSESSION (NON-NEGOTIABLE):
  - Load existing todos first — never re-plan if a plan exists
  - Mark in_progress before starting EACH task (ONE at a time)
  - Mark completed IMMEDIATELY after finishing
  - NEVER skip steps, NEVER batch completions

  Execution without todos = lost work.
  </Discipline>

  <SidebarTodos>
  The user sees a Todo sidebar (~35 char width). Use todowrite to keep it useful:

  WHEN STARTING A PLAN:
  - Create one "in_progress" todo for the current task (short title)
  - Create "pending" todos for the next 2-3 upcoming tasks
  - Create one summary todo: "[plan-name] 0/N done"

  WHEN COMPLETING A TASK:
  - Mark current task todo "completed"
  - Mark next task todo "in_progress"
  - Add next upcoming task as "pending" (keep 2-3 pending visible)
  - Update summary todo: "[plan-name] K/N done"

  WHEN BLOCKED:
  - Mark current task "cancelled" with reason
  - Set next unblocked task to "in_progress"

  WHEN PLAN COMPLETES:
  - Mark all remaining todos "completed"
  - Update summary: "[plan-name] DONE N/N"

  FORMAT RULES:
  - Max 35 chars per todo content
  - Use task number prefix: "3/7: Add user model"
  - Summary todo always present during execution
  - Max 5 visible todos (1 summary + 1 in_progress + 2-3 pending)
  - in_progress = yellow highlight — use for CURRENT task only
  </SidebarTodos>
  ```

  **Acceptance**: Tapestry default prompt contains `<SidebarTodos>` section. `bun test src/agents/tapestry/index.test.ts` passes.

- [x] 2. **Update Loom's prompt with todowrite sidebar strategy**
  **What**: Replace Loom's generic `<Discipline>` section with delegation-aware todowrite instructions. Loom delegates more than it executes, so its todos should reflect orchestration state (what's been delegated to whom, what's pending).
  **Files**: `src/agents/loom/default.ts`
  **Changes**: Replace the existing `<Discipline>` block (lines 12-20) with the new version. The new block tells Loom to surface delegation state through todos.

  Replace this:
  ```
  <Discipline>
  TODO OBSESSION (NON-NEGOTIABLE):
  - 2+ steps → todowrite FIRST, atomic breakdown
  - Mark in_progress before starting (ONE at a time)
  - Mark completed IMMEDIATELY after each step
  - NEVER batch completions

  No todos on multi-step work = INCOMPLETE WORK.
  </Discipline>
  ```

  With this:
  ```
  <Discipline>
  TODO OBSESSION (NON-NEGOTIABLE):
  - 2+ steps → todowrite FIRST, atomic breakdown
  - Mark in_progress before starting (ONE at a time)
  - Mark completed IMMEDIATELY after each step
  - NEVER batch completions

  No todos on multi-step work = INCOMPLETE WORK.
  </Discipline>

  <SidebarTodos>
  The user sees a Todo sidebar (~35 char width). Use todowrite strategically:

  WHEN PLANNING (multi-step work):
  - Create "in_progress": "Planning: [brief desc]"
  - When plan ready: mark completed, add "Plan ready — /start-work"

  WHEN DELEGATING TO AGENTS:
  - Create "in_progress": "[agent]: [task]" (e.g. "thread: scan models")
  - Mark "completed" when agent returns results
  - If multiple delegations: one todo per active agent

  WHEN DOING QUICK TASKS (no plan needed):
  - One "in_progress" todo for current step
  - Mark "completed" immediately when done

  FORMAT RULES:
  - Max 35 chars per todo content
  - Max 5 visible todos at any time
  - in_progress = yellow highlight — use for ACTIVE work only
  - Prefix delegations with agent name
  - After all work done: mark everything completed (sidebar hides)
  </SidebarTodos>
  ```

  **Acceptance**: Loom default prompt contains `<SidebarTodos>` section. `bun test src/agents/loom/index.test.ts` passes.

- [x] 3. **Enhance start-work context injection with todowrite bootstrap instructions**
  **What**: When `/start-work` fires and injects plan context, also inject explicit instructions telling Tapestry to immediately populate the sidebar with todos from the plan. This is the critical bootstrapping moment — the first thing the user sees.
  **Files**: `src/hooks/start-work-hook.ts`
  **Changes**: Modify `buildFreshContext()` (line 182) and `buildResumeContext()` (line 194) to append todowrite bootstrapping instructions.

  Replace `buildFreshContext` (lines 182-192):
  ```typescript
  function buildFreshContext(
    planPath: string,
    planName: string,
    progress: { total: number; completed: number },
  ): string {
    return `## Starting Plan: ${planName}
  **Plan file**: ${planPath}
  **Progress**: ${progress.completed}/${progress.total} tasks completed

  Read the plan file now and begin executing from the first unchecked \`- [ ]\` task.`
  }
  ```

  With:
  ```typescript
  function buildFreshContext(
    planPath: string,
    planName: string,
    progress: { total: number; completed: number },
  ): string {
    return `## Starting Plan: ${planName}
  **Plan file**: ${planPath}
  **Progress**: ${progress.completed}/${progress.total} tasks completed

  Read the plan file now and begin executing from the first unchecked \`- [ ]\` task.

  **SIDEBAR TODOS — DO THIS FIRST:**
  Before starting any work, use todowrite to populate the sidebar:
  1. Create a summary todo (in_progress): "${planName} ${progress.completed}/${progress.total}"
  2. Create a todo for the first unchecked task (in_progress)
  3. Create todos for the next 2-3 tasks (pending)
  Keep each todo under 35 chars. Update as you complete tasks.`
  }
  ```

  Replace `buildResumeContext` (lines 194-205):
  ```typescript
  function buildResumeContext(
    planPath: string,
    planName: string,
    progress: { total: number; completed: number },
  ): string {
    return `## Resuming Plan: ${planName}
  **Plan file**: ${planPath}
  **Progress**: ${progress.completed}/${progress.total} tasks completed
  **Status**: RESUMING — continuing from where the previous session left off.

  Read the plan file now and continue from the first unchecked \`- [ ]\` task.`
  }
  ```

  With:
  ```typescript
  function buildResumeContext(
    planPath: string,
    planName: string,
    progress: { total: number; completed: number },
  ): string {
    const remaining = progress.total - progress.completed
    return `## Resuming Plan: ${planName}
  **Plan file**: ${planPath}
  **Progress**: ${progress.completed}/${progress.total} tasks completed
  **Status**: RESUMING — continuing from where the previous session left off.

  Read the plan file now and continue from the first unchecked \`- [ ]\` task.

  **SIDEBAR TODOS — RESTORE STATE:**
  Previous session's todos are lost. Use todowrite to restore the sidebar:
  1. Create a summary todo (in_progress): "${planName} ${progress.completed}/${progress.total}"
  2. Create a todo for the next unchecked task (in_progress)
  3. Create todos for the following 2-3 tasks (pending)
  Keep each todo under 35 chars. ${remaining} task${remaining !== 1 ? "s" : ""} remaining.`
  }
  ```

  **Acceptance**: `bun test src/hooks/start-work-hook.test.ts` passes. New context strings contain "SIDEBAR TODOS". Resume context includes remaining task count.

- [x] 4. **Enhance context-window-monitor messages with todowrite instructions**
  **What**: When context window thresholds are hit, the warning/recovery messages should instruct the agent to update the sidebar to alert the user visually. The `in_progress` yellow highlight on a "Context: 80% used" todo is immediately noticeable.
  **Files**: `src/hooks/context-window-monitor.ts`
  **Changes**: Modify `buildWarningMessage()` (line 42) and `buildRecoveryMessage()` (line 46) to include todowrite instructions.

  Replace `buildWarningMessage` (lines 42-44):
  ```typescript
  function buildWarningMessage(usagePct: number): string {
    return `⚠️ Context window at ${(usagePct * 100).toFixed(0)}%. Consider wrapping up the current task or spawning a background agent for remaining work.`
  }
  ```

  With:
  ```typescript
  function buildWarningMessage(usagePct: number): string {
    const pct = (usagePct * 100).toFixed(0)
    return `⚠️ Context window at ${pct}%. Consider wrapping up the current task or spawning a background agent for remaining work.

  Update the sidebar: use todowrite to create or update a todo (in_progress, high priority): "Context: ${pct}% — wrap up soon"`
  }
  ```

  Replace `buildRecoveryMessage` (lines 46-54):
  ```typescript
  function buildRecoveryMessage(state: ContextWindowState, usagePct: number): string {
    return `🚨 Context window at ${(usagePct * 100).toFixed(0)}% (${state.usedTokens}/${state.maxTokens} tokens).

  IMMEDIATE ACTION REQUIRED:
  1. Save your current progress and findings to a notepad or file
  2. Summarize completed work and remaining tasks
  3. If work remains: spawn a background agent or ask the user to continue in a new session
  4. Do NOT attempt large new tasks — wrap up gracefully`
  }
  ```

  With:
  ```typescript
  function buildRecoveryMessage(state: ContextWindowState, usagePct: number): string {
    const pct = (usagePct * 100).toFixed(0)
    return `🚨 Context window at ${pct}% (${state.usedTokens}/${state.maxTokens} tokens).

  IMMEDIATE ACTION REQUIRED:
  1. Save your current progress and findings to a notepad or file
  2. Summarize completed work and remaining tasks
  3. If work remains: spawn a background agent or ask the user to continue in a new session
  4. Do NOT attempt large new tasks — wrap up gracefully

  Update the sidebar: use todowrite to create a todo (in_progress, high priority): "CONTEXT ${pct}% — save & stop"`
  }
  ```

  **Acceptance**: `bun test src/hooks/context-window-monitor.test.ts` passes. Warning message contains "todowrite". Recovery message contains "todowrite".

- [x] 5. **Enhance work-continuation prompts with todowrite restoration instructions**
  **What**: When a session resumes after being idle, the continuation prompt should tell the agent to restore the sidebar state (since todos from the previous interaction may be stale or lost).
  **Files**: `src/hooks/work-continuation.ts`
  **Changes**: Modify the `continuationPrompt` string in `checkContinuation()` (lines 37-47).

  Replace the continuation prompt (lines 37-47):
  ```typescript
    return {
      continuationPrompt: `You have an active work plan with incomplete tasks. Continue working.

  **Plan**: ${state.plan_name}
  **File**: ${state.active_plan}
  **Progress**: ${progress.completed}/${progress.total} tasks completed (${remaining} remaining)

  1. Read the plan file NOW to check exact current progress
  2. Find the first unchecked \`- [ ]\` task
  3. Execute it, verify it, mark \`- [ ]\` → \`- [x]\`
  4. Continue to the next task
  5. Do not stop until all tasks are complete`,
    }
  ```

  With:
  ```typescript
    return {
      continuationPrompt: `You have an active work plan with incomplete tasks. Continue working.

  **Plan**: ${state.plan_name}
  **File**: ${state.active_plan}
  **Progress**: ${progress.completed}/${progress.total} tasks completed (${remaining} remaining)

  1. Read the plan file NOW to check exact current progress
  2. Use todowrite to restore sidebar: summary todo "${state.plan_name} ${progress.completed}/${progress.total}" (in_progress) + next task (in_progress) + 2-3 upcoming (pending). Max 35 chars each.
  3. Find the first unchecked \`- [ ]\` task
  4. Execute it, verify it, mark \`- [ ]\` → \`- [x]\`
  5. Update sidebar todos as you complete tasks
  6. Do not stop until all tasks are complete`,
    }
  ```

  **Acceptance**: `bun test src/hooks/work-continuation.test.ts` passes. Continuation prompt contains "todowrite" and "sidebar".

- [x] 6. **Update tests for all modified hooks**
  **What**: Update existing test assertions that match on exact or partial strings that will change due to the modifications above. Add new test cases that verify the todowrite instructions are present in output.
  **Files**:
  - `src/hooks/start-work-hook.test.ts` — Add assertions for "SIDEBAR TODOS" in fresh and resume contexts
  - `src/hooks/context-window-monitor.test.ts` — Add assertions for "todowrite" in warning and recovery messages
  - `src/hooks/work-continuation.test.ts` — Add assertions for "todowrite" and "sidebar" in continuation prompt

  **Specific test changes**:

  In `start-work-hook.test.ts`:
  - The test on line 81 (`toContain("Starting Plan: my-feature")`) still passes (unchanged text).
  - Add a new assertion: `expect(result.contextInjection).toContain("SIDEBAR TODOS")` in the "auto-selects and creates work state" test.
  - Add a new assertion in the "resumes incomplete plan" test: `expect(result.contextInjection).toContain("SIDEBAR TODOS")`.

  In `context-window-monitor.test.ts`:
  - Find any test that asserts on the exact warning/recovery message text and update to match the new format.
  - Add a test: "warning message includes todowrite instruction" — verify `message` contains `"todowrite"`.
  - Add a test: "recovery message includes todowrite instruction" — verify `message` contains `"todowrite"`.

  In `work-continuation.test.ts`:
  - The existing test on line 61 (`toContain("1/3 tasks completed")`) still passes.
  - Add assertion: `expect(result.continuationPrompt).toContain("todowrite")`.
  - Add assertion: `expect(result.continuationPrompt).toContain("sidebar")`.

  **Acceptance**: `bun test` passes with 0 failures across all test files.

## Verification
- [x] `bun test` — all tests pass, no regressions
- [x] `bun run build` — no build errors or warnings
- [x] Manual review: each modified prompt/context string contains todowrite instructions
- [x] Manual review: all todo content examples in prompts are ≤ 35 characters
- [x] Manual review: no prompt suggests more than 5 concurrent visible todos

## Design Rationale

### Why this approach works
The sidebar is the only persistent visual feedback the user has while agents work. By teaching agents a consistent todo vocabulary (`K/N` progress format, agent-prefixed delegations, 35-char limit), the sidebar becomes a reliable status dashboard without any OpenCode modifications.

### Why `in_progress` is strategic
It's the only visually distinct status (yellow). We reserve it for exactly two scenarios: (1) the currently executing task, and (2) urgent alerts (context window). This prevents "yellow fatigue" where everything is highlighted.

### Why summary todos matter
A single `"plan-name 3/7 done"` todo gives instant progress visibility. It persists throughout execution and updates with each task, providing the user a single number to watch.

### Why we cap at 5 visible todos
The sidebar collapses at > 2 items. With 5 (1 summary + 1 active + 2-3 pending), the user sees meaningful depth without scroll fatigue. Completed items auto-mute, keeping the view fresh.

### Future Tier 2 considerations
If OpenCode later exposes a way to programmatically create todos from plugin hooks, we could:
- Auto-populate todos from plan checkboxes in `start-work-hook.ts`
- Auto-create context-window warning todos from `context-window-monitor.ts`
- This plan's prompt instructions would still be valuable as fallback/reinforcement
