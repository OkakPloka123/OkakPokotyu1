import { app, BrowserWindow, Notification, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { ToolItem } from '../shared/types'
import { getProvider } from './agent/providers'
import { ChatService } from './chats'
import { registerIpc } from './ipc'
import { McpService } from './mcp/service'
import { Store } from './store'

let mainWindow: BrowserWindow | null = null
// Kept referenced: a garbage-collected notification loses its click handler.
let notification: Notification | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'Desktop Agent',
    backgroundColor: '#0e1014',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('focus', () => win.flashFrame(false))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The UI never navigates; block anything that tries to (a dropped file, a stray link).
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** An external agent waits for approval: make sure the user notices even if the app is hidden. */
function notifyApproval(item: ToolItem): void {
  const win = mainWindow
  if (win?.isFocused()) return
  win?.flashFrame(true)
  if (!Notification.isSupported()) return
  const { name, args } = item.call
  const body =
    name === 'run_command'
      ? `Команда: ${args.command ?? ''}`
      : name === 'write_file'
        ? `Запись файла: ${args.path ?? ''}`
        : name
  notification = new Notification({ title: 'Агент просит разрешение', body })
  notification.on('click', () => {
    showMainWindow()
    mainWindow?.webContents.send('mcp:focus')
  })
  notification.show()
}

function start(): void {
  electronApp.setAppUserModelId('com.okakploka.desktopagent')
  // F12 opens DevTools in development; Ctrl+R reload is disabled in production.
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const store = new Store(app.getPath('userData'))
  const chats = new ChatService(store, getProvider, {
    chatUpdated: (chat) => mainWindow?.webContents.send('chat:updated', chat),
    runState: (state) => mainWindow?.webContents.send('run:state', state)
  })
  const mcp = new McpService(
    store,
    {
      updated: (snapshot) => mainWindow?.webContents.send('mcp:updated', snapshot),
      approvalRequested: notifyApproval
    },
    { version: app.getVersion() }
  )
  registerIpc({ chats, mcp, store, getWindow: () => mainWindow })
  createWindow()
  if (store.settings.mcp.enabled) void mcp.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // Commands run in their own process groups and would outlive the app otherwise.
  app.on('will-quit', () => {
    chats.stopAll()
    mcp.shutdown()
  })
}

// A second copy would fight the first one for the MCP port.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)
  void app.whenReady().then(start)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
