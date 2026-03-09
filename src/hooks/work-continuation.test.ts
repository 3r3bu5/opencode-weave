import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { checkContinuation, CONTINUATION_MARKER, MAX_STALE_CONTINUATIONS } from "./work-continuation"
import { writeWorkState, createWorkState, readWorkState } from "../features/work-state/storage"
import { PLANS_DIR } from "../features/work-state/constants"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "weave-cont-test-"))
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

function createPlanFile(name: string, content: string): string {
  const plansDir = join(testDir, PLANS_DIR)
  mkdirSync(plansDir, { recursive: true })
  const filePath = join(plansDir, `${name}.md`)
  writeFileSync(filePath, content, "utf-8")
  return filePath
}

describe("checkContinuation", () => {
  it("returns null when no work state exists", () => {
    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns null when plan is complete", () => {
    const planPath = createPlanFile("done", "# Done\n- [x] Task 1\n- [x] Task 2\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns null when plan file is missing", () => {
    // State references a non-existent plan file
    writeWorkState(testDir, createWorkState("/nonexistent/plan.md", "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns continuation prompt for incomplete plan", () => {
    const planPath = createPlanFile("my-plan", "# Plan\n- [x] Done 1\n- [ ] Todo 2\n- [ ] Todo 3\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
    expect(result.continuationPrompt).toContain("my-plan")
    expect(result.continuationPrompt).toContain("1/3 tasks completed")
    expect(result.continuationPrompt).toContain("2 remaining")
    expect(result.continuationPrompt).toContain("todowrite")
    expect(result.continuationPrompt).toContain("sidebar")
    expect(result.continuationPrompt).toContain(CONTINUATION_MARKER)
  })

  it("includes plan file path in continuation prompt", () => {
    const planPath = createPlanFile("feature", "# Feature\n- [ ] Task\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toContain(planPath)
  })

  it("returns null when work state has paused: true", () => {
    const planPath = createPlanFile("paused-plan", "# Plan\n- [x] Done 1\n- [ ] Todo 2\n")
    const state = createWorkState(planPath, "sess_1")
    writeWorkState(testDir, { ...state, paused: true })

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns continuation prompt when paused is false", () => {
    const planPath = createPlanFile("active-plan", "# Plan\n- [x] Done 1\n- [ ] Todo 2\n")
    const state = createWorkState(planPath, "sess_1")
    writeWorkState(testDir, { ...state, paused: false })

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
  })

  it("returns continuation prompt when paused is absent (backward compat)", () => {
    const planPath = createPlanFile("legacy-plan", "# Plan\n- [ ] Todo 1\n")
    // Simulate a state.json written before the paused field existed
    const state = createWorkState(planPath, "sess_1")
    const legacyState = { ...state }
    // Ensure paused is undefined (absent from JSON)
    writeWorkState(testDir, legacyState)
    // Verify paused is not in the raw JSON
    const written = readWorkState(testDir)
    expect(written!.paused).toBeUndefined()

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
  })
})

describe("checkContinuation — session scoping", () => {
  it("returns null when session is not in state.session_ids", () => {
    const planPath = createPlanFile("scoped-plan", "# Plan\n- [ ] Todo 1\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_other", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns continuation when session IS in state.session_ids", () => {
    const planPath = createPlanFile("scoped-plan-2", "# Plan\n- [ ] Todo 1\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
  })

  it("returns continuation when session_ids is empty (legacy compat)", () => {
    const planPath = createPlanFile("legacy-sessions", "# Plan\n- [ ] Todo 1\n")
    const state = createWorkState(planPath, "sess_1")
    state.session_ids = []
    writeWorkState(testDir, state)

    const result = checkContinuation({ sessionId: "any_session", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
  })
})

describe("checkContinuation — stale progress detection", () => {
  it("initializes snapshot on first call", () => {
    const planPath = createPlanFile("stale-init", "# Plan\n- [x] Done\n- [ ] Todo\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()

    const state = readWorkState(testDir)!
    expect(state.continuation_completed_snapshot).toBe(1)
    expect(state.stale_continuation_count).toBe(0)
  })

  it("resets stale counter when progress is made", () => {
    const planPath = createPlanFile("stale-reset", "# Plan\n- [x] Done 1\n- [x] Done 2\n- [ ] Todo\n")
    const state = createWorkState(planPath, "sess_1")
    state.continuation_completed_snapshot = 1
    state.stale_continuation_count = 2
    writeWorkState(testDir, state)

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()

    const updated = readWorkState(testDir)!
    expect(updated.continuation_completed_snapshot).toBe(2)
    expect(updated.stale_continuation_count).toBe(0)
  })

  it("increments stale counter when no progress", () => {
    const planPath = createPlanFile("stale-inc", "# Plan\n- [x] Done\n- [ ] Todo\n")
    const state = createWorkState(planPath, "sess_1")
    state.continuation_completed_snapshot = 1
    state.stale_continuation_count = 0
    writeWorkState(testDir, state)

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()

    const updated = readWorkState(testDir)!
    expect(updated.stale_continuation_count).toBe(1)
  })

  it("auto-pauses after MAX_STALE_CONTINUATIONS with no progress", () => {
    const planPath = createPlanFile("stale-pause", "# Plan\n- [x] Done\n- [ ] Todo\n")
    const state = createWorkState(planPath, "sess_1")
    state.continuation_completed_snapshot = 1
    state.stale_continuation_count = MAX_STALE_CONTINUATIONS - 1
    writeWorkState(testDir, state)

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()

    const updated = readWorkState(testDir)!
    expect(updated.paused).toBe(true)
    expect(updated.stale_continuation_count).toBe(MAX_STALE_CONTINUATIONS)
  })

  it("returns null after auto-pause on subsequent calls", () => {
    const planPath = createPlanFile("stale-after", "# Plan\n- [x] Done\n- [ ] Todo\n")
    const state = createWorkState(planPath, "sess_1")
    state.continuation_completed_snapshot = 1
    state.stale_continuation_count = MAX_STALE_CONTINUATIONS - 1
    writeWorkState(testDir, state)

    // This call triggers auto-pause
    checkContinuation({ sessionId: "sess_1", directory: testDir })

    // Subsequent call should also return null (paused)
    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("resets stale counter after progress even if previously stale", () => {
    const planPath = createPlanFile("stale-recover", "# Plan\n- [x] Done 1\n- [x] Done 2\n- [ ] Todo\n")
    const state = createWorkState(planPath, "sess_1")
    // Was stale for 2 rounds (one more would auto-pause)
    state.continuation_completed_snapshot = 1
    state.stale_continuation_count = 2
    writeWorkState(testDir, state)

    // Progress was made (completed=2 > snapshot=1)
    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()

    const updated = readWorkState(testDir)!
    expect(updated.continuation_completed_snapshot).toBe(2)
    expect(updated.stale_continuation_count).toBe(0)
  })
})

describe("checkContinuation — backward compatibility with old state files", () => {
  it("works with state.json missing stale-tracking fields", () => {
    const planPath = createPlanFile("old-state", "# Plan\n- [x] Done\n- [ ] Todo\n")
    // Simulate an old state.json without the new fields
    const state = createWorkState(planPath, "sess_1")
    // Explicitly ensure the new fields are absent
    delete (state as unknown as Record<string, unknown>).continuation_completed_snapshot
    delete (state as unknown as Record<string, unknown>).stale_continuation_count
    writeWorkState(testDir, state)

    const written = readWorkState(testDir)!
    expect(written.continuation_completed_snapshot).toBeUndefined()
    expect(written.stale_continuation_count).toBeUndefined()

    // Should treat as first call — initialize and return prompt
    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()

    const updated = readWorkState(testDir)!
    expect(updated.continuation_completed_snapshot).toBe(1)
    expect(updated.stale_continuation_count).toBe(0)
  })
})
