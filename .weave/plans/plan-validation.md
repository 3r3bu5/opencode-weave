# Add Plan Validation Before /start-work Execution

## TL;DR
> **Summary**: Add a `validatePlan()` function that structurally validates plan files before Tapestry begins execution, catching malformed plans (missing sections, broken checkboxes, non-existent file references) and surfacing errors/warnings to the user in the start-work context injection.
> **Estimated Effort**: Medium

## Context
### Original Request
GitHub Issue #3: When `/start-work` is invoked, there is no structural validation of the plan file. A malformed plan can silently break execution or cause Tapestry to produce incomplete work. Add validation that checks structure, checkboxes, file references, numbering, effort estimates, and verification sections.

### Key Findings

1. **Plan template** is defined in `src/agents/pattern/default.ts` (lines 28-67). The canonical structure is:
   - `## TL;DR` with `**Summary**` and `**Estimated Effort**` (Quick | Short | Medium | Large | XL)
   - `## Context` with `### Original Request` and `### Key Findings`
   - `## Objectives` with `### Core Objective`, `### Deliverables`, `### Definition of Done`, `### Guardrails`
   - `## TODOs` — each item: `- [ ] N. [Title]` with `**What**`, `**Files**`, `**Acceptance**` sub-fields
   - `## Verification` with at least one `- [ ]` item

2. **`handleStartWork()`** in `src/hooks/start-work-hook.ts` is the entry point. It resolves the plan path (explicit name, resume, or discovery), creates work state, and returns `contextInjection` + `switchAgent`. Validation should run after plan resolution but before state creation and context building.

3. **Plan path is resolved to an absolute path** by `findPlans()` (returns absolute paths from `.weave/plans/`). The validation function receives this absolute path.

4. **Context injection** is appended to the prompt text in `src/plugin/plugin-interface.ts` (line 99): `parts[idx].text += \`\n\n---\n${result.contextInjection}\``. Validation results should be included in this injection string.

5. **Existing types** in `src/features/work-state/types.ts` define `WorkState` and `PlanProgress`. Validation result types belong here or in a new sibling file.

6. **Testing patterns**: Bun test runner, `describe`/`it`/`expect` from `bun:test`, temp directories via `mkdirSync(join(tmpdir(), ...))` with cleanup in `afterEach`. No mocking framework — tests use real filesystem with temp dirs.

7. **File references in plans**: The `**Files**` sub-field in TODO items lists paths like `src/hooks/session-token-state.ts` or `Create src/hooks/session-token-state.ts`. These are relative to project root. Words like "Create", "Modify", "New:", "(new)" indicate new files. Existing file validation should resolve relative to the `directory` parameter (project root).

8. **The `StartWorkResult` interface** has `contextInjection: string | null` and `switchAgent: string | null`. Validation results should be formatted into the contextInjection string — no interface changes needed.

9. **Blocking vs warnings**: Errors (no checkboxes, missing required sections) should prevent state creation and return an error context injection. Warnings (missing optional fields, potentially missing files) should be included in the normal context injection but not block execution.

## Objectives
### Core Objective
Validate plan structure before execution to catch malformed plans early and surface clear feedback to the user.

### Deliverables
- [x] `ValidationResult` type with errors (blocking) and warnings (non-blocking)
- [x] `validatePlan()` function implementing all 6 validation categories
- [x] Integration into `handleStartWork()` flow
- [x] Validation results rendered in start-work context injection
- [x] Comprehensive test coverage for valid, warning, and error cases

### Definition of Done
- [x] `bun test` passes with no failures
- [x] `bun run typecheck` passes with no errors
- [x] `bun run build` succeeds
- [x] A plan missing `## TODOs` section blocks `/start-work` with a clear error
- [x] A plan with TODO items missing `**Acceptance**` sub-fields triggers a warning but doesn't block

### Guardrails (Must NOT)
- Must NOT change the `StartWorkResult` interface (validation results are formatted into `contextInjection` strings)
- Must NOT modify Pattern's plan template in `src/agents/pattern/default.ts`
- Must NOT break existing start-work-hook tests (they use minimal plan files that will fail strict validation — the hook tests should NOT run validation, only the integration path should)
- Must NOT make validation synchronous file I/O expensive — plan files are small, one read is sufficient
- Must NOT block on warnings — only errors are blocking

## TODOs

- [x] 1. **Define validation result types**
  **What**: Create `src/features/work-state/validation-types.ts` with:
  - `ValidationSeverity` type: `"error" | "warning"`
  - `ValidationIssue` interface: `{ severity: ValidationSeverity; category: string; message: string }`
  - `ValidationResult` interface: `{ valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }`
  - `ValidationCategory` type covering the 6 categories: `"structure" | "checkboxes" | "file-references" | "numbering" | "effort-estimate" | "verification"`
  **Files**: Create `src/features/work-state/validation-types.ts`
  **Acceptance**: Types compile with `bun run typecheck`. Exported from `src/features/work-state/index.ts`.

- [x] 2. **Implement structure validation**
  **What**: In a new file `src/features/work-state/validation.ts`, implement the `validatePlan(planPath: string, projectDir: string): ValidationResult` function. Start with **structure validation** only:
  - Read the plan file content
  - Check for required H2 sections: `## TL;DR`, `## TODOs`, `## Verification`
  - Missing `## TL;DR` → error
  - Missing `## TODOs` → error
  - Missing `## Verification` → error
  - Missing `## Context` → warning
  - Missing `## Objectives` → warning
  - Return `ValidationResult` with `valid: true` only if zero errors
  **Files**: Create `src/features/work-state/validation.ts`
  **Acceptance**: Function parses section headings and reports missing ones. Handles missing file (returns error).

- [x] 3. **Implement checkbox validation**
  **What**: Add checkbox validation to `validatePlan()`:
  - Check that `## TODOs` section contains at least one `- [ ]` or `- [x]` checkbox → error if none found
  - For each TODO checkbox line matching `- [ ] N.` or `- [x] N.` pattern, check that the following lines contain `**What**:`, `**Files**:`, and `**Acceptance**:` sub-fields
  - Missing `**What**` → warning (per task)
  - Missing `**Files**` → warning (per task)
  - Missing `**Acceptance**` → warning (per task)
  **Files**: Modify `src/features/work-state/validation.ts`
  **Acceptance**: Plans with no checkboxes produce an error. Plans with incomplete sub-fields produce per-task warnings.

- [x] 4. **Implement file reference validation**
  **What**: Add file reference validation to `validatePlan()`:
  - Extract file paths from `**Files**:` sub-fields in TODO items
  - Parse paths: strip leading verbs ("Create", "Modify", "New:"), strip `(new)` suffix, trim whitespace
  - For paths NOT marked as new (no "Create", "New:", "(new)"), check if the file exists relative to `projectDir` using `existsSync`
  - Non-existent referenced files → warning (not error, since file may be created by an earlier task)
  - Paths that look like new files (contain "Create" or "(new)") → skip existence check
  **Files**: Modify `src/features/work-state/validation.ts`
  **Acceptance**: References to existing files pass. References to non-existent files without `(new)` marker produce warnings.

- [x] 5. **Implement numbering validation**
  **What**: Add task numbering validation to `validatePlan()`:
  - Extract task numbers from TODO checkbox lines matching `- [ ] N.` or `- [x] N.` where N is a digit
  - Check for duplicate numbers → error
  - Check for gaps in sequence (e.g., 1, 2, 4 — missing 3) → warning
  - Tasks without numbers (bare `- [ ] Task` without `N.`) → skip numbering check for those (they're valid but unnumbered)
  **Files**: Modify `src/features/work-state/validation.ts`
  **Acceptance**: Duplicate numbers produce errors. Gaps produce warnings. Unnumbered tasks are accepted.

- [x] 6. **Implement effort estimate and verification validation**
  **What**: Add the final two validation categories to `validatePlan()`:
  - **Effort estimate**: Check `## TL;DR` section for `**Estimated Effort**:` text. Missing → warning. Value not one of Quick/Short/Medium/Large/XL → warning.
  - **Verification section**: Check `## Verification` section contains at least one checkbox (`- [ ]` or `- [x]`). No checkboxes in verification → error (verification must have at least one verifiable condition).
  **Files**: Modify `src/features/work-state/validation.ts`
  **Acceptance**: Missing effort estimate triggers warning. Empty verification section triggers error.

- [x] 7. **Write unit tests for validation**
  **What**: Create `src/features/work-state/validation.test.ts` with comprehensive tests:
  - **Valid plan**: A well-formed plan passes with no errors and no warnings
  - **Missing required sections**: Plans missing `## TL;DR`, `## TODOs`, or `## Verification` produce errors
  - **Missing optional sections**: Plans missing `## Context` or `## Objectives` produce warnings only
  - **No checkboxes in TODOs**: Produces error
  - **TODO items missing sub-fields**: Each missing sub-field produces a warning
  - **File references**: Existing files pass, non-existent files produce warnings, `(new)` files are skipped
  - **Duplicate task numbers**: Produce errors
  - **Gap in task numbers**: Produces warning
  - **Missing effort estimate**: Warning
  - **Invalid effort estimate value**: Warning
  - **Empty verification section**: Error
  - **Non-existent plan file**: Returns error
  - **Edge case**: Plan with only checked checkboxes `- [x]` is valid (completed plan)
  
  Use temp directory pattern from `storage.test.ts` (tmpdir + random suffix, cleanup in afterEach). Create test plan files with `writeFileSync`.
  **Files**: Create `src/features/work-state/validation.test.ts`
  **Acceptance**: `bun test src/features/work-state/validation.test.ts` passes with all scenarios covered.

- [x] 8. **Integrate validation into handleStartWork**
  **What**: Modify `src/hooks/start-work-hook.ts` to call `validatePlan()` after resolving the plan path but before creating work state:
  - Import `validatePlan` from `../features/work-state`
  - In `handleExplicitPlan()`: after finding the matched plan and before the "already complete" check, call `validatePlan(matched, directory)`
  - In `handlePlanDiscovery()` single-plan path: after selecting the plan and before `createWorkState`, call `validatePlan(plan, directory)`
  - If validation has errors (`!result.valid`): return a `contextInjection` with `## Plan Validation Failed` heading listing all errors and warnings. Set `switchAgent: "tapestry"` so Tapestry can relay the message to the user. Do NOT create work state.
  - If validation has warnings only: proceed normally but append a `### Validation Warnings` section to the context injection (after the normal fresh/resume context).
  - Resume path: also validate — in the existing state resume block, validate before returning resume context. If errors found, clear state and return error context.
  - Add a new helper: `formatValidationResults(result: ValidationResult): string` that renders errors and warnings as markdown.
  **Files**: Modify `src/hooks/start-work-hook.ts`
  **Acceptance**: Malformed plans block execution with clear error messages. Plans with warnings proceed with warnings shown.

- [x] 9. **Update start-work-hook tests for validation integration**
  **What**: Update `src/hooks/start-work-hook.test.ts` to cover validation integration:
  - Add test: well-formed plan proceeds normally (update existing plan content in `createPlanFile` helper to include minimal valid structure: `## TL;DR`, `## TODOs` with checkbox, `## Verification` with checkbox)
  - Add test: plan missing `## TODOs` section returns validation error context
  - Add test: plan with warnings proceeds but includes warning text in context
  - Add test: resume with malformed plan clears state and returns error
  - Update existing tests: ensure the plan content used in existing tests includes enough structure to pass validation (add `## TL;DR`, `## TODOs`, `## Verification` to test plans that need to succeed)
  **Files**: Modify `src/hooks/start-work-hook.test.ts`
  **Acceptance**: `bun test src/hooks/start-work-hook.test.ts` passes with new and updated tests.

- [x] 10. **Export validation from work-state index**
  **What**: Update `src/features/work-state/index.ts` to export the new validation function and types:
  - `export { validatePlan } from "./validation"`
  - `export type { ValidationResult, ValidationIssue, ValidationSeverity, ValidationCategory } from "./validation-types"`
  **Files**: Modify `src/features/work-state/index.ts`
  **Acceptance**: `import { validatePlan } from "../features/work-state"` works in start-work-hook.ts. `bun run typecheck` passes.

- [x] 11. **Final verification**
  **What**: Run the full test suite, typecheck, and build to ensure no regressions:
  - `bun test` — all tests pass (should be 460+ existing + new validation tests)
  - `bun run typecheck` — no type errors
  - `bun run build` — successful build with no warnings
  **Files**: None (verification only)
  **Acceptance**: All three commands succeed with zero errors.

## Implementation Order

```
1. validation-types.ts (new, no deps)                    → Task 1
2. validation.ts (new, depends on types)                  → Tasks 2-6 (incremental)
3. validation.test.ts (new, depends on validation.ts)     → Task 7
4. work-state/index.ts (export wiring)                    → Task 10
5. start-work-hook.ts (integration, depends on 1-4)       → Task 8
6. start-work-hook.test.ts (integration tests)            → Task 9
7. Final verification                                     → Task 11
```

Tasks 1-7 and 10 are independent of the hook integration (tasks 8-9). The validation module can be fully built and tested before touching the hook.

## Verification
- [x] All tests pass (`bun test`)
- [x] No type errors (`bun run typecheck`)
- [x] Build succeeds (`bun run build`)
- [x] No regressions in existing 460 tests
- [x] A plan missing `## TODOs` blocks `/start-work` with "Plan Validation Failed"
- [x] A plan with warnings proceeds and shows "Validation Warnings" in context
- [x] A well-formed plan (like the existing `.weave/plans/` plans) passes validation cleanly
