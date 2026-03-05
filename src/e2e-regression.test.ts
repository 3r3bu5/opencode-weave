/**
 * E2E regression tests for PR #12: configurable agent framework.
 *
 * These tests close the gap between unit tests and the real plugin
 * initialization flow by exercising WeavePlugin() from src/index.ts
 * end-to-end — covering config loading, analytics opt-in/opt-out,
 * hook→tracker→JSONL persistence, configDir prompt resolution,
 * JSONL rotation, agent name variant registration, and a combined
 * features smoke test.
 *
 * No LLM model is required — these tests verify wiring and
 * configuration, not inference.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { PluginInput } from "@opencode-ai/plugin"
import WeavePlugin from "./index"
import { AGENT_DISPLAY_NAMES, getAgentDisplayName } from "./shared/agent-display-names"
import { createSessionTracker } from "./features/analytics/session-tracker"
import {
  readSessionSummaries,
  appendSessionSummary,
  MAX_SESSION_ENTRIES,
} from "./features/analytics/storage"
import { createManagers } from "./create-managers"
import { WeaveConfigSchema } from "./config/schema"
import { stripDisabledAgentReferences } from "./agents/agent-builder"
import { ANALYTICS_DIR, SESSION_SUMMARIES_FILE } from "./features/analytics/types"

// ── Shared helpers ─────────────────────────────────────────────────

const makeMockCtx = (directory: string): PluginInput =>
  ({
    directory,
    client: {},
    project: { root: directory },
    serverUrl: "http://localhost:3000",
  }) as unknown as PluginInput

function writeProjectConfig(testDir: string, config: Record<string, unknown>): void {
  const configDir = join(testDir, ".opencode")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, "weave-opencode.json"), JSON.stringify(config), "utf-8")
}

function cleanupCustomDisplayNames(registeredKeys: string[]): void {
  for (const key of registeredKeys) {
    delete AGENT_DISPLAY_NAMES[key]
  }
}

// ── 1. Full WeavePlugin() initialization flow ──────────────────────

describe("E2E Regression: WeavePlugin full initialization", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weave-e2e-init-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("returns all 8 handlers and config produces all builtin agents", async () => {
    const plugin = await WeavePlugin(makeMockCtx(testDir))

    // Verify all 8 handler keys exist
    const expectedKeys = [
      "tool",
      "config",
      "chat.message",
      "chat.params",
      "chat.headers",
      "event",
      "tool.execute.before",
      "tool.execute.after",
    ]
    for (const key of expectedKeys) {
      expect((plugin as Record<string, unknown>)[key]).toBeDefined()
    }

    // Run config handler — it mutates the object
    const configObj: Record<string, unknown> = {}
    await (plugin.config as (c: Record<string, unknown>) => Promise<void>)(configObj)

    // All 8 builtin agents should be present
    const agents = configObj.agent as Record<string, { prompt?: string }>
    expect(agents).toBeDefined()

    const builtinNames = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "warp", "weft"]
    for (const name of builtinNames) {
      const displayName = getAgentDisplayName(name)
      expect(agents[displayName]).toBeDefined()
    }

    // Loom should have a prompt with <Role>
    const loomDisplayName = getAgentDisplayName("loom")
    expect(agents[loomDisplayName].prompt).toContain("<Role>")

    // Default agent should be Loom
    expect(configObj.default_agent).toBe(loomDisplayName)
  })

  it("with no config file does NOT create analytics directory", async () => {
    await WeavePlugin(makeMockCtx(testDir))
    expect(existsSync(join(testDir, ANALYTICS_DIR))).toBe(false)
  })
})

// ── 2. Analytics opt-in/opt-out E2E ────────────────────────────────

describe("E2E Regression: Analytics opt-in/opt-out", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weave-e2e-analytics-"))
    // Write project marker files for fingerprint detection
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test-proj", dependencies: {} }))
    writeFileSync(join(testDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("analytics.enabled: true creates analytics directory and fingerprint", async () => {
    writeProjectConfig(testDir, { analytics: { enabled: true } })
    await WeavePlugin(makeMockCtx(testDir))

    expect(existsSync(join(testDir, ANALYTICS_DIR))).toBe(true)
    expect(existsSync(join(testDir, ANALYTICS_DIR, "fingerprint.json"))).toBe(true)

    // Fingerprint should have expected fields
    const fingerprint = JSON.parse(readFileSync(join(testDir, ANALYTICS_DIR, "fingerprint.json"), "utf-8"))
    expect(Array.isArray(fingerprint.stack)).toBe(true)
    expect(fingerprint.primaryLanguage).toBeDefined()
    expect(fingerprint.packageManager).toBeDefined()
  })

  it("analytics.enabled omitted (default) does NOT create analytics artifacts", async () => {
    writeProjectConfig(testDir, {})
    await WeavePlugin(makeMockCtx(testDir))

    expect(existsSync(join(testDir, ANALYTICS_DIR))).toBe(false)
  })

  it("analytics.enabled: true injects fingerprint into Loom prompt", async () => {
    // Add bun.lockb so fingerprint detects bun
    writeFileSync(join(testDir, "bun.lockb"), "")
    writeProjectConfig(testDir, { analytics: { enabled: true } })

    const plugin = await WeavePlugin(makeMockCtx(testDir))
    const configObj: Record<string, unknown> = {}
    await (plugin.config as (c: Record<string, unknown>) => Promise<void>)(configObj)

    const agents = configObj.agent as Record<string, { prompt?: string }>
    const loomPrompt = agents[getAgentDisplayName("loom")].prompt ?? ""

    expect(loomPrompt).toContain("<ProjectContext>")
    expect(loomPrompt).toContain("typescript")
    expect(loomPrompt).toContain("bun")
  })
})

// ── 3. Tracker → JSONL persistence flow ────────────────────────────

describe("E2E Regression: Tracker → JSONL persistence", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weave-e2e-tracker-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("endSession() persists summary to JSONL file on disk", () => {
    const tracker = createSessionTracker(testDir)
    tracker.startSession("persist-test-1")
    tracker.trackToolStart("persist-test-1", "read", "c1")
    tracker.trackToolEnd("persist-test-1", "read", "c1")
    tracker.trackToolStart("persist-test-1", "task", "c2", "thread")
    tracker.trackToolEnd("persist-test-1", "task", "c2", "thread")
    const summary = tracker.endSession("persist-test-1")

    expect(summary).not.toBeNull()
    expect(existsSync(join(testDir, ANALYTICS_DIR, SESSION_SUMMARIES_FILE))).toBe(true)

    // Read and parse the JSONL file directly
    const content = readFileSync(join(testDir, ANALYTICS_DIR, SESSION_SUMMARIES_FILE), "utf-8")
    const lines = content.split("\n").filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(1)

    const parsed = JSON.parse(lines[0])
    expect(parsed.sessionId).toBe("persist-test-1")
    expect(parsed.totalToolCalls).toBe(2)
    expect(parsed.totalDelegations).toBe(1)
  })

  it("readSessionSummaries() reads back persisted data correctly", () => {
    const tracker = createSessionTracker(testDir)

    // Session 1: 2 tool calls
    tracker.startSession("session-a")
    tracker.trackToolStart("session-a", "read", "a1")
    tracker.trackToolEnd("session-a", "read", "a1")
    tracker.trackToolStart("session-a", "write", "a2")
    tracker.trackToolEnd("session-a", "write", "a2")
    tracker.endSession("session-a")

    // Session 2: 1 tool call
    tracker.startSession("session-b")
    tracker.trackToolStart("session-b", "bash", "b1")
    tracker.trackToolEnd("session-b", "bash", "b1")
    tracker.endSession("session-b")

    const summaries = readSessionSummaries(testDir)
    expect(summaries.length).toBe(2)
    expect(summaries[0].sessionId).toBe("session-a")
    expect(summaries[0].totalToolCalls).toBe(2)
    expect(summaries[1].sessionId).toBe("session-b")
    expect(summaries[1].totalToolCalls).toBe(1)
  })

  it("multiple sessions accumulate in the same JSONL file", () => {
    const tracker = createSessionTracker(testDir)

    for (let i = 0; i < 3; i++) {
      const sid = `multi-${i}`
      tracker.startSession(sid)
      tracker.trackToolStart(sid, "read", `c-${i}`)
      tracker.trackToolEnd(sid, "read", `c-${i}`)
      tracker.endSession(sid)
    }

    const content = readFileSync(join(testDir, ANALYTICS_DIR, SESSION_SUMMARIES_FILE), "utf-8")
    const lines = content.split("\n").filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(3)

    const summaries = readSessionSummaries(testDir)
    expect(summaries.length).toBe(3)
    expect(summaries[0].sessionId).toBe("multi-0")
    expect(summaries[2].sessionId).toBe("multi-2")
  })
})

// ── 4. configDir prompt_file resolution ────────────────────────────

describe("E2E Regression: configDir prompt_file resolution", () => {
  let testDir: string
  const registeredKeys: string[] = []

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weave-e2e-configdir-"))
    // Create prompts subdirectory with a known prompt file
    mkdirSync(join(testDir, "prompts"), { recursive: true })
    writeFileSync(
      join(testDir, "prompts", "my-agent.md"),
      "You are a database optimization specialist.\n\nFocus on query performance.",
    )
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    cleanupCustomDisplayNames(registeredKeys)
    registeredKeys.length = 0
  })

  it("prompt_file resolved relative to configDir through createManagers", () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "db-helper": {
          prompt_file: "prompts/my-agent.md",
          display_name: "DB Helper",
        },
      },
    })
    registeredKeys.push("db-helper")

    const managers = createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: config,
      configDir: testDir,
    })

    expect(managers.agents["db-helper"]).toBeDefined()
    expect(managers.agents["db-helper"].prompt).toContain("database optimization specialist")
    expect(managers.agents["db-helper"].prompt).toContain("query performance")
  })

  it("prompt_file with missing file results in empty or undefined prompt (graceful fallback)", () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "missing-prompt": {
          prompt_file: "nonexistent.md",
          display_name: "Missing",
        },
      },
    })
    registeredKeys.push("missing-prompt")

    const managers = createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: config,
      configDir: testDir,
    })

    // Agent should still be built — just with no prompt content
    expect(managers.agents["missing-prompt"]).toBeDefined()
    const prompt = managers.agents["missing-prompt"].prompt
    expect(!prompt || prompt.trim() === "").toBe(true)
  })
})

// ── 5. JSONL rotation through real storage API ─────────────────────

describe("E2E Regression: JSONL rotation through storage API", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weave-e2e-rotation-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("JSONL file rotates to MAX_SESSION_ENTRIES when threshold exceeded", () => {
    // Write 1001 entries via appendSessionSummary
    for (let i = 0; i <= MAX_SESSION_ENTRIES; i++) {
      appendSessionSummary(testDir, {
        sessionId: `s-${i}`,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 100,
        toolUsage: [],
        delegations: [],
        totalToolCalls: 0,
        totalDelegations: 0,
      })
    }

    const summaries = readSessionSummaries(testDir)
    expect(summaries.length).toBe(MAX_SESSION_ENTRIES)
    // First entry (s-0) should have been trimmed
    expect(summaries[0].sessionId).toBe("s-1")
    expect(summaries[summaries.length - 1].sessionId).toBe(`s-${MAX_SESSION_ENTRIES}`)
  })
})

// ── 6. Custom agent name variant registration ──────────────────────

describe("E2E Regression: Custom agent name variant registration", () => {
  let testDir: string
  const registeredKeys: string[] = []

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weave-e2e-variants-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    cleanupCustomDisplayNames(registeredKeys)
    registeredKeys.length = 0
  })

  it("buildCustomAgent via createManagers registers name variants for stripDisabledAgentReferences", () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "code-reviewer": {
          prompt: "Review code.",
          display_name: "Code Reviewer",
        },
      },
    })
    registeredKeys.push("code-reviewer")

    createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: config,
    })

    // After building, registerAgentNameVariants should have been called.
    // Verify by checking that stripDisabledAgentReferences strips the custom agent's references.
    const text = "Use code-reviewer for reviews\nUse Code Reviewer for reviews\nKeep this"
    const result = stripDisabledAgentReferences(text, new Set(["code-reviewer"]))

    expect(result).not.toContain("code-reviewer")
    expect(result).not.toContain("Code Reviewer")
    expect(result).toContain("Keep this")
  })

  it("custom agent with same name as display_name gets auto-generated variants", () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "helper": {
          prompt: "Help.",
          display_name: "helper",
        },
      },
    })
    registeredKeys.push("helper")

    createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: config,
    })

    const text = "Use helper for tasks\nUse Helper for tasks\nKeep"
    const result = stripDisabledAgentReferences(text, new Set(["helper"]))

    expect(result).not.toContain("helper")
    expect(result).not.toContain("Helper")
    expect(result).toContain("Keep")
  })
})

// ── 7. All features combined through WeavePlugin ───────────────────

describe("E2E Regression: All features combined through WeavePlugin", () => {
  let testDir: string
  const registeredKeys: string[] = []

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weave-e2e-combined-"))
    // Write project marker files for fingerprint detection
    writeFileSync(join(testDir, "package.json"), JSON.stringify({
      name: "test-combined",
      dependencies: { react: "^18.0.0" },
    }))
    writeFileSync(join(testDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }))
    writeFileSync(join(testDir, "bun.lockb"), "")
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    cleanupCustomDisplayNames(registeredKeys)
    registeredKeys.length = 0
  })

  it("overrides + custom agents + disabled agents + fingerprint + analytics together", async () => {
    writeProjectConfig(testDir, {
      agents: { loom: { model: "override-test-model" } },
      custom_agents: {
        "my-specialist": {
          prompt: "I handle specialized tasks.",
          display_name: "My Specialist",
          category: "specialist",
          cost: "CHEAP",
        },
      },
      disabled_agents: ["spindle"],
      analytics: { enabled: true },
    })
    registeredKeys.push("my-specialist")

    const plugin = await WeavePlugin(makeMockCtx(testDir))
    const configObj: Record<string, unknown> = {}
    await (plugin.config as (c: Record<string, unknown>) => Promise<void>)(configObj)

    const agents = configObj.agent as Record<string, { prompt?: string; model?: string }>

    // Agent overrides
    const loomDisplayName = getAgentDisplayName("loom")
    expect(agents[loomDisplayName]).toBeDefined()
    expect(agents[loomDisplayName].model).toBe("override-test-model")

    // Custom agents
    expect(agents["My Specialist"]).toBeDefined()
    expect(agents["My Specialist"].prompt).toContain("specialized tasks")

    // Disabled agents
    const spindleDisplayName = getAgentDisplayName("spindle")
    expect(agents[spindleDisplayName]).toBeUndefined()

    // Non-disabled agents still present
    expect(agents[getAgentDisplayName("thread")]).toBeDefined()
    expect(agents[getAgentDisplayName("tapestry")]).toBeDefined()

    // Fingerprint injection (analytics enabled → fingerprint injected into prompts)
    const loomPrompt = agents[loomDisplayName].prompt ?? ""
    expect(loomPrompt).toContain("<ProjectContext>")
    expect(loomPrompt).toContain("typescript")

    // Analytics directory created
    expect(existsSync(join(testDir, ANALYTICS_DIR))).toBe(true)

    // Disabled agent not in Loom prompt
    expect(loomPrompt).not.toContain("spindle")

     // Default agent set
    expect(configObj.default_agent).toBe(loomDisplayName)
  })
})

// ── 8. Completely custom workflow ──────────────────────────────────

describe("E2E Regression: Completely custom workflow through WeavePlugin", () => {
  let testDir: string
  const registeredKeys: string[] = []

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weave-e2e-workflow-"))
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "custom-workflow-test" }))

    // Write a prompt file for the orchestrator
    mkdirSync(join(testDir, ".opencode", "prompts"), { recursive: true })
    writeFileSync(
      join(testDir, ".opencode", "prompts", "orchestrator.md"),
      [
        "You are the lead orchestrator for a data pipeline team.",
        "",
        "Your job is to coordinate between the data-validator and report-writer agents.",
        "Always validate data before generating reports.",
      ].join("\n"),
    )
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    cleanupCustomDisplayNames(registeredKeys)
    registeredKeys.length = 0
  })

  it("user-defined workflow: disable most builtins, define custom agents with roles and tool permissions", async () => {
    writeProjectConfig(testDir, {
      // Disable all builtins except thread (keep one lightweight explorer)
      disabled_agents: ["loom", "tapestry", "shuttle", "pattern", "spindle", "warp", "weft"],
      custom_agents: {
        // Primary orchestrator — replaces Loom
        "pipeline-lead": {
          prompt_file: "prompts/orchestrator.md",
          display_name: "Pipeline Lead",
          mode: "primary",
          model: "anthropic/claude-sonnet-4",
          category: "utility",
          cost: "EXPENSIVE",
          description: "Orchestrates the data pipeline workflow",
          triggers: [
            { domain: "Orchestration", trigger: "Coordinate data pipeline tasks" },
            { domain: "Planning", trigger: "Plan data processing steps" },
          ],
        },
        // Specialist: validates data, read-only tools
        "data-validator": {
          prompt: "You validate data quality. Check schemas, detect anomalies, report issues.",
          display_name: "Data Validator",
          mode: "subagent",
          category: "specialist",
          cost: "CHEAP",
          tools: { read: true, glob: true, grep: true, write: false, edit: false, bash: false },
          description: "Validates data quality and schema conformance",
          triggers: [
            { domain: "Data Quality", trigger: "When data needs validation or schema checking" },
          ],
        },
        // Specialist: generates reports, can write files
        "report-writer": {
          prompt: "You generate reports from validated data. Write clear, structured markdown reports.",
          display_name: "Report Writer",
          mode: "subagent",
          category: "specialist",
          cost: "CHEAP",
          tools: { read: true, write: true, edit: true, bash: false, glob: true, grep: true },
          description: "Generates structured reports from data",
          triggers: [
            { domain: "Reporting", trigger: "When reports need to be generated from data" },
          ],
        },
      },
    })
    registeredKeys.push("pipeline-lead", "data-validator", "report-writer")

    const plugin = await WeavePlugin(makeMockCtx(testDir))
    const configObj: Record<string, unknown> = {}
    await (plugin.config as (c: Record<string, unknown>) => Promise<void>)(configObj)

    const agents = configObj.agent as Record<string, {
      prompt?: string
      model?: string
      mode?: string
      tools?: Record<string, boolean>
      description?: string
    }>

    // ── All 7 disabled builtins should be absent ──
    const disabledBuiltins = ["loom", "tapestry", "shuttle", "pattern", "spindle", "warp", "weft"]
    for (const name of disabledBuiltins) {
      expect(agents[getAgentDisplayName(name)]).toBeUndefined()
    }

    // ── Thread (the one remaining builtin) should still be present ──
    expect(agents[getAgentDisplayName("thread")]).toBeDefined()

    // ── Custom orchestrator: prompt loaded from file, mode primary ──
    const lead = agents["Pipeline Lead"]
    expect(lead).toBeDefined()
    expect(lead.prompt).toContain("lead orchestrator for a data pipeline team")
    expect(lead.prompt).toContain("data-validator and report-writer")
    expect(lead.model).toBe("anthropic/claude-sonnet-4")
    expect(lead.mode).toBe("primary")

    // ── Custom data-validator: inline prompt, restricted tools ──
    const validator = agents["Data Validator"]
    expect(validator).toBeDefined()
    expect(validator.prompt).toContain("validate data quality")
    expect(validator.mode).toBe("subagent")
    const validatorTools = validator.tools as Record<string, boolean>
    expect(validatorTools.read).toBe(true)
    expect(validatorTools.write).toBe(false)
    expect(validatorTools.bash).toBe(false)

    // ── Custom report-writer: inline prompt, write-enabled tools ──
    const writer = agents["Report Writer"]
    expect(writer).toBeDefined()
    expect(writer.prompt).toContain("generate reports")
    const writerTools = writer.tools as Record<string, boolean>
    expect(writerTools.write).toBe(true)
    expect(writerTools.bash).toBe(false)

    // ── Default agent fallback: Loom is disabled, so it should fall back ──
    // resolveDefaultAgent picks first agent in the map when Loom is absent.
    // Thread is the only remaining builtin, so it should be first.
    const defaultAgent = configObj.default_agent as string
    expect(defaultAgent).toBeDefined()
    // Loom is disabled — default should NOT be Loom
    expect(defaultAgent).not.toBe(getAgentDisplayName("loom"))

    // ── Total agent count: 1 builtin (thread) + 3 custom = 4 ──
    const agentKeys = Object.keys(agents)
    expect(agentKeys.length).toBe(4)
  })

  it("custom agents get proper name variant registration for prompt stripping", async () => {
    writeProjectConfig(testDir, {
      disabled_agents: ["loom", "tapestry", "shuttle", "pattern", "spindle", "warp", "weft"],
      custom_agents: {
        "pipeline-lead": {
          prompt: "Orchestrate pipeline tasks. Delegate to data-validator for checks.",
          display_name: "Pipeline Lead",
          mode: "primary",
        },
        "data-validator": {
          prompt: "Validate data.",
          display_name: "Data Validator",
          mode: "subagent",
        },
      },
    })
    registeredKeys.push("pipeline-lead", "data-validator")

    createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: WeaveConfigSchema.parse({
        disabled_agents: ["loom", "tapestry", "shuttle", "pattern", "spindle", "warp", "weft"],
        custom_agents: {
          "pipeline-lead": {
            prompt: "Orchestrate pipeline tasks. Delegate to data-validator for checks.",
            display_name: "Pipeline Lead",
            mode: "primary",
          },
          "data-validator": {
            prompt: "Validate data.",
            display_name: "Data Validator",
            mode: "subagent",
          },
        },
      }),
    })

    // If data-validator is disabled, its references should be stripped
    const text = [
      "Use data-validator for checking schemas",
      "Use Data Validator for quality checks",
      "Use Pipeline Lead for orchestration",
      "Keep this line",
    ].join("\n")

    const result = stripDisabledAgentReferences(text, new Set(["data-validator"]))
    expect(result).not.toContain("data-validator")
    expect(result).not.toContain("Data Validator")
    expect(result).toContain("Pipeline Lead")
    expect(result).toContain("Keep this line")
  })
})
