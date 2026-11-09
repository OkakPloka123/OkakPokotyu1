import { dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { providers } from './agent/providers'
import type { ChatService } from './chats'
import type { Store } from './store'

export function registerIpc(
  chats: ChatService,
  store: Store,
  getWindow: () => BrowserWindow | null
): void {
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
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Ожидалась строка')
  return value
}
