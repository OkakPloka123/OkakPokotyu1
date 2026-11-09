import { useState } from 'react'
import type { McpSnapshot, McpState, ToolItem } from '../../../shared/types'
import { ToolCard } from './ToolCard'

const STATE_TEXT: Record<McpState, string> = {
  stopped: 'Выключен',
  starting: 'Запускается…',
  running: 'Работает',
  error: 'Ошибка'
}

interface McpPanelProps {
  snapshot: McpSnapshot | null
  workspace: string | null
  onToggle(enabled: boolean): void
  onPortChange(port: number): void
  onRegenerateToken(): void
  onClearLog(): void
  onCopy(text: string): void
  onRespond(itemId: string, approved: boolean): void
  onStopJob(jobId: string): void
}

export function McpPanel({
  snapshot,
  workspace,
  onToggle,
  onPortChange,
  onRegenerateToken,
  onClearLog,
  onCopy,
  onRespond,
  onStopJob
}: McpPanelProps): React.JSX.Element {
  const [showToken, setShowToken] = useState(false)
  const [portDraft, setPortDraft] = useState<string | null>(null)

  if (!snapshot) return <div className="mcp" />

  const { enabled, state, url, port, token, error, items } = snapshot
  // Waiting requests go first: the agent gives up if nobody answers within the call budget.
  const waiting = items.filter((item) => item.status === 'pending')
  const history = items.filter((item) => item.status !== 'pending')
  const tunnel = `cloudflared tunnel --url http://127.0.0.1:${port}`
  const portValue = portDraft ?? String(port)
  const card = (item: ToolItem): React.JSX.Element => (
    <ToolCard
      key={item.id}
      item={item}
      showTime
      onRespond={(approved) => onRespond(item.id, approved)}
      onStop={item.jobId ? () => onStopJob(item.jobId!) : undefined}
    />
  )

  return (
    <div className="mcp">
      <div className="mcp-inner">
        <header className="mcp-head">
          <div>
            <h1>MCP-сервер</h1>
            <p className="muted">
              Через него внешний агент, например Hoplite или Custom Agent в Notion, работает на этом
              компьютере. Запись файлов и команды выполняются только после вашего подтверждения
              здесь.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="MCP-сервер"
            className={enabled ? 'switch on' : 'switch'}
            onClick={() => onToggle(!enabled)}
          >
            <span className="switch-knob" />
          </button>
        </header>

        <div className={`mcp-status mcp-status-${state}`}>
          <span className={`status-dot status-${state}`} />
          <span>{STATE_TEXT[state]}</span>
          {state === 'running' && <code>{url}</code>}
          {error && <span className="mcp-error">{error}</span>}
        </div>

        {!workspace && (
          <div className="warn">
            Рабочая папка не выбрана, поэтому агент не сможет работать с файлами и командами.
            Выберите её вверху.
          </div>
        )}

        {waiting.length > 0 && (
          <section className="waiting">
            <h2>Ждут вашего ответа</h2>
            <div className="journal-list">{waiting.map(card)}</div>
          </section>
        )}

        <section className="card">
          <h2>Подключение</h2>
          <div className="field">
            <span className="field-label">Локальный адрес</span>
            <code className="field-value">{url}</code>
            <button className="btn btn-small" onClick={() => onCopy(url)}>
              Копировать
            </button>
          </div>
          <div className="field">
            <span className="field-label">Токен</span>
            <code className="field-value">
              {token ? (showToken ? token : '•'.repeat(24)) : 'появится после первого включения'}
            </code>
            {token && (
              <>
                <button className="btn btn-small" onClick={() => setShowToken(!showToken)}>
                  {showToken ? 'Скрыть' : 'Показать'}
                </button>
                <button className="btn btn-small" onClick={() => onCopy(token)}>
                  Копировать
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => {
                    if (window.confirm('Старый токен перестанет работать. Создать новый?')) {
                      onRegenerateToken()
                    }
                  }}
                >
                  Новый
                </button>
              </>
            )}
          </div>
          <form
            className="field"
            onSubmit={(event) => {
              event.preventDefault()
              onPortChange(Number(portValue))
              setPortDraft(null)
            }}
          >
            <span className="field-label">Порт</span>
            <input
              className="port-input"
              type="number"
              min={1024}
              max={65535}
              value={portValue}
              onChange={(event) => setPortDraft(event.target.value)}
            />
            {portValue !== String(port) && (
              <button className="btn btn-small" type="submit">
                Применить
              </button>
            )}
          </form>
        </section>

        <section className="card">
          <h2>Как подключить агента</h2>
          <ol className="steps">
            <li>
              Установите cloudflared: <code>winget install --id Cloudflare.cloudflared</code> на
              Windows или <code>brew install cloudflared</code> на macOS.
            </li>
            <li>
              Запустите туннель и не закрывайте окно терминала:
              <div className="command">
                <code>{tunnel}</code>
                <button className="btn btn-small" onClick={() => onCopy(tunnel)}>
                  Копировать
                </button>
              </div>
            </li>
            <li>
              Скопируйте из вывода адрес вида <code>https://….trycloudflare.com</code> и допишите в
              конце <code>/mcp</code>.
            </li>
            <li>
              В Hoplite откройте Settings → Project → MCP → Add server: вставьте адрес, транспорт{' '}
              <code>http</code>, авторизация Bearer token, в поле токена — токен выше.
            </li>
          </ol>
          <p className="muted small">
            Адрес быстрого туннеля меняется при каждом запуске cloudflared, тогда обновите его в
            настройках агента. Тот же адрес и токен подходят для Custom Agent в Notion.
          </p>
        </section>

        <section className="journal">
          <div className="journal-head">
            <h2>Журнал действий</h2>
            {history.length > 0 && (
              <button className="btn btn-small" onClick={onClearLog}>
                Очистить
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="muted">
              Здесь появятся действия внешнего агента: что он читал, что записал и какие команды
              запускал.
            </p>
          ) : (
            <div className="journal-list">{history.map(card)}</div>
          )}
        </section>
      </div>
    </div>
  )
}
