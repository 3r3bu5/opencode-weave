import { describe, expect, it } from "bun:test"
import { cpSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { runEvalSuite } from "./runner"

describe("runEvalSuite", () => {
  it("runs the committed phase1 suite from copied eval assets", () => {
    const dir = mkdtempSync(join(tmpdir(), "weave-evals-runner-"))
    try {
      cpSync(join(process.cwd(), "evals"), join(dir, "evals"), { recursive: true })
      const output = runEvalSuite({ directory: dir, suite: "phase1-core" })
      expect(output.result.suiteId).toBe("phase1-core")
      expect(output.result.summary.totalCases).toBeGreaterThan(0)
      expect(output.result.summary.normalizedScore).toBeGreaterThan(0)
      expect(output.result.summary.normalizedScore).toBeLessThanOrEqual(1)
      expect(output.result.caseResults.some((result) => result.status === "passed")).toBe(true)
      for (const result of output.result.caseResults) {
        expect(result.normalizedScore).toBeGreaterThanOrEqual(0)
        expect(result.normalizedScore).toBeLessThanOrEqual(1)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
