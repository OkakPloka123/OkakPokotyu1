import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Chat, Settings } from '../shared/types'

const DEFAULT_SETTINGS: Settings = { workspace: null, providerId: 'demo' }

/** Settings and chats stored as JSON files in the app's data folder. */
export class Store {
  settings: Settings
  chats: Chat[]

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...readJson<Partial<Settings>>(this.file('settings'), {})
    }
    this.chats = readJson<Chat[]>(this.file('chats'), [])
  }

  saveSettings(): void {
    writeJson(this.file('settings'), this.settings)
  }

  saveChats(): void {
    writeJson(this.file('chats'), this.chats)
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
