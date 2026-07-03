import { useEffect, useRef, useState } from 'react'
import { getSessionMessages, streamChat } from '../api'
import type { AgentEvent, ChatMessage } from '../types'
import MessageView from './MessageView'

const STARTER_CARDS = [
  {
    className: 'hero-card big yellow',
    title: '搜索达人',
    desc: '自然语言描述，精准匹配',
    emoji: '🎯',
    prompt: '帮我在 TikTok 上找 10 个美妆类达人，粉丝量 1w-50w',
  },
  {
    className: 'hero-card blue',
    title: '相似达人',
    desc: '给一个账号，挖同类',
    emoji: '👥',
    prompt: '帮我找和这个达人相似的账号：',
  },
  {
    className: 'hero-card purple',
    title: '邮件外联',
    desc: '批量触达谈合作',
    emoji: '📮',
    prompt: '帮我给收藏的达人发合作邀约邮件',
  },
  {
    className: 'hero-card white',
    title: '不知道从哪开始？',
    desc: '让 AI 一步步引导你',
    emoji: '❓',
    prompt: '我是第一次做 KOL 投放，请一步步引导我',
  },
]

export default function Chat({
  sessionId,
  onSessionCreated,
}: {
  sessionId: string | null
  onSessionCreated: (id: string) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cost, setCost] = useState<{ spent: number; cap: number } | null>(null)
  const currentSession = useRef<string | null>(sessionId)
  const justCreatedSession = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    currentSession.current = sessionId
    if (!sessionId) {
      setMessages([])
      setCost(null)
      return
    }

    if (justCreatedSession.current === sessionId) {
      justCreatedSession.current = null
      return
    }

    let cancelled = false
    getSessionMessages(sessionId)
      .then(({ session, messages }) => {
        if (cancelled) return
        setCost({ spent: session.quotaSpent, cap: 0 })
        setMessages(
          messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              text: contentToText(m.content),
              activities: (m.display ?? []).map((d) => ({
                toolName: d.kind,
                status: 'done' as const,
                display: d,
              })),
              confirmations: [],
            }))
            .filter((m) => m.text || m.activities.length),
        )
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: busy ? 'auto' : 'smooth' })
  }, [busy, messages])

  const pickStarter = (prompt: string) => {
    setInput(prompt)
    inputRef.current?.focus()
  }

  const send = async () => {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    setBusy(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: message, activities: [], confirmations: [] },
      { role: 'assistant', text: '', activities: [], confirmations: [] },
    ])

    const updateLast = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = fn(next[next.length - 1])
        return next
      })

    const onEvent = (event: AgentEvent) => {
      switch (event.type) {
        case 'session':
          if (!currentSession.current) {
            currentSession.current = event.sessionId
            justCreatedSession.current = event.sessionId
            onSessionCreated(event.sessionId)
          }
          break
        case 'text-delta':
          updateLast((m) => ({ ...m, text: m.text + event.delta }))
          break
        case 'tool-start':
          updateLast((m) => ({
            ...m,
            activities: [
              ...m.activities,
              { toolName: event.toolName, status: 'running', estimatedQuota: event.estimatedQuota },
            ],
          }))
          break
        case 'tool-result':
          updateLast((m) => {
            const activities = [...m.activities]
            for (let i = activities.length - 1; i >= 0; i--) {
              if (activities[i].toolName === event.toolName && activities[i].status === 'running') {
                activities[i] = { ...activities[i], status: 'done', display: event.display }
                break
              }
            }
            return { ...m, activities }
          })
          break
        case 'confirmation-required':
          updateLast((m) => ({
            ...m,
            confirmations: [...m.confirmations, { action: event.action, status: 'pending' }],
          }))
          break
        case 'cost':
          setCost({ spent: event.spent, cap: event.cap })
          break
        case 'error':
          updateLast((m) => ({ ...m, error: event.message }))
          break
        case 'done':
          break
      }
    }

    try {
      await streamChat(message, currentSession.current, onEvent)
    } catch (err) {
      updateLast((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="chat">
      <div className="message-list">
        {messages.length === 0 && (
          <div className="hero">
            <h1 className="hero-title">开启你的达人营销 🚀</h1>
            <p className="hero-greeting">
              👋 嗨！我是你的 KOL 营销助手，找达人、发外联、盯数据都可以交给我。
              <br />
              从下面选一个服务开始，或直接在下方描述你的需求！
            </p>
            <div className="hero-cards">
              {STARTER_CARDS.map((c) => (
                <button key={c.title} className={c.className} onClick={() => pickStarter(c.prompt)}>
                  <div className="hero-card-title">{c.title}</div>
                  <div className="hero-card-desc">{c.desc}</div>
                  <div className="hero-card-emoji">{c.emoji}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView key={i} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="composer-wrap">
        <div className="composer-pill">
          <textarea
            ref={inputRef}
            value={input}
            placeholder="描述你的需求"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (e.nativeEvent.isComposing) return
                e.preventDefault()
                send()
              }
            }}
            rows={2}
          />
          <div className="composer-bar">
            <div className="composer-meta">
              <span className="composer-hint">Enter 发送，Shift+Enter 换行</span>
              {cost && cost.cap > 0 && (
                <span className="quota-hint">
                  本会话配额消耗 {cost.spent} / {cost.cap}
                </span>
              )}
              {busy && <span className="busy-hint">思考中...</span>}
            </div>
            <button className="send-btn" onClick={send} disabled={busy || !input.trim()} aria-label={busy ? '思考中' : '发送'}>
              {busy ? <span className="send-spinner" /> : '→'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

/** 把持久化的 ModelMessage content 还原为纯文本 */
function contentToText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === 'text')
      .map((p) => p.text)
      .join('')
  }
  return ''
}
