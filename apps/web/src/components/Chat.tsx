import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { getSessionMessages, streamChat } from '../api'
import type { AgentEvent, ChatMessage, ToolDisplay } from '../types'
import MessageView from './MessageView'
import ToolCard from './ToolCard'

const STARTER_CARDS = [
  {
    title: 'AI 搜索',
    desc: '用自然语言描述目标达人，自动拆解条件并生成候选名单。',
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    prompt: '帮我在 TikTok 上找一批适合美妆护肤投放的达人，粉丝量 1w-50w',
  },
  {
    title: '相似达人搜索',
    desc: '输入一个种子账号，扩展出风格和受众相近的达人。',
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
    title: '受众分析',
    desc: '查看达人受众地区、年龄、性别和假粉风险。',
    icon: (
      <>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <rect x="7" y="11" width="3" height="5" rx="1" />
        <rect x="12" y="8" width="3" height="8" rx="1" />
        <rect x="17" y="4" width="3" height="12" rx="1" />
      </>
    ),
    prompt: '帮我分析这个达人的受众画像和假粉风险：',
  },
  {
    title: '投放追踪',
    desc: '追踪发布内容、评论反馈和投放效果。',
    icon: (
      <>
        <path d="M4 19V5" />
        <path d="m4 15 5-5 4 4 7-8" />
        <path d="M15 6h5v5" />
      </>
    ),
    prompt: '帮我追踪这次 KOL 投放的发布内容、评论反馈和效果数据',
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
  const [busyCount, setBusyCount] = useState(0)
  const busy = busyCount > 0
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [cost, setCost] = useState<{ spent: number; cap: number; accountRemaining?: number } | null>(null)
  const [showJump, setShowJump] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const currentSession = useRef<string | null>(sessionId)
  const justCreatedSession = useRef<string | null>(null)
  /** 运行中的所有流（支持同会话排队：可以有多条在途） */
  const controllersRef = useRef<Set<AbortController>>(new Set())
  const nextTurnId = useRef(1)
  const turnStartedAt = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const latestKolDisplay = findLatestDisplay(messages, 'kol-list')
  const [canDockResults, setCanDockResults] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1180))
  const [resultSidebarWidth, setResultSidebarWidth] = useState(720)
  const [resultSidebarCollapsed, setResultSidebarCollapsed] = useState(false)
  const dockedKolDisplay = canDockResults ? latestKolDisplay : null

  useEffect(() => {
    const updateCanDock = () => setCanDockResults(window.innerWidth >= 1180)
    updateCanDock()
    window.addEventListener('resize', updateCanDock)
    return () => window.removeEventListener('resize', updateCanDock)
  }, [])

  useEffect(() => {
    if (dockedKolDisplay) setResultSidebarCollapsed(false)
  }, [dockedKolDisplay])

  useEffect(() => {
    currentSession.current = sessionId
    if (justCreatedSession.current === sessionId) {
      // 流式中新建的会话：流本身属于该会话，不中止
      justCreatedSession.current = null
      return
    }

    // 切换会话（含新建空会话）时中止在途的旧流，避免旧会话的事件写入当前会话
    controllersRef.current.forEach((c) => c.abort())
    controllersRef.current.clear()

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

  useEffect(
    () => () => {
      controllersRef.current.forEach((c) => c.abort())
      controllersRef.current.clear()
    },
    [],
  )

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

  const stop = () => {
    controllersRef.current.forEach((c) => c.abort())
    controllersRef.current.clear()
  }

  const startResultResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resultSidebarCollapsed) return
    event.preventDefault()
    const minWidth = 620
    const maxWidth = Math.min(980, Math.max(minWidth, window.innerWidth - 420))
    const resize = (moveEvent: PointerEvent) => {
      const nextWidth = window.innerWidth - moveEvent.clientX
      setResultSidebarWidth(Math.min(maxWidth, Math.max(minWidth, nextWidth)))
    }
    const stopResize = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResize)
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stopResize, { once: true })
  }

  /** 重发最后一条用户消息（出错后的重试入口） */
  const retryLast = () => {
    if (busy) return
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUser) send(lastUser.text)
  }

  const send = async (overrideText?: string) => {
    const message = (overrideText ?? input).trim()
    if (!message) return
    // 首轮还没拿到 sessionId 时不能并发发送：第二条会误建一个新会话
    if (busy && !currentSession.current) return
    if (overrideText == null) {
      setInput('')
      requestAnimationFrame(autosize)
    }
    const turnId = nextTurnId.current++
    const startedAt = Date.now()
    setBusyCount((c) => c + 1)
    setElapsedSeconds(0)
    turnStartedAt.current = startedAt
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: message, activities: [], confirmations: [], turnId },
      { role: 'assistant', text: '', activities: [], confirmations: [], turnId },
    ])

    const controller = new AbortController()
    controllersRef.current.add(controller)

    // 并发排队时可能有多条在途流，按 turnId 定位本回合的 assistant 消息
    const updateLast = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) =>
        prev.map((m) => (m.turnId === turnId && m.role === 'assistant' ? fn(m) : m)),
      )

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
        case 'queued':
          updateLast((m) => ({ ...m, queued: true }))
          break
        case 'text-delta':
          updateLast((m) => ({ ...m, queued: false, text: m.text + event.delta }))
          break
        case 'tool-start':
          updateLast((m) => ({
            ...m,
            queued: false,
            activities: [
              ...m.activities,
              { toolName: event.toolName, status: 'running', estimatedQuota: event.estimatedQuota },
            ],
          }))
          break
        case 'tool-progress':
          updateLast((m) => {
            const activities = [...m.activities]
            for (let i = activities.length - 1; i >= 0; i--) {
              if (activities[i].toolName === event.toolName && activities[i].status === 'running') {
                activities[i] = {
                  ...activities[i],
                  progress: { message: event.message, elapsedMs: event.elapsedMs },
                }
                break
              }
            }
            return { ...m, activities }
          })
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
      controllersRef.current.delete(controller)
      if (!controller.signal.aborted) {
        const processedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000))
        updateLast((m) => ({ ...m, processedSeconds }))
      }
      setBusyCount((c) => {
        const next = c - 1
        if (next === 0) turnStartedAt.current = null
        return next
      })
      // 新会话首轮结束后标题才生成，通知侧栏刷新
      onTurnDone?.()
    }
  }

  useEffect(() => {
    const onIntentSearch = (event: Event) => {
      const message = event instanceof CustomEvent ? event.detail : ''
      if (typeof message === 'string' && message.trim()) {
        void send(message)
      }
    }
    window.addEventListener('ek-assistant:intent-search', onIntentSearch)
    return () => window.removeEventListener('ek-assistant:intent-search', onIntentSearch)
  })

  const resultLayoutStyle = dockedKolDisplay
    ? ({ '--results-width': `${resultSidebarWidth}px` } as CSSProperties)
    : undefined

  return (
    <main
      className={`chat ${messages.length === 0 ? 'empty' : ''} ${dockedKolDisplay ? 'has-results' : ''}`}
      style={resultLayoutStyle}
    >
      <section className="chat-thread">
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
              <div className="hero-brand">
                <img className="hero-logo" src="/ek-icon.png" alt="" />
                <h1 className="hero-title">EasyKOL</h1>
              </div>
              <p className="hero-greeting">从发现达人、评估受众到建联追踪，覆盖 KOL 投放关键流程。</p>
            </div>
          )}
          {messages.map((m, i) => (
            <MessageView
              key={i}
              message={m}
              active={busy && i === messages.length - 1 && m.role === 'assistant'}
              elapsedSeconds={elapsedSeconds}
              onRetry={!busy && i === messages.length - 1 ? retryLast : undefined}
              dockedKinds={dockedKolDisplay ? ['kol-list'] : []}
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
              placeholder="描述你想找的达人..."
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
              <div className="composer-btns">
                {busy && (
                  <button className="send-btn stop" onClick={stop} aria-label="停止生成" title="停止生成">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <rect x="7" y="7" width="10" height="10" rx="1.5" />
                    </svg>
                  </button>
                )}
                <button
                  className="send-btn"
                  onClick={() => send()}
                  disabled={!input.trim() || (busy && !currentSession.current)}
                  aria-label={busy ? '发送（排队执行）' : '发送'}
                  title={busy ? '发送（排队执行）' : '发送'}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                </button>
              </div>
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
      </section>
      {dockedKolDisplay && (
        <aside className={`results-pane ${resultSidebarCollapsed ? 'is-collapsed' : ''}`} aria-label="搜索结果">
          <div
            className="results-resize-handle"
            role="separator"
            aria-label="调整结果栏宽度"
            aria-orientation="vertical"
            onPointerDown={startResultResize}
          >
            <button
              className="results-collapse-btn"
              type="button"
              aria-label={resultSidebarCollapsed ? '展开结果栏' : '收起结果栏'}
              title={resultSidebarCollapsed ? '展开结果栏' : '收起结果栏'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setResultSidebarCollapsed((value) => !value)}
            />
          </div>
          <div className="results-pane-content" aria-hidden={resultSidebarCollapsed}>
            <ToolCard display={dockedKolDisplay} />
          </div>
        </aside>
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

function findLatestDisplay(messages: ChatMessage[], kind: string): ToolDisplay | null {
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const activities = messages[mi].activities
    for (let ai = activities.length - 1; ai >= 0; ai--) {
      const display = activities[ai].display
      if (display?.kind === kind) return display
    }
  }
  return null
}
