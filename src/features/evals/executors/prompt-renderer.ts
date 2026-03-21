import type { EvalArtifacts, ExecutionContext, ExecutorSpec, ResolvedTarget } from "../types"

export function executePromptRender(
  resolvedTarget: ResolvedTarget,
  executor: ExecutorSpec,
  _context: ExecutionContext,
): EvalArtifacts {
  if (executor.kind !== "prompt-render") {
    throw new Error(`Executor ${executor.kind} is not implemented in Phase 1`)
  }

  return {
    ...resolvedTarget.artifacts,
    promptLength:
      resolvedTarget.artifacts.promptLength ?? resolvedTarget.artifacts.renderedPrompt?.length ?? 0,
  }
}
