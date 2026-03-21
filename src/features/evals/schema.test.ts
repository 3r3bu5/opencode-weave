import { describe, expect, it } from "bun:test"
import { EvalCaseSchema, EvalSuiteManifestSchema } from "./schema"

describe("eval schemas", () => {
  it("validates a phase1 prompt-render case", () => {
    const result = EvalCaseSchema.safeParse({
      id: "loom-default-contract",
      title: "Loom default",
      phase: "phase1",
      target: { kind: "builtin-agent-prompt", agent: "loom" },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["<Role>"] }],
    })
    expect(result.success).toBe(true)
  })

  it("rejects unknown kind values", () => {
    const result = EvalCaseSchema.safeParse({
      id: "bad",
      title: "Bad",
      phase: "phase1",
      target: { kind: "not-real", agent: "loom" },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["x"] }],
    })
    expect(result.success).toBe(false)
  })

  it("validates suite manifests", () => {
    const result = EvalSuiteManifestSchema.safeParse({
      id: "phase1-core",
      title: "Phase 1",
      phase: "phase1",
      caseFiles: ["evals/cases/loom/default-contract.jsonc"],
    })
    expect(result.success).toBe(true)
  })
})
