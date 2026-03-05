# Remove Tapestry→Loom Agent-Switch Hacks and Post-Execution Review Logic

## TL;DR
> **Summary**: Remove all pendingAgentSwitch machinery, plan-completion agent switching in `tool.execute.after`, review handoff in work-continuation, and post-execution review mandates from Tapestry/Loom prompts. When a plan completes, Tapestry simply says "done".
> **Estimated Effort**: Medium

## Context
### Original Request
Remove ALL Tapestry→Loom agent-switch workarounds and post-execution review logic. When Tapestry finishes a plan, it just reports completion — no forced agent switch to Loom, no injected review prompt, no mandatory Weft/Warp post-execution review gate.

### Key Findings
The agent-switch hack spans 5 source files and 4 test files, with deeply intertwined logic:

1. **`pendingAgentSwitch` Map** (plugin-interface.ts L19): Module-level Map bridging `tool.execute.after` → `chat.message`. Set on plan-completion in `tool.execute.after` (L342), consumed in `chat.message` (L58-72) to mutate `message.agent`.

2. **Plan-completion block in `tool.execute.after`** (plugin-interface.ts L317-355): When an edit targets a plan file AND `workContinuation` returns a `targetAgent`, it calls `client.session.promptAsync` to inject a Loom-targeted prompt AND sets the pending switch.

3. **Review handoff in `checkContinuation`** (work-continuation.ts L38-58): When `progress.isComplete`, returns `{ continuationPrompt: <review instructions>, targetAgent: "Loom (Main Orchestrator)" }` with Weft/Warp review mandate. Also uses `review_triggered` flag to fire only once.

4. **`review_triggered` field** (types.ts L17): Field on `WorkState` used solely for the review gate deduplication.

5. **Tapestry prompt line** (default.ts L70): `"All tasks complete. **Post-execution review required** — Loom must run Weft and Warp before reporting success."`

6. **Loom PlanWorkflow Step 5** (default.ts L102-111): Entire mandatory post-execution review section with Weft+Warp parallel delegation.

7. **Loom ReviewWorkflow Post-Plan section** (default.ts L120-124): `"Post-Plan-Execution Review"` block mandating both Weft and Warp.

8. **`ContinuationResult.targetAgent`** (work-continuation.ts L18): Interface field only used for review handoff — the incomplete-plan path never sets it.

9. **`session.idle` event handler** (plugin-interface.ts L205-234): Uses `targetAgent` from workContinuation result to route the promptAsync — this is for BOTH incomplete continuation AND completion. After removal, it still needs to work for incomplete plans (which never set `targetAgent`), but the `targetAgent` conditional spreading becomes dead code.

## Objectives
### Core Objective
Remove all Tapestry→Loom agent-switching mechanics and post-execution review mandates so plan completion is a simple "done" from Tapestry with no further automation.

### Deliverables
- [x] `pendingAgentSwitch` Map and all references removed
- [x] Plan-completion block in `tool.execute.after` removed
- [x] `checkContinuation` returns `{ continuationPrompt: null }` when plan is complete (no review handoff)
- [x] `review_triggered` field removed from `WorkState` type
- [x] `targetAgent` field removed from `ContinuationResult` interface
- [x] `session.idle` handler simplified (no targetAgent spreading)
- [x] Tapestry prompt: completion step says "done" without review mandate
- [x] Loom prompt: PlanWorkflow Step 5 removed, ReviewWorkflow Post-Plan section removed
- [x] All test files updated to match new behavior
- [x] `getAgentDisplayName` import removed from work-continuation.ts (unused after changes)

### Definition of Done
- [x] `bun test` passes with zero failures
- [x] `bun run build` succeeds with no warnings
- [x] No references to `pendingAgentSwitch` remain in codebase
- [x] No references to `review_triggered` remain in codebase
- [x] `grep -r "Post-execution review" src/` returns zero results
- [x] `grep -r "targetAgent" src/hooks/work-continuation` returns zero results

### Guardrails (Must NOT)
- Must NOT change the incomplete-plan continuation behavior (session.idle still nudges Tapestry to keep working)
- Must NOT remove the `session.idle` event handler itself — only strip the targetAgent/review parts
- Must NOT remove Weft/Warp agents or their ad-hoc review capabilities — only the MANDATORY post-plan review gate
- Must NOT change the `/start-work` command behavior
- Must NOT remove the verification-reminder hook (Tapestry self-verification is separate from Loom's post-execution review)

## TODOs

- [x] 1. Remove `pendingAgentSwitch` and `chat.message` consumption logic from plugin-interface.ts
  **What**: Delete the `pendingAgentSwitch` Map declaration (L19), the comment above it (L16-18), and the entire consumption block in `chat.message` (L56-72). Also remove the `getAgentDisplayName` import if it's only used here (check — it's also used in `chat.message` for start-work, so it stays).
  **Files**: `src/plugin/plugin-interface.ts`
  **Acceptance**: No references to `pendingAgentSwitch` in the file. `chat.message` handler no longer reads/mutates `message.agent` based on pending switches.

- [x] 2. Remove plan-completion block from `tool.execute.after` in plugin-interface.ts
  **What**: Delete the entire block from L317-355 (`// Plan completion check: when a plan file edit completes all tasks...` through the closing `}`). This block calls `workContinuation`, `client.session.promptAsync`, and sets `pendingAgentSwitch`. Keep the verification-reminder block above it (L299-315) intact.
  **Files**: `src/plugin/plugin-interface.ts`
  **Acceptance**: `tool.execute.after` no longer calls `workContinuation` or `client.session.promptAsync`. Only delegation logging and verification-reminder logic remain.

- [x] 3. Simplify `session.idle` handler to remove `targetAgent` logic in plugin-interface.ts
  **What**: In the `event` handler's `session.idle` block (L205-234), simplify the `promptAsync` call body. Since `ContinuationResult` will no longer have `targetAgent`, remove:
  - The `...(result.targetAgent ? { agent: result.targetAgent } : {})` spread in body
  - The `...(result.targetAgent ? [{ type: "agent" ... }] : [])` spread in parts
  - The `...(result.targetAgent ? { targetAgent: result.targetAgent } : {})` spread in the log
  The result should be a simple `{ parts: [{ type: "text", text: result.continuationPrompt }] }` body.
  **Files**: `src/plugin/plugin-interface.ts`
  **Acceptance**: `session.idle` handler no longer references `targetAgent`. Incomplete plan continuation still works via text-only prompt.

- [x] 4. Simplify `checkContinuation` in work-continuation.ts — return null on complete plans
  **What**: 
  - In the `isComplete` branch (L38-58): Replace the entire review-handoff block with `return { continuationPrompt: null }`. Delete the `review_triggered` check, the `writeWorkState` call, and the review instructions string.
  - Remove the `targetAgent` field from the `ContinuationResult` interface (L18).
  - Remove the `import { getAgentDisplayName }` (L7) — no longer used.
  - Remove the `import { writeWorkState }` from the imports (L6) — check if `readWorkState` import needs to stay (yes, it's used on L28). Only `writeWorkState` is removed.
  **Files**: `src/hooks/work-continuation.ts`
  **Acceptance**: `checkContinuation` returns `{ continuationPrompt: null }` when plan is complete. No `targetAgent` field on `ContinuationResult`. No `review_triggered` reference. No `getAgentDisplayName` import.

- [x] 5. Remove `review_triggered` from `WorkState` type
  **What**: Delete line 17 (`review_triggered?: boolean`) and its JSDoc comment (L16) from the `WorkState` interface.
  **Files**: `src/features/work-state/types.ts`
  **Acceptance**: `WorkState` type no longer has `review_triggered` field. TypeScript compilation succeeds.

- [x] 6. Update Tapestry prompt — remove post-execution review mandate
  **What**: In `src/agents/tapestry/default.ts`, change PlanExecution step 5 (L69-70) from:
  ```
  5. When ALL checkboxes are checked, report final summary and include:
     "All tasks complete. **Post-execution review required** — Loom must run Weft and Warp before reporting success."
  ```
  To:
  ```
  5. When ALL checkboxes are checked, report final summary: "All N tasks complete."
  ```
  **Files**: `src/agents/tapestry/default.ts`
  **Acceptance**: Tapestry prompt no longer mentions "Post-execution review", "Loom", "Weft", or "Warp" in the completion step.

- [x] 7. Update Loom prompt — remove PlanWorkflow Step 5 and ReviewWorkflow Post-Plan section
  **What**: In `src/agents/loom/default.ts`:
  
  **A. Remove PlanWorkflow Step 5** (L102-111): Delete the entire `5. POST-EXECUTION REVIEW (MANDATORY — NO SKIP CONDITIONS):` block including all sub-points (a-e) and the two trailing lines about skip conditions/workflow violation. Renumber: there is no Step 5 now. The workflow ends at Step 4 (RESUME).
  
  **B. Remove ReviewWorkflow Post-Plan section** (L120-124): Delete the `**Post-Plan-Execution Review (after PlanWorkflow Step 5):**` block (L120-124: the 5 lines starting with `**Post-Plan-Execution Review` through `- Both must APPROVE before reporting success to the user`). Keep the `**Ad-Hoc Review**` section intact. Update the opening line of `<ReviewWorkflow>` from "Two review modes" to reflect there's only one mode now.
  
  **Files**: `src/agents/loom/default.ts`
  **Acceptance**: Loom prompt has no PlanWorkflow Step 5. ReviewWorkflow only contains ad-hoc review. No mention of "Post-Plan-Execution Review" or "MANDATORY — NO SKIP CONDITIONS" in the prompt.

- [x] 8. Update plugin-interface.test.ts — remove `pendingAgentSwitch` and plan-completion tests
  **What**: 
  
  **A. Remove entire `describe("pending agent switch")` block** (L1067-1267): This is 5 tests that all exercise the pendingAgentSwitch logic. All of them should be deleted.
  
  **B. Remove/rewrite `describe("plan completion on edit")` block** (L898-1065): 
  - Delete test "tool.execute.after calls promptAsync when plan edit completes all tasks" (L899-936) — this no longer happens.
  - Delete test "tool.execute.after does NOT call promptAsync when plan has remaining tasks" (L938-971) — this test asserts promptAsync is NOT called, which is trivially true now since we removed the entire block. It's testing dead logic; delete it.
  - Delete test "tool.execute.after does NOT call promptAsync for non-plan file edits" (L973-1006) — same reasoning.
  - Delete test "tool.execute.after does not crash when client is absent and plan is complete" (L1008-1031) — dead logic.
  - Delete test "tool.execute.after does not crash when promptAsync throws" (L1033-1064) — dead logic.
  
  The entire `describe("plan completion on edit")` block can be deleted.
  
  **C. Update event handler test** (L402-434): The test "event handler calls client.session.promptAsync when workContinuation returns a continuationPrompt" — the mock `workContinuation` currently returns `{ continuationPrompt: "..." }` without `targetAgent`, which matches the new interface. Check the assertions: `promptAsyncCalls[0].body.parts[0].text` — after simplification, parts will be `[{ type: "text", text: "..." }]` so `parts[0].text` is correct. This test should still pass as-is, but verify the body structure matches the simplified code (no agent field, no agent part).
  
  **Files**: `src/plugin/plugin-interface.test.ts`
  **Acceptance**: No test references `pendingAgentSwitch`. No "plan completion on edit" describe block. Existing event handler test still passes.

- [x] 9. Update work-continuation.test.ts — plan complete returns null, no review logic
  **What**: 
  
  **A. Rewrite test "returns review handoff when plan is complete"** (L39-49): Change to assert `result.continuationPrompt` IS null and `result.targetAgent` is undefined (or doesn't exist). Rename to "returns null when plan is complete".
  
  **B. Remove test "returns null on second call after review already triggered"** (L51-63): No longer relevant — first call also returns null now. Delete this test.
  
  **C. Remove test "sets review_triggered flag in state after first fire"** (L65-74): `review_triggered` no longer exists. Delete this test.
  
  **D. Remove `getAgentDisplayName` import** (L6): No longer used in test file.
  
  **E. Keep tests**: "returns null when no work state exists" (L34-37), "returns null when plan file is missing" (L76-82), "returns continuation prompt for incomplete plan" (L84-96), "includes plan file path in continuation prompt" (L98-104) — these all remain valid.
  
  **F. In "returns continuation prompt for incomplete plan"** (L90): `expect(result.targetAgent).toBeUndefined()` — this assertion should be removed since `targetAgent` no longer exists on the interface. Or keep it as a defensive check that the field doesn't exist.
  
  **Files**: `src/hooks/work-continuation.test.ts`
  **Acceptance**: No test asserts `review_triggered`, `targetAgent`, or review handoff. Plan-complete test asserts `continuationPrompt` is null.

- [x] 10. Update workflow.test.ts — remove post-execution review assertions
  **What**: 
  
  **A. Phase 3 test "idle session with complete plan gets no continuation"** (L225-233): This test marks all tasks complete then calls `checkContinuation`. It currently expects `result.continuationPrompt` to be null — BUT WAIT, looking at the test closely: it calls `markTaskComplete` twice on a 2-task plan, then checks. The existing test asserts `result.continuationPrompt` is null... but in current code, the first call returns the review prompt and sets `review_triggered`, so the second call returns null. Actually, re-reading: there's only ONE call to `checkContinuation`. Current code: complete plan → returns review prompt (not null). So this test might actually be WRONG in current code, OR the test was written expecting our new behavior. Let me re-read: L232 says `expect(result.continuationPrompt).toBeNull()`. In current code, first call on complete plan returns the review prompt (NOT null). This test would currently FAIL. It may be that the test accounts for the `review_triggered` flag being set by a previous test... but `beforeEach` creates a fresh `testDir`. This test will need verification. **In the new code, a complete plan returns null, so this assertion is correct for our target behavior.**
  
  **B. Integration test "startWork → workContinuation → full cycle"** (L536-563): Lines 560-562 assert `cont2.targetAgent` is the Loom display name and `cont2.continuationPrompt` contains "post-execution review". Change these to:
  - `expect(cont2.continuationPrompt).toBeNull()` (plan complete → null)
  - Remove `expect(cont2.targetAgent)...` assertion
  
  **C. Full lifecycle test** (L619-753):
  - Lines 694-697: Asserts `cont2.targetAgent` is Loom and `continuationPrompt` contains "post-execution review". Change to: `expect(cont2.continuationPrompt).toBeNull()`.
  - Lines 730-741: Asserts Loom's PlanWorkflow contains Step 5, "MANDATORY", "Weft", "Warp", "BOTH". Delete these assertions (L730-741).
  - Lines 744-746: Asserts Tapestry prompt contains "Post-execution review required". Change to assert it does NOT contain "Post-execution review required".
  
  **Files**: `src/workflow.test.ts`
  **Acceptance**: No test asserts `targetAgent` from `checkContinuation`. No test asserts "post-execution review" in continuation prompts. Loom PlanWorkflow Step 5 assertions removed. Tapestry post-review assertion reversed.

- [x] 11. Update tapestry/index.test.ts — remove post-execution review assertion
  **What**: Test "completion step mentions post-execution review" (L34-38) asserts `prompt.contains("Post-execution review required")`. This should be changed to assert the prompt does NOT contain that text, or the test should be rewritten to assert the new completion text (e.g., "All" and "tasks complete").
  **Files**: `src/agents/tapestry/index.test.ts`
  **Acceptance**: Test passes with new Tapestry prompt.

- [x] 12. Update loom/index.test.ts — remove PlanWorkflow Step 5 and Post-Plan review tests
  **What**: Several tests assert the now-removed content:
  
  **A. "PlanWorkflow Step 2 has skip condition but Step 5 does not"** (L50-64): Remove the Step 5 portion of this test (L60-63). Keep the Step 2 assertion. Rename test.
  
  **B. "PlanWorkflow contains Step 5 POST-EXECUTION REVIEW"** (L111-121): Delete entirely.
  
  **C. "PlanWorkflow Step 5 always invokes both Weft and Warp"** (L123-132): Delete entirely.
  
  **D. "PlanWorkflow Step 5 has no skip conditions"** (L134-144): Delete entirely.
  
  **E. "ReviewWorkflow distinguishes post-plan and ad-hoc review modes"** (L146-156): Update — remove assertion for "Post-Plan-Execution Review" (L153) and "No skip conditions" (L155). Keep "Ad-Hoc Review" assertion.
  
  **F. Keep tests**: "PlanWorkflow review step is not marked optional" (L29-37), "PlanWorkflow specifies review trigger conditions" (L39-48), "ReviewWorkflow contains mandatory Warp invocation language" (L66-75), "ReviewWorkflow contains all security trigger keywords" (L77-88), "PlanWorkflow references Warp for security-relevant plans" (L90-99), "Delegation section uses mandatory language for Warp" (L101-109). These reference Step 2 review and ad-hoc review — still valid. BUT: check that the PlanWorkflow still references Warp after Step 5 removal. The Step 2 MANDATORY Warp line (L97 in default.ts) is in the plan-review step, not post-execution, so it stays.
  
  **Files**: `src/agents/loom/index.test.ts`
  **Acceptance**: No test asserts "Step 5", "POST-EXECUTION REVIEW", or "Post-Plan-Execution Review". Remaining tests pass.

- [x] 13. Verify build and tests
  **What**: Run `bun run build` and `bun test` to ensure everything compiles and all tests pass. Run grep checks from Definition of Done.
  **Files**: None (verification only)
  **Acceptance**: Zero build warnings, zero test failures, all grep checks pass.

## Verification
- [x] `bun run build` succeeds with no errors or warnings
- [x] `bun test` passes with zero failures
- [x] `grep -r "pendingAgentSwitch" src/` returns no results
- [x] `grep -r "review_triggered" src/` returns no results
- [x] `grep -r "Post-execution review" src/` returns no results
- [x] `grep -r "targetAgent" src/hooks/work-continuation` returns no results
- [x] `grep -r "POST-EXECUTION REVIEW" src/` returns no results
- [x] No regressions in incomplete-plan continuation behavior
