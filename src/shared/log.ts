import * as fs from "fs"
import * as path from "path"
import * as os from "os"

function getLogDir(): string {
  const home = os.homedir()
  return path.join(home, ".opencode", "logs")
}

function resolveLogFile(): string {
  const dir = getLogDir()
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  } catch {
    // Fall back to cwd if home dir is not writable
  }
  return path.join(dir, "weave-opencode.log")
}

const LOG_FILE = resolveLogFile()

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const entry = `[${timestamp}] ${message}${data !== undefined ? " " + JSON.stringify(data) : ""}\n`
    fs.appendFileSync(LOG_FILE, entry) // lgtm[js/http-to-file-access]
  } catch {
  }
}

export function getLogFilePath(): string {
  return LOG_FILE
}

export interface DelegationEvent {
  phase: "start" | "complete" | "error"
  agent: string
  sessionId?: string
  toolCallId?: string
  durationMs?: number
  summary?: string
}

export function logDelegation(event: DelegationEvent): void {
  const prefix = `[delegation:${event.phase}]`
  log(`${prefix} agent=${event.agent}`, {
    sessionId: event.sessionId,
    toolCallId: event.toolCallId,
    durationMs: event.durationMs,
    summary: event.summary,
  })
}
