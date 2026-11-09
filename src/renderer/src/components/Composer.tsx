import { useState, type KeyboardEvent } from 'react'
import { SendIcon, StopIcon } from './Icons'

interface ComposerProps {
  disabled: boolean
  running: boolean
  onSend(text: string): void
  onStop(): void
}

export function Composer({ disabled, running, onSend, onStop }: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const canSend = !disabled && !running && text.trim().length > 0

  const submit = (): void => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={
            disabled
              ? 'Сначала выберите рабочую папку'
              : 'Опишите задачу. Enter — отправить, Shift+Enter — новая строка'
          }
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button className="send stop" onClick={onStop} title="Остановить агента">
            <StopIcon />
          </button>
        ) : (
          <button className="send" onClick={submit} disabled={!canSend} title="Отправить">
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  )
}
