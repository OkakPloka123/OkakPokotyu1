import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Chat, Settings, ToolItem } from '../shared/types'

export const DEFAULT_MCP_PORT = 7337

const DEFAULT_SETTINGS: Settings = {
  workspace: null,
  providerId: 'demo',
  mcp: { enabled: false, port: DEFAULT_MCP_PORT, token: '' }
}

/** Settings, chats and the MCP journal stored as JSON files in the app's data folder. */
export class Store {
  settings: Settings
  chats: Chat[]
  mcpLog: ToolItem[]

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    const saved = readJson<Partial<Settings>>(this.file('settings'), {})
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      mcp: { ...DEFAULT_SETTINGS.mcp, ...saved.mcp }
    }
    this.chats = readJson<Chat[]>(this.file('chats'), [])
    this.mcpLog = readJson<ToolItem[]>(this.file('mcp-log'), [])
  }

  saveSettings(): void {
    writeJson(this.file('settings'), this.settings)
  }

  saveChats(): void {
    writeJson(this.file('chats'), this.chats)
  }

  saveMcpLog(): void {
    writeJson(this.file('mcp-log'), this.mcpLog)
  }

  private file(name: string): string {
    return path.join(this.dir, `${name}.json`)
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  // Write to a temp file and rename, so a crash never leaves a half-written file behind.
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, file)
}
