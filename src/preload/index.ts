import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppApi, Chat, McpSnapshot, RunState } from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: AppApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  pickWorkspace: () => ipcRenderer.invoke('settings:pickWorkspace'),
  setProvider: (providerId) => ipcRenderer.invoke('settings:setProvider', providerId),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  listChats: () => ipcRenderer.invoke('chats:list'),
  getChat: (chatId) => ipcRenderer.invoke('chats:get', chatId),
  createChat: () => ipcRenderer.invoke('chats:create'),
  deleteChat: (chatId) => ipcRenderer.invoke('chats:delete', chatId),
  sendMessage: (chatId, text) => ipcRenderer.invoke('chats:send', chatId, text),
  stop: (chatId) => ipcRenderer.invoke('chats:stop', chatId),
  respond: (chatId, itemId, approved) =>
    ipcRenderer.invoke('chats:respond', chatId, itemId, approved),
  onChatUpdated: (listener) => subscribe<Chat>('chat:updated', listener),
  onRunState: (listener) => subscribe<RunState>('run:state', listener),

  getMcp: () => ipcRenderer.invoke('mcp:get'),
  setMcpEnabled: (enabled) => ipcRenderer.invoke('mcp:setEnabled', enabled),
  setMcpPort: (port) => ipcRenderer.invoke('mcp:setPort', port),
  regenerateMcpToken: () => ipcRenderer.invoke('mcp:regenerateToken'),
  clearMcpLog: () => ipcRenderer.invoke('mcp:clearLog'),
  respondMcp: (itemId, approved) => ipcRenderer.invoke('mcp:respond', itemId, approved),
  stopMcpJob: (jobId) => ipcRenderer.invoke('mcp:stopJob', jobId),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  onMcpUpdated: (listener) => subscribe<McpSnapshot>('mcp:updated', listener),
  onMcpFocus: (listener) => subscribe<void>('mcp:focus', () => listener())
}

contextBridge.exposeInMainWorld('api', api)
