import { describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { EvalConfigError, loadEvalCaseFile, loadEvalSuiteManifest } from "./loader"

describe("eval loader", () => {
  it("loads a valid suite manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "weave-evals-loader-"))
    try {
      const suitesDir = join(dir, "evals", "suites")
      mkdirSync(suitesDir, { recursive: true })
      writeFileSync(
        join(suitesDir, "phase1-core.jsonc"),
        '{ "id": "phase1-core", "title": "Phase 1", "phase": "phase1", "caseFiles": ["evals/cases/a.jsonc"] }',
      )
      const suite = loadEvalSuiteManifest(dir, "phase1-core")
      expect(suite.id).toBe("phase1-core")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("surfaces allowed values for unknown kinds", () => {
    const dir = mkdtempSync(join(tmpdir(), "weave-evals-loader-"))
    try {
      const casesDir = join(dir, "evals", "cases")
      mkdirSync(casesDir, { recursive: true })
      const casePath = join(casesDir, "bad.jsonc")
      writeFileSync(
        casePath,
        '{ "id": "bad", "title": "Bad", "phase": "phase1", "target": { "kind": "wrong", "agent": "loom" }, "executor": { "kind": "prompt-render" }, "evaluators": [{ "kind": "contains-all", "patterns": ["x"] }] }',
      )
      expect(() => loadEvalCaseFile(dir, casePath)).toThrow(EvalConfigError)
      try {
        loadEvalCaseFile(dir, casePath)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).toContain("Allowed target.kind values")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
