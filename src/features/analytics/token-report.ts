import type { SessionSummary } from "./types"
import { readSessionSummaries } from "./storage"

/**
 * Generate a human-readable token usage and cost report from session summaries.
 *
 * Sections:
 * 1. Overall Totals — aggregate metrics across all sessions
 * 2. Per-Agent Breakdown — grouped by agentName, sorted by total cost
 * 3. Top 5 Costliest Sessions — most expensive individual sessions
 */
export function generateTokenReport(summaries: SessionSummary[]): string {
  if (summaries.length === 0) {
    return "No session data available."
  }

  const sections: string[] = []

  // ── Section 1: Overall Totals ──────────────────────────────────
  const totalSessions = summaries.length
  const totalMessages = summaries.reduce((sum, s) => sum + (s.tokenUsage?.totalMessages ?? 0), 0)
  const totalInput = summaries.reduce((sum, s) => sum + (s.tokenUsage?.inputTokens ?? 0), 0)
  const totalOutput = summaries.reduce((sum, s) => sum + (s.tokenUsage?.outputTokens ?? 0), 0)
  const totalReasoning = summaries.reduce((sum, s) => sum + (s.tokenUsage?.reasoningTokens ?? 0), 0)
  const totalCacheRead = summaries.reduce((sum, s) => sum + (s.tokenUsage?.cacheReadTokens ?? 0), 0)
  const totalCacheWrite = summaries.reduce((sum, s) => sum + (s.tokenUsage?.cacheWriteTokens ?? 0), 0)
  const totalCost = summaries.reduce((sum, s) => sum + (s.totalCost ?? 0), 0)

  sections.push(
    `## Overall Totals\n` +
    `- Sessions: ${fmt(totalSessions)}\n` +
    `- Messages: ${fmt(totalMessages)}\n` +
    `- Input tokens: ${fmt(totalInput)}\n` +
    `- Output tokens: ${fmt(totalOutput)}\n` +
    `- Reasoning tokens: ${fmt(totalReasoning)}\n` +
    `- Cache read tokens: ${fmt(totalCacheRead)}\n` +
    `- Cache write tokens: ${fmt(totalCacheWrite)}\n` +
    `- Total cost: ${fmtCost(totalCost)}`,
  )

  // ── Section 2: Per-Agent Breakdown ─────────────────────────────
  const agentGroups = new Map<string, SessionSummary[]>()
  for (const s of summaries) {
    const key = s.agentName ?? "(unknown)"
    const group = agentGroups.get(key)
    if (group) {
      group.push(s)
    } else {
      agentGroups.set(key, [s])
    }
  }

  const agentStats = Array.from(agentGroups.entries())
    .map(([agent, sessions]) => {
      const agentCost = sessions.reduce((sum, s) => sum + (s.totalCost ?? 0), 0)
      const agentTokens = sessions.reduce(
        (sum, s) =>
          sum +
          (s.tokenUsage?.inputTokens ?? 0) +
          (s.tokenUsage?.outputTokens ?? 0) +
          (s.tokenUsage?.reasoningTokens ?? 0),
        0,
      )
      const avgTokens = sessions.length > 0 ? Math.round(agentTokens / sessions.length) : 0
      const avgCost = sessions.length > 0 ? agentCost / sessions.length : 0
      return { agent, sessions: sessions.length, avgTokens, avgCost, totalCost: agentCost }
    })
    .sort((a, b) => b.totalCost - a.totalCost)

  const agentLines = agentStats.map(
    (a) =>
      `- **${a.agent}**: ${fmt(a.sessions)} session${a.sessions === 1 ? "" : "s"}, ` +
      `avg ${fmt(a.avgTokens)} tokens/session, ` +
      `avg ${fmtCost(a.avgCost)}/session, ` +
      `total ${fmtCost(a.totalCost)}`,
  )
  sections.push(`## Per-Agent Breakdown\n${agentLines.join("\n")}`)

  // ── Section 3: Top 5 Costliest Sessions ────────────────────────
  const top5 = [...summaries]
    .sort((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0))
    .slice(0, 5)

  const top5Lines = top5.map((s) => {
    const id = s.sessionId.length > 8 ? s.sessionId.slice(0, 8) : s.sessionId
    const agent = s.agentName ?? "(unknown)"
    const cost = fmtCost(s.totalCost ?? 0)
    const tokens =
      (s.tokenUsage?.inputTokens ?? 0) +
      (s.tokenUsage?.outputTokens ?? 0) +
      (s.tokenUsage?.reasoningTokens ?? 0)
    const duration = fmtDuration(s.durationMs)
    return `- \`${id}\` ${agent} — ${cost}, ${fmt(tokens)} tokens, ${duration}`
  })
  sections.push(`## Top 5 Costliest Sessions\n${top5Lines.join("\n")}`)

  return sections.join("\n\n")
}

/**
 * Convenience function: read summaries from disk and generate the report.
 */
export function getTokenReport(directory: string): string {
  const summaries = readSessionSummaries(directory)
  return generateTokenReport(summaries)
}

// ── Formatting helpers ─────────────────────────────────────────

/** Format a number with locale-aware thousands separators */
function fmt(n: number): string {
  return n.toLocaleString("en-US")
}

/** Format a dollar cost as $X.XX */
function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`
}

/** Format milliseconds as Xm Ys */
function fmtDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}
