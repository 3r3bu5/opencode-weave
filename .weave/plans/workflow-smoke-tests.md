# Workflow Smoke Tests — Fleet-Based End-to-End Verification

## TL;DR
> **Summary**: Design Fleet API–based smoke tests that spawn real OpenCode sessions with Weave configs, send prompts, and verify workflow behavior — covering default delegation, custom agent pipelines (review, security, domain specialists), disabled agents, and prompt_append overrides. These tests prove that `weave-opencode.json` customization recipes actually work end-to-end.
> **Estimated Effort**: Large

## Context

### Original Request
Create Fleet-based smoke tests that exercise Weave's configurable workflows end-to-end. Users customize workflows via `weave-opencode.json` — disabling agents, adding custom agents with triggers, overriding models/prompts. We need to verify these recipes work in real sessions, not just unit tests.

### Key Findings

1. **Config loading path**: `loadWeaveConfig()` in `src/config/loader.ts` reads from `{directory}/.opencode/weave-opencode.json(c)` (project-level) and `~/.config/opencode/weave-opencode.json(c)` (user-level). For smoke tests, we write config to `{directory}/.opencode/weave-opencode.json` before the session starts.

2. **Loom's prompt composition**: `composeLoomPrompt()` in `src/agents/loom/prompt-composer.ts` conditionally includes/excludes sections based on `disabledAgents`. When agents are disabled, their references are stripped from `<Delegation>`, `<DelegationNarration>`, `<PlanWorkflow>`, and `<ReviewWorkflow>` sections.

3. **Custom agent metadata registration**: `createManagers()` calls `registerCustomAgentMetadata()` which stores custom agent triggers in `CUSTOM_AGENT_METADATA`. This metadata is accessible via `getAllAgentMetadata()` — BUT currently **nothing in Loom's prompt composer calls the dynamic prompt builder functions** (`buildDelegationTable`, `buildToolSelectionTable`, etc.). Only `buildProjectContextSection` is imported.

4. **The bridge gap**: The dynamic prompt builder has all the infrastructure (`buildDelegationTable`, `buildKeyTriggersSection`, etc.) to inject custom agent triggers into prompts, but Loom's `composeLoomPrompt()` doesn't use them. Custom agents are registered with OpenCode and appear in the agent list, but Loom's system prompt doesn't contain their delegation triggers. This means **Loom won't know when to delegate to custom agents unless `prompt_append` explicitly instructs it**.

5. **`prompt_append` as workaround**: The `agents.loom.prompt_append` config field appends text to Loom's system prompt via `builtin-agents.ts:223-224`. This is the current mechanism for teaching Loom about custom agents — users must explicitly tell Loom when to delegate to their custom agents.

6. **Fleet API contract**: Sessions are spawned via `POST /api/sessions` with `isolationStrategy: "worktree"|"clone"|"existing"`. Prompts via `POST /api/sessions/:id/prompt`. Results via `GET /api/sessions/:id` (messages) and `GET /api/sessions/:id/diffs` (file changes).

7. **Agent delegation format**: Loom delegates via the `task` tool (or `call_weave_agent`). The `tool.execute.before` hook in `plugin-interface.ts:288-299` logs delegation starts when `input.tool === "task"`, extracting `subagent_type` or `description` from args. This is what we inspect in conversation logs.

8. **Config schema**: Custom agents support `triggers` (array of `{domain, trigger}`), `category` (exploration/specialist/advisor/utility), `cost` (FREE/CHEAP/EXPENSIVE), `tools` (permission map), `prompt`/`prompt_file`, `model`, `display_name`, `mode` (subagent/primary/all).

## Objectives

### Core Objective
Verify that Weave's configurable workflow recipes produce correct delegation behavior in real OpenCode sessions, catching integration failures that unit tests miss.

### Deliverables
- [ ] Smoke test harness script (`tests/smoke/harness.ts`) with Fleet API helpers
- [ ] 5 smoke test scenarios with configs, prompts, and verification logic
- [ ] Runner script that executes all scenarios and reports pass/fail
- [ ] Documentation of how to run smoke tests locally

### Definition of Done
- [ ] All 5 scenarios can be spawned via Fleet API and produce verifiable results
- [ ] Pass/fail determination is automated (not manual inspection)
- [ ] Tests can run in CI with Fleet API available
- [ ] Results are reported in a structured format (JSON or markdown summary)

### Guardrails (Must NOT)
- Must NOT modify Weave source code — smoke tests are external consumers
- Must NOT require specific model availability — use whatever model the environment provides
- Must NOT leave orphan sessions/worktrees after test runs (cleanup required)
- Must NOT hard-code `FLEET_PORT` — use environment variable with fallback to 3000
- Must NOT depend on specific LLM output — verify structural behavior (delegation happened), not exact text

## Architecture

### Test Harness Design

```
tests/smoke/
├── harness.ts           # Fleet API client helpers + test runner
├── scenarios/
│   ├── 01-baseline.ts         # Scenario 1: Default workflow
│   ├── 02-review-pipeline.ts  # Scenario 2: Replace review pipeline
│   ├── 03-dual-security.ts    # Scenario 3: Dual security review
│   ├── 04-minimal-setup.ts    # Scenario 4: Minimal agent setup
│   └── 05-domain-coding.ts    # Scenario 5: Domain-specialized agents
├── configs/
│   ├── 02-review-pipeline.json
│   ├── 03-dual-security.json
│   ├── 04-minimal-setup.json
│   └── 05-domain-coding.json
├── run.ts               # Main runner script
└── README.md            # How to run locally
```

### Fleet API Client (harness.ts)

The harness wraps the Fleet API with typed helpers:

```typescript
interface FleetClient {
  // Discovery
  listSessions(): Promise<FleetSession[]>
  findSelf(): Promise<{ instanceId: string; sessionId: string }>
  
  // Lifecycle
  createSession(opts: CreateSessionOpts): Promise<CreatedSession>
  promptSession(sessionId: string, instanceId: string, text: string): Promise<void>
  
  // Inspection
  getSession(sessionId: string, instanceId: string): Promise<SessionDetails>
  getDiffs(sessionId: string, instanceId: string): Promise<DiffResult>
  
  // Cleanup
  // (Fleet handles worktree cleanup on session delete, but we need to track sessions for teardown)
}

interface SmokeTestScenario {
  name: string
  description: string
  config?: Record<string, unknown>     // weave-opencode.json content (null = no custom config)
  prompt: string                        // Prompt to send to the child session
  timeoutMs: number                     // Max time to wait for completion
  verify: (session: SessionDetails) => VerificationResult
}

interface VerificationResult {
  passed: boolean
  checks: Array<{ name: string; passed: boolean; detail: string }>
}
```

### Config Injection Strategy

For each scenario that requires custom config:

1. The harness writes `weave-opencode.json` to `{targetDir}/.opencode/weave-opencode.json` **before** spawning the child session
2. For `isolationStrategy: "worktree"`, the config file must be committed or copied to the worktree — worktrees share the git objects but have separate working directories
3. **Recommended approach**: Use `isolationStrategy: "existing"` for smoke tests (single session per scenario, no parallelism needed within a scenario) OR commit the config to a test branch

**Alternative — simpler approach**: Since smoke tests run sequentially, write the config to the repo root's `.opencode/` directory, spawn a session with `"existing"` isolation (it uses the same directory), then clean up the config after the test. This avoids worktree complexity.

### Conversation Inspection Strategy

After a session completes, `GET /api/sessions/:id` returns the full conversation. To verify delegation:

1. **Parse messages** — look for assistant messages containing delegation narration (e.g., "Delegating to Thread...", "Asking Weft to review...")
2. **Check tool calls** — look for `task` or `call_weave_agent` tool invocations in the message list. The tool args contain `subagent_type` (the agent name) and `prompt` (the delegation prompt)
3. **Check tool results** — look for tool results corresponding to the `task` calls to confirm the agent actually ran

Key fields to extract from conversation messages:
- `role: "assistant"` messages with `tool_calls` where `function.name === "task"` or `"call_weave_agent"`
- Parse `function.arguments` to extract `subagent_type` / `agent` field
- Build a set of `delegated_agents` from all task/call_weave_agent invocations

---

## Dependencies & Prerequisites

### Required Infrastructure
- [ ] Fleet API server running (`FLEET_PORT` env var, default 3000)
- [ ] OpenCode instance running (Fleet spawns sessions via OpenCode)
- [ ] At least one LLM provider configured (any model — tests verify structure, not quality)
- [ ] Git repo with Weave plugin installed (the test target directory)

### Bridge Fix Dependency

> **CRITICAL**: Scenarios 2, 3, and 5 depend on Loom knowing about custom agent triggers.
>
> **Current state**: Custom agents are registered with OpenCode (they appear as available agents), and their metadata is stored via `registerCustomAgentMetadata()`. However, Loom's prompt composer (`composeLoomPrompt()`) does NOT call `buildDelegationTable()` or `buildKeyTriggersSection()` — it only uses hardcoded delegation instructions for the 8 builtin agents.
>
> **Implication**: Without the bridge fix, Loom will not automatically delegate to custom agents based on their `triggers` config. It will only delegate to them if:
> 1. The user's `prompt_append` on Loom explicitly instructs delegation, OR
> 2. The user's prompt explicitly names the custom agent
>
> **Workaround for smoke tests**: Each scenario that uses custom agents also includes a `prompt_append` on Loom that explicitly instructs delegation. This makes the tests valid today, and when the bridge fix lands, we can remove the `prompt_append` workarounds and verify that trigger-based delegation works automatically.
>
> **Tracking**: The bridge fix involves wiring `getAllAgentMetadata()` → `buildDelegationTable()` → injection into Loom's composed prompt. This is being planned in parallel.

---

## TODOs

- [ ] 1. **Create test harness with Fleet API client**
  **What**: Build `tests/smoke/harness.ts` with typed Fleet API helpers — `listSessions`, `createSession`, `promptSession`, `getSession`, `getDiffs`, `findSelf`. Include retry logic for session completion polling (since we may not always use callbacks). Include config injection helper that writes `weave-opencode.json` to a target directory and cleans up after.
  **Files**: Create `tests/smoke/harness.ts`
  **Details**:
  - `FLEET_BASE_URL` from `process.env.FLEET_PORT` with fallback to `http://localhost:3000`
  - `createSession(opts)` → `POST /api/sessions` with `isolationStrategy`, `title`, `directory`, optional `onComplete`
  - `promptSession(sessionId, instanceId, text)` → `POST /api/sessions/${sessionId}/prompt`
  - `getSession(sessionId, instanceId)` → `GET /api/sessions/${sessionId}?instanceId=${instanceId}`
  - `getDiffs(sessionId, instanceId)` → `GET /api/sessions/${sessionId}/diffs?instanceId=${instanceId}`
  - `waitForCompletion(sessionId, instanceId, timeoutMs)` — polls `getSession` every 5s until session status is `idle` or `error`, or timeout exceeded
  - `injectConfig(directory, config)` — writes `{directory}/.opencode/weave-opencode.json`, creating `.opencode/` dir if needed
  - `cleanupConfig(directory)` — removes `{directory}/.opencode/weave-opencode.json`
  - `extractDelegations(session)` — parses conversation messages to find all `task`/`call_weave_agent` tool calls and returns `Set<string>` of delegated agent names
  **Acceptance**: Harness compiles and can list sessions against a running Fleet API

- [ ] 2. **Scenario 1: Baseline — Default Workflow Delegation**
  **What**: Verify that with NO custom config, Loom delegates to Thread for a codebase exploration task. This establishes the baseline behavior.
  **Files**: Create `tests/smoke/scenarios/01-baseline.ts`
  **Setup**:
  - No `weave-opencode.json` config (or clean up any existing one)
  - Use `isolationStrategy: "existing"` (single session, no parallel risk)
  **Prompt**: `"Find all TypeScript files in this repository that contain TODO comments. List each file with the line number and TODO text."`
  **Rationale**: This is an exploration-only task with no code changes. Loom's prompt says "Use thread for fast codebase exploration (read-only, cheap)" — so Loom should delegate to Thread rather than doing it directly.
  **Verification** (`verify` function):
  - [ ] Check 1: `extractDelegations(session)` contains `"thread"` — Loom delegated to Thread
  - [ ] Check 2: Session completed without error (status is `idle`, not `error`)
  - [ ] Check 3: Conversation contains assistant message with exploration results (file paths mentioned)
  **Expected outcome**: Loom narrates "Delegating to Thread..." and Thread returns a list of files with TODOs
  **Failure modes**:
  - Loom does exploration directly (no delegation) → Thread delegation check fails. **Meaning**: Loom's prompt isn't guiding delegation for exploration tasks, or the model decided the task was simple enough for direct tools. This is a soft failure — note but don't block.
  - Session errors out → Infrastructure issue, not a Weave bug
  - Thread returns empty results → Not a Weave failure if the repo genuinely has no TODOs; use a repo with known TODOs

- [ ] 3. **Scenario 2: Replace the Review Pipeline**
  **What**: Verify that disabling weft/warp and adding custom review agents (code-reviewer, compliance-checker) results in Loom delegating to the custom agents instead of the builtin review agents.
  **Files**: Create `tests/smoke/scenarios/02-review-pipeline.ts`, Create `tests/smoke/configs/02-review-pipeline.json`
  **Setup** — Config at `{directory}/.opencode/weave-opencode.json`:
  ```json
  {
    "disabled_agents": ["weft", "warp"],
    "custom_agents": {
      "code-reviewer": {
        "display_name": "Code Reviewer",
        "description": "Reviews code against team standards and patterns",
        "category": "advisor",
        "cost": "CHEAP",
        "prompt": "You are a code reviewer. Review code changes for correctness, maintainability, and adherence to project conventions. Focus on logic errors, missing edge cases, and code clarity. Provide actionable feedback. Be concise.",
        "tools": { "write": false, "edit": false, "bash": false },
        "triggers": [
          { "domain": "Code Review", "trigger": "Code quality review, standards compliance, best practices" }
        ]
      },
      "compliance-checker": {
        "display_name": "Compliance",
        "description": "Checks for regulatory and licensing compliance",
        "category": "advisor",
        "cost": "CHEAP",
        "prompt": "You are a compliance checker. Check code for licensing compliance, PII handling, data retention policies, and regulatory requirements. Flag any issues with third-party dependencies, data handling, or privacy concerns. Be thorough but concise.",
        "tools": { "write": false, "edit": false, "bash": false },
        "triggers": [
          { "domain": "Compliance", "trigger": "License checks, PII handling, regulatory review, data privacy" }
        ]
      }
    },
    "agents": {
      "loom": {
        "prompt_append": "IMPORTANT: For code review tasks, delegate to Code Reviewer for quality review and Compliance for regulatory checks. Weft and Warp are disabled — use Code Reviewer and Compliance instead."
      }
    }
  }
  ```
  **Prompt**: `"Review the recent changes in this repository for code quality and compliance. Check for any issues with code standards, licensing, or data handling."`
  **Verification** (`verify` function):
  - [ ] Check 1: `extractDelegations(session)` contains `"code-reviewer"` — Loom delegated to Code Reviewer
  - [ ] Check 2: `extractDelegations(session)` contains `"compliance-checker"` — Loom delegated to Compliance
  - [ ] Check 3: `extractDelegations(session)` does NOT contain `"weft"` — disabled agent not used
  - [ ] Check 4: `extractDelegations(session)` does NOT contain `"warp"` — disabled agent not used
  - [ ] Check 5: Session completed without error
  - [ ] Check 6: Loom's system prompt does NOT contain the word "spindle" (disabled agent stripped) — verify via config handler output
  **Expected outcome**: Loom narrates delegating to Code Reviewer and Compliance, both return read-only review results
  **Failure modes**:
  - Loom delegates to weft/warp despite them being disabled → `disabled_agents` not working in config pipeline. **Critical bug**.
  - Loom doesn't delegate to code-reviewer/compliance-checker → `prompt_append` not reaching Loom, or model ignoring instructions. Check if agents appear in `getSession` agent list.
  - Custom agents error out → Model resolution failure (no model set on custom agents; they inherit default). Check model config.
  **Bridge fix note**: Once the bridge fix lands, remove the `prompt_append` from this config and verify that Loom delegates based on triggers alone.

- [ ] 4. **Scenario 3: Dual Security Review**
  **What**: Verify that adding a custom security agent alongside Warp results in Loom delegating to BOTH for security-sensitive tasks.
  **Files**: Create `tests/smoke/scenarios/03-dual-security.ts`, Create `tests/smoke/configs/03-dual-security.json`
  **Setup** — Config at `{directory}/.opencode/weave-opencode.json`:
  ```json
  {
    "custom_agents": {
      "security-gpt": {
        "display_name": "Security (GPT)",
        "description": "Independent security review using a second opinion model",
        "category": "advisor",
        "cost": "EXPENSIVE",
        "prompt": "You are an independent security auditor providing a second opinion. Review code for authentication flaws, injection vulnerabilities, insecure defaults, secrets exposure, and cryptographic misuse. Provide specific, actionable findings with severity ratings. Be thorough.",
        "tools": { "write": false, "edit": false, "bash": false },
        "triggers": [
          { "domain": "Security", "trigger": "Independent security review, second opinion on security-sensitive changes" }
        ]
      }
    },
    "agents": {
      "loom": {
        "prompt_append": "IMPORTANT: When reviewing security-sensitive changes, delegate to BOTH Warp AND Security (GPT) for independent reviews. Two security opinions are better than one."
      }
    }
  }
  ```
  **Prompt**: `"Review the authentication module in this repository for security vulnerabilities. Check for token handling issues, session management flaws, and input validation problems."`
  **Verification** (`verify` function):
  - [ ] Check 1: `extractDelegations(session)` contains `"warp"` — Loom delegated to Warp
  - [ ] Check 2: `extractDelegations(session)` contains `"security-gpt"` — Loom delegated to Security (GPT)
  - [ ] Check 3: Session completed without error
  - [ ] Check 4: Both agents returned review results (non-empty tool results)
  **Expected outcome**: Loom narrates delegating to both Warp and Security (GPT), both return independent security reviews
  **Failure modes**:
  - Only Warp or only Security (GPT) invoked → Model didn't follow `prompt_append` dual-delegation instruction. Soft failure — LLM judgment.
  - Security (GPT) agent errors out → Model resolution. Since no `model` is set, it inherits default. If the default model isn't available, agent creation fails silently. Check session messages for errors.
  - Neither invoked → Loom handled security review directly. Check if `prompt_append` was applied to Loom's prompt.
  **Bridge fix note**: Once the bridge fix lands, Loom's delegation table will show both Warp and Security (GPT) under "Security" domain, making dual delegation more natural.

- [ ] 5. **Scenario 4: Minimal Agent Setup**
  **What**: Verify that disabling pattern, spindle, weft, and warp results in Loom working with only Thread and Shuttle, skipping planning phases.
  **Files**: Create `tests/smoke/scenarios/04-minimal-setup.ts`, Create `tests/smoke/configs/04-minimal-setup.json`
  **Setup** — Config at `{directory}/.opencode/weave-opencode.json`:
  ```json
  {
    "disabled_agents": ["pattern", "spindle", "weft", "warp"],
    "agents": {
      "loom": {
        "prompt_append": "Skip planning phases. Work directly with Thread for exploration and Shuttle for coding. Do not attempt to use Pattern, Spindle, Weft, or Warp — they are disabled."
      }
    }
  }
  ```
  **Prompt**: `"Create a new file called hello.ts in the root of this repository with a function that returns 'Hello, World!'. Export the function as default."`
  **Rationale**: A simple coding task that should go through Shuttle (category-specific work) or Loom can handle directly. The key assertion is that disabled agents are NOT invoked.
  **Verification** (`verify` function):
  - [ ] Check 1: `extractDelegations(session)` does NOT contain `"pattern"` — disabled
  - [ ] Check 2: `extractDelegations(session)` does NOT contain `"spindle"` — disabled
  - [ ] Check 3: `extractDelegations(session)` does NOT contain `"weft"` — disabled
  - [ ] Check 4: `extractDelegations(session)` does NOT contain `"warp"` — disabled
  - [ ] Check 5: Session completed without error
  - [ ] Check 6: `getDiffs(session)` shows `hello.ts` was created — task actually completed
  - [ ] Check 7: Loom's system prompt (from config handler) does NOT contain "spindle", "pattern", "Weft", "Warp" references — `composeLoomPrompt` stripped them
  **Expected outcome**: Loom either handles the task directly or delegates to Shuttle/Thread. The file `hello.ts` is created.
  **Failure modes**:
  - Loom attempts to delegate to a disabled agent → `disabled_agents` filtering broken in `createBuiltinAgents`. **Critical bug** — disabled agent still exists in agent map.
  - Task not completed (no file created) → Loom couldn't figure out how to proceed without Pattern for planning. Soft failure — validates that minimal setup needs clear `prompt_append` guidance.
  - Loom's prompt still references disabled agents → `composeLoomPrompt` not receiving `disabledAgents` set. **Bug in config wiring**.

- [ ] 6. **Scenario 5: Domain-Specialized Coding Agents**
  **What**: Verify that domain-specialized custom agents (frontend-dev, backend-dev) are registered and Loom delegates frontend tasks to the frontend agent.
  **Files**: Create `tests/smoke/scenarios/05-domain-coding.ts`, Create `tests/smoke/configs/05-domain-coding.json`
  **Setup** — Config at `{directory}/.opencode/weave-opencode.json`:
  ```json
  {
    "custom_agents": {
      "frontend-dev": {
        "display_name": "Frontend Dev",
        "description": "Specializes in React, TypeScript, CSS, and frontend architecture",
        "category": "specialist",
        "cost": "CHEAP",
        "prompt": "You are a frontend development specialist. You work with React, TypeScript, CSS/Tailwind, and modern frontend tooling. Write clean, accessible, performant UI code. Follow component-based architecture patterns.",
        "triggers": [
          { "domain": "Frontend", "trigger": "React components, CSS styling, frontend architecture, UI development" }
        ]
      },
      "backend-dev": {
        "display_name": "Backend Dev",
        "description": "Specializes in Node.js, APIs, databases, and server architecture",
        "category": "specialist",
        "cost": "CHEAP",
        "prompt": "You are a backend development specialist. You work with Node.js, Express/Fastify, databases, and API design. Write robust, well-tested server code. Follow RESTful conventions and handle errors properly.",
        "triggers": [
          { "domain": "Backend", "trigger": "API endpoints, database queries, server logic, backend architecture" }
        ]
      }
    },
    "agents": {
      "loom": {
        "prompt_append": "IMPORTANT: For frontend work (React components, CSS, UI), delegate to Frontend Dev. For backend work (APIs, databases, server logic), delegate to Backend Dev. Use these domain specialists instead of generic Shuttle for their respective domains."
      }
    }
  }
  ```
  **Prompt**: `"Create a simple React component called LoginForm that has email and password inputs with a submit button. Put it in src/components/LoginForm.tsx. Use TypeScript and include proper type annotations."`
  **Verification** (`verify` function):
  - [ ] Check 1: `extractDelegations(session)` contains `"frontend-dev"` — Loom delegated to Frontend Dev
  - [ ] Check 2: `extractDelegations(session)` does NOT contain `"shuttle"` for this task — domain specialist used instead
  - [ ] Check 3: Session completed without error
  - [ ] Check 4: `getDiffs(session)` shows `src/components/LoginForm.tsx` was created (or attempted)
  **Expected outcome**: Loom narrates delegating to Frontend Dev, which creates the React component
  **Failure modes**:
  - Loom delegates to Shuttle instead of Frontend Dev → `prompt_append` not effective enough, or model chose generic path. Soft failure.
  - Frontend Dev errors out → Check model resolution, check if the agent was properly registered
  - Loom does the work directly → Valid for simple tasks, but misses the delegation verification point. The prompt should be complex enough to trigger delegation.
  **Bridge fix note**: Once the bridge fix lands, Frontend Dev's trigger `"React components, CSS styling..."` would automatically appear in Loom's delegation table, making delegation more reliable without `prompt_append`.

- [ ] 7. **Create test runner with structured reporting**
  **What**: Build `tests/smoke/run.ts` that imports all scenarios, runs them sequentially, collects results, and outputs a structured report (JSON + human-readable summary). Include cleanup logic to remove injected configs after each scenario.
  **Files**: Create `tests/smoke/run.ts`
  **Details**:
  - Import all 5 scenario files
  - For each scenario:
    1. Log scenario name and description
    2. If `scenario.config` is non-null, call `injectConfig(directory, config)`
    3. Call `createSession()` with appropriate isolation strategy
    4. Call `promptSession()` with the scenario prompt
    5. Call `waitForCompletion()` with the scenario timeout
    6. Call `getSession()` to get full conversation
    7. Call `scenario.verify(session)` to get verification result
    8. If `scenario.config` was injected, call `cleanupConfig(directory)`
    9. Record result (scenario name, pass/fail, checks detail, duration)
  - After all scenarios:
    - Print summary table: `PASS/FAIL | Scenario Name | Duration | Checks`
    - Write detailed results to `tests/smoke/results.json`
    - Exit with code 0 if all pass, 1 if any fail
  - Include `--scenario` flag to run a single scenario by name
  - Include `--timeout` flag to override default timeouts
  - Include `--directory` flag to specify the target repo directory
  **Acceptance**: `bun run tests/smoke/run.ts --directory /path/to/repo` executes all scenarios and produces a report

- [ ] 8. **Create extractDelegations helper for conversation parsing**
  **What**: Implement the core conversation parsing logic that extracts which agents were delegated to from a session's message history. This is the key verification primitive.
  **Files**: `tests/smoke/harness.ts` (add to existing harness)
  **Details**:
  - Parse the session's messages array from `GET /api/sessions/:id` response
  - For each message with `role: "assistant"`:
    - Check for `tool_calls` array
    - For each tool call where `function.name === "task"` or `function.name === "call_weave_agent"`:
      - Parse `function.arguments` (JSON string) to extract `subagent_type` or `agent` field
      - Add to `delegatedAgents: Set<string>`
  - Also scan assistant text content for delegation narration patterns:
    - `"Delegating to {agent}..."` → extract agent name
    - `"Asking {agent} to..."` → extract agent name
    - This catches cases where narration exists but tool call parsing fails
  - Return `{ delegatedAgents: Set<string>, toolCalls: Array<{tool, agent, prompt}> }`
  - Handle edge cases:
    - Tool call with no `subagent_type` field (fallback to `description`)
    - Nested JSON in arguments
    - Empty or malformed messages
  **Acceptance**: Given a mock session with known tool calls, `extractDelegations()` returns the correct set of agent names

- [ ] 9. **Add config injection verification step to each scenario**
  **What**: Before sending the prompt, verify that the injected config was actually loaded by the session. Query the session's config handler output (via agent list) to confirm custom agents appear and disabled agents are absent.
  **Files**: Modify scenarios 2–5 verification functions
  **Details**:
  - After session creation but before verification, check the session details for registered agents
  - For scenarios with `disabled_agents`: confirm those agents are NOT in the session's agent list
  - For scenarios with `custom_agents`: confirm those agents ARE in the session's agent list
  - This catches config loading failures early — if config isn't loaded, we know the test is invalid rather than reporting a false failure
  **Acceptance**: Each scenario reports "Config verified" before running delegation checks

- [ ] 10. **Add timeout and retry handling**
  **What**: Implement robust timeout handling for session completion. LLM responses can be slow, especially when multiple delegations occur. Include configurable per-scenario timeouts and graceful failure reporting on timeout.
  **Files**: `tests/smoke/harness.ts`
  **Details**:
  - Default timeout: 120 seconds per scenario
  - Scenarios with multiple delegations (2, 3, 5): 180 seconds
  - Polling interval: 5 seconds
  - On timeout:
    - Fetch session state at timeout
    - Log last message in conversation
    - Report as `TIMEOUT` (distinct from `FAIL`)
    - Include partial results — which checks passed before timeout
  - Retry logic: if a scenario times out, optionally retry once with 2x timeout
  **Acceptance**: Timeout scenarios produce clear `TIMEOUT` status with partial diagnostics

---

## Interpreting Results

### Result Categories

| Status | Meaning | Action |
|--------|---------|--------|
| **PASS** | All verification checks passed | ✅ Workflow works as expected |
| **FAIL** | One or more checks failed | 🔍 Investigate — see check details |
| **TIMEOUT** | Session didn't complete in time | ⏰ Likely model slowness, not a bug — retry with longer timeout |
| **ERROR** | Infrastructure failure (Fleet API down, session creation failed) | 🔧 Fix infrastructure, not Weave |

### Common Failure Patterns

**"Loom didn't delegate to custom agent X"**
- Check 1: Is the custom agent in the session's agent list? If NO → config loading failure
- Check 2: Is `prompt_append` present in Loom's system prompt? If NO → agent override not applied
- Check 3: Did Loom narrate any delegation at all? If NO → model might have handled the task directly (soft failure for simple tasks)
- Check 4: Did Loom delegate to a different agent? If YES → model chose a different routing path (common with LLM variability)

**"Loom delegated to disabled agent X"**
- This is a **critical bug** — `disabled_agents` filtering in `createBuiltinAgents()` or `ConfigHandler.applyAgentConfig()` is broken
- Check: Is the disabled agent present in the session's registered agent list? If YES → agent wasn't removed

**"Custom agent errored out"**
- Check model resolution: custom agents with no `model` field inherit the system default. If no system default is available, agent creation may fail
- Check tool permissions: if the agent's `tools` config denies a tool it tried to use, the tool call will be blocked
- Check prompt: an empty or broken prompt can cause model confusion

### LLM Variability Note

These are **smoke tests**, not deterministic unit tests. LLM-driven delegation decisions have inherent variability:
- Loom might decide a task is simple enough to handle directly (skipping delegation)
- Loom might choose a different agent than expected for borderline tasks
- The same prompt may produce different delegation patterns on different runs

**Mitigation strategies**:
1. Use strong prompts that clearly match the target agent's domain
2. Use `prompt_append` to make delegation instructions explicit
3. Run each scenario 2–3 times and consider it passing if delegation occurs in majority of runs
4. Distinguish "hard failures" (disabled agent invoked, config not loaded) from "soft failures" (model chose alternative path)

---

## Verification

- [ ] All 5 scenarios execute without infrastructure errors
- [ ] Scenario 1 (baseline) demonstrates Thread delegation in ≥50% of runs
- [ ] Scenario 2 shows disabled agents (weft, warp) are never invoked
- [ ] Scenario 3 shows dual delegation (warp + security-gpt) in ≥50% of runs
- [ ] Scenario 4 shows disabled agents (pattern, spindle, weft, warp) are never invoked AND file is created
- [ ] Scenario 5 shows frontend-dev delegation in ≥50% of runs
- [ ] Config injection and cleanup works correctly (no leftover configs after test run)
- [ ] Test runner produces machine-readable results (JSON)
- [ ] Tests can be run with `bun run tests/smoke/run.ts --directory .`
