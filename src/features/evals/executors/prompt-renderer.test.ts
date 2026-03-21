import { describe, expect, it } from "bun:test"
import { executePromptRender } from "./prompt-renderer"

describe("executePromptRender", () => {
  it("passes through rendered prompt artifacts", () => {
    const artifacts = executePromptRender(
      {
        target: { kind: "builtin-agent-prompt", agent: "loom" },
        artifacts: { renderedPrompt: "<Role>test</Role>", toolPolicy: {} },
      },
      { kind: "prompt-render" },
      { mode: "local", directory: process.cwd() },
    )
    expect(artifacts.renderedPrompt).toBe("<Role>test</Role>")
    expect(artifacts.promptLength).toBe(17)
  })
})
