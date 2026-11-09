import { describe, expect, it, vi } from 'vitest'
import type { ChatItem, ToolItem } from '../../shared/types'
import { runAgent, type RunOptions } from './loop'
import type { ProviderSession } from './providers/types'

function scripted(replies: string[]): ProviderSession & { received: string[] } {
  const received: string[] = []
  return {
    received,
    send: async (message) => {
      received.push(message)
      const reply = replies.shift()
      if (reply === undefined) throw new Error('no more scripted replies')
      return reply
    }
  }
}

const tool = (call: object): string => `<tool>${JSON.stringify(call)}</tool>`

function run(
  session: ProviderSession,
  overrides: Partial<RunOptions> = {}
): { items: ChatItem[]; done: Promise<void> } {
  const items: ChatItem[] = []
  const upsert = (item: ChatItem): void => {
    const index = items.findIndex((existing) => existing.id === item.id)
    if (index === -1) items.push(item)
    else items[index] = item
  }
  const done = runAgent({
    session,
    message: 'задача',
    signal: new AbortController().signal,
    upsert,
    approve: async () => true,
    execute: async () => ({ ok: true, output: 'ok' }),
    ...overrides
  })
  return { items, done }
}

describe('runAgent', () => {
  it('runs read-only tools without asking and sends the result back', async () => {
    const session = scripted([tool({ name: 'list_dir', args: { path: '.' } }), 'Тут один файл.'])
    const approve = vi.fn()
    const execute = vi.fn(async () => ({ ok: true, output: 'a.txt' }))
    const { items, done } = run(session, { approve, execute })
    await done

    expect(approve).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
    expect(session.received[1]).toBe('<result tool="list_dir" ok="true">\na.txt\n</result>')
    expect(items.map((item) => item.kind)).toEqual(['tool', 'assistant'])
    expect((items[0] as ToolItem).status).toBe('done')
  })

  it('asks before writing and reports a rejection to the agent', async () => {
    const session = scripted([
      tool({ name: 'write_file', args: { path: 'a.txt', content: 'x' } }),
      'Хорошо.'
    ])
    const execute = vi.fn()
    const { items, done } = run(session, { approve: async () => false, execute })
    await done

    expect(execute).not.toHaveBeenCalled()
    expect((items[0] as ToolItem).status).toBe('rejected')
    expect(session.received[1]).toContain('ok="false"')
  })

  it('blocks dangerous commands without asking', async () => {
    const session = scripted([tool({ name: 'run_command', args: { command: 'rm -rf /' } }), 'Ок.'])
    const approve = vi.fn()
    const execute = vi.fn()
    const { items, done } = run(session, { approve, execute })
    await done

    expect(approve).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect((items[0] as ToolItem).status).toBe('blocked')
  })

  it('asks the agent to fix a malformed tool block', async () => {
    const session = scripted(['<tool>{oops}</tool>', 'Готово.'])
    const { items, done } = run(session)
    await done

    expect(session.received[1]).toMatch(/could not be used/)
    expect(items.map((item) => item.kind)).toEqual(['notice', 'assistant'])
  })

  it('stops after the step limit', async () => {
    const session = scripted(Array(3).fill(tool({ name: 'list_dir', args: {} })))
    const { items, done } = run(session, { maxSteps: 3 })
    await done

    expect(items.at(-1)).toMatchObject({ kind: 'notice', level: 'error' })
  })
})
