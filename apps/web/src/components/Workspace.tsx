import { useCallback, useEffect, useRef, useState } from 'react'
import { listSessions } from '../api'
import type { SessionSummary } from '../types'
import Chat from './Chat'

export default function Workspace({ userEmail }: { userEmail: string }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [resetToken, setResetToken] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const railRef = useRef<HTMLElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const visibleSessions = sessions.filter((s) => !isNoiseSession(s))
  const hiddenCount = sessions.length - visibleSessions.length

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
    // 打开面板时重新拉取：新会话创建瞬间标题多半还没生成，不刷新会长期显示"未命名会话"
    refresh()

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
  }, [historyOpen, refresh])

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
            setResetToken((v) => v + 1)
            setHistoryOpen(false)
          }}
        >
          <span className="rail-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              <path d="M12 9v6" />
              <path d="M9 12h6" />
            </svg>
          </span>
          新会话
        </button>
        <button
          className={`rail-btn ${historyOpen ? 'active' : ''}`}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <span className="rail-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.5 2" />
            </svg>
          </span>
          历史
        </button>
      </nav>

      {historyOpen && (
        <div className="history-panel" ref={historyRef}>
          <div className="history-head">
            <div className="history-title">历史会话</div>
            <button className="history-close" aria-label="关闭历史" onClick={() => setHistoryOpen(false)}>
              ×
            </button>
          </div>
          <div className="session-list">
            {visibleSessions.length === 0 && <div className="muted">暂无会话</div>}
            {visibleSessions.map((s) => (
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
            {hiddenCount > 0 && <div className="history-muted">已隐藏 {hiddenCount} 个空白测试会话</div>}
          </div>
        </div>
      )}

      <Chat
        key={resetToken}
        sessionId={activeId}
        resetToken={resetToken}
        onSessionCreated={(id) => {
          setActiveId(id)
          refresh()
        }}
      />
    </div>
  )
}

function isNoiseSession(session: SessionSummary): boolean {
  const title = (session.title ?? '').trim()
  if (session.quotaSpent > 0) return false
  return title.length <= 2
}
