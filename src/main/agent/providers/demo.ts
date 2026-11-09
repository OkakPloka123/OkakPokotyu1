import type { ToolCall } from '../../../shared/types'
import type { AgentProvider, ProviderSession } from './types'

type Scenario = 'list' | 'write' | 'read' | 'run'

const DEMO_FILE = 'hello.txt'

const SCENARIOS: Record<Scenario, { intro: string; call: ToolCall }> = {
  list: {
    intro: 'Посмотрю, что лежит в рабочей папке.',
    call: { name: 'list_dir', args: { path: '.' } }
  },
  write: {
    intro: `Создам файл ${DEMO_FILE} в рабочей папке.`,
    call: {
      name: 'write_file',
      args: { path: DEMO_FILE, content: 'Привет! Этот файл создал демо-агент.\n' }
    }
  },
  read: {
    intro: `Прочитаю ${DEMO_FILE}.`,
    call: { name: 'read_file', args: { path: DEMO_FILE } }
  },
  run: {
    intro: 'Запущу простую команду, чтобы проверить терминал.',
    call: { name: 'run_command', args: { command: 'echo "Привет из терминала"' } }
  }
}

const HELP = [
  'Я демо-агент: работаю без интернета и нужен, чтобы проверить приложение. Попросите меня:',
  '• «Покажи, что лежит в папке»',
  `• «Создай файл ${DEMO_FILE}»`,
  `• «Прочитай ${DEMO_FILE}»`,
  '• «Выполни команду в терминале»',
  '',
  'Настоящего агента (Notion) подключим следующим шагом.'
].join('\n')

function pickScenario(text: string): Scenario | null {
  const t = text.toLowerCase()
  if (/созда|запиш|write|create/.test(t)) return 'write'
  if (/прочит|открой|read/.test(t)) return 'read'
  if (/команд|выполн|запуст|терминал|run|command/.test(t)) return 'run'
  if (/файл|папк|покажи|что леж|list|files/.test(t)) return 'list'
  return null
}

/** Scripted agent that speaks the same text protocol as a real one. */
class DemoSession implements ProviderSession {
  private scenario: Scenario | null = null

  async send(message: string, signal: AbortSignal): Promise<string> {
    await sleep(500, signal)
    const result = /^<result[^>]*ok="(true|false)"[^>]*>\n?([\s\S]*?)\n?<\/result>$/.exec(
      message.trim()
    )
    if (result) return this.summarize(result[1] === 'true', result[2])

    this.scenario = pickScenario(message)
    if (!this.scenario) return HELP
    const { intro, call } = SCENARIOS[this.scenario]
    return `${intro}\n<tool>${JSON.stringify(call)}</tool>`
  }

  private summarize(ok: boolean, output: string): string {
    const scenario = this.scenario
    this.scenario = null
    if (!ok) {
      if (output.includes('отклонил')) return 'Хорошо, не буду. Скажите, что сделать вместо этого.'
      if (scenario === 'read') {
        return `Не получилось прочитать ${DEMO_FILE}: ${output}\nПопросите меня сначала создать его.`
      }
      return `Не получилось:\n${output}`
    }
    switch (scenario) {
      case 'list':
        return `Вот что лежит в рабочей папке:\n${output}`
      case 'write':
        return `Готово, файл ${DEMO_FILE} создан. Можете попросить меня прочитать его.`
      case 'read':
        return `Содержимое ${DEMO_FILE}:\n\n${output}`
      case 'run':
        return `Команда выполнилась:\n${output}`
      default:
        return 'Готово.'
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const demoProvider: AgentProvider = {
  info: {
    id: 'demo',
    name: 'Демо-агент',
    description: 'Работает без интернета и показывает, как устроены действия и подтверждения.'
  },
  createSession: () => new DemoSession()
}
