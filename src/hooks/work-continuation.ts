/**
 * Work continuation hook: checks if there's an active plan with remaining tasks
 * and returns a continuation prompt to keep the executor going.
 */

import { readWorkState, writeWorkState, getPlanProgress } from "../features/work-state"

/**
 * Marker embedded in continuation prompts so that `chat.message` can distinguish
 * continuation-injected messages from user-initiated messages.
 * When a user message arrives WITHOUT this marker (and is not a /start-work command),
 * the plugin auto-pauses work to prevent the infinite continuation loop.
 */
export const CONTINUATION_MARKER = "<!-- weave:continuation -->"

/** Maximum consecutive continuations without progress before auto-pausing */
export const MAX_STALE_CONTINUATIONS = 3

export interface ContinuationInput {
  sessionId: string
  directory: string
}

export interface ContinuationResult {
  /** Continuation prompt to inject, or null if no active work / plan complete */
  continuationPrompt: string | null
}

/**
 * Check if there's active work that should continue.
 * Returns a continuation prompt if the plan has remaining tasks, null otherwise.
 */
export function checkContinuation(input: ContinuationInput): ContinuationResult {
  const { directory } = input

  const state = readWorkState(directory)
  if (!state) {
    return { continuationPrompt: null }
  }

  if (state.paused) {
    return { continuationPrompt: null }
  }

  // Session scoping: only fire continuations for sessions that are working on this plan.
  // Empty session_ids (legacy states) are allowed through gracefully.
  if (state.session_ids.length > 0 && !state.session_ids.includes(input.sessionId)) {
    return { continuationPrompt: null }
  }

  const progress = getPlanProgress(state.active_plan)
  if (progress.isComplete) {
    return { continuationPrompt: null }
  }

  // Stale progress detection: compare current progress to the last-seen snapshot.
  // If progress hasn't changed after MAX_STALE_CONTINUATIONS consecutive calls, auto-pause.
  if (state.continuation_completed_snapshot === undefined) {
    // First continuation call — initialize tracking fields
    state.continuation_completed_snapshot = progress.completed
    state.stale_continuation_count = 0
    writeWorkState(directory, state)
  } else if (progress.completed > state.continuation_completed_snapshot) {
    // Progress was made — reset stale counter
    state.continuation_completed_snapshot = progress.completed
    state.stale_continuation_count = 0
    writeWorkState(directory, state)
  } else {
    // No progress — increment stale counter
    state.stale_continuation_count = (state.stale_continuation_count ?? 0) + 1
    if (state.stale_continuation_count >= MAX_STALE_CONTINUATIONS) {
      // Auto-pause: inline write to preserve stale-tracking fields
      state.paused = true
      writeWorkState(directory, state)
      return { continuationPrompt: null }
    }
    writeWorkState(directory, state)
  }

  const remaining = progress.total - progress.completed
  return {
    continuationPrompt: `${CONTINUATION_MARKER}
You have an active work plan with incomplete tasks. Continue working.

**Plan**: ${state.plan_name}
**File**: ${state.active_plan}
**Progress**: ${progress.completed}/${progress.total} tasks completed (${remaining} remaining)

1. Read the plan file NOW to check exact current progress
2. Use todowrite to restore sidebar: summary todo "${state.plan_name} ${progress.completed}/${progress.total}" (in_progress) + next task (in_progress) + 2-3 upcoming (pending). Max 35 chars each.
3. Find the first unchecked \`- [ ]\` task
4. Execute it, verify it, mark \`- [ ]\` → \`- [x]\`
5. Update sidebar todos as you complete tasks
6. Do not stop until all tasks are complete`,
  }
}
