import { spawn, type ChildProcess } from 'node:child_process'

export const COMMAND_TIMEOUT_MS = 120_000
const MAX_CAPTURE_CHARS = 1_000_000

export interface CommandResult {
  exitCode: number | null
  output: string
  timedOut: boolean
  truncated: boolean
}

/** A started shell command whose output is collected while it runs. */
export interface CommandProcess {
  readonly output: string
  readonly truncated: boolean
  /** Exit code once the command and its output streams close; `null` when killed by a signal. */
  readonly done: Promise<number | null>
  /** Kills the command together with its child processes. */
  kill(): void
}

export function shellCommand(
  command: string,
  platform: NodeJS.Platform = process.platform
): { file: string; args: string[] } {
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
      ]
    }
  }
  // GUI apps on macOS start with a minimal PATH; a login shell loads the user's one.
  const login = platform === 'darwin' ? ['-l'] : []
  return { file: process.env.SHELL || '/bin/sh', args: [...login, '-c', command] }
}

export function startCommand(command: string, cwd: string): CommandProcess {
  const { file, args } = shellCommand(command)
  const child = spawn(file, args, {
    cwd,
    // Its own process group, so the whole tree can be killed at once.
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let output = ''
  let truncated = false
  const collect = (chunk: string): void => {
    if (output.length < MAX_CAPTURE_CHARS) output += chunk
    else truncated = true
  }
  child.stdout?.setEncoding('utf8').on('data', collect)
  child.stderr?.setEncoding('utf8').on('data', collect)

  const done = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  // Callers that never await `done` must not trigger an unhandled rejection.
  done.catch(() => {})

  return {
    get output() {
      return output
    },
    get truncated() {
      return truncated
    },
    done,
    kill: () => killTree(child)
  }
}

/** Runs a shell command in `cwd`, killing it (with its children) on timeout or abort. */
export async function runCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs = COMMAND_TIMEOUT_MS
): Promise<CommandResult> {
  signal.throwIfAborted()
  const proc = startCommand(command, cwd)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)
  const onAbort = (): void => proc.kill()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const exitCode = await proc.done
    signal.throwIfAborted()
    return { exitCode, output: proc.output, timedOut, truncated: proc.truncated }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}
