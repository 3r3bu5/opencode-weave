import type { McpConfig, McpServerConfig } from './types';
import { BUILTIN_MCP_SERVERS } from './types';

/**
 * Get enabled MCP servers based on config
 * @param mcpConfig - MCP configuration from Weave config
 * @returns Map of MCP name to server config
 */
export function getMcpServers(
  mcpConfig?: McpConfig,
): Map<string, McpServerConfig> {
  const result = new Map<string, McpServerConfig>();

  // If MCP is not configured at all, return empty
  if (!mcpConfig) {
    return result;
  }

  const enabled = mcpConfig.enabled;
  if (!enabled) {
    return result;
  }

  // Add enabled MCPs
  for (const [name, isEnabled] of Object.entries(enabled)) {
    if (isEnabled && BUILTIN_MCP_SERVERS[name]) {
      result.set(name, BUILTIN_MCP_SERVERS[name]);
    }
  }

  return result;
}

/**
 * Get list of available MCP names
 */
export function getAvailableMcps(): string[] {
  return Object.keys(BUILTIN_MCP_SERVERS);
}

export type { McpConfig, McpServerConfig } from './types';
export { BUILTIN_MCP_SERVERS } from './types';
