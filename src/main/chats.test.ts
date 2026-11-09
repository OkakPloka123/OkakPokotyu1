import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunState, ToolItem } from '../shared/types'
import type { AgentProvider } from './agent/providers/types'
import { ChatService } from './chats'
import { Store } from './store'

const WRITE = '<tool>{"name": "write_file", "args": {"path": "a.txt", "content": "x"}}</tool>'

let dataDir: string
let workspace: string

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'data-'))
  workspace = await mkdtemp(path.join(tmpdir(), 'ws-'))
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
})

function setup(replies: string[]): { service: ChatService; store: Store; states: RunState[] } {
  const provider: AgentProvider = {
    info: { id: 'test', name: 'Test', description: '' },
    createSession: () => ({ send: async () => replies.shift() ?? 'Готово.' })
  }
  const store = new Store(dataDir)
  store.settings.workspace = workspace
  const states: RunState[] = []
  const service = new ChatService(store, () => provider, {
    chatUpdated: () => {},
    runState: (state) => states.push(state)
  })
  return { service, store, states }
}

function pendingTool(service: ChatService, chatId: string): ToolItem | undefined {
  return service
    .get(chatId)
    ?.items.find((item): item is ToolItem => item.kind === 'tool' && item.status === 'pending')
}

describe('ChatService', () => {
  it('runs an approved action and keeps the chat on disk', async () => {
    const { service, states } = setup([WRITE, 'Файл создан.'])
    const chat = service.create()
    const run = service.send(chat.id, 'Создай файл a.txt')

    await vi.waitFor(() => expect(pendingTool(service, chat.id)).toBeDefined())
    service.respond(chat.id, pendingTool(service, chat.id)!.id, true)
    await run

    expect(await readFile(path.join(workspace, 'a.txt'), 'utf8')).toBe('x')
    expect(states).toEqual([
      { chatId: chat.id, running: true },
      { chatId: chat.id, running: false }
    ])
    const saved = new Store(dataDir).chats[0]
    expect(saved.title).toBe('Создай файл a.txt')
    expect(saved.items.map((item) => item.kind)).toEqual(['user', 'tool', 'assistant'])
  })

  it('stop rejects a pending action', async () => {
    const { service } = setup([WRITE])
    const chat = service.create()
    const run = service.send(chat.id, 'Создай файл')

    await vi.waitFor(() => expect(pendingTool(service, chat.id)).toBeDefined())
    service.stop(chat.id)
    await run

    const items = service.get(chat.id)!.items
    expect(items.find((item) => item.kind === 'tool')).toMatchObject({ status: 'rejected' })
    expect(items.at(-1)).toMatchObject({ kind: 'notice', text: 'Остановлено.' })
  })

  it('refuses to start without a workspace', async () => {
    const { service, store } = setup([])
    store.settings.workspace = null
    await expect(service.send(service.create().id, 'привет')).rejects.toThrow(/рабочую папку/)
  })
})
