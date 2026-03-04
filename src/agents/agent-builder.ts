import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentSource } from "./types"
import type { CategoriesConfig } from "../config/schema"
import { isFactory } from "./types"

export type ResolveSkillsFn = (skillNames: string[], disabledSkills?: Set<string>) => string

export type BuildAgentOptions = {
  categories?: CategoriesConfig
  disabledSkills?: Set<string>
  resolveSkills?: ResolveSkillsFn
  disabledAgents?: Set<string>
}

type AgentConfigExtended = AgentConfig & {
  category?: string
  skills?: string[]
  variant?: string
}

/**
 * Map from agent config key (lowercase) to display name variants that
 * might appear in prompt text. Used by stripDisabledAgentReferences to
 * remove lines that mention disabled agents.
 */
const AGENT_NAME_VARIANTS: Record<string, string[]> = {
  thread: ["thread", "Thread"],
  spindle: ["spindle", "Spindle"],
  weft: ["weft", "Weft"],
  warp: ["warp", "Warp"],
  pattern: ["pattern", "Pattern"],
  shuttle: ["shuttle", "Shuttle"],
  loom: ["loom", "Loom"],
  tapestry: ["tapestry", "Tapestry"],
}

/**
 * Remove lines from a prompt that reference disabled agents.
 * Only strips lines where an agent name appears as a standalone concept
 * (e.g. "Use thread (codebase explorer)"), not incidental word matches.
 * Uses word-boundary matching to avoid false positives.
 */
export function stripDisabledAgentReferences(prompt: string, disabled: Set<string>): string {
  if (disabled.size === 0) return prompt

  // Build a set of all name variants to look for
  const disabledVariants: string[] = []
  for (const name of disabled) {
    const variants = AGENT_NAME_VARIANTS[name]
    if (variants) {
      disabledVariants.push(...variants)
    }
  }
  if (disabledVariants.length === 0) return prompt

  // Build a regex that matches any line containing a disabled agent name
  // with word boundaries to avoid matching substrings (e.g. "pattern" in "patterns")
  const pattern = new RegExp(
    `\\b(${disabledVariants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  )

  const lines = prompt.split("\n")
  const filtered = lines.filter((line) => !pattern.test(line))
  return filtered.join("\n")
}

export function buildAgent(source: AgentSource, model: string, options?: BuildAgentOptions): AgentConfig {
  const base: AgentConfigExtended = isFactory(source) ? source(model) : { ...source }

  if (base.category && options?.categories) {
    const categoryConfig = options.categories[base.category]
    if (categoryConfig) {
      if (!base.model) {
        base.model = categoryConfig.model
      }
      if (base.temperature === undefined && categoryConfig.temperature !== undefined) {
        base.temperature = categoryConfig.temperature
      }
      if (base.variant === undefined && categoryConfig.variant !== undefined) {
        base.variant = categoryConfig.variant
      }
    }
  }

  if (base.skills?.length && options?.resolveSkills) {
    const skillContent = options.resolveSkills(base.skills, options.disabledSkills)
    if (skillContent) {
      base.prompt = skillContent + (base.prompt ? "\n\n" + base.prompt : "")
    }
  }

  // Strip references to disabled agents from the prompt
  if (options?.disabledAgents && options.disabledAgents.size > 0 && base.prompt) {
    base.prompt = stripDisabledAgentReferences(base.prompt, options.disabledAgents)
  }

  return base
}
