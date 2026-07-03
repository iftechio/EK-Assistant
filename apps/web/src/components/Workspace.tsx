import { useCallback, useEffect, useRef, useState } from 'react'
import { listSessions } from '../api'
import type { SessionSummary } from '../types'
import Chat from './Chat'

export default function Workspace({ userEmail }: { userEmail: string }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const railRef = useRef<HTMLElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch (e) {
      // 会话过期时挂载中的请求会抛"未登录"，App 随后会收到 SIGNED_OUT 切回登录页
      console.warn('加载会话列表失败:', e)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!historyOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (historyRef.current?.contains(target) || railRef.current?.contains(target)) return
      setHistoryOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [historyOpen])

  return (
    <div className="workspace">
      <header className="topbar">
        <span className="user-chip" title={userEmail}>
          {userEmail}
        </span>
      </header>

      <nav className="rail" ref={railRef}>
        <img className="rail-logo" src="/ek-icon.png" alt="EasyKOL" />
        <div className="rail-divider" />
        <button
          className="rail-btn"
          onClick={() => {
            setActiveId(null)
            setHistoryOpen(false)
          }}
        >
          <span className="rail-icon">＋</span>
          新会话
        </button>
        <button
          className={`rail-btn ${historyOpen ? 'active' : ''}`}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <span className="rail-icon">🕘</span>
          历史
        </button>
      </nav>

      {historyOpen && (
        <div className="history-panel" ref={historyRef}>
          <div className="history-title">历史会话</div>
          <div className="session-list">
            {sessions.length === 0 && <div className="muted">暂无会话</div>}
            {sessions.map((s) => (
              <button
                key={s.id}
                className={`session-item ${s.id === activeId ? 'active' : ''}`}
                onClick={() => {
                  setActiveId(s.id)
                  setHistoryOpen(false)
                }}
              >
                <div className="session-title">{s.title ?? '未命名会话'}</div>
                <div className="session-meta">配额 {s.quotaSpent}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <Chat
        sessionId={activeId}
        onSessionCreated={(id) => {
          setActiveId(id)
          refresh()
        }}
      />
    </div>
  )
}
