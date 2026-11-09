import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall } from '../../shared/types'
import { COMMAND_TIMEOUT_MS, runCommand } from './shell'
import { WorkspaceError, resolveInWorkspace } from './workspace'

export interface ToolResult {
  ok: boolean
  output: string
}

const MAX_LIST_ENTRIES = 200
const MAX_READ_BYTES = 512 * 1024

const FS_ERRORS: Record<string, string> = {
  ENOENT: 'файл или папка не найдены',
  EACCES: 'нет доступа',
  EPERM: 'нет доступа',
  EISDIR: 'это папка, а не файл',
  ENOTDIR: 'это не папка'
}

/** Runs one tool inside the workspace. Failures become readable results instead of exceptions. */
export async function executeTool(
  call: ToolCall,
  workspace: string,
  signal: AbortSignal
): Promise<ToolResult> {
  const { path: target = '.', content = '', command = '' } = call.args
  try {
    switch (call.name) {
      case 'list_dir':
        return await listDir(workspace, target)
      case 'read_file':
        return await readTextFile(workspace, target)
      case 'write_file':
        return await writeTextFile(workspace, target, content)
      case 'run_command':
        return await runInWorkspace(workspace, command, signal)
    }
  } catch (err) {
    if (signal.aborted) throw err
    return { ok: false, output: describeError(err, call.name === 'run_command' ? null : target) }
  }
}

async function listDir(workspace: string, target: string): Promise<ToolResult> {
  const dir = await resolveInWorkspace(workspace, target)
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
  )
  const lines = await Promise.all(
    entries.slice(0, MAX_LIST_ENTRIES).map(async (entry) => {
      if (entry.isDirectory()) return `${entry.name}/`
      const size = await stat(path.join(dir, entry.name)).then(
        (info) => formatSize(info.size),
        () => null
      )
      return size ? `${entry.name} (${size})` : entry.name
    })
  )
  if (entries.length > MAX_LIST_ENTRIES) lines.push(`… и ещё ${entries.length - MAX_LIST_ENTRIES}`)
  return { ok: true, output: lines.length > 0 ? lines.join('\n') : '(папка пуста)' }
}

async function readTextFile(workspace: string, target: string): Promise<ToolResult> {
  const file = await resolveInWorkspace(workspace, target)
  const info = await stat(file)
  if (info.isDirectory()) {
    return { ok: false, output: `«${target}» — это папка, используйте list_dir.` }
  }
  if (info.size > MAX_READ_BYTES) {
    return {
      ok: false,
      output: `Файл слишком большой (${formatSize(info.size)}), лимит ${formatSize(MAX_READ_BYTES)}.`
    }
  }
  const data = await readFile(file)
  if (data.includes(0)) {
    return { ok: false, output: 'Это бинарный файл, прочитать его как текст нельзя.' }
  }
  return { ok: true, output: data.toString('utf8') }
}

async function writeTextFile(
  workspace: string,
  target: string,
  content: string
): Promise<ToolResult> {
  const file = await resolveInWorkspace(workspace, target)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
  return { ok: true, output: `Записано ${formatSize(Buffer.byteLength(content))} в «${target}».` }
}

async function runInWorkspace(
  workspace: string,
  command: string,
  signal: AbortSignal
): Promise<ToolResult> {
  const result = await runCommand(command, workspace, signal)
  const lines: string[] = []
  if (result.timedOut) lines.push(`Остановлено по таймауту (${COMMAND_TIMEOUT_MS / 1000} с).`)
  lines.push(
    `Код выхода: ${result.exitCode ?? 'нет'}`,
    '',
    result.output.trimEnd() || '(нет вывода)'
  )
  if (result.truncated) lines.push('… вывод обрезан')
  return { ok: result.exitCode === 0 && !result.timedOut, output: lines.join('\n') }
}

function describeError(err: unknown, target: string | null): string {
  if (err instanceof WorkspaceError) return err.message
  const code = (err as NodeJS.ErrnoException | null)?.code
  const known = code ? FS_ERRORS[code] : undefined
  if (known) return target ? `«${target}»: ${known}` : `Ошибка: ${known}`
  return `Ошибка: ${err instanceof Error ? err.message : String(err)}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}
