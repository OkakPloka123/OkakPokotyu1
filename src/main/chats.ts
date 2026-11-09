import { randomUUID } from 'node:crypto'
import type { Chat, ChatItem, ChatSummary, RunState } from '../shared/types'
import { notice, runAgent } from './agent/loop'
import { buildRules } from './agent/protocol'
import type { AgentProvider, ProviderSession } from './agent/providers/types'
import type { Store } from './store'
import { executeTool } from './tools'
import { COMMAND_TIMEOUT_MS } from './tools/shell'

export interface ChatEvents {
  chatUpdated(chat: Chat): void
  runState(state: RunState): void
}

interface PendingApproval {
  chatId: string
  resolve(approved: boolean): void
}

/** Owns chats, agent runs and pending approvals; the UI talks to it over IPC. */
export class ChatService {
  private readonly sessions = new Map<string, { providerId: string; session: ProviderSession }>()
  private readonly runs = new Map<string, AbortController>()
  private readonly approvals = new Map<string, PendingApproval>()

  constructor(
    private readonly store: Store,
    private readonly getProvider: (providerId: string) => AgentProvider,
    private readonly events: ChatEvents
  ) {
    // Runs do not survive a restart, so nothing saved can still be pending or running.
    for (const chat of store.chats) settleOpenTools(chat)
  }

  list(): ChatSummary[] {
    return this.store.chats
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        running: this.runs.has(chat.id)
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(chatId: string): Chat | null {
    return this.store.chats.find((chat) => chat.id === chatId) ?? null
  }

  create(): Chat {
    const now = Date.now()
    const chat: Chat = {
      id: randomUUID(),
      title: 'Новый чат',
      createdAt: now,
      updatedAt: now,
      items: []
    }
    this.store.chats.push(chat)
    this.store.saveChats()
    return chat
  }

  delete(chatId: string): void {
    this.stop(chatId)
    this.sessions.delete(chatId)
    this.store.chats = this.store.chats.filter((chat) => chat.id !== chatId)
    this.store.saveChats()
  }

  /** Runs the agent on a new message; resolves when the run is over. */
  async send(chatId: string, text: string): Promise<void> {
    const chat = this.get(chatId)
    if (!chat) throw new Error('Чат не найден')
    if (!text.trim()) throw new Error('Пустое сообщение')
    if (this.runs.has(chatId)) throw new Error('Агент ещё работает в этом чате')
    const { workspace, providerId } = this.store.settings
    if (!workspace) throw new Error('Сначала выберите рабочую папку')

    if (chat.items.length === 0) chat.title = makeTitle(text)
    this.upsert(chat, { id: randomUUID(), at: Date.now(), kind: 'user', text })

    const controller = new AbortController()
    this.runs.set(chatId, controller)
    this.events.runState({ chatId, running: true })
    try {
      await runAgent({
        session: this.sessionFor(chatId, providerId),
        message: text,
        signal: controller.signal,
        upsert: (item) => this.upsert(chat, item),
        approve: (item) =>
          new Promise<boolean>((resolve) => this.approvals.set(item.id, { chatId, resolve })),
        execute: (call, signal) => executeTool(call, workspace, signal)
      })
    } catch (err) {
      if (!controller.signal.aborted) {
        this.upsert(
          chat,
          notice('error', `Ошибка: ${err instanceof Error ? err.message : String(err)}`)
        )
      }
    } finally {
      this.runs.delete(chatId)
      if (settleOpenTools(chat)) this.touch(chat)
      if (controller.signal.aborted) this.upsert(chat, notice('info', 'Остановлено.'))
      this.events.runState({ chatId, running: false })
    }
  }

  stop(chatId: string): void {
    this.runs.get(chatId)?.abort()
    for (const [itemId, pending] of this.approvals) {
      if (pending.chatId !== chatId) continue
      this.approvals.delete(itemId)
      pending.resolve(false)
    }
  }

  /** For app quit: stops every running agent together with its command. */
  stopAll(): void {
    for (const chatId of [...this.runs.keys()]) this.stop(chatId)
  }

  respond(chatId: string, itemId: string, approved: boolean): void {
    const pending = this.approvals.get(itemId)
    if (!pending || pending.chatId !== chatId) return
    this.approvals.delete(itemId)
    pending.resolve(approved)
  }

  private sessionFor(chatId: string, providerId: string): ProviderSession {
    const existing = this.sessions.get(chatId)
    if (existing?.providerId === providerId) return existing.session
    const rules = buildRules(process.platform, COMMAND_TIMEOUT_MS / 1000)
    const session = this.getProvider(providerId).createSession(rules)
    this.sessions.set(chatId, { providerId, session })
    return session
  }

  private upsert(chat: Chat, item: ChatItem): void {
    const index = chat.items.findIndex((existing) => existing.id === item.id)
    if (index === -1) chat.items.push(item)
    else chat.items[index] = item
    this.touch(chat)
  }

  private touch(chat: Chat): void {
    // A chat deleted mid-run must not come back through late updates.
    if (!this.store.chats.includes(chat)) return
    chat.updatedAt = Date.now()
    this.store.saveChats()
    this.events.chatUpdated(chat)
  }
}

/** Marks tool calls left without an outcome (stopped run, closed app). Returns true if any. */
function settleOpenTools(chat: Chat): boolean {
  let changed = false
  chat.items = chat.items.map((item): ChatItem => {
    if (item.kind !== 'tool') return item
    if (item.status === 'pending') {
      changed = true
      return { ...item, status: 'rejected', output: 'Остановлено до подтверждения.' }
    }
    if (item.status === 'running') {
      changed = true
      return { ...item, status: 'error', output: 'Выполнение прервано.' }
    }
    return item
  })
  return changed
}

function makeTitle(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}
