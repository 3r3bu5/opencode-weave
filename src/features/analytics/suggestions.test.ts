import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { generateSuggestions, getSuggestionsForProject } from "./suggestions"
import { appendSessionSummary } from "./storage"
import type { SessionSummary } from "./types"

let tempDir: string

function makeSummary(overrides?: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: "s1",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:05:00.000Z",
    durationMs: 300_000,
    toolUsage: [{ tool: "read", count: 5 }],
    delegations: [],
    totalToolCalls: 5,
    totalDelegations: 0,
    ...overrides,
  }
}

beforeEach(() => {
  tempDir = join(tmpdir(), `weave-suggest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

describe("generateSuggestions", () => {
  it("returns empty array when fewer than 3 sessions", () => {
    const summaries = [makeSummary({ sessionId: "s1" }), makeSummary({ sessionId: "s2" })]
    expect(generateSuggestions(summaries)).toEqual([])
  })

  it("returns empty array for empty input", () => {
    expect(generateSuggestions([])).toEqual([])
  })

  it("detects high tool usage (>50 avg calls per session)", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 60,
        toolUsage: [{ tool: "read", count: 60 }],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "high-tool-usage")).toBe(true)
  })

  it("does not flag high tool usage when under threshold", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 10,
        toolUsage: [{ tool: "read", count: 10 }],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "high-tool-usage")).toBe(false)
  })

  it("detects read-heavy sessions (>60% reads)", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 10,
        toolUsage: [
          { tool: "read", count: 8 },
          { tool: "write", count: 2 },
        ],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "read-heavy")).toBe(true)
  })

  it("does not flag read-heavy when balanced", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 10,
        toolUsage: [
          { tool: "read", count: 4 },
          { tool: "write", count: 3 },
          { tool: "grep", count: 3 },
        ],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "read-heavy")).toBe(false)
  })

  it("detects low delegation with enough sessions", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalDelegations: 0,
        delegations: [],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "low-delegation")).toBe(true)
  })

  it("does not flag low delegation with insufficient sessions", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalDelegations: 0,
        delegations: [],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    // 3 sessions < 5 minimum for low-delegation suggestion
    expect(suggestions.some((s) => s.id === "low-delegation")).toBe(false)
  })

  it("detects slow delegations (>60s average)", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalDelegations: 1,
        delegations: [
          { agent: "pattern", toolCallId: `c${i}`, durationMs: 90_000 },
        ],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "slow-delegation-pattern")).toBe(true)
  })

  it("does not flag fast delegations", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalDelegations: 1,
        delegations: [
          { agent: "thread", toolCallId: `c${i}`, durationMs: 5_000 },
        ],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id?.startsWith("slow-delegation"))).toBe(false)
  })

  it("detects many short sessions (>30% under 30s)", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        durationMs: i < 3 ? 10_000 : 300_000, // 3 out of 5 are short
        totalToolCalls: 5,
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "many-short-sessions")).toBe(true)
  })

  it("detects many long sessions (>30% over 30 minutes)", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        durationMs: i < 3 ? 35 * 60 * 1000 : 300_000, // 3 out of 5 are long
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "many-long-sessions")).toBe(true)
  })

  it("all suggestions have required fields", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 60,
        toolUsage: [{ tool: "read", count: 60 }],
        totalDelegations: 0,
        delegations: [],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    for (const s of suggestions) {
      expect(s.id).toBeTruthy()
      expect(s.text).toBeTruthy()
      expect(["tool-usage", "delegation", "workflow"]).toContain(s.category)
      expect(["high", "medium", "low"]).toContain(s.confidence)
    }
  })
})

describe("getSuggestionsForProject", () => {
  it("returns suggestions based on stored summaries", () => {
    // Store 5 sessions with high tool usage
    for (let i = 0; i < 5; i++) {
      appendSessionSummary(
        tempDir,
        makeSummary({
          sessionId: `s${i}`,
          totalToolCalls: 60,
          toolUsage: [{ tool: "read", count: 60 }],
          totalDelegations: 0,
        }),
      )
    }

    const suggestions = getSuggestionsForProject(tempDir)
    expect(suggestions.length).toBeGreaterThan(0)
  })

  it("returns empty array when no summaries exist", () => {
    const suggestions = getSuggestionsForProject(tempDir)
    expect(suggestions).toEqual([])
  })
})
