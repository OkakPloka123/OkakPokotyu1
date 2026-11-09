import type { ChatSummary, McpState } from '../../../shared/types'
import { formatTime } from '../lib/format'
import { PlugIcon, PlusIcon, TrashIcon } from './Icons'

interface SidebarProps {
  chats: ChatSummary[]
  activeId: string | null
  mcpState: McpState | null
  mcpPending: number
  mcpActive: boolean
  onSelect(chatId: string): void
  onCreate(): void
  onDelete(chatId: string): void
  onOpenMcp(): void
}

export function Sidebar({
  chats,
  activeId,
  mcpState,
  mcpPending,
  mcpActive,
  onSelect,
  onCreate,
  onDelete,
  onOpenMcp
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" />
        Desktop Agent
      </div>
      <button className="new-chat" onClick={onCreate}>
        <PlusIcon />
        Новый чат
      </button>
      <nav className="chat-list">
        {chats.length === 0 && <p className="muted small empty-list">Чатов пока нет</p>}
        {chats.map((chat) => (
          <div key={chat.id} className={chat.id === activeId ? 'chat-row active' : 'chat-row'}>
            <button className="chat-link" onClick={() => onSelect(chat.id)}>
              <span className="chat-title">
                {chat.running && <span className="pulse" />}
                <span className="chat-title-text">{chat.title}</span>
              </span>
              <span className="chat-time">{formatTime(chat.updatedAt)}</span>
            </button>
            <button
              className="icon-button chat-delete"
              title="Удалить чат"
              onClick={() => {
                if (window.confirm('Удалить этот чат?')) onDelete(chat.id)
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </nav>
      <button className={mcpActive ? 'mcp-link active' : 'mcp-link'} onClick={onOpenMcp}>
        <PlugIcon />
        <span className="mcp-link-text">MCP-сервер</span>
        {mcpPending > 0 ? (
          <span className="count" title="Запросы ждут вашего ответа">
            {mcpPending}
          </span>
        ) : (
          <span className={`status-dot status-${mcpState ?? 'stopped'}`} />
        )}
      </button>
    </aside>
  )
}
