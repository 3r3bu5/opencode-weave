import { z } from 'zod';

/**
 * MCP server configuration for OpenCode
 * Based on OpenCode's MCP registration format
 */
export const McpServerConfigSchema = z.object({
  type: z.enum(['local', 'remote']).optional(),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * User-facing MCP configuration (simpler format)
 */
export const McpEnabledConfigSchema = z.object({
  websearch: z.boolean().optional(),
  context7: z.boolean().optional(),
  grep_app: z.boolean().optional(),
});

export type McpEnabledConfig = z.infer<typeof McpEnabledConfigSchema>;

/**
 * Full MCP config in Weave config file
 */
export const McpConfigSchema = z
  .object({
    enabled: McpEnabledConfigSchema.optional(),
    disabled_mcps: z.array(z.string()).optional(),
  })
  .optional();

export type McpConfig = z.infer<typeof McpConfigSchema>;

/**
 * Built-in MCP servers configuration
 * These are the MCPs that come with Weave-MCP
 */
export const BUILTIN_MCP_SERVERS: Record<string, McpServerConfig> = {
  websearch: {
    type: 'remote',
    url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
    oauth: false,
  },
  context7: {
    type: 'remote',
    url: 'https://mcp.context7.com/mcp',
    oauth: false,
  },
  grep_app: {
    type: 'remote',
    url: 'https://mcp.grep.app',
    oauth: false,
  },
};
