import { useEffect, useRef, useState } from 'react'
import { getSessionMessages, streamChat } from '../api'
import type { AgentEvent, ChatMessage } from '../types'
import MessageView from './MessageView'

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
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sessionId) return
    getSessionMessages(sessionId)
      .then(({ session, messages }) => {
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
      .catch(() => setMessages([]))
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
      {cost && cost.cap > 0 && (
        <div className="cost-banner">
          本会话配额消耗：{cost.spent} / {cost.cap}
        </div>
      )}
      <div className="message-list">
        {messages.length === 0 && (
          <div className="empty-hint">
            <h2>我能帮你做什么？</h2>
            <ul>
              <li>“帮我在 YouTube 上找 10 个美妆类达人”</li>
              <li>“给筛出来的人发一封合作邀约邮件”（发送前会让你确认）</li>
              <li>“这几条视频发布之后帮我盯着数据”</li>
              <li>“这条合作视频的评论都在说什么？”</li>
              <li>“这条视频比他平时表现好还是差，为什么？”</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView key={i} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="composer">
        <textarea
          value={input}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={3}
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          {busy ? '思考中…' : '发送'}
        </button>
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
