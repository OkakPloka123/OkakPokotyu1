import { randomUUID } from 'node:crypto'
import type { ChatItem, NoticeItem, ToolCall, ToolItem, ToolStatus } from '../../shared/types'
import type { ToolResult } from '../tools'
import { decide } from '../tools/policy'
import { formatProtocolError, formatResult, parseReply, truncateMiddle } from './protocol'
import type { ProviderSession } from './providers/types'

export const MAX_STEPS = 25
/** Output kept in the chat history; the agent itself gets a shorter version. */
const STORED_OUTPUT_CHARS = 20_000

export interface RunOptions {
  session: ProviderSession
  message: string
  signal: AbortSignal
  /** Adds an item to the chat or replaces the item with the same id. */
  upsert(item: ChatItem): void
  approve(item: ToolItem): Promise<boolean>
  execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult>
  maxSteps?: number
}

/**
 * Talks to the agent until it answers without requesting an action. Every requested action goes
 * through the policy, waits for the user's approval when needed, runs locally, and its result is
 * sent back to the agent as the next message.
 */
export async function runAgent(options: RunOptions): Promise<void> {
  const { session, signal, upsert, maxSteps = MAX_STEPS } = options
  let message = options.message

  for (let step = 0; step < maxSteps; step++) {
    const reply = await session.send(message, signal)
    signal.throwIfAborted()
    const parsed = parseReply(reply)
    if (parsed.text) {
      upsert({ id: randomUUID(), at: Date.now(), kind: 'assistant', text: parsed.text })
    }
    if (parsed.error !== null) {
      upsert(notice('error', 'Агент прислал некорректный запрос действия, прошу его повторить.'))
      message = formatProtocolError(parsed.error)
      continue
    }
    if (!parsed.call) return

    const result = await handleTool(parsed.call, options)
    const note =
      parsed.ignored > 0
        ? 'Only the first <tool> block was executed. Request one action per reply.'
        : undefined
    message = formatResult(parsed.call, result, note)
  }

  upsert(notice('error', `Агент сделал ${maxSteps} шагов без итогового ответа и был остановлен.`))
}

async function handleTool(call: ToolCall, options: RunOptions): Promise<ToolResult> {
  const { upsert, approve, execute, signal } = options
  const item: ToolItem = { id: randomUUID(), at: Date.now(), kind: 'tool', call, status: 'pending' }
  const finish = (status: ToolStatus, result: ToolResult): ToolResult => {
    upsert({ ...item, status, output: truncateMiddle(result.output, STORED_OUTPUT_CHARS) })
    return result
  }

  const decision = decide(call)
  if (decision.kind === 'deny') {
    return finish('blocked', {
      ok: false,
      output: `Заблокировано: ${decision.reason}. Такие команды приложение не выполняет.`
    })
  }
  if (decision.kind === 'ask') {
    upsert(item)
    const approved = await approve(item)
    signal.throwIfAborted()
    if (!approved) {
      return finish('rejected', { ok: false, output: 'Пользователь отклонил это действие.' })
    }
  }

  upsert({ ...item, status: 'running' })
  const result = await execute(call, signal)
  return finish(result.ok ? 'done' : 'error', result)
}

export function notice(level: NoticeItem['level'], text: string): NoticeItem {
  return { id: randomUUID(), at: Date.now(), kind: 'notice', level, text }
}
