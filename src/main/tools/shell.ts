import { spawn, type ChildProcess } from 'node:child_process'

export const COMMAND_TIMEOUT_MS = 120_000
const MAX_CAPTURE_CHARS = 1_000_000

export interface CommandResult {
  exitCode: number | null
  output: string
  timedOut: boolean
  truncated: boolean
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

/** Runs a shell command in `cwd`, killing it (with its children) on timeout or abort. */
export function runCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs = COMMAND_TIMEOUT_MS
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
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
    let timedOut = false
    const collect = (chunk: string): void => {
      if (output.length < MAX_CAPTURE_CHARS) output += chunk
      else truncated = true
    }
    child.stdout?.setEncoding('utf8').on('data', collect)
    child.stderr?.setEncoding('utf8').on('data', collect)

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    const onAbort = (): void => killTree(child)
    signal.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }

    child.on('error', (err) => {
      cleanup()
      reject(err)
    })
    child.on('close', (exitCode) => {
      cleanup()
      if (signal.aborted) reject(signal.reason)
      else resolve({ exitCode, output, timedOut, truncated })
    })
  })
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
