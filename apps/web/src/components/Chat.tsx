import { useEffect, useRef, useState } from 'react'
import { getSessionMessages, streamChat } from '../api'
import type { AgentEvent, ChatMessage } from '../types'
import MessageView from './MessageView'

const STARTER_CARDS = [
  {
    title: '搜索达人',
    desc: '按平台、地区、粉丝量和内容风格筛选候选人。',
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    prompt: '帮我在 TikTok 上找 10 个美妆类达人，粉丝量 1w-50w',
  },
  {
    title: '相似达人',
    desc: '输入种子账号，继续扩展同类达人池。',
    icon: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
        <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
        <path d="M18.5 14.4c1.9.9 3 2.6 3 5.6" />
      </>
    ),
    prompt: '帮我找和这个达人相似的账号：',
  },
  {
    title: '邮件外联',
    desc: '基于名单、模板和发送节奏生成外联计划。',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m3.5 7 8.5 6 8.5-6" />
      </>
    ),
    prompt: '帮我给收藏的达人发合作邀约邮件',
  },
  {
    title: '不知道从哪开始？',
    desc: '从目标、市场和执行步骤开始拆解任务。',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </>
    ),
    prompt: '我是第一次做 KOL 投放，请一步步引导我',
  },
]

export default function Chat({
  sessionId,
  resetToken,
  onSessionCreated,
  onTurnDone,
}: {
  sessionId: string | null
  resetToken: number
  onSessionCreated: (id: string) => void
  onTurnDone?: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [cost, setCost] = useState<{ spent: number; cap: number; accountRemaining?: number } | null>(null)
  const [showJump, setShowJump] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const currentSession = useRef<string | null>(sessionId)
  const justCreatedSession = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const turnStartedAt = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    currentSession.current = sessionId
    if (justCreatedSession.current === sessionId) {
      // 流式中新建的会话：流本身属于该会话，不中止
      justCreatedSession.current = null
      return
    }

    // 切换会话（含新建空会话）时中止在途的旧流，避免旧会话的事件写入当前会话
    abortRef.current?.abort()

    if (!sessionId) {
      setMessages([])
      setCost(null)
      return
    }

    let cancelled = false
    getSessionMessages(sessionId)
      .then(({ session, messages, pendingActions }) => {
        if (cancelled) return
        setCost({ spent: session.quotaSpent, cap: 0 })
        const restored: ChatMessage[] = messages
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
          .filter((m) => m.text || m.activities.length)
        // 重建未决的高风险操作确认卡片（挂在最后一条 assistant 消息上）
        if (pendingActions?.length) {
          const confirmations = pendingActions.map((action) => ({
            action,
            status: 'pending' as const,
          }))
          const last = restored[restored.length - 1]
          if (last?.role === 'assistant') {
            last.confirmations = confirmations
          } else {
            restored.push({ role: 'assistant', text: '', activities: [], confirmations })
          }
        }
        setMessages(restored)
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([
            {
              role: 'assistant',
              text: '',
              activities: [],
              confirmations: [],
              error: '加载会话历史失败，请刷新页面重试',
            },
          ])
        }
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, resetToken])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    // 用户已明显上滑（距底 >240px，与"回到底部"按钮同一阈值）时不强行拽回，
    // 否则流式输出期间无法上滑阅读
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 240) return
    bottomRef.current?.scrollIntoView({ behavior: busy ? 'auto' : 'smooth' })
  }, [busy, messages])

  useEffect(() => {
    if (!busy || !turnStartedAt.current) return
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - turnStartedAt.current!) / 1000))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  const pickStarter = (prompt: string) => {
    setInput(prompt)
    inputRef.current?.focus()
  }

  const autosize = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const stop = () => abortRef.current?.abort()

  /** 重发最后一条用户消息（出错后的重试入口） */
  const retryLast = () => {
    if (busy) return
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUser) send(lastUser.text)
  }

  const send = async (overrideText?: string) => {
    const message = (overrideText ?? input).trim()
    if (!message || busy) return
    if (overrideText == null) {
      setInput('')
      requestAnimationFrame(autosize)
    }
    setBusy(true)
    setElapsedSeconds(0)
    turnStartedAt.current = Date.now()
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: message, activities: [], confirmations: [] },
      { role: 'assistant', text: '', activities: [], confirmations: [] },
    ])

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const updateLast = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (!last) return prev
        const next = [...prev]
        next[next.length - 1] = fn(last)
        return next
      })

    const onEvent = (event: AgentEvent) => {
      // 流已被中止（切换了会话）：丢弃残余事件，避免写入其它会话
      if (controller.signal.aborted) return
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
          setCost({ spent: event.spent, cap: event.cap, accountRemaining: event.accountRemaining })
          break
        case 'error':
          updateLast((m) => ({ ...m, error: event.message }))
          break
        case 'done':
          break
      }
    }

    try {
      await streamChat(message, currentSession.current, onEvent, controller.signal)
    } catch (err) {
      if (!controller.signal.aborted) {
        updateLast((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }))
        // 断流后服务端可能已生成确认卡片但事件丢失（send_outreach_batch 等会永远等不到批准），
        // 拉一次会话快照把漏掉的待确认操作补挂上
        const sid = currentSession.current
        if (sid) {
          getSessionMessages(sid)
            .then(({ pendingActions }) => {
              if (currentSession.current !== sid || !pendingActions?.length) return
              updateLast((m) => {
                const known = new Set(m.confirmations.map((c) => c.action.id))
                const missed = pendingActions
                  .filter((a) => !known.has(a.id))
                  .map((action) => ({ action, status: 'pending' as const }))
                return missed.length ? { ...m, confirmations: [...m.confirmations, ...missed] } : m
              })
            })
            .catch(() => {})
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        const processedSeconds = turnStartedAt.current
          ? Math.max(1, Math.floor((Date.now() - turnStartedAt.current) / 1000))
          : undefined
        updateLast((m) => ({ ...m, processedSeconds }))
      }
      turnStartedAt.current = null
      setBusy(false)
      // 新会话首轮结束后标题才生成，通知侧栏刷新
      onTurnDone?.()
    }
  }

  return (
    <main className={`chat ${messages.length === 0 ? 'empty' : ''}`}>
      <div
        className="message-list"
        ref={listRef}
        onScroll={() => {
          const el = listRef.current
          if (!el) return
          setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 240)
        }}
      >
        {messages.length === 0 && (
          <div className="hero">
            <img className="hero-logo" src="/ek-icon.png" alt="" />
            <h1 className="hero-title">达人营销工作台</h1>
            <p className="hero-greeting">把搜索、收藏、邮件外联和投放追踪串成一条工作流。</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView
            key={i}
            message={m}
            active={busy && i === messages.length - 1 && m.role === 'assistant'}
            elapsedSeconds={elapsedSeconds}
            onRetry={!busy && i === messages.length - 1 ? retryLast : undefined}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      {showJump && (
        <button
          className="jump-bottom"
          aria-label="回到底部"
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
          </svg>
        </button>
      )}
      <div className="composer-wrap">
        <div className="composer-pill">
          <textarea
            ref={inputRef}
            value={input}
            placeholder="描述你的需求，Enter 发送，Shift+Enter 换行"
            onChange={(e) => {
              setInput(e.target.value)
              autosize()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (e.nativeEvent.isComposing) return
                e.preventDefault()
                send()
              }
            }}
            rows={1}
          />
          <div className="composer-bar">
            <div className="composer-meta">
              {cost && (cost.cap > 0 || cost.spent > 0) && (
                <span className="quota-group" aria-label="配额信息">
                  <span className="quota-pill">本会话已用 {cost.spent}</span>
                  {cost.accountRemaining != null && (
                    <span className="quota-pill">账户剩余 {cost.accountRemaining}</span>
                  )}
                </span>
              )}
              {busy && <span className="busy-hint">思考中 · {elapsedSeconds}s</span>}
            </div>
            {busy ? (
              <button className="send-btn stop" onClick={stop} aria-label="停止生成" title="停止生成">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                </svg>
              </button>
            ) : (
              <button className="send-btn" onClick={() => send()} disabled={!input.trim()} aria-label="发送" title="发送">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      {messages.length === 0 && (
        <div className="starter-wrap">
          <div className="hero-cards">
            {STARTER_CARDS.map((c) => (
              <button key={c.title} className="hero-card" onClick={() => pickStarter(c.prompt)}>
                <span className="hero-card-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {c.icon}
                  </svg>
                </span>
                <span className="hero-card-text">
                  <span className="hero-card-title">{c.title}</span>
                  <span className="hero-card-desc">{c.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
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
