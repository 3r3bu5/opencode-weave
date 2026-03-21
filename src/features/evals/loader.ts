import { existsSync, readFileSync } from "fs"
import { isAbsolute, join } from "path"
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import {
  EvalCaseSchema,
  EvalSuiteManifestSchema,
  formatSchemaIssues,
  AllowedEvalTargetKinds,
  AllowedExecutorKinds,
  AllowedEvaluatorKinds,
} from "./schema"
import type { LoadedEvalCase, LoadedEvalSuiteManifest } from "./types"

export class EvalConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EvalConfigError"
  }
}

function readJsoncFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    throw new EvalConfigError(`Eval config not found: ${filePath}`)
  }

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch (error) {
    throw new EvalConfigError(`Failed to read eval config ${filePath}: ${String(error)}`)
  }

  const parseErrors: { error: number; offset: number; length: number }[] = []
  const parsed = parseJsonc(raw, parseErrors, { allowTrailingComma: true, disallowComments: false })

  if (parseErrors.length > 0) {
    const detail = parseErrors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ")
    throw new EvalConfigError(`Invalid JSONC in ${filePath}: ${detail}`)
  }

  return parsed
}

function formatKindHint(raw: unknown): string {
  if (!raw || typeof raw !== "object") return ""
  const record = raw as Record<string, unknown>
  const hints: string[] = []

  if (record.target && typeof record.target === "object") {
    const target = record.target as Record<string, unknown>
    if (typeof target.kind === "string" && !AllowedEvalTargetKinds.includes(target.kind as never)) {
      hints.push(`Allowed target.kind values: ${AllowedEvalTargetKinds.join(", ")}`)
    }
  }

  if (record.executor && typeof record.executor === "object") {
    const executor = record.executor as Record<string, unknown>
    if (typeof executor.kind === "string" && !AllowedExecutorKinds.includes(executor.kind as never)) {
      hints.push(`Allowed executor.kind values: ${AllowedExecutorKinds.join(", ")}`)
    }
  }

  if (Array.isArray(record.evaluators)) {
    const invalid = record.evaluators
      .map((evaluator, index) => ({ evaluator, index }))
      .filter(({ evaluator }) => evaluator && typeof evaluator === "object")
      .filter(({ evaluator }) => {
        const kind = (evaluator as Record<string, unknown>).kind
        return typeof kind === "string" && !AllowedEvaluatorKinds.includes(kind as never)
      })

    if (invalid.length > 0) {
      hints.push(`Allowed evaluator.kind values: ${AllowedEvaluatorKinds.join(", ")}`)
    }
  }

  return hints.length > 0 ? `\n${hints.join("\n")}` : ""
}

function resolvePath(directory: string, value: string, fallbackDir?: string): string {
  if (isAbsolute(value)) return value
  if (value.startsWith("evals/")) return join(directory, value)
  if (fallbackDir) return join(fallbackDir, value)
  return join(directory, value)
}

export function resolveSuitePath(directory: string, suite: string): string {
  if (suite.endsWith(".json") || suite.endsWith(".jsonc")) {
    return resolvePath(directory, suite)
  }

  return join(directory, "evals", "suites", `${suite}.jsonc`)
}

export function loadEvalSuiteManifest(directory: string, suite: string): LoadedEvalSuiteManifest {
  const filePath = resolveSuitePath(directory, suite)
  const parsed = readJsoncFile(filePath)
  const result = EvalSuiteManifestSchema.safeParse(parsed)

  if (!result.success) {
    throw new EvalConfigError(`${formatSchemaIssues(filePath, result.error.issues)}${formatKindHint(parsed)}`)
  }

  return { ...result.data, filePath }
}

export function loadEvalCaseFile(directory: string, filePath: string): LoadedEvalCase {
  const parsed = readJsoncFile(filePath)
  const result = EvalCaseSchema.safeParse(parsed)

  if (!result.success) {
    throw new EvalConfigError(`${formatSchemaIssues(filePath, result.error.issues)}${formatKindHint(parsed)}`)
  }

  return { ...result.data, filePath }
}

export function loadEvalCasesForSuite(directory: string, suite: LoadedEvalSuiteManifest): LoadedEvalCase[] {
  const suiteDir = join(suite.filePath, "..")
  return suite.caseFiles.map((caseFile) => loadEvalCaseFile(directory, resolvePath(directory, caseFile, suiteDir)))
}
