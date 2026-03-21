import { describe, expect, it } from "bun:test"
import { resolveBuiltinAgentTarget } from "./builtin-agent-target"

describe("resolveBuiltinAgentTarget", () => {
  it("renders loom via composer", () => {
    const result = resolveBuiltinAgentTarget({ kind: "builtin-agent-prompt", agent: "loom" })
    expect(result.artifacts.agentMetadata?.sourceKind).toBe("composer")
    expect(result.artifacts.renderedPrompt).toContain("<PlanWorkflow>")
  })

  it("supports disabled-agent variants", () => {
    const result = resolveBuiltinAgentTarget({
      kind: "builtin-agent-prompt",
      agent: "loom",
      variant: { disabledAgents: ["warp"] },
    })
    expect(result.artifacts.renderedPrompt).not.toContain("MUST use Warp")
  })

  it("resolves default-agent prompts", () => {
    const result = resolveBuiltinAgentTarget({ kind: "builtin-agent-prompt", agent: "thread" })
    expect(result.artifacts.agentMetadata?.sourceKind).toBe("default")
    expect(result.artifacts.toolPolicy).toEqual({
      write: false,
      edit: false,
      task: false,
      call_weave_agent: false,
    })
  })
})
