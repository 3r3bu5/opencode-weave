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
})

describe("createSessionTracker", () => {
  it("creates a SessionTracker instance", () => {
    const t = createSessionTracker(tempDir)
    expect(t).toBeInstanceOf(SessionTracker)
  })
})
