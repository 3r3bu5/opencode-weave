# Superpowers Integration — Anti-Rationalization & Workflow Discipline for Weave

## TL;DR
> **Summary**: Bring Superpowers' battle-tested anti-rationalization techniques, hard-gate brainstorming, TDD discipline, systematic debugging, and two-stage review into Weave — as new skills, agent prompt enhancements, and strengthened runtime hooks. This is a prompt-engineering and skill-authoring effort, not a code architecture change.
> **Estimated Effort**: Large

## Context

### Original Request
Integrate the best ideas from the Superpowers workflow-discipline framework into Weave's multi-agent orchestration system. Superpowers enforces structured development workflows via skill injection with techniques like Red Flags tables, Iron Laws, explicit rationalization counters, hard-gate brainstorming, DOT flowcharts, and verification-before-completion enforcement. These techniques should enhance Weave's agents and skills without replacing its existing architecture.

### Key Findings

**Superpowers' core techniques (to adopt):**
1. **Anti-rationalization tables** — Every discipline skill has a `| Excuse | Reality |` table that preemptively counters LLM shortcuts. These are paired with "Red Flags" lists (self-check triggers) and an "Iron Law" (one inviolable rule per skill).
2. **Hard-gate brainstorming** — `<HARD-GATE>` blocks implementation until design is approved. Includes anti-pattern callout: "This Is Too Simple To Need A Design."
3. **DOT flowcharts** — Decision flows in GraphViz DOT notation serve as executable specs that agents follow more reliably than prose.
4. **Skills-as-TDD** — The `writing-skills` meta-skill applies Red-Green-Refactor to skill authoring: baseline test → write skill → close loopholes.
5. **Description trap** — Skill descriptions that summarize workflows cause agents to skip reading the full content. Descriptions should be trigger-only ("Use when...").
6. **Verification-before-completion** — Forbids success/completion language without running verification commands in the *same message*. Gate function: IDENTIFY → RUN → READ → VERIFY → CLAIM.
7. **TDD Iron Law** — "No production code without a failing test first." Explicit counters for "I'll test after", "too simple to test", "tests after achieve same goals."
8. **Systematic debugging** — 4-phase process: Root Cause Investigation → Pattern Analysis → Hypothesis Testing → Implementation. 3+ failed fixes triggers architectural questioning.
9. **Two-stage subagent review** — Spec compliance review (does code match requirements?) THEN code quality review (is code well-built?). These are separate stages, not one combined pass.
10. **Code review reception** — Technical evaluation, not performative agreement. Forbidden responses: "You're absolutely right!", "Great point!". Push back with reasoning when wrong.

**Weave's current state:**
- **8 agents** with typed prompts: Loom (orchestrator), Pattern (planner), Tapestry (executor), Weft (reviewer), Warp (security), Thread (explorer), Shuttle (specialist), Spindle (researcher).
- **8 existing skills** at `~/.config/opencode/skills/`: fleet-orchestration, reviewing-csharp-code, syncing-github-issues, managing-pull-requests, processing-review-comments, verifying-release-builds, enforcing-dotnet-testing, enforcing-csharp-standards.
- **Hook system** with 11 hooks: context-window-monitor, write-existing-file-guard, rules-injector, first-message-variant, keyword-detector, pattern-md-only, start-work, work-continuation, verification-reminder, session-token-state, plus exported types.
- **Skill format**: YAML frontmatter (`name`, `description`, optional `model`, `tools`) + markdown body. Skills are discovered from `~/.config/opencode/skills/{name}/SKILL.md` (user scope) and `.opencode/skills/{name}/SKILL.md` (project scope).
- **Verification reminder hook** exists but is simple — a static prompt injection. It lacks anti-rationalization patterns, Red Flags, and the "no success language without evidence" enforcement.
- **Weft reviewer** does one-pass review (plan review or work review), not two-stage spec+quality.

**Description trap audit of existing skills:**
| Skill | Description | Trap? |
|-------|-------------|-------|
| `fleet-orchestration` | "Orchestrates multi-session workflows via Fleet API. Use when spawning child sessions..." | ⚠️ Mild — "Orchestrates" hints at workflow but isn't a full summary |
| `reviewing-csharp-code` | "Reviews C# and .NET code for quality, security, and coverage. Use when reviewing..." | ⚠️ Mild — describes what it does, not just when to use |
| `enforcing-dotnet-testing` | "Enforces .NET testing strategy and standards. Use when writing, modifying, or reviewing tests..." | ⚠️ Mild — "Enforces" is a verb |
| `enforcing-csharp-standards` | "Enforces strict C# and .NET coding standards. Use when writing, editing, or generating C#..." | ⚠️ Same pattern |
| `verifying-release-builds` | "Enforces release-mode build verification. Use when compiling, building, or verifying..." | ⚠️ Same pattern |
| `processing-review-comments` | "Processes GitHub PR review comments through a structured triage workflow. Use when asked to fix..." | 🔴 Summarizes workflow ("structured triage workflow") |
| `managing-pull-requests` | "Manages pull request creation with issue linking and URL tracking. Use when the user asks to open..." | 🔴 Summarizes process ("with issue linking and URL tracking") |
| `syncing-github-issues` | "Syncs finalized plan summaries to linked GitHub issues. Use when the user asks to update..." | 🔴 Summarizes action ("Syncs finalized plan summaries") |

## Objectives

### Core Objective
Enhance Weave's agent prompts, skills, and hooks with Superpowers' proven anti-rationalization and workflow-discipline techniques, making agents more reliable and harder to shortcut.

### Deliverables
- [ ] 5 new skills: brainstorming, test-driven-development, systematic-debugging, writing-skills, receiving-code-review
- [ ] 3 agent prompt enhancements: Tapestry (anti-rationalization), Pattern (brainstorming gate), Weft (two-stage review)
- [ ] 1 strengthened hook: verification-reminder with anti-rationalization patterns
- [ ] 8 existing skill descriptions audited and fixed for the description trap
- [ ] DOT flowcharts adopted in all new skills and retrofitted into key existing skills

### Definition of Done
- [ ] All 5 new skill files exist at `~/.config/opencode/skills/{name}/SKILL.md` with valid YAML frontmatter
- [ ] Each new skill has: Iron Law or core principle, Red Flags table, Common Rationalizations table, DOT flowchart
- [ ] Agent prompt changes compile: `npx tsc --noEmit` passes
- [ ] Hook changes pass tests: `npx vitest run src/hooks/verification-reminder.test.ts`
- [ ] All existing tests still pass: `npx vitest run`
- [ ] Existing skill descriptions updated to trigger-only format

### Guardrails (Must NOT)
- Do NOT modify the Superpowers codebase
- Do NOT change Weave's skill loading architecture (types, discovery, resolver)
- Do NOT change agent roles or tool access (e.g., Weft stays read-only)
- Do NOT replace Weave's existing patterns — enhance them
- Do NOT add dependencies or new npm packages
- Skills must work standalone — no cross-references to Superpowers skills (use `weave:` prefix if referencing other Weave skills)

## TODOs

### Phase 1: Skill Description Audit (Fix the Description Trap)

- [ ] 1. Audit and fix all 8 existing skill descriptions
  **What**: Rewrite each skill's YAML `description` field to be trigger-only. Remove any workflow summaries, process descriptions, or "what it does" language. Use the "Use when..." pattern consistently.
  **Files**:
  - `~/.config/opencode/skills/processing-review-comments/SKILL.md` — change `"Processes GitHub PR review comments through a structured triage workflow. Use when asked to fix, address, or review GitHub PR comments."` → `"Use when asked to fix, address, or review GitHub PR comments on a pull request."`
  - `~/.config/opencode/skills/managing-pull-requests/SKILL.md` — change `"Manages pull request creation with issue linking and URL tracking. Use when the user asks to open, create, or submit a pull request."` → `"Use when the user asks to open, create, or submit a pull request."`
  - `~/.config/opencode/skills/syncing-github-issues/SKILL.md` — change `"Syncs finalized plan summaries to linked GitHub issues. Use when the user asks to update, sync, or post the plan to a GitHub issue."` → `"Use when the user asks to update, sync, or post a plan summary to a GitHub issue."`
  - `~/.config/opencode/skills/fleet-orchestration/SKILL.md` — change `"Orchestrates multi-session workflows via Fleet API. Use when spawning child sessions for parallel or delegated work."` → `"Use when spawning child sessions for parallel or delegated work via Fleet API."`
  - `~/.config/opencode/skills/reviewing-csharp-code/SKILL.md` — change to `"Use when reviewing code changes, commits, or pull requests in .NET projects."`
  - `~/.config/opencode/skills/enforcing-dotnet-testing/SKILL.md` — change to `"Use when writing, modifying, or reviewing tests in .NET projects."`
  - `~/.config/opencode/skills/enforcing-csharp-standards/SKILL.md` — change to `"Use when writing, editing, or generating C# code."`
  - `~/.config/opencode/skills/verifying-release-builds/SKILL.md` — change to `"Use when compiling, building, or verifying .NET projects before marking tasks complete."`
  **Acceptance**: Every skill description starts with "Use when" and contains zero workflow/process summary language. Verify by grepping all SKILL.md files for `description:` and confirming the pattern.

### Phase 2: New Skills — Discipline & Process

- [ ] 2. Create brainstorming skill
  **What**: Create a brainstorming skill adapted from Superpowers' brainstorming skill. This establishes a collaborative design phase before Pattern creates plans. Key elements to include:
  - `<HARD-GATE>`: No planning or implementation until design is presented and user approves
  - Anti-pattern callout: "This Is Too Simple To Need A Design"
  - DOT flowchart showing: Explore context → Ask questions (one at a time) → Propose 2-3 approaches → Present design → User approves? → Save design doc → Transition to Pattern for planning
  - Checklist with numbered steps
  - Key principles: one question at a time, multiple choice preferred, YAGNI ruthlessly, explore alternatives
  - Adapted for Weave: designs saved to `.weave/designs/`, transition is to Pattern agent (not "writing-plans" skill)
  **Files**: `~/.config/opencode/skills/brainstorming/SKILL.md`
  **Acceptance**: Skill loads via `skill` tool. Description is trigger-only. Contains `<HARD-GATE>`, DOT flowchart, checklist. References `.weave/designs/` for output. Does NOT reference Superpowers skills.

- [ ] 3. Create test-driven-development skill
  **What**: Create a TDD skill adapted from Superpowers' TDD skill. This is a **rigid** discipline skill — agents must follow it exactly. Key elements:
  - Iron Law: `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST`
  - "Violating the letter of the rules is violating the spirit of the rules."
  - Red-Green-Refactor cycle with DOT flowchart
  - Good/Bad code examples (adapted to be language-agnostic, with TypeScript as primary example)
  - Explicit loophole closures: "Don't keep as reference", "Don't adapt it", "Delete means delete"
  - Common Rationalizations table (all 11 from Superpowers)
  - Red Flags list (all 13 from Superpowers)
  - Verification checklist before marking work complete
  - "When Stuck" troubleshooting table
  - Bug fix example showing RED → Verify RED → GREEN → Verify GREEN → REFACTOR
  **Files**: `~/.config/opencode/skills/test-driven-development/SKILL.md`
  **Acceptance**: Skill loads via `skill` tool. Description is trigger-only: `"Use when implementing any feature or bugfix, before writing implementation code"`. Contains Iron Law, DOT flowchart, Red Flags, Rationalizations table. Does NOT reference Superpowers skills.

- [ ] 4. Create systematic-debugging skill
  **What**: Create a debugging skill adapted from Superpowers' 4-phase systematic debugging skill. Key elements:
  - Iron Law: `NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST`
  - 4 phases: Root Cause Investigation → Pattern Analysis → Hypothesis Testing → Implementation
  - DOT flowchart showing the 4-phase flow with decision diamonds
  - Multi-component evidence gathering technique (log at each component boundary)
  - Data flow tracing technique (trace bad values backward to source)
  - Scientific method: form hypothesis, test minimally, one variable at a time
  - 3+ failed fixes trigger: "Question the architecture" — STOP and discuss with user
  - Red Flags list (all 11 from Superpowers)
  - Common Rationalizations table (all 8 from Superpowers)
  - Quick Reference table (Phase → Key Activities → Success Criteria)
  - Cross-reference to `weave:test-driven-development` for Phase 4 test creation
  **Files**: `~/.config/opencode/skills/systematic-debugging/SKILL.md`
  **Acceptance**: Skill loads via `skill` tool. Description is trigger-only: `"Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes"`. Contains all 4 phases, Iron Law, DOT flowchart, Red Flags, Rationalizations. 3+ fix escalation included.

- [ ] 5. Create writing-skills meta-skill
  **What**: Create a meta-skill for skill authors, adapted from Superpowers' writing-skills skill. This applies TDD to skill creation. Key elements:
  - Core principle: "Creating skills IS TDD for process documentation"
  - Iron Law: `NO SKILL WITHOUT A FAILING TEST FIRST`
  - TDD mapping table: Test case → Pressure scenario, Production code → SKILL.md, RED → Agent violates without skill, GREEN → Agent complies with skill, REFACTOR → Close loopholes
  - Skill types: Technique, Pattern, Reference (with test approaches for each)
  - SKILL.md structure template with frontmatter format
  - **Claude Search Optimization (CSO) section** — the description trap explanation with Good/Bad examples
  - Flowchart usage guidelines (when to use DOT, when not)
  - Anti-rationalization bulletproofing section: close every loophole explicitly, address "spirit vs letter" arguments, build rationalization tables from baseline testing, create Red Flags lists
  - RED-GREEN-REFACTOR cycle for skills: baseline scenario → write minimal skill → close loopholes
  - Skill creation checklist (adapted for Weave's skill format)
  - Adapted for Weave: skills live at `~/.config/opencode/skills/` or `.opencode/skills/`, use Weave's YAML frontmatter format (`name`, `description`, optional `model`, `tools`)
  **Files**: `~/.config/opencode/skills/writing-skills/SKILL.md`
  **Acceptance**: Skill loads via `skill` tool. Description is trigger-only: `"Use when creating new skills, editing existing skills, or verifying skills work before deployment"`. Contains TDD mapping, description trap section, skill structure template, anti-rationalization bulletproofing.

- [ ] 6. Create receiving-code-review skill
  **What**: Create a code review reception skill adapted from Superpowers' receiving-code-review skill. This teaches agents to evaluate feedback technically rather than performatively. Key elements:
  - Response pattern: READ → UNDERSTAND → VERIFY → EVALUATE → RESPOND → IMPLEMENT
  - DOT flowchart for the response pattern
  - Forbidden responses: "You're absolutely right!", "Great point!", "Let me implement that now" (before verification)
  - Handling unclear feedback: STOP — don't implement partial understanding
  - Source-specific handling: user feedback vs external reviewers (different trust levels)
  - YAGNI check for "professional" features suggested by reviewers
  - Implementation order: clarify all → blocking issues → simple fixes → complex fixes → test each
  - When to push back: breaks existing functionality, reviewer lacks context, violates YAGNI, technically incorrect
  - Acknowledging correct feedback: "Fixed. [description]" — no gratitude performance
  - Common Mistakes table
  - Adapted for Weave: reference Weft's review output format, align with Weave's APPROVE/REJECT verdict structure
  **Files**: `~/.config/opencode/skills/receiving-code-review/SKILL.md`
  **Acceptance**: Skill loads via `skill` tool. Description is trigger-only: `"Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable"`. Contains forbidden responses, pushback guidance, implementation order.

### Phase 3: Agent Prompt Enhancements

- [ ] 7. Enhance Tapestry with anti-rationalization patterns
  **What**: Add Red Flags and rationalization counters to Tapestry's prompt. Tapestry is the execution agent most likely to cut corners under pressure. Add:
  - A `<RedFlags>` section listing self-check triggers specific to execution:
    - "This task is too simple to verify" → Verify anyway
    - "I'll verify at the end" → Verify each task individually
    - "The test probably passes" → Run it
    - "Close enough to the acceptance criteria" → Exact match required
    - "I'll skip the learnings file" → Always read/write learnings
    - "This task doesn't need a review" → Follow PostExecutionReview
  - A `<RationalizationCounter>` principle: "If you're explaining why you should skip a step, that's rationalization. Do the step."
  - Strengthen the `<Verification>` section with the gate function from Superpowers: IDENTIFY → RUN → READ → VERIFY → CLAIM. Add: "Using 'should', 'probably', or 'seems to' before running verification = lying, not efficiency."
  **Files**: `src/agents/tapestry/default.ts`
  **Acceptance**: `npx tsc --noEmit` passes. Prompt contains `<RedFlags>` section with 6+ items. Prompt contains rationalization counter principle. Verification section includes gate function.

- [ ] 8. Enhance Pattern with brainstorming gate
  **What**: Add a brainstorming awareness step to Pattern's prompt. When Pattern is asked to plan something creative (new feature, architecture change, major refactor), it should check whether brainstorming has occurred. Add:
  - A `<BrainstormingGate>` section in the prompt:
    - "Before creating a plan for new features or significant changes, check: has a design document been created at `.weave/designs/`?"
    - "If no design exists and the request involves creative/architectural decisions, recommend the user run brainstorming first"
    - "If the user explicitly says 'skip brainstorming' or the task is purely mechanical (bug fix, refactor with clear scope), proceed directly to planning"
  - A Red Flags callout for Pattern-specific rationalization:
    - "This is just a small feature" → Small features accumulate the most unexamined assumptions
    - "The requirements are clear enough" → Clear to you ≠ clear to the executor
    - "I already know what to plan" → Research before planning, always
  **Files**: `src/agents/pattern/default.ts`
  **Acceptance**: `npx tsc --noEmit` passes. Prompt contains `<BrainstormingGate>` section. Prompt contains Pattern-specific Red Flags.

- [ ] 9. Enhance Weft with two-stage review process
  **What**: Modify Weft's Work Review mode to use two stages: spec compliance review first, then code quality review. This is inspired by Superpowers' subagent-driven-development two-stage review. Since Weft is a single read-only agent (cannot spawn subagents), implement this as two sequential passes in a single review:
  - Rename `Work Review` to `Work Review (Two-Stage)` in the `<ReviewModes>` section
  - **Stage 1 — Spec Compliance**: Does the code implement what was requested? Check each requirement from the task spec. Report: requirements met, requirements missed, scope creep (extra work not requested). Use a checklist format.
  - **Stage 2 — Code Quality**: Is the implementation well-built? Check for stubs/TODOs/placeholders, test quality, naming, error handling, duplication. Only proceed to this stage if Stage 1 passes (all requirements met).
  - Add a DOT flowchart showing: Read spec → Check each requirement → All requirements met? → (no: REJECT with missing requirements) → (yes: proceed to quality review) → Quality issues? → (no: APPROVE) → (yes: REJECT with quality issues)
  - Keep plan review mode unchanged (single-stage)
  **Files**: `src/agents/weft/default.ts`
  **Acceptance**: `npx tsc --noEmit` passes. Prompt contains two-stage work review. DOT flowchart present. Plan review mode unchanged. Stage 1 (spec) must pass before Stage 2 (quality).

### Phase 4: Strengthen Verification Hook

- [ ] 10. Enhance verification-reminder hook with anti-rationalization
  **What**: Strengthen the `buildVerificationReminder` function to include anti-rationalization patterns from Superpowers' verification-before-completion skill. The current hook is a simple static prompt. Enhance it with:
  - The gate function: "BEFORE claiming any status: IDENTIFY what command proves this claim → RUN the command → READ full output → VERIFY output confirms claim → ONLY THEN make the claim"
  - Red Flags inline: "Using 'should', 'probably', 'seems to' = STOP. Run verification."
  - Common failures table: "Tests pass" requires test command output, not "should pass". "Build succeeds" requires build command exit 0, not "linter passed".
  - The principle: "Claiming work is complete without verification is dishonesty, not efficiency."
  - "No completion claims without fresh verification evidence" — Iron Law
  - Keep the existing plan context and weft/warp delegation guidance
  **Files**:
  - `src/hooks/verification-reminder.ts` — enhance `buildVerificationReminder` output
  - `src/hooks/verification-reminder.test.ts` — update tests to verify new content is present
  **Acceptance**: `npx vitest run src/hooks/verification-reminder.test.ts` passes. Output contains gate function, Red Flags, Iron Law. Existing plan context functionality preserved.

### Phase 5: Loom Orchestrator Awareness

- [ ] 11. Update Loom's prompt for new skill awareness
  **What**: Update Loom's `<PlanWorkflow>` section to mention the brainstorming step as a recommended precursor to Pattern for creative/architectural work. Also add awareness of the new skills so Loom can recommend them contextually. Add:
  - In `<PlanWorkflow>`, before step 1 (PLAN), add step 0: "0. BRAINSTORM (optional but recommended for new features): If the request involves creative decisions, new architecture, or significant behavior changes, suggest the user invoke the `brainstorming` skill first. Skip for mechanical tasks (bug fixes, clear-scope refactors)."
  - In `<Delegation>`, add a note: "When debugging, suggest the user invoke the `systematic-debugging` skill before diving into fixes."
  - Add a `<SkillAwareness>` section listing the discipline skills that Loom should recommend contextually:
    - New feature/design → `brainstorming`
    - Implementation → `test-driven-development`
    - Bug/unexpected behavior → `systematic-debugging`
    - Code review received → `receiving-code-review`
    - Creating/editing skills → `writing-skills`
  **Files**: `src/agents/loom/default.ts`
  **Acceptance**: `npx tsc --noEmit` passes. Prompt contains brainstorming step 0 in PlanWorkflow. Prompt contains SkillAwareness section. Delegation mentions systematic-debugging.

### Phase 6: DOT Flowcharts in Existing Skills

- [ ] 12. Add DOT flowcharts to key existing skills
  **What**: Retrofit DOT flowcharts into existing skills where decision flows would improve clarity. Target the skills with the most complex workflows:
  - `fleet-orchestration` — Add a DOT flowchart for the parallelizability decision: "Have tasks? → Assess file overlap → No overlap → Parallel with worktree / Possible overlap → Sequential or careful scoping / Definite overlap → Sequential only"
  - `processing-review-comments` — Add a DOT flowchart for the per-comment triage: "Discover comments → Categorize/dedup → Present comment → Analyze → User decision → Fix or Dismiss → Resolve thread → More comments? → Next"
  **Files**:
  - `~/.config/opencode/skills/fleet-orchestration/SKILL.md`
  - `~/.config/opencode/skills/processing-review-comments/SKILL.md`
  **Acceptance**: Each skill contains a valid DOT flowchart in a `\`\`\`dot` code block. Flowcharts accurately represent the skill's decision logic.

## Verification

- [ ] All existing tests pass: `npx vitest run`
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] All 5 new skills load correctly: verify each via `ls ~/.config/opencode/skills/{name}/SKILL.md` for all 5 names
- [ ] All new skills have valid YAML frontmatter: grep for `^---` at line 1 and `name:` + `description:` fields in each
- [ ] All skill descriptions start with "Use when" (no description trap): `grep -h "^description:" ~/.config/opencode/skills/*/SKILL.md` — verify all start with "Use when..." or trigger-only language
- [ ] No Superpowers cross-references: `grep -r "superpowers:" ~/.config/opencode/skills/` returns nothing
- [ ] Agent prompt changes are syntactically valid TypeScript template literals: `npx tsc --noEmit` catches broken strings
- [ ] Verification reminder hook tests pass: `npx vitest run src/hooks/verification-reminder.test.ts`
- [ ] Manual smoke test: invoke each new skill via the `skill` tool in OpenCode and confirm content loads correctly
