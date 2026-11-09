import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeTool } from '.'
import { runCommand } from './shell'

let root: string
const signal = new AbortController().signal

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tools-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('executeTool', () => {
  it('writes, lists and reads files', async () => {
    const write = await executeTool(
      { name: 'write_file', args: { path: 'notes/hello.txt', content: 'Привет' } },
      root,
      signal
    )
    expect(write.ok).toBe(true)

    const list = await executeTool({ name: 'list_dir', args: {} }, root, signal)
    expect(list).toEqual({ ok: true, output: 'notes/' })

    const read = await executeTool(
      { name: 'read_file', args: { path: 'notes/hello.txt' } },
      root,
      signal
    )
    expect(read).toEqual({ ok: true, output: 'Привет' })
  })

  it('returns readable errors instead of throwing', async () => {
    const missing = await executeTool(
      { name: 'read_file', args: { path: 'nope.txt' } },
      root,
      signal
    )
    expect(missing.ok).toBe(false)
    expect(missing.output).toMatch(/не найдены/)

    const escape = await executeTool(
      { name: 'read_file', args: { path: '../etc/passwd' } },
      root,
      signal
    )
    expect(escape.output).toMatch(/за пределы рабочей папки/)
  })

  it('runs commands in the workspace and reports the exit code', async () => {
    const ok = await executeTool(
      { name: 'run_command', args: { command: 'echo hello' } },
      root,
      signal
    )
    expect(ok.ok).toBe(true)
    expect(ok.output).toContain('hello')

    const failed = await executeTool(
      { name: 'run_command', args: { command: 'exit 3' } },
      root,
      signal
    )
    expect(failed.ok).toBe(false)
    expect(failed.output).toContain('Код выхода: 3')
  })
})

describe('runCommand', () => {
  it('kills a command that runs past the time limit', async () => {
    const started = Date.now()
    const result = await runCommand('sleep 5', root, signal, 300)
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('rejects when the run is stopped', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    await expect(runCommand('sleep 5', root, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})
