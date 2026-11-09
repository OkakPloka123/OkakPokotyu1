import type { ToolItem, ToolName, ToolStatus } from '../../../shared/types'
import { formatTime } from '../lib/format'

const TITLES: Record<ToolName, string> = {
  list_dir: 'Просмотр папки',
  read_file: 'Чтение файла',
  write_file: 'Запись файла',
  run_command: 'Команда в терминале'
}

const STATUS: Record<ToolStatus, string> = {
  pending: 'Ждёт разрешения',
  running: 'Выполняется…',
  done: 'Готово',
  error: 'Ошибка',
  rejected: 'Отклонено',
  blocked: 'Заблокировано'
}

const PREVIEW_LINES = 12

interface ToolCardProps {
  item: ToolItem
  onRespond(approved: boolean): void
  /** Offered while a background command is running. */
  onStop?(): void
  showTime?: boolean
}

export function ToolCard({ item, onRespond, onStop, showTime }: ToolCardProps): React.JSX.Element {
  const { call, status, output } = item
  const target =
    call.name === 'run_command' ? `$ ${call.args.command ?? ''}` : (call.args.path ?? '.')

  return (
    <div className={`tool tool-${status}`}>
      <div className="tool-head">
        <span className="tool-title">{TITLES[call.name]}</span>
        {showTime && <span className="tool-time">{formatTime(item.at)}</span>}
        <span className={`badge badge-${status}`}>{STATUS[status]}</span>
      </div>
      <pre className="tool-target">{target}</pre>
      {call.name === 'write_file' && (
        <pre className="tool-preview">{preview(call.args.content ?? '')}</pre>
      )}
      {status === 'pending' && (
        <div className="tool-actions">
          <button className="btn btn-primary" onClick={() => onRespond(true)}>
            Разрешить
          </button>
          <button className="btn" onClick={() => onRespond(false)}>
            Отклонить
          </button>
        </div>
      )}
      {status === 'running' && onStop && (
        <div className="tool-actions">
          <button className="btn" onClick={onStop}>
            Остановить
          </button>
        </div>
      )}
      {output && (
        <details className="tool-output" open={status === 'error' || status === 'blocked'}>
          <summary>Результат</summary>
          <pre>{output}</pre>
        </details>
      )}
    </div>
  )
}

function preview(content: string): string {
  const lines = content.split('\n')
  if (lines.length <= PREVIEW_LINES) return content
  return [...lines.slice(0, PREVIEW_LINES), `… ещё строк: ${lines.length - PREVIEW_LINES}`].join(
    '\n'
  )
}
