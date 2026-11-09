export type ToolName = 'list_dir' | 'read_file' | 'write_file' | 'run_command'

export interface ToolCall {
  name: ToolName
  args: Record<string, string>
}

export type ToolStatus = 'pending' | 'running' | 'done' | 'error' | 'rejected' | 'blocked'

interface BaseItem {
  id: string
  at: number
}

export interface UserItem extends BaseItem {
  kind: 'user'
  text: string
}

export interface AssistantItem extends BaseItem {
  kind: 'assistant'
  text: string
}

export interface ToolItem extends BaseItem {
  kind: 'tool'
  call: ToolCall
  status: ToolStatus
  output?: string
  /** Set for a background command started over MCP, so the user can stop it. */
  jobId?: string
}

export interface NoticeItem extends BaseItem {
  kind: 'notice'
  level: 'info' | 'error'
  text: string
}

export type ChatItem = UserItem | AssistantItem | ToolItem | NoticeItem

export interface Chat {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  items: ChatItem[]
}

export interface ChatSummary {
  id: string
  title: string
  updatedAt: number
  running: boolean
}

export interface McpSettings {
  enabled: boolean
  port: number
  token: string
}

export interface Settings {
  workspace: string | null
  providerId: string
  mcp: McpSettings
}

export type McpState = 'stopped' | 'starting' | 'running' | 'error'

export interface McpSnapshot {
  enabled: boolean
  state: McpState
  port: number
  url: string
  error: string | null
  token: string
  /** Actions requested by external agents, newest first. */
  items: ToolItem[]
}

export interface ProviderInfo {
  id: string
  name: string
  description: string
}

export interface RunState {
  chatId: string
  running: boolean
}

/** Bridge exposed to the renderer as `window.api`. */
export interface AppApi {
  getSettings(): Promise<Settings>
  pickWorkspace(): Promise<Settings>
  setProvider(providerId: string): Promise<Settings>
  listProviders(): Promise<ProviderInfo[]>
  listChats(): Promise<ChatSummary[]>
  getChat(chatId: string): Promise<Chat | null>
  createChat(): Promise<Chat>
  deleteChat(chatId: string): Promise<void>
  /** Resolves when the agent has finished working on the message. */
  sendMessage(chatId: string, text: string): Promise<void>
  stop(chatId: string): Promise<void>
  respond(chatId: string, itemId: string, approved: boolean): Promise<void>
  onChatUpdated(listener: (chat: Chat) => void): () => void
  onRunState(listener: (state: RunState) => void): () => void

  getMcp(): Promise<McpSnapshot>
  setMcpEnabled(enabled: boolean): Promise<McpSnapshot>
  setMcpPort(port: number): Promise<McpSnapshot>
  regenerateMcpToken(): Promise<McpSnapshot>
  clearMcpLog(): Promise<McpSnapshot>
  respondMcp(itemId: string, approved: boolean): Promise<void>
  stopMcpJob(jobId: string): Promise<void>
  copyText(text: string): Promise<void>
  onMcpUpdated(listener: (snapshot: McpSnapshot) => void): () => void
  /** Fired when the user clicks an approval notification. */
  onMcpFocus(listener: () => void): () => void
}
