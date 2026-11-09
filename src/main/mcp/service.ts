import { randomBytes } from 'node:crypto'
import type { McpSnapshot, McpState, ToolItem } from '../../shared/types'
import type { Store } from '../store'
import { McpActions } from './actions'
import { startMcpHttp, type McpHttpServer } from './http'
import { buildMcpServer } from './tools'

const MAX_LOG_ITEMS = 300

export interface McpEvents {
  updated(snapshot: McpSnapshot): void
  approvalRequested(item: ToolItem): void
}

export interface McpServiceOptions {
  version?: string
  host?: string
  /** Time for one call, approval included; shortened in tests. */
  budgetMs?: number
}

/** Owns the MCP server's lifecycle, its settings and the journal of agent actions. */
export class McpService {
  readonly actions: McpActions
  private server: McpHttpServer | null = null
  private state: McpState = 'stopped'
  private error: string | null = null
  // Start and stop run one at a time, so quick toggles cannot leave two servers behind.
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: Store,
    private readonly events: McpEvents,
    private readonly options: McpServiceOptions = {}
  ) {
    this.actions = new McpActions(
      {
        workspace: () => store.settings.workspace,
        log: (item) => this.log(item),
        approvalRequested: (item) => events.approvalRequested(item)
      },
      options.budgetMs
    )
    // Nothing from a previous launch can still be waiting or running.
    store.mcpLog = store.mcpLog.map((item): ToolItem => {
      if (item.status === 'pending') {
        return { ...item, status: 'rejected', output: 'Приложение закрылось до ответа.' }
      }
      if (item.status === 'running') {
        return { ...item, status: 'error', output: 'Прервано: приложение закрылось.' }
      }
      return item
    })
  }

  snapshot(): McpSnapshot {
    const port = this.server?.port ?? this.store.settings.mcp.port
    return {
      enabled: this.store.settings.mcp.enabled,
      state: this.state,
      port,
      url: `http://127.0.0.1:${port}/mcp`,
      error: this.error,
      token: this.store.settings.mcp.token,
      items: this.store.mcpLog
    }
  }

  start(): Promise<McpSnapshot> {
    return this.serialize(() => this.doStart())
  }

  setEnabled(enabled: boolean): Promise<McpSnapshot> {
    this.store.settings.mcp.enabled = enabled
    this.store.saveSettings()
    return this.serialize(() => (enabled ? this.doStart() : this.doStop()))
  }

  setPort(port: number): Promise<McpSnapshot> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Порт должен быть числом от 1024 до 65535')
    }
    this.store.settings.mcp.port = port
    this.store.saveSettings()
    return this.serialize(async () => {
      await this.doStop()
      if (this.store.settings.mcp.enabled) await this.doStart()
    })
  }

  regenerateToken(): McpSnapshot {
    this.store.settings.mcp.token = newToken()
    this.store.saveSettings()
    this.emit()
    return this.snapshot()
  }

  clearLog(): McpSnapshot {
    this.store.mcpLog = this.store.mcpLog.filter(
      (item) => item.status === 'pending' || item.status === 'running'
    )
    this.store.saveMcpLog()
    this.emit()
    return this.snapshot()
  }

  respond(itemId: string, approved: boolean): void {
    this.actions.respond(itemId, approved)
  }

  stopJob(jobId: string): void {
    this.actions.stopCommand(jobId)
  }

  /** For app quit: background commands must not outlive the app. */
  shutdown(): void {
    this.actions.cancelAll()
    void this.server?.close()
    this.server = null
  }

  private async doStart(): Promise<void> {
    if (this.server) return
    const mcp = this.store.settings.mcp
    if (!mcp.token) {
      mcp.token = newToken()
      this.store.saveSettings()
    }
    this.state = 'starting'
    this.error = null
    this.emit()
    try {
      this.server = await startMcpHttp({
        port: mcp.port,
        host: this.options.host,
        token: () => this.store.settings.mcp.token,
        createServer: () => buildMcpServer(this.actions, this.options.version ?? '0.0.0'),
        onerror: (error) => console.error('[mcp]', error.message)
      })
      this.state = 'running'
    } catch (err) {
      this.state = 'error'
      this.error = listenError(err, mcp.port)
    }
    this.emit()
  }

  private async doStop(): Promise<void> {
    const server = this.server
    this.server = null
    this.actions.cancelAll()
    if (server) await server.close()
    this.state = 'stopped'
    this.error = null
    this.emit()
  }

  private serialize(task: () => Promise<void>): Promise<McpSnapshot> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => {})
    return run.then(() => this.snapshot())
  }

  private log(item: ToolItem): void {
    const log = this.store.mcpLog
    const index = log.findIndex((existing) => existing.id === item.id)
    if (index === -1) log.unshift(item)
    else log[index] = item
    if (log.length > MAX_LOG_ITEMS) log.length = MAX_LOG_ITEMS
    this.store.saveMcpLog()
    this.emit()
  }

  private emit(): void {
    this.events.updated(this.snapshot())
  }
}

function newToken(): string {
  return randomBytes(24).toString('base64url')
}

function listenError(err: unknown, port: number): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'EADDRINUSE') return `Порт ${port} уже занят другой программой. Укажите другой.`
  if (code === 'EACCES') return `Нет прав открыть порт ${port}. Укажите другой.`
  return `Не удалось запустить сервер: ${err instanceof Error ? err.message : String(err)}`
}
