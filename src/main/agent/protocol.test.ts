import { describe, expect, it } from 'vitest'
import { MAX_RESULT_CHARS, formatResult, parseReply, truncateMiddle } from './protocol'

describe('parseReply', () => {
  it('returns plain text when there is no tool block', () => {
    expect(parseReply('  Готово!  ')).toEqual({
      text: 'Готово!',
      call: null,
      error: null,
      ignored: 0
    })
  })

  it('extracts the tool call and keeps the surrounding text', () => {
    const parsed = parseReply(
      'Посмотрю файлы.\n<tool>{"name": "list_dir", "args": {"path": "src"}}</tool>'
    )
    expect(parsed.text).toBe('Посмотрю файлы.')
    expect(parsed.call).toEqual({ name: 'list_dir', args: { path: 'src' } })
    expect(parsed.error).toBeNull()
  })

  it('accepts a JSON code fence inside the block', () => {
    const parsed = parseReply(
      '<tool>\n```json\n{"name": "run_command", "args": {"command": "ls"}}\n```\n</tool>'
    )
    expect(parsed.call).toEqual({ name: 'run_command', args: { command: 'ls' } })
  })

  it('reports unknown tools, missing arguments and broken JSON', () => {
    expect(parseReply('<tool>{"name": "format_disk"}</tool>').error).toMatch(/unknown tool/)
    expect(parseReply('<tool>{"name": "read_file", "args": {}}</tool>').error).toMatch(/"path"/)
    expect(parseReply('<tool>{"name": "toString"}</tool>').error).toMatch(/unknown tool/)
    expect(parseReply('<tool>{"name": </tool>').error).toBeTruthy()
    expect(parseReply('Сейчас <tool>{"name": "list_dir"}').error).toMatch(/not closed/)
  })

  it('executes only the first of several blocks', () => {
    const parsed = parseReply('<tool>{"name": "list_dir"}</tool><tool>{"name": "list_dir"}</tool>')
    expect(parsed.call?.name).toBe('list_dir')
    expect(parsed.ignored).toBe(1)
    expect(parsed.text).toBe('')
  })
})

describe('formatResult', () => {
  it('fits long output into the message limit', () => {
    const message = formatResult(
      { name: 'run_command', args: { command: 'x' } },
      { ok: true, output: 'a'.repeat(50_000) }
    )
    expect(message.length).toBeLessThanOrEqual(MAX_RESULT_CHARS)
    expect(message).toMatch(/^<result tool="run_command" ok="true">\n/)
    expect(message).toMatch(/characters omitted/)
    expect(message.endsWith('\n</result>')).toBe(true)
  })
})

describe('truncateMiddle', () => {
  it('keeps short text and the start and end of long text', () => {
    expect(truncateMiddle('short', 10)).toBe('short')
    const cut = truncateMiddle('START' + 'x'.repeat(1000) + 'END', 200)
    expect(cut.length).toBeLessThanOrEqual(200)
    expect(cut.startsWith('START')).toBe(true)
    expect(cut.endsWith('END')).toBe(true)
  })
})
