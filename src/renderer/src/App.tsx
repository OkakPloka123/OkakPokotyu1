import { useCallback, useEffect, useState } from 'react'
import type { Chat, ChatSummary, ProviderInfo, Settings } from '../../shared/types'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { errorText } from './lib/format'

function summarize(chat: Chat, running: boolean): ChatSummary {
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, running }
}

function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [active, setActive] = useState<Chat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const report = useCallback((err: unknown) => setError(errorText(err)), [])

  useEffect(() => {
    Promise.all([window.api.getSettings(), window.api.listProviders(), window.api.listChats()])
      .then(([loadedSettings, loadedProviders, loadedChats]) => {
        setSettings(loadedSettings)
        setProviders(loadedProviders)
        setChats(loadedChats)
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
    return () => {
      offChat()
      offRun()
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

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={() => void createChat().catch(report)}
        onDelete={(chatId) => void deleteChat(chatId).catch(report)}
      />
      <main className="main">
        <TopBar
          workspace={workspace}
          providers={providers}
          providerId={settings?.providerId ?? ''}
          onPickWorkspace={() => void window.api.pickWorkspace().then(setSettings).catch(report)}
          onProviderChange={(id) => void window.api.setProvider(id).then(setSettings).catch(report)}
        />
        <ChatView
          chat={chat}
          running={running}
          workspace={workspace}
          onRespond={(itemId, approved) => {
            if (chat) void window.api.respond(chat.id, itemId, approved).catch(report)
          }}
          onSuggestion={(text) => void send(text)}
        />
        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} title="Закрыть">
              ×
            </button>
          </div>
        )}
        <Composer
          disabled={!workspace}
          running={running}
          onSend={(text) => void send(text)}
          onStop={() => {
            if (chat) void window.api.stop(chat.id).catch(report)
          }}
        />
      </main>
    </div>
  )
}

export default App
