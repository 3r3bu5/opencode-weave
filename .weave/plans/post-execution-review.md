# Post-Execution Review Workflow

## TL;DR
> **Summary**: After Tapestry completes all plan tasks, automatically switch to Loom and trigger Weft/Warp review of the completed work — closing the "no review after execution" gap.
> **Estimated Effort**: Short

## Context
### Original Request
When Tapestry finishes executing a plan (all checkboxes checked), the session goes idle and nobody reviews the work. Weft/Warp are never invoked because Tapestry has `task=false`. We need an automated handoff back to Loom so it can invoke review agents.

### Key Findings
1. **`checkContinuation` in `work-continuation.ts`** — Currently returns `{ continuationPrompt: null }` when plan is complete (line 36-39). This is where we inject the review prompt instead.
2. **`plugin-interface.ts` event handler (lines 182-206)** — Calls `workContinuation` on `session.idle`, then injects the continuation prompt via `client.session.promptAsync()`. Currently does NOT pass `agent` to `promptAsync`, but the SDK's `SessionPromptAsyncData` type confirms `agent?: string` is a supported field.
3. **`getAgentDisplayName("loom")` → `"Loom (Main Orchestrator)"`** — Already exists in `agent-display-names.ts`. We use this to switch to Loom.
4. **Loom's prompt** — Has `<ReviewWorkflow>` and `<PlanWorkflow>` sections. Needs a new `<PostExecutionReview>` section explaining how to handle automated review triggers.
5. **Existing tests** — `work-continuation.test.ts` has 7 tests. Two tests assert that `continuationPrompt` is `null` when plan is complete — these must be updated to expect the new review prompt. `plugin-interface.test.ts` has a test for `promptAsync` that doesn't check for `agent` — needs a new test.
6. **WorkState contains `active_plan` (path) and `plan_name`** — Both are available to construct the review prompt before clearing state.

## Objectives
### Core Objective
When a plan completes, fire a review prompt to Loom (via agent switch) so it invokes Weft and optionally Warp to review all changes.

### Deliverables
- [x] `ContinuationResult` type extended with `switchAgent?: string`
- [x] `checkContinuation` returns review prompt + `switchAgent: "loom"` on plan completion
- [x] `plugin-interface.ts` passes `agent` to `promptAsync` when `switchAgent` is set
- [x] Loom prompt updated with `<PostExecutionReview>` instructions
- [x] Tests updated and new tests added

### Definition of Done
- [x] `bun test` passes with no failures
- [x] `bun run build` succeeds with no warnings
- [x] When a plan completes, `checkContinuation` returns a review prompt targeting Loom (verified by unit test)
- [x] When `switchAgent` is set, `promptAsync` receives `agent` field (verified by unit test)

### Guardrails (Must NOT)
- Do NOT change Tapestry's prompt or behavior — Tapestry stays `task=false`
- Do NOT add new dependencies
- Do NOT change the `WorkState` type
- Do NOT change behavior when plan is incomplete (continuation prompt stays the same)
- Do NOT change behavior when no work state exists (fast exit stays the same)

## TODOs

- [x] 1. **Extend `ContinuationResult` type**
  **What**: Add optional `switchAgent` field to `ContinuationResult` interface.
  **Files**: `src/hooks/work-continuation.ts`
  **Change**:
  ```typescript
  export interface ContinuationResult {
    /** Continuation prompt to inject, or null if no active work */
    continuationPrompt: string | null
    /** Agent to switch to when injecting the prompt (config key, e.g. "loom") */
    switchAgent?: string
  }
  ```
  **Acceptance**: Type compiles. Existing callers unaffected (field is optional).

- [x] 2. **Return review prompt on plan completion**
  **What**: In `checkContinuation`, when `progress.isComplete` and `progress.total > 0`, capture plan info before clearing state, then return a review prompt with `switchAgent: "loom"`.
  **Files**: `src/hooks/work-continuation.ts`
  **Change**: Replace the `isComplete` branch (lines 36-39):
  ```typescript
  if (progress.isComplete) {
    // Capture plan info before clearing state
    const planPath = state.active_plan
    const planName = state.plan_name
    clearWorkState(directory)
    return {
      continuationPrompt: `Tapestry has completed all tasks in the plan "${planName}".

**Plan file**: ${planPath}
**Status**: All ${progress.total} tasks marked complete.

## Review Instructions

1. **Invoke Weft** to review all changes made during this plan execution. Tell Weft to check the git diff for quality, correctness, and adherence to the plan's acceptance criteria.
2. **Invoke Warp** if any changes touch security-relevant areas (auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows). When in doubt, invoke Warp — false positives are cheap.
3. **Report findings** to the user with a concise summary of the review results.
4. **Suggest next steps** if any issues are found.

This is an automated post-execution review. Do NOT skip it.`,
      switchAgent: "loom",
    }
  }
  ```
  **Acceptance**: Unit test confirms review prompt is returned with `switchAgent: "loom"` when plan is complete. State is still cleared.

- [x] 3. **Pass `agent` to `promptAsync` in plugin-interface**
  **What**: When `result.switchAgent` is set, include `agent` in the `promptAsync` body so OpenCode routes the message to the correct agent.
  **Files**: `src/plugin/plugin-interface.ts`
  **Change**: Modify the `session.idle` handler (lines 188-196). Replace:
  ```typescript
  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      parts: [
        { type: "text" as const, text: result.continuationPrompt },
      ],
    },
  })
  ```
  With:
  ```typescript
  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      ...(result.switchAgent ? { agent: getAgentDisplayName(result.switchAgent) } : {}),
      parts: [
        { type: "text" as const, text: result.continuationPrompt },
      ],
    },
  })
  ```
  Note: `getAgentDisplayName` is already imported in this file (line 7).
  **Acceptance**: When `switchAgent` is `"loom"`, `promptAsync` receives `agent: "Loom (Main Orchestrator)"`. When `switchAgent` is undefined, no `agent` field is passed (backward compatible).

- [x] 4. **Add `<PostExecutionReview>` section to Loom's prompt**
  **What**: Add instructions to Loom's system prompt so it knows how to handle automated review triggers from completed plans.
  **Files**: `src/agents/loom/default.ts`
  **Change**: Insert a new `<PostExecutionReview>` section after `</ReviewWorkflow>` (after line 131, before `<Style>`):
  ```
  <PostExecutionReview>
  When you receive an automated review trigger after Tapestry completes a plan:

  1. Narrate to the user: "Tapestry completed [plan name]. Running automated review..."
  2. Invoke Weft to review the git diff — check quality, correctness, and acceptance criteria adherence
  3. If any changed files touch security-relevant areas (auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML) → invoke Warp in parallel with Weft
  4. Summarize review findings to the user:
     - If both approve: "Review passed — all changes look good."
     - If issues found: List the specific issues and suggest concrete fixes
  5. Mark all sidebar todos completed after reporting

  This review is automatic — do NOT ask the user for permission to review.
  </PostExecutionReview>
  ```
  **Acceptance**: Loom's prompt contains `<PostExecutionReview>` section. No other prompt sections are modified.

- [x] 5. **Update existing tests for new return type**
  **What**: Two existing tests in `work-continuation.test.ts` assert `continuationPrompt` is `null` when plan is complete. These must be updated to expect the review prompt instead. One test also asserts state is cleared — that behavior is preserved.
  **Files**: `src/hooks/work-continuation.test.ts`
  **Changes**:
  - **Test "returns null when plan is complete" (line 39-45)**: Update to expect `continuationPrompt` to be a non-null string containing "review" or "Weft". Also check `switchAgent` is `"loom"`.
  - **Test "clears state.json when plan is complete" (line 47-54)**: Keep the `readWorkState` assertion. Also verify the result has a non-null `continuationPrompt`.
  - **Test "subsequent call returns null immediately after state cleared" (line 101-112)**: First call now returns a review prompt (not null). Second call still returns null. Update the first-call assertion.
  **Acceptance**: All updated tests pass. No existing test semantics broken for incomplete/missing plan cases.

- [x] 6. **Add new tests for review prompt behavior**
  **What**: Add tests covering the review prompt content and `switchAgent` field.
  **Files**: `src/hooks/work-continuation.test.ts`
  **New tests**:
  ```typescript
  it("returns review prompt with switchAgent when plan is complete", () => {
    const planPath = createPlanFile("done", "# Done\n- [x] Task 1\n- [x] Task 2\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
    expect(result.continuationPrompt).toContain("Weft")
    expect(result.continuationPrompt).toContain("Warp")
    expect(result.continuationPrompt).toContain("done")  // plan name
    expect(result.continuationPrompt).toContain(planPath)
    expect(result.switchAgent).toBe("loom")
  })

  it("review prompt includes task count", () => {
    const planPath = createPlanFile("big-plan", "# Big\n- [x] A\n- [x] B\n- [x] C\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toContain("3")  // total tasks
  })

  it("does not set switchAgent for incomplete plans", () => {
    const planPath = createPlanFile("wip", "# WIP\n- [x] Done\n- [ ] Pending\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.switchAgent).toBeUndefined()
  })

  it("does not set switchAgent when no work state", () => {
    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.switchAgent).toBeUndefined()
  })
  ```
  **Acceptance**: All new tests pass.

- [x] 7. **Add plugin-interface test for agent switching on review prompt**
  **What**: Add a test in `plugin-interface.test.ts` verifying that when `workContinuation` returns `switchAgent`, `promptAsync` receives the `agent` field with the display name.
  **Files**: `src/plugin/plugin-interface.test.ts`
  **New test**:
  ```typescript
  it("event handler passes agent to promptAsync when workContinuation returns switchAgent", async () => {
    const promptAsyncCalls: Array<{ path: { id: string }; body: { agent?: string; parts: Array<{ type: string; text: string }> } }> = []

    const mockClient = {
      session: {
        promptAsync: async (opts: { path: { id: string }; body: { agent?: string; parts: Array<{ type: string; text: string }> } }) => {
          promptAsyncCalls.push(opts)
        },
      },
    } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

    const hooks = makeHooks({
      workContinuation: (_sessionId: string) => ({
        continuationPrompt: "Review the completed work.",
        switchAgent: "loom",
      }),
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      client: mockClient,
    })

    const event = { type: "session.idle", properties: { sessionID: "sess-review-1" } }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    expect(promptAsyncCalls.length).toBe(1)
    expect(promptAsyncCalls[0].body.agent).toBe("Loom (Main Orchestrator)")
    expect(promptAsyncCalls[0].body.parts[0].text).toBe("Review the completed work.")
  })

  it("event handler does not pass agent to promptAsync when switchAgent is undefined", async () => {
    const promptAsyncCalls: Array<{ path: { id: string }; body: Record<string, unknown> }> = []

    const mockClient = {
      session: {
        promptAsync: async (opts: { path: { id: string }; body: Record<string, unknown> }) => {
          promptAsyncCalls.push(opts)
        },
      },
    } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

    const hooks = makeHooks({
      workContinuation: (_sessionId: string) => ({
        continuationPrompt: "Continue working.",
      }),
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      client: mockClient,
    })

    const event = { type: "session.idle", properties: { sessionID: "sess-no-switch" } }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    expect(promptAsyncCalls.length).toBe(1)
    expect(promptAsyncCalls[0].body.agent).toBeUndefined()
  })
  ```
  **Acceptance**: Both tests pass. Existing `promptAsync` test still passes.

## Implementation Order

```
1. ContinuationResult type (no deps)
2. checkContinuation logic (depends on 1)
3. plugin-interface.ts agent passing (depends on 1)
4. Loom prompt update (no deps, can parallel with 2-3)
5. Update existing tests (depends on 2)
6. New work-continuation tests (depends on 2)
7. New plugin-interface tests (depends on 3)
```

Tasks 1-4 are the production code changes. Tasks 5-7 are tests. Tasks 2 and 3 can be done in parallel since they depend only on 1. Task 4 is independent.

## Verification
- [x] `bun run build` succeeds with no TypeScript errors or warnings
- [x] `bun test src/hooks/work-continuation.test.ts` — all tests pass
- [x] `bun test src/plugin/plugin-interface.test.ts` — all tests pass
- [x] `bun test` — full suite passes, no regressions
- [x] Manual check: `checkContinuation` returns `switchAgent: "loom"` with review prompt when plan is complete
- [x] Manual check: `checkContinuation` returns `switchAgent: undefined` with continuation prompt when plan is incomplete
- [x] Manual check: `promptAsync` body includes `agent: "Loom (Main Orchestrator)"` only when `switchAgent` is set

## Pitfalls & Mitigations

| Pitfall | Mitigation |
|---------|------------|
| Review prompt fires on plans with 0 checkboxes | Already handled: `progress.total === 0` branch returns null before the `isComplete` branch |
| State cleared before we read plan info | Capture `state.active_plan` and `state.plan_name` BEFORE calling `clearWorkState()` |
| `promptAsync` agent field rejected by SDK | Confirmed: `SessionPromptAsyncData` type includes `agent?: string` — field is supported |
| Infinite loop: Loom finishes review → idle → tries to continue | No risk: state is already cleared before returning the review prompt, so next idle event takes the "no state" fast exit |
| Existing tests break silently | Two specific tests must be updated (listed in TODO 5). The test assertions are explicit about what changed. |
