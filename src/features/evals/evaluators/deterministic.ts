import type {
  AssertionResult,
  EvalArtifacts,
  EvaluatorSpec,
  ContainsAllEvaluator,
  ExcludesAllEvaluator,
  OrderedContainsEvaluator,
  XmlSectionsPresentEvaluator,
  ToolPolicyEvaluator,
} from "../types"

function getWeight(spec: EvaluatorSpec): number {
  return spec.weight ?? 1
}

function getPrompt(artifacts: EvalArtifacts): string {
  return artifacts.renderedPrompt ?? ""
}

function distributeWeight(totalWeight: number, count: number): number {
  return count > 0 ? totalWeight / count : totalWeight
}

function containsAll(prompt: string, spec: ContainsAllEvaluator): AssertionResult[] {
  const perItem = distributeWeight(getWeight(spec), spec.patterns.length)
  return spec.patterns.map((pattern) => {
    const passed = prompt.includes(pattern)
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed ? `Found required pattern: ${pattern}` : `Missing required pattern: ${pattern}`,
    }
  })
}

function containsAny(prompt: string, spec: Extract<EvaluatorSpec, { kind: "contains-any" }>): AssertionResult[] {
  const match = spec.patterns.find((pattern) => prompt.includes(pattern))
  const weight = getWeight(spec)
  return [
    {
      evaluatorKind: spec.kind,
      passed: match !== undefined,
      score: match ? weight : 0,
      maxScore: weight,
      message:
        match !== undefined
          ? `Found one allowed pattern: ${match}`
          : `Expected one of: ${spec.patterns.join(", ")}`,
    },
  ]
}

function excludesAll(prompt: string, spec: ExcludesAllEvaluator): AssertionResult[] {
  const perItem = distributeWeight(getWeight(spec), spec.patterns.length)
  return spec.patterns.map((pattern) => {
    const passed = !prompt.includes(pattern)
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed ? `Excluded forbidden pattern: ${pattern}` : `Forbidden pattern present: ${pattern}`,
    }
  })
}

function orderedContains(prompt: string, spec: OrderedContainsEvaluator): AssertionResult[] {
  const perItem = distributeWeight(getWeight(spec), spec.patterns.length)
  let lastIndex = -1
  return spec.patterns.map((pattern) => {
    const index = prompt.indexOf(pattern, lastIndex + 1)
    const passed = index >= 0
    if (passed) lastIndex = index
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Pattern appears in order: ${pattern}`
        : `Pattern missing or out of order: ${pattern}`,
    }
  })
}

function xmlSectionsPresent(prompt: string, spec: XmlSectionsPresentEvaluator): AssertionResult[] {
  const perItem = distributeWeight(getWeight(spec), spec.sections.length)
  return spec.sections.map((section) => {
    const hasOpen = prompt.includes(`<${section}>`)
    const hasClose = prompt.includes(`</${section}>`)
    const passed = hasOpen && hasClose
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `XML section present: ${section}`
        : `Missing XML section tags for: ${section}`,
    }
  })
}

function toolPolicy(artifacts: EvalArtifacts, spec: ToolPolicyEvaluator): AssertionResult[] {
  const keys = Object.keys(spec.expectations)
  const perItem = distributeWeight(getWeight(spec), keys.length)
  const actualPolicy = artifacts.toolPolicy ?? {}

  return keys.map((tool) => {
    const expected = spec.expectations[tool]
    const actual = actualPolicy[tool]
    const passed = actual === expected
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Tool policy matches for ${tool}: ${expected}`
        : `Tool policy mismatch for ${tool}: expected ${expected}, received ${String(actual)}`,
    }
  })
}

function minLength(prompt: string, spec: Extract<EvaluatorSpec, { kind: "min-length" }>): AssertionResult[] {
  const weight = getWeight(spec)
  const passed = prompt.length >= spec.min
  return [
    {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? weight : 0,
      maxScore: weight,
      message: passed
        ? `Prompt length ${prompt.length} meets minimum ${spec.min}`
        : `Prompt length ${prompt.length} below minimum ${spec.min}`,
    },
  ]
}

export function runDeterministicEvaluator(spec: EvaluatorSpec, artifacts: EvalArtifacts): AssertionResult[] {
  const prompt = getPrompt(artifacts)

  switch (spec.kind) {
    case "contains-all":
      return containsAll(prompt, spec)
    case "contains-any":
      return containsAny(prompt, spec)
    case "excludes-all":
      return excludesAll(prompt, spec)
    case "ordered-contains":
      return orderedContains(prompt, spec)
    case "xml-sections-present":
      return xmlSectionsPresent(prompt, spec)
    case "tool-policy":
      return toolPolicy(artifacts, spec)
    case "min-length":
      return minLength(prompt, spec)
    case "llm-judge":
    case "baseline-diff":
    case "trajectory-assertion":
      throw new Error(`Evaluator ${spec.kind} is reserved for a later phase and is not implemented yet`)
  }
}
