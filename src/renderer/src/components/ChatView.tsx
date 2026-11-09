import { useEffect, useRef } from 'react'
import type { Chat, ChatItem } from '../../../shared/types'
import { ToolCard } from './ToolCard'

const SUGGESTIONS = [
  'Покажи, что лежит в папке',
  'Создай файл hello.txt',
  'Прочитай hello.txt',
  'Выполни команду в терминале'
]

interface ChatViewProps {
  chat: Chat | null
  running: boolean
  workspace: string | null
  onRespond(itemId: string, approved: boolean): void
  onSuggestion(text: string): void
}

export function ChatView({
  chat,
  running,
  workspace,
  onRespond,
  onSuggestion
}: ChatViewProps): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  const items = chat?.items ?? []
  const lastUpdate = chat?.updatedAt

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lastUpdate, running])

  if (items.length === 0) {
    return (
      <div className="empty">
        <h1>Чем помочь?</h1>
        {workspace ? (
          <>
            <p className="muted">
              Агент работает в папке <code>{workspace}</code>. Перед записью файлов и запуском
              команд он спросит разрешения.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((text) => (
                <button key={text} className="chip" onClick={() => onSuggestion(text)}>
                  {text}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            Сначала выберите рабочую папку вверху: агент сможет работать только внутри неё.
          </p>
        )}
      </div>
    )
  }

  const toolInProgress = items.some(
    (item) => item.kind === 'tool' && (item.status === 'pending' || item.status === 'running')
  )

  return (
    <div className="messages">
      <div className="messages-inner">
        {items.map((item) => (
          <Item key={item.id} item={item} onRespond={onRespond} />
        ))}
        {running && !toolInProgress && (
          <div className="thinking">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            Агент думает…
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

interface ItemProps {
  item: ChatItem
  onRespond(itemId: string, approved: boolean): void
}

function Item({ item, onRespond }: ItemProps): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg-user">
          <div className="bubble">{item.text}</div>
        </div>
      )
    case 'assistant':
      return (
        <div className="msg-assistant">
          <div className="avatar">A</div>
          <div className="text">{item.text}</div>
        </div>
      )
    case 'tool':
      return <ToolCard item={item} onRespond={(approved) => onRespond(item.id, approved)} />
    case 'notice':
      return <div className={`notice notice-${item.level}`}>{item.text}</div>
  }
}
