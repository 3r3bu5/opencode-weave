import { describe, it, expect } from "bun:test"
import { generateTokenReport } from "./token-report"
import type { SessionSummary } from "./types"

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "test-session-id-12345",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:05:00.000Z",
    durationMs: 300_000,
    toolUsage: [],
    delegations: [],
    totalToolCalls: 0,
    totalDelegations: 0,
    ...overrides,
  }
}

describe("generateTokenReport", () => {
  it("returns 'No session data available.' for empty array", () => {
    expect(generateTokenReport([])).toBe("No session data available.")
  })

  it("shows overall totals section", () => {
    const report = generateTokenReport([
      makeSummary({
        totalCost: 0.50,
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 500,
          reasoningTokens: 100,
          cacheReadTokens: 200,
          cacheWriteTokens: 50,
          totalMessages: 3,
        },
      }),
    ])

    expect(report).toContain("## Overall Totals")
    expect(report).toContain("Sessions: 1")
    expect(report).toContain("Messages: 3")
    expect(report).toContain("Input tokens: 1,000")
    expect(report).toContain("Output tokens: 500")
    expect(report).toContain("Reasoning tokens: 100")
    expect(report).toContain("Cache read tokens: 200")
    expect(report).toContain("Cache write tokens: 50")
    expect(report).toContain("$0.50")
  })

  it("groups by agent name correctly", () => {
    const report = generateTokenReport([
      makeSummary({ agentName: "Loom", totalCost: 0.30 }),
      makeSummary({ agentName: "Loom", totalCost: 0.20 }),
      makeSummary({ agentName: "Tapestry", totalCost: 0.10 }),
    ])

    expect(report).toContain("## Per-Agent Breakdown")
    expect(report).toContain("**Loom**")
    expect(report).toContain("**Tapestry**")
    // Loom has higher total cost, should appear first
    const loomIndex = report.indexOf("**Loom**")
    const tapestryIndex = report.indexOf("**Tapestry**")
    expect(loomIndex).toBeLessThan(tapestryIndex)
  })

  it("shows '(unknown)' for sessions without agent name", () => {
    const report = generateTokenReport([
      makeSummary({ totalCost: 0.10 }),
    ])

    expect(report).toContain("(unknown)")
  })

  it("shows top 5 costliest sessions sorted by cost", () => {
    const summaries = [
      makeSummary({ sessionId: "cheap-session", totalCost: 0.01, agentName: "A" }),
      makeSummary({ sessionId: "expensive-session", totalCost: 0.99, agentName: "B" }),
      makeSummary({ sessionId: "mid-session", totalCost: 0.50, agentName: "C" }),
    ]
    const report = generateTokenReport(summaries)

    expect(report).toContain("## Top 5 Costliest Sessions")
    // Most expensive first
    const expensiveIdx = report.indexOf("$0.99")
    const midIdx = report.indexOf("$0.50")
    const cheapIdx = report.indexOf("$0.01")
    expect(expensiveIdx).toBeLessThan(midIdx)
    expect(midIdx).toBeLessThan(cheapIdx)
  })

  it("limits to top 5 even when more than 5 sessions exist", () => {
    const summaries = Array.from({ length: 8 }, (_, i) =>
      makeSummary({ sessionId: `session-${i}`, totalCost: i * 0.10, agentName: "Agent" }),
    )
    const report = generateTokenReport(summaries)

    // Count occurrences of session IDs in the Top 5 section
    const top5Section = report.split("## Top 5 Costliest Sessions")[1]
    const lines = top5Section.split("\n").filter((l) => l.startsWith("- `"))
    expect(lines.length).toBe(5)
  })

  it("handles sessions without tokenUsage/totalCost gracefully", () => {
    const report = generateTokenReport([
      makeSummary({}), // no tokenUsage, no totalCost
    ])

    expect(report).toContain("## Overall Totals")
    expect(report).toContain("$0.00")
    expect(report).toContain("Messages: 0")
  })

  it("formats costs as dollar amounts with 2 decimal places", () => {
    const report = generateTokenReport([
      makeSummary({ totalCost: 1.5 }),
    ])

    expect(report).toContain("$1.50")
  })

  it("formats duration as Xm Ys", () => {
    const report = generateTokenReport([
      makeSummary({ durationMs: 125_000 }), // 2m 5s
    ])

    expect(report).toContain("2m 5s")
  })

  it("truncates session ID to 8 chars in top sessions", () => {
    const report = generateTokenReport([
      makeSummary({ sessionId: "abcdefghijklmnop", totalCost: 0.10 }),
    ])

    expect(report).toContain("`abcdefgh`")
    expect(report).not.toContain("abcdefghijklmnop")
  })

  it("shows session count per agent", () => {
    const report = generateTokenReport([
      makeSummary({ agentName: "Loom", totalCost: 0.10 }),
      makeSummary({ agentName: "Loom", totalCost: 0.20 }),
    ])

    expect(report).toContain("2 sessions")
  })
})
