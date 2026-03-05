import type { PluginInput } from "@opencode-ai/plugin"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "./config/schema"
import type { ResolveSkillsFn } from "./agents/agent-builder"
import type { ProjectFingerprint } from "./features/analytics/types"
import type { AvailableAgent } from "./agents/dynamic-prompt-builder"
import { ConfigHandler } from "./managers/config-handler"
import { BackgroundManager } from "./managers/background-manager"
import { SkillMcpManager } from "./managers/skill-mcp-manager"
import { createBuiltinAgents, registerCustomAgentMetadata } from "./agents/builtin-agents"
import { buildCustomAgent, buildCustomAgentMetadata } from "./agents/custom-agent-factory"

export interface WeaveManagers {
  configHandler: ConfigHandler
  backgroundManager: BackgroundManager
  skillMcpManager: SkillMcpManager
  agents: Record<string, AgentConfig>
}

export function createManagers(options: {
  ctx: PluginInput
  pluginConfig: WeaveConfig
  resolveSkills?: ResolveSkillsFn
  fingerprint?: ProjectFingerprint | null
  configDir?: string
}): WeaveManagers {
  const { pluginConfig, resolveSkills, fingerprint, configDir } = options

  // Step 1: Build custom agent metadata FIRST so Loom's prompt can include triggers
  const customAgentMetadata: AvailableAgent[] = []
  if (pluginConfig.custom_agents) {
    const disabledSet = new Set(pluginConfig.disabled_agents ?? [])
    for (const [name, customConfig] of Object.entries(pluginConfig.custom_agents)) {
      if (disabledSet.has(name)) continue
      const metadata = buildCustomAgentMetadata(name, customConfig)
      customAgentMetadata.push({
        name,
        description: customConfig.description ?? customConfig.display_name ?? name,
        metadata,
      })
    }
  }

  // Step 2: Build builtins WITH custom agent metadata for Loom's prompt
  const agents = createBuiltinAgents({
    disabledAgents: pluginConfig.disabled_agents,
    agentOverrides: pluginConfig.agents,
    resolveSkills,
    fingerprint,
    customAgentMetadata,
  })

  // Step 3: Build custom agent configs and register metadata
  if (pluginConfig.custom_agents) {
    const disabledSet = new Set(pluginConfig.disabled_agents ?? [])
    for (const [name, customConfig] of Object.entries(pluginConfig.custom_agents)) {
      // Skip disabled custom agents
      if (disabledSet.has(name)) continue
      // Prevent custom agents from overriding built-in agents
      if (agents[name] !== undefined) continue

      agents[name] = buildCustomAgent(name, customConfig, {
        resolveSkills,
        disabledSkills: pluginConfig.disabled_skills ? new Set(pluginConfig.disabled_skills) : undefined,
        configDir,
      })

      // Register metadata for Loom's dynamic prompt integration
      const metadata = buildCustomAgentMetadata(name, customConfig)
      registerCustomAgentMetadata(name, metadata)
    }
  }

  const configHandler = new ConfigHandler({ pluginConfig })
  const backgroundManager = new BackgroundManager({
    maxConcurrent: pluginConfig.background?.defaultConcurrency ?? 5,
  })
  const skillMcpManager = new SkillMcpManager()

  return { configHandler, backgroundManager, skillMcpManager, agents }
}
