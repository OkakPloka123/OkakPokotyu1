import type { ToolCall } from '../../shared/types'

export type Decision = { kind: 'auto' } | { kind: 'ask' } | { kind: 'deny'; reason: string }

// A coarse safety net for obviously destructive commands. The real protection is that the user
// approves every command before it runs.
const BLOCKED: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\brm\s+(?:-{1,2}[\w-]+\s+)*(?:\/|~|\$HOME)\/?\*?(?=\s|$|[;&|])/,
    reason: 'удаление корня диска или домашней папки'
  },
  { pattern: /\bmkfs(?:\.\w+)?\b/, reason: 'форматирование диска' },
  { pattern: /\bdd\b.*\bof=\/dev\/(?!null\b)/, reason: 'запись поверх диска' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork-бомба' },
  { pattern: /\bch(?:mod|own)\b.*\s-R\b.*\s\/(?=\s|$)/, reason: 'смена прав на весь диск' },
  {
    pattern: /(?:^|[;&|]|\bsudo)\s*(?:shutdown|reboot|poweroff|halt)\b/,
    reason: 'выключение или перезагрузка компьютера'
  },
  { pattern: /\b(?:Stop|Restart)-Computer\b/i, reason: 'выключение или перезагрузка компьютера' },
  { pattern: /\bformat(?:\.com)?\s+[a-z]:/i, reason: 'форматирование диска' },
  { pattern: /\b(?:diskpart|bcdedit)\b/i, reason: 'изменение разделов диска или загрузчика' },
  {
    pattern: /\b(?:rd|rmdir|del|erase|Remove-Item)\b.*\s[a-z]:\\?\*?(?=\s|$|["'])/i,
    reason: 'удаление корня диска'
  },
  {
    pattern: /\bRemove-Item\b.*\s(?:~|\$HOME|\$env:USERPROFILE)[\\/]?(?=\s|$|["'])/i,
    reason: 'удаление домашней папки'
  }
]

/** Read-only tools run right away, changes need the user's approval, known disasters never run. */
export function decide(call: ToolCall): Decision {
  switch (call.name) {
    case 'list_dir':
    case 'read_file':
      return { kind: 'auto' }
    case 'write_file':
      return { kind: 'ask' }
    case 'run_command': {
      const blocked = BLOCKED.find(({ pattern }) => pattern.test(call.args.command ?? ''))
      return blocked ? { kind: 'deny', reason: blocked.reason } : { kind: 'ask' }
    }
  }
}
