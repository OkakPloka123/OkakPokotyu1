import { useCallback, useEffect, useState } from 'react'
import type { Chat, ChatSummary, McpSnapshot, ProviderInfo, Settings } from '../../shared/types'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { McpPanel } from './components/McpPanel'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { errorText } from './lib/format'

type View = 'chat' | 'mcp'

function summarize(chat: Chat, running: boolean): ChatSummary {
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, running }
}

function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [active, setActive] = useState<Chat | null>(null)
  const [view, setView] = useState<View>('chat')
  const [mcp, setMcp] = useState<McpSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const report = useCallback((err: unknown) => setError(errorText(err)), [])

  useEffect(() => {
    Promise.all([
      window.api.getSettings(),
      window.api.listProviders(),
      window.api.listChats(),
      window.api.getMcp()
    ])
      .then(([loadedSettings, loadedProviders, loadedChats, loadedMcp]) => {
        setSettings(loadedSettings)
        setProviders(loadedProviders)
        setChats(loadedChats)
        setMcp(loadedMcp)
        setActiveId((current) => current ?? loadedChats[0]?.id ?? null)
      })
      .catch(report)

    const offChat = window.api.onChatUpdated((chat) => {
      setActive((current) => (current?.id === chat.id ? chat : current))
      setChats((list) => {
        const running = list.find((item) => item.id === chat.id)?.running ?? false
        const rest = list.filter((item) => item.id !== chat.id)
        return [summarize(chat, running), ...rest].sort((a, b) => b.updatedAt - a.updatedAt)
      })
    })
    const offRun = window.api.onRunState(({ chatId, running }) => {
      setChats((list) => list.map((item) => (item.id === chatId ? { ...item, running } : item)))
    })
    const offMcp = window.api.onMcpUpdated(setMcp)
    const offFocus = window.api.onMcpFocus(() => setView('mcp'))
    return () => {
      offChat()
      offRun()
      offMcp()
      offFocus()
    }
  }, [report])

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    window.api
      .getChat(activeId)
      .then((chat) => {
        if (!cancelled) setActive(chat)
      })
      .catch(report)
    return () => {
      cancelled = true
    }
  }, [activeId, report])

  const chat = active && active.id === activeId ? active : null
  const running = chats.some((item) => item.id === chat?.id && item.running)
  const workspace = settings?.workspace ?? null
  const mcpPending = mcp?.items.filter((item) => item.status === 'pending').length ?? 0

  const createChat = async (): Promise<Chat> => {
    const created = await window.api.createChat()
    setChats((list) => [summarize(created, false), ...list])
    setActive(created)
    setActiveId(created.id)
    return created
  }

  const send = async (text: string): Promise<void> => {
    try {
      const target = chat ?? (await createChat())
      await window.api.sendMessage(target.id, text)
    } catch (err) {
      report(err)
    }
  }

  const deleteChat = async (chatId: string): Promise<void> => {
    await window.api.deleteChat(chatId)
    const list = await window.api.listChats()
    setChats(list)
    if (chatId === activeId) setActiveId(list[0]?.id ?? null)
  }

  const copy = (text: string): void => {
    window.api
      .copyText(text)
      .then(() => {
        setInfo('Скопировано')
        setTimeout(() => setInfo(null), 1500)
      })
      .catch(report)
  }

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        activeId={view === 'chat' ? activeId : null}
        mcpState={mcp?.state ?? null}
        mcpPending={mcpPending}
        mcpActive={view === 'mcp'}
        onSelect={(chatId) => {
          setActiveId(chatId)
          setView('chat')
        }}
        onCreate={() => void createChat().then(() => setView('chat'), report)}
        onDelete={(chatId) => void deleteChat(chatId).catch(report)}
        onOpenMcp={() => setView('mcp')}
      />
      <main className="main">
        <TopBar
          workspace={workspace}
          providers={providers}
          providerId={settings?.providerId ?? ''}
          showProvider={view === 'chat'}
          onPickWorkspace={() => void window.api.pickWorkspace().then(setSettings).catch(report)}
          onProviderChange={(id) => void window.api.setProvider(id).then(setSettings).catch(report)}
        />
        {view === 'mcp' ? (
          <McpPanel
            snapshot={mcp}
            workspace={workspace}
            onToggle={(enabled) => void window.api.setMcpEnabled(enabled).then(setMcp, report)}
            onPortChange={(port) => void window.api.setMcpPort(port).then(setMcp, report)}
            onRegenerateToken={() => void window.api.regenerateMcpToken().then(setMcp, report)}
            onClearLog={() => void window.api.clearMcpLog().then(setMcp, report)}
            onCopy={copy}
            onRespond={(itemId, approved) =>
              void window.api.respondMcp(itemId, approved).catch(report)
            }
            onStopJob={(jobId) => void window.api.stopMcpJob(jobId).catch(report)}
          />
        ) : (
          <>
            <ChatView
              chat={chat}
              running={running}
              workspace={workspace}
              onRespond={(itemId, approved) => {
                if (chat) void window.api.respond(chat.id, itemId, approved).catch(report)
              }}
              onSuggestion={(text) => void send(text)}
            />
            <Composer
              disabled={!workspace}
              running={running}
              onSend={(text) => void send(text)}
              onStop={() => {
                if (chat) void window.api.stop(chat.id).catch(report)
              }}
            />
          </>
        )}
        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} title="Закрыть">
              ×
            </button>
          </div>
        )}
        {info && !error && (
          <div className="toast toast-info" role="status">
            {info}
          </div>
        )}
      </main>
    </div>
  )
}

export default App
