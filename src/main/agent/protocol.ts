import type { ToolCall, ToolName } from '../../shared/types'

/** Notion's Agent API accepts at most 10 000 characters per message; keep results below that. */
export const MAX_RESULT_CHARS = 9000

const TOOL_ARGS: Record<ToolName, { required: string[]; optional: string[] }> = {
  list_dir: { required: [], optional: ['path'] },
  read_file: { required: ['path'], optional: [] },
  write_file: { required: ['path', 'content'], optional: [] },
  run_command: { required: ['command'], optional: [] }
}

const TOOL_NAMES = Object.keys(TOOL_ARGS) as ToolName[]

/** Instructions that teach the agent the text protocol; each provider decides how to deliver them. */
export function buildRules(platform: NodeJS.Platform, commandTimeoutSec: number): string {
  const os = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
  const shell = platform === 'win32' ? 'PowerShell' : 'the default Unix shell'
  return [
    "You are connected to the user's desktop app and work on the user's own computer through it.",
    'You never access the computer directly: you request actions, the app shows each one to the user and performs it.',
    'Writing files and running commands happen only after the user approves them. No SSH, passwords or keys are needed.',
    '',
    `Environment: ${os}, commands run in ${shell}. Paths are relative to the working folder chosen by the user; paths outside it are rejected.`,
    '',
    'To request an action, reply with exactly one block:',
    '<tool>{"name": "<tool name>", "args": {...}}</tool>',
    '',
    'Tools:',
    '- list_dir {"path": "."}: list a folder',
    '- read_file {"path": "notes.txt"}: read a text file',
    '- write_file {"path": "notes.txt", "content": "..."}: create or overwrite a text file',
    `- run_command {"command": "git status"}: run a command in the working folder (time limit ${commandTimeoutSec} s)`,
    '',
    'Rules:',
    '- One action per reply. A short explanation before the block is fine.',
    '- The result arrives in the next message as <result tool="..." ok="true|false">...</result>.',
    '- If the user rejects an action, do not retry it; ask what to do instead.',
    '- When the task is done, reply with plain text and no <tool> block.',
    "- Reply in the user's language."
  ].join('\n')
}

export interface ParsedReply {
  /** Agent text with tool blocks removed. */
  text: string
  call: ToolCall | null
  /** Why a <tool> block could not be used; sent back to the agent so it can retry. */
  error: string | null
  /** Tool blocks after the first one; they are not executed. */
  ignored: number
}

const TOOL_BLOCK = /<tool>([\s\S]*?)<\/tool>/gi

export function parseReply(reply: string): ParsedReply {
  const blocks = [...reply.matchAll(TOOL_BLOCK)]
  const text = reply.replace(TOOL_BLOCK, '').trim()
  if (blocks.length === 0) {
    if (/<tool>/i.test(reply)) {
      const before = text.replace(/<tool>[\s\S]*$/i, '').trim()
      return {
        text: before,
        call: null,
        error: 'the <tool> block is not closed with </tool>',
        ignored: 0
      }
    }
    return { text, call: null, error: null, ignored: 0 }
  }
  try {
    const call = toToolCall(JSON.parse(stripFence(blocks[0][1])))
    return { text, call, error: null, ignored: blocks.length - 1 }
  } catch (err) {
    return { text, call: null, error: err instanceof Error ? err.message : String(err), ignored: 0 }
  }
}

function stripFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
}

function toToolCall(value: unknown): ToolCall {
  if (!isRecord(value)) throw new Error('the block must contain a JSON object')
  const name = value.name
  if (typeof name !== 'string' || !TOOL_NAMES.includes(name as ToolName)) {
    throw new Error(`unknown tool "${String(name)}", available tools: ${TOOL_NAMES.join(', ')}`)
  }
  const spec = TOOL_ARGS[name as ToolName]
  const rawArgs = value.args ?? {}
  if (!isRecord(rawArgs)) throw new Error('"args" must be an object')

  const args: Record<string, string> = {}
  for (const key of [...spec.required, ...spec.optional]) {
    const arg = rawArgs[key]
    if (arg === undefined) {
      if (spec.required.includes(key)) throw new Error(`${name} needs a string "${key}" argument`)
      continue
    }
    if (typeof arg !== 'string') throw new Error(`argument "${key}" must be a string`)
    args[key] = arg
  }
  return { name: name as ToolName, args }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function formatResult(
  call: ToolCall,
  result: { ok: boolean; output: string },
  note?: string
): string {
  const open = `<result tool="${call.name}" ok="${result.ok}">\n`
  const close = '\n</result>'
  const body = note ? `${note}\n${result.output}` : result.output
  return open + truncateMiddle(body, MAX_RESULT_CHARS - open.length - close.length) + close
}

export function formatProtocolError(error: string): string {
  return [
    '<result ok="false">',
    `Your <tool> block could not be used: ${error}.`,
    'Reply again with one valid <tool>{"name": "...", "args": {...}}</tool> block, or with plain text if the task is done.',
    '</result>'
  ].join('\n')
}

/** Keeps the start and the end of long text: that is where errors and summaries usually are. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const marker = (omitted: number): string => `\n... [${omitted} characters omitted] ...\n`
  const keep = max - marker(text.length).length
  if (keep <= 0) return text.slice(0, max)
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  return text.slice(0, head) + marker(text.length - head - tail) + text.slice(text.length - tail)
}
