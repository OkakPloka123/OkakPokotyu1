import { clipboard, dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { providers } from './agent/providers'
import type { ChatService } from './chats'
import type { McpService } from './mcp/service'
import type { Store } from './store'

interface IpcDeps {
  chats: ChatService
  mcp: McpService
  store: Store
  getWindow(): BrowserWindow | null
}

export function registerIpc({ chats, mcp, store, getWindow }: IpcDeps): void {
  ipcMain.handle('settings:get', () => store.settings)

  ipcMain.handle('settings:pickWorkspace', async () => {
    const options: OpenDialogOptions = {
      title: 'Рабочая папка агента',
      properties: ['openDirectory', 'createDirectory']
    }
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (!result.canceled && result.filePaths[0]) {
      store.settings.workspace = result.filePaths[0]
      store.saveSettings()
    }
    return store.settings
  })

  ipcMain.handle('settings:setProvider', (_event, providerId: unknown) => {
    const id = asString(providerId)
    if (providers.some((provider) => provider.info.id === id)) {
      store.settings.providerId = id
      store.saveSettings()
    }
    return store.settings
  })

  ipcMain.handle('providers:list', () => providers.map((provider) => provider.info))
  ipcMain.handle('chats:list', () => chats.list())
  ipcMain.handle('chats:get', (_event, chatId: unknown) => chats.get(asString(chatId)))
  ipcMain.handle('chats:create', () => chats.create())
  ipcMain.handle('chats:delete', (_event, chatId: unknown) => chats.delete(asString(chatId)))
  ipcMain.handle('chats:send', (_event, chatId: unknown, text: unknown) =>
    chats.send(asString(chatId), asString(text))
  )
  ipcMain.handle('chats:stop', (_event, chatId: unknown) => chats.stop(asString(chatId)))
  ipcMain.handle('chats:respond', (_event, chatId: unknown, itemId: unknown, approved: unknown) =>
    chats.respond(asString(chatId), asString(itemId), approved === true)
  )

  ipcMain.handle('mcp:get', () => mcp.snapshot())
  ipcMain.handle('mcp:setEnabled', (_event, enabled: unknown) => mcp.setEnabled(enabled === true))
  ipcMain.handle('mcp:setPort', (_event, port: unknown) => mcp.setPort(Number(port)))
  ipcMain.handle('mcp:regenerateToken', () => mcp.regenerateToken())
  ipcMain.handle('mcp:clearLog', () => mcp.clearLog())
  ipcMain.handle('mcp:respond', (_event, itemId: unknown, approved: unknown) =>
    mcp.respond(asString(itemId), approved === true)
  )
  ipcMain.handle('mcp:stopJob', (_event, jobId: unknown) => mcp.stopJob(asString(jobId)))
  ipcMain.handle('clipboard:write', (_event, text: unknown) => clipboard.writeText(asString(text)))
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Ожидалась строка')
  return value
}
