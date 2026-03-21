import { randomBytes } from "node:crypto"
import { loadEvalCasesForSuite, loadEvalSuiteManifest } from "./loader"
import { executePromptRender } from "./executors/prompt-renderer"
import { runDeterministicEvaluator } from "./evaluators/deterministic"
import { formatEvalSummary } from "./reporter"
import { ensureEvalStorageDir, writeEvalRunResult } from "./storage"
import { resolveBuiltinAgentTarget } from "./targets/builtin-agent-target"
import type {
  EvalArtifacts,
  EvalCaseResult,
  EvalRunResult,
  EvalRunSummary,
  ExecutionContext,
  LoadedEvalCase,
  RunEvalSuiteOptions,
} from "./types"

function createRunId(): string {
  return `eval_${randomBytes(6).toString("hex")}`
}

function matchesFilters(evalCase: LoadedEvalCase, filters: RunEvalSuiteOptions["filters"]): boolean {
  if (!filters) return true

  if (filters.caseIds && filters.caseIds.length > 0 && !filters.caseIds.includes(evalCase.id)) {
    return false
  }

  if (
    filters.agents &&
    filters.agents.length > 0 &&
    (evalCase.target.kind !== "builtin-agent-prompt" || !filters.agents.includes(evalCase.target.agent))
  ) {
    return false
  }

  if (filters.tags && filters.tags.length > 0) {
    const tags = new Set(evalCase.tags ?? [])
    if (!filters.tags.every((tag) => tags.has(tag))) {
      return false
    }
  }

  return true
}

function resolveTarget(evalCase: LoadedEvalCase) {
  switch (evalCase.target.kind) {
    case "builtin-agent-prompt":
      return resolveBuiltinAgentTarget(evalCase.target)
    case "custom-agent-prompt":
    case "single-turn-agent":
    case "trajectory-agent":
      throw new Error(`Target kind ${evalCase.target.kind} is reserved for a later phase and is not implemented yet`)
  }
}

function executeCase(evalCase: LoadedEvalCase, context: ExecutionContext): EvalCaseResult {
  const started = Date.now()

  try {
    const resolvedTarget = resolveTarget(evalCase)
    let artifacts: EvalArtifacts

    switch (evalCase.executor.kind) {
      case "prompt-render":
        artifacts = executePromptRender(resolvedTarget, evalCase.executor, context)
        break
      case "model-response":
      case "trajectory-run":
        throw new Error(`Executor ${evalCase.executor.kind} is not implemented in Phase 1`)
    }

    const assertionResults = evalCase.evaluators.flatMap((evaluator) => runDeterministicEvaluator(evaluator, artifacts))
    const rawScore = assertionResults.reduce((sum, result) => sum + result.score, 0)
    const maxScore = assertionResults.reduce((sum, result) => sum + result.maxScore, 0)
    const normalizedScore = maxScore > 0 ? rawScore / maxScore : 0

    return {
      caseId: evalCase.id,
      status: assertionResults.every((result) => result.passed) ? "passed" : "failed",
      score: rawScore,
      normalizedScore,
      maxScore,
      durationMs: Date.now() - started,
      artifacts,
      assertionResults,
      errors: [],
    }
  } catch (error) {
    return {
      caseId: evalCase.id,
      status: "error",
      score: 0,
      normalizedScore: 0,
      maxScore: 0,
      durationMs: Date.now() - started,
      artifacts: {},
      assertionResults: [],
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

function buildSummary(caseResults: EvalCaseResult[]): EvalRunSummary {
  const totalScore = caseResults.reduce((sum, result) => sum + result.score, 0)
  const maxScore = caseResults.reduce((sum, result) => sum + result.maxScore, 0)
  return {
    totalCases: caseResults.length,
    passedCases: caseResults.filter((result) => result.status === "passed").length,
    failedCases: caseResults.filter((result) => result.status === "failed").length,
    errorCases: caseResults.filter((result) => result.status === "error").length,
    totalScore,
    normalizedScore: maxScore > 0 ? totalScore / maxScore : 0,
    maxScore,
  }
}

export interface RunEvalSuiteOutput {
  result: EvalRunResult
  artifactPath: string
  consoleSummary: string
}

export function runEvalSuite(options: RunEvalSuiteOptions): RunEvalSuiteOutput {
  ensureEvalStorageDir(options.directory)

  const suite = loadEvalSuiteManifest(options.directory, options.suite)
  const selectedCases = loadEvalCasesForSuite(options.directory, suite).filter((evalCase) =>
    matchesFilters(evalCase, options.filters),
  )

  const context: ExecutionContext = {
    mode: options.mode ?? "local",
    directory: options.directory,
    outputPath: options.outputPath,
  }

  const runId = createRunId()
  const startedAt = new Date().toISOString()
  const caseResults = selectedCases.map((evalCase) => executeCase(evalCase, context))
  const finishedAt = new Date().toISOString()

  const result: EvalRunResult = {
    runId,
    startedAt,
    finishedAt,
    suiteId: suite.id,
    phase: suite.phase,
    summary: buildSummary(caseResults),
    caseResults,
  }

  const artifactPath = writeEvalRunResult(options.directory, result, options.outputPath)
  const consoleSummary = formatEvalSummary(result)

  return { result, artifactPath, consoleSummary }
}
