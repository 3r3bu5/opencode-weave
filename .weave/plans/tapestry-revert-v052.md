# Full Revert to v0.5.2 + Cherry-pick Tapestry Verification

## TL;DR
> **Summary**: Revert all 14 files changed since v0.5.2 to their tagged state, then re-apply ONLY the Tapestry `<Verification>` section and step 3c reference, plus 7 corresponding tests.
> **Estimated Effort**: Medium

## Context
### Original Request
Full revert of the weave codebase to v0.5.2, then cherry-pick back ONLY the `<Verification>` section in Tapestry.

### Key Findings
- 18 commits and 14 files changed since v0.5.2
- Changes span Loom prompts, hooks (start-work, verification-reminder, work-continuation), plugin interface, workflow tests, and Tapestry
- The ONLY post-v0.5.2 content worth keeping is the Tapestry `<Verification>` section + step 3c reference
- v0.5.2 Tapestry has step 5 with post-execution review message — this is KEPT (it's the v0.5.2 original)
- v0.5.2 Tapestry has inline verification in step 3c — this gets REPLACED with the `<Verification>` protocol reference

## Objectives
### Core Objective
Return the entire codebase to v0.5.2, preserving only the Tapestry per-task verification protocol.

### Deliverables
- [x] All 14 changed files reverted to v0.5.2
- [x] `<Verification>` section re-applied to `src/agents/tapestry/default.ts`
- [x] Step 3c updated to reference `<Verification>` protocol
- [x] 7 Verification-related tests re-applied to `src/agents/tapestry/index.test.ts`
- [x] All tests pass

### Definition of Done
- [x] `bun test` passes with 0 failures
- [x] `git diff v0.5.2 -- $(git diff v0.5.2..HEAD --name-only | grep -v tapestry)` shows NO diff for non-Tapestry files
- [x] `git diff v0.5.2 -- src/agents/tapestry/default.ts` shows ONLY the Verification section + step 3c change
- [x] `git diff v0.5.2 -- src/agents/tapestry/index.test.ts` shows ONLY the 7 Verification tests

### Guardrails (Must NOT)
- Do NOT modify any files not in the 14-file list
- Do NOT introduce any content that wasn't in v0.5.2 or the Verification cherry-pick
- The ONLY non-v0.5.2 content after completion should be in `src/agents/tapestry/default.ts` and `src/agents/tapestry/index.test.ts`
- Do NOT remove the v0.5.2 step 5 post-execution review wording — it's the original

## TODOs

- [x] 1. Batch revert ALL 14 files to v0.5.2
  **What**: Use `git checkout v0.5.2 -- <files>` to revert every changed file to its v0.5.2 state in a single command.
  **Files**: All 14 files:
  - `src/agents/loom/default.ts`
  - `src/agents/loom/index.test.ts`
  - `src/agents/tapestry/default.ts`
  - `src/agents/tapestry/index.test.ts`
  - `src/hooks/start-work-hook.ts`
  - `src/hooks/start-work-hook.test.ts`
  - `src/hooks/verification-reminder.ts`
  - `src/hooks/verification-reminder.test.ts`
  - `src/hooks/work-continuation.ts`
  - `src/hooks/work-continuation.test.ts`
  - `src/plugin/plugin-interface.ts`
  - `src/plugin/plugin-interface.test.ts`
  - `src/workflow.test.ts`
  - `progress.txt`
  **Command**:
  ```bash
  git checkout v0.5.2 -- \
    src/agents/loom/default.ts \
    src/agents/loom/index.test.ts \
    src/agents/tapestry/default.ts \
    src/agents/tapestry/index.test.ts \
    src/hooks/start-work-hook.ts \
    src/hooks/start-work-hook.test.ts \
    src/hooks/verification-reminder.ts \
    src/hooks/verification-reminder.test.ts \
    src/hooks/work-continuation.ts \
    src/hooks/work-continuation.test.ts \
    src/plugin/plugin-interface.ts \
    src/plugin/plugin-interface.test.ts \
    src/workflow.test.ts \
    progress.txt
  ```
  **Acceptance**: `git diff v0.5.2 -- <all 14 files>` shows zero diff. All 14 files are byte-identical to v0.5.2.

- [x] 2. Re-apply step 3c change in `src/agents/tapestry/default.ts`
  **What**: Replace the v0.5.2 inline verification step 3c with the version that references `<Verification>` protocol.
  **Files**: `src/agents/tapestry/default.ts`
  **Edit**:
  - **oldString**:
    ```
   c. Verify: Read changed files, run tests, check acceptance criteria. If uncertain about quality, note that Loom should invoke Weft for formal review.
    ```
  - **newString**:
    ```
   c. Verify: Follow the <Verification> protocol below — ALL checks must pass before marking complete. If uncertain about quality, note that Loom should invoke Weft for formal review.
    ```
  **Acceptance**: Step 3c contains `<Verification> protocol below` instead of `Read changed files, run tests`.

- [x] 3. Re-apply `<Verification>` section in `src/agents/tapestry/default.ts`
  **What**: Insert the `<Verification>` section between `</PlanExecution>` and `<Execution>`. The v0.5.2 file has `</PlanExecution>` immediately followed by `<Execution>`.
  **Files**: `src/agents/tapestry/default.ts`
  **Edit**:
  - **oldString**:
    ```
</PlanExecution>

<Execution>
    ```
  - **newString**:
    ```
</PlanExecution>

<Verification>
After completing work for each task — BEFORE marking \`- [ ]\` → \`- [x]\`:

1. **Inspect changes**:
   - Review your Edit/Write tool call history to identify all files you modified
   - Read EVERY changed file to confirm correctness
   - Cross-check: does the code actually implement what the task required?

2. **Validate acceptance criteria**:
   - Re-read the task's acceptance criteria from the plan
   - Verify EACH criterion is met — exactly, not approximately
   - If any criterion is unmet: address it, then re-verify

3. **Accumulate learnings** (if \`.weave/learnings/{plan-name}.md\` exists or plan has multiple tasks):
   - After verification passes, append 1-3 bullet points of key findings
   - Before starting the NEXT task, read the learnings file for context from previous tasks

**Gate**: Only mark complete when ALL checks pass. If ANY check fails, fix first.
</Verification>

<Execution>
    ```
  **Acceptance**: File contains `<Verification>` section between `</PlanExecution>` and `<Execution>`. Content matches exactly.

- [x] 4. Re-apply 7 Verification-related tests in `src/agents/tapestry/index.test.ts`
  **What**: After revert, the test file has 7 tests (v0.5.2 state). Add back the 7 Verification-related tests, and update the existing "completion step mentions post-execution review" test to assert the opposite (since step 5 still has post-execution review but we also need the Verification tests).
  
  Wait — step 5 is v0.5.2 original (WITH post-execution review). So the v0.5.2 test `it("completion step mentions post-execution review"...)` is CORRECT and should stay. We just need to ADD the 7 new tests after it.
  
  **Files**: `src/agents/tapestry/index.test.ts`
  **Edit**:
  - **oldString**:
    ```
  it("completion step mentions post-execution review", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("Post-execution review required")
  })
})
    ```
  - **newString**:
    ```
  it("completion step mentions post-execution review", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("Post-execution review required")
  })

  it("contains a Verification section", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("<Verification>")
    expect(prompt).toContain("</Verification>")
  })

  it("verification protocol mentions tool call history instead of git diff", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("Edit/Write tool call history")
    expect(prompt).not.toContain("git diff")
  })

  it("verification protocol does NOT mention automated checks (removed)", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).not.toContain("Run automated checks")
    expect(prompt).not.toContain("bun test")
  })

  it("verification protocol does NOT mention type-checking (LSP handles this)", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).not.toContain("type/build check")
  })

  it("verification protocol mentions acceptance criteria", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("acceptance criteria")
  })

  it("verification protocol does NOT mention security-sensitive flagging (removed)", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).not.toContain("Flag security-sensitive")
  })

  it("PlanExecution step 3c references the Verification section", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("<Verification>")
    // Step 3c should reference the Verification protocol
    const planExec = prompt.slice(prompt.indexOf("<PlanExecution>"), prompt.indexOf("</PlanExecution>"))
    expect(planExec).toContain("Verification")
  })
})
    ```
  **Acceptance**: Test file has 14 total tests (7 original + 7 new Verification tests). All pass.

- [x] 5. Run full test suite to verify everything passes
  **What**: Run all tests across the entire codebase to confirm no regressions.
  **Files**: None (test execution only)
  **Command**: `bun test`
  **Acceptance**: All tests pass with 0 failures, 0 skipped. Specifically:
  - `src/agents/tapestry/index.test.ts` — 14 tests pass
  - `src/agents/loom/index.test.ts` — all tests pass (restored v0.5.2 tests)
  - `src/hooks/` — all hook tests pass
  - `src/plugin/plugin-interface.test.ts` — all tests pass
  - `src/workflow.test.ts` — all tests pass

## Verification
- [x] All tests pass: `bun test` exits 0
- [x] Non-Tapestry files are byte-identical to v0.5.2: `git diff v0.5.2 -- src/agents/loom/ src/hooks/ src/plugin/ src/workflow.test.ts progress.txt` shows empty diff
- [x] Tapestry prompt contains `<Verification>` section
- [x] Tapestry step 3c references `<Verification>` protocol
- [x] Tapestry step 5 contains v0.5.2 post-execution review wording
- [x] Tapestry test file has exactly 14 tests (7 original + 7 Verification)
- [x] Build succeeds with no warnings: `bun build src/index.ts --outdir /dev/null` or equivalent
