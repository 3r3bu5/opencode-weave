import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { ensureEvalStorageDir, writeEvalRunResult } from "./storage"
import fixture from "./__fixtures__/phase1-run-result.json"
import type { EvalRunResult } from "./types"

describe("eval storage", () => {
  it("creates storage directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "weave-evals-storage-"))
    try {
      const path = ensureEvalStorageDir(dir)
      expect(existsSync(path)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("writes run result and latest pointer copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "weave-evals-storage-"))
    try {
      const outputPath = writeEvalRunResult(dir, fixture as EvalRunResult)
      expect(existsSync(outputPath)).toBe(true)
      expect(existsSync(join(dir, ".weave", "evals", "latest.json"))).toBe(true)
      const saved = JSON.parse(readFileSync(outputPath, "utf-8"))
      expect(Object.keys(saved)).toEqual(Object.keys(fixture))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
