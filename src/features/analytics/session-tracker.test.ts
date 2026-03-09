import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { SessionTracker, createSessionTracker } from "./session-tracker"
import { readSessionSummaries } from "./storage"

let tempDir: string
let tracker: SessionTracker

beforeEach(() => {
  tempDir = join(tmpdir(), `weave-tracker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
  tracker = createSessionTracker(tempDir)
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

describe("SessionTracker", () => {
  describe("startSession", () => {
    it("creates a new tracked session", () => {
      const session = tracker.startSession("s1")
      expect(session.sessionId).toBe("s1")
      expect(session.startedAt).toBeTruthy()
      expect(session.toolCounts).toEqual({})
      expect(session.delegations).toEqual([])
      expect(session.inFlight).toEqual({})
    })

    it("is idempotent — returns same session on second call", () => {
      const first = tracker.startSession("s1")
      const second = tracker.startSession("s1")
      expect(first).toBe(second)
      expect(first.startedAt).toBe(second.startedAt)
    })
  })

  describe("trackToolStart", () => {
    it("increments tool count", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolStart("s1", "read", "c2")
      tracker.trackToolStart("s1", "write", "c3")

      const session = tracker.getSession("s1")!
      expect(session.toolCounts.read).toBe(2)
      expect(session.toolCounts.write).toBe(1)
    })

    it("tracks in-flight calls", () => {
      tracker.trackToolStart("s1", "task", "c1", "thread")

      const session = tracker.getSession("s1")!
      expect(session.inFlight.c1).toBeDefined()
      expect(session.inFlight.c1.tool).toBe("task")
      expect(session.inFlight.c1.agent).toBe("thread")
    })

    it("lazily starts the session", () => {
      expect(tracker.isTracking("s1")).toBe(false)
      tracker.trackToolStart("s1", "read", "c1")
      expect(tracker.isTracking("s1")).toBe(true)
    })
  })

  describe("trackToolEnd", () => {
    it("removes in-flight tracking", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolEnd("s1", "read", "c1")

      const session = tracker.getSession("s1")!
      expect(session.inFlight.c1).toBeUndefined()
    })

    it("records delegation for task tool calls", () => {
      tracker.trackToolStart("s1", "task", "c1", "thread")
      tracker.trackToolEnd("s1", "task", "c1", "thread")

      const session = tracker.getSession("s1")!
      expect(session.delegations.length).toBe(1)
      expect(session.delegations[0].agent).toBe("thread")
      expect(session.delegations[0].toolCallId).toBe("c1")
      expect(session.delegations[0].durationMs).toBeDefined()
      expect(session.delegations[0].durationMs!).toBeGreaterThanOrEqual(0)
    })

    it("does not record delegation for non-task tools", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolEnd("s1", "read", "c1")

      const session = tracker.getSession("s1")!
      expect(session.delegations.length).toBe(0)
    })

    it("is safe to call for untracked sessions", () => {
      // Should not throw
      tracker.trackToolEnd("nonexistent", "read", "c1")
    })

    it("falls back to agent from inFlight if not provided on end", () => {
      tracker.trackToolStart("s1", "task", "c1", "weft")
      tracker.trackToolEnd("s1", "task", "c1")

      const session = tracker.getSession("s1")!
      expect(session.delegations[0].agent).toBe("weft")
    })
  })

  describe("endSession", () => {
    it("produces a session summary", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolEnd("s1", "read", "c1")
      tracker.trackToolStart("s1", "write", "c2")
      tracker.trackToolEnd("s1", "write", "c2")
      tracker.trackToolStart("s1", "task", "c3", "thread")
      tracker.trackToolEnd("s1", "task", "c3", "thread")

      const summary = tracker.endSession("s1")
      expect(summary).not.toBeNull()
      expect(summary!.sessionId).toBe("s1")
      expect(summary!.totalToolCalls).toBe(3)
      expect(summary!.totalDelegations).toBe(1)
      expect(summary!.toolUsage.length).toBe(3)
      expect(summary!.durationMs).toBeGreaterThanOrEqual(0)
    })

    it("persists summary to JSONL", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolEnd("s1", "read", "c1")
      tracker.endSession("s1")

      const summaries = readSessionSummaries(tempDir)
      expect(summaries.length).toBe(1)
      expect(summaries[0].sessionId).toBe("s1")
    })

    it("removes session from tracking", () => {
      tracker.startSession("s1")
      expect(tracker.isTracking("s1")).toBe(true)
      tracker.endSession("s1")
      expect(tracker.isTracking("s1")).toBe(false)
    })

    it("returns null for untracked sessions", () => {
      const summary = tracker.endSession("nonexistent")
      expect(summary).toBeNull()
    })
  })

  describe("activeSessionCount", () => {
    it("tracks number of active sessions", () => {
      expect(tracker.activeSessionCount).toBe(0)
      tracker.startSession("s1")
      expect(tracker.activeSessionCount).toBe(1)
      tracker.startSession("s2")
      expect(tracker.activeSessionCount).toBe(2)
      tracker.endSession("s1")
      expect(tracker.activeSessionCount).toBe(1)
    })
  })

  describe("setAgentName", () => {
    it("stores agent name on session", () => {
      tracker.startSession("s1")
      tracker.setAgentName("s1", "Loom (Main Orchestrator)")
      const session = tracker.getSession("s1")!
      expect(session.agentName).toBe("Loom (Main Orchestrator)")
    })

    it("is idempotent — first call wins", () => {
      tracker.startSession("s1")
      tracker.setAgentName("s1", "Loom")
      tracker.setAgentName("s1", "Tapestry")
      const session = tracker.getSession("s1")!
      expect(session.agentName).toBe("Loom")
    })

    it("is safe to call for untracked sessions", () => {
      // Should not throw
      tracker.setAgentName("nonexistent", "Loom")
    })
  })

  describe("trackCost", () => {
    it("accumulates cost across multiple calls", () => {
      tracker.startSession("s1")
      tracker.trackCost("s1", 0.05)
      tracker.trackCost("s1", 0.03)
      tracker.trackCost("s1", 0.02)
      const session = tracker.getSession("s1")!
      expect(session.totalCost).toBeCloseTo(0.10, 10)
    })

    it("is safe to call for untracked sessions", () => {
      tracker.trackCost("nonexistent", 0.05)
    })
  })

  describe("trackTokenUsage", () => {
    it("accumulates all token fields and increments totalMessages", () => {
      tracker.startSession("s1")
      tracker.trackTokenUsage("s1", { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } })
      tracker.trackTokenUsage("s1", { input: 200, output: 100, reasoning: 20, cache: { read: 40, write: 10 } })

      const session = tracker.getSession("s1")!
      expect(session.tokenUsage.inputTokens).toBe(300)
      expect(session.tokenUsage.outputTokens).toBe(150)
      expect(session.tokenUsage.reasoningTokens).toBe(30)
      expect(session.tokenUsage.cacheReadTokens).toBe(60)
      expect(session.tokenUsage.cacheWriteTokens).toBe(15)
      expect(session.tokenUsage.totalMessages).toBe(2)
    })

    it("is safe to call for untracked sessions", () => {
      tracker.trackTokenUsage("nonexistent", { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } })
    })
  })

  describe("endSession with new fields", () => {
    it("includes agentName, totalCost, and tokenUsage in summary", () => {
      tracker.startSession("s1")
      tracker.setAgentName("s1", "Loom")
      tracker.trackCost("s1", 0.05)
      tracker.trackTokenUsage("s1", { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } })

      const summary = tracker.endSession("s1")!
      expect(summary.agentName).toBe("Loom")
      expect(summary.totalCost).toBeCloseTo(0.05, 10)
      expect(summary.tokenUsage).toBeDefined()
      expect(summary.tokenUsage!.inputTokens).toBe(100)
      expect(summary.tokenUsage!.outputTokens).toBe(50)
      expect(summary.tokenUsage!.totalMessages).toBe(1)
    })

    it("omits agentName when not set (undefined)", () => {
      tracker.startSession("s1")
      const summary = tracker.endSession("s1")!
      expect(summary.agentName).toBeUndefined()
    })

    it("omits totalCost when no cost tracked", () => {
      tracker.startSession("s1")
      const summary = tracker.endSession("s1")!
      expect(summary.totalCost).toBeUndefined()
    })

    it("omits tokenUsage when no messages tracked", () => {
      tracker.startSession("s1")
      const summary = tracker.endSession("s1")!
      expect(summary.tokenUsage).toBeUndefined()
    })

    it("includes totalCost when cost was tracked", () => {
      tracker.startSession("s1")
      tracker.trackCost("s1", 0.05)
      const summary = tracker.endSession("s1")!
      expect(summary.totalCost).toBe(0.05)
    })

    it("includes tokenUsage when messages were tracked", () => {
      tracker.startSession("s1")
      tracker.trackTokenUsage("s1", { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } })
      const summary = tracker.endSession("s1")!
      expect(summary.tokenUsage).toBeDefined()
      expect(summary.tokenUsage!.totalMessages).toBe(1)
    })

    it("trackCost ignores NaN and negative values", () => {
      tracker.startSession("s1")
      tracker.trackCost("s1", NaN)
      tracker.trackCost("s1", -5)
      tracker.trackCost("s1", 0.10)
      const summary = tracker.endSession("s1")!
      expect(summary.totalCost).toBe(0.10)
    })

    it("trackTokenUsage ignores NaN and negative token values", () => {
      tracker.startSession("s1")
      tracker.trackTokenUsage("s1", { input: NaN, output: -1, reasoning: 100, cache: { read: NaN, write: 50 } })
      const summary = tracker.endSession("s1")!
      expect(summary.tokenUsage!.inputTokens).toBe(0)
      expect(summary.tokenUsage!.outputTokens).toBe(0)
      expect(summary.tokenUsage!.reasoningTokens).toBe(100)
      expect(summary.tokenUsage!.cacheReadTokens).toBe(0)
      expect(summary.tokenUsage!.cacheWriteTokens).toBe(50)
    })
  })
})

describe("createSessionTracker", () => {
  it("creates a SessionTracker instance", () => {
    const t = createSessionTracker(tempDir)
    expect(t).toBeInstanceOf(SessionTracker)
  })
})
