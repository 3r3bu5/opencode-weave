/**
 * Default MCP assignments for each agent type
 * Agents get these MCPs by default unless overridden in config
 */

export type AgentMcpDefault = string[];

export const AGENT_MCP_DEFAULTS: Record<string, AgentMcpDefault> = {
  // Primary agents (orchestrators) get all MCPs
  loom: ['websearch', 'context7', 'grep_app'],
  tapestry: ['websearch', 'context7', 'grep_app'],

  // Subagents get role-specific MCPs
  thread: ['grep_app'], // Explorer - needs code search
  spindle: ['context7', 'grep_app'], // Researcher - docs + code
  weft: ['websearch'], // Reviewer - needs web search
  warp: ['websearch', 'grep_app'], // Security - audit + code search
  shuttle: ['grep_app'], // Specialist - code search
  pattern: ['websearch', 'context7', 'grep_app'], // Planner - needs everything
};

/**
 * Get MCP defaults for an agent
 */
export function getAgentMcpDefaults(agentName: string): string[] {
  return AGENT_MCP_DEFAULTS[agentName] ?? [];
}
