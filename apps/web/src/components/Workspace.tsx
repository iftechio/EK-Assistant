import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteSession, listSessions, renameSession } from '../api'
import type { SessionSummary } from '../types'
import Chat from './Chat'

export default function Workspace({
  userEmail,
  onLogout,
}: {
  userEmail: string
  onLogout: () => void
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [resetToken, setResetToken] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
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
      setEditingId(null)
      setConfirmDeleteId(null)
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

  const startNewChat = () => {
    setActiveId(null)
    setResetToken((v) => v + 1)
    setHistoryOpen(false)
  }

  const beginRename = (s: SessionSummary) => {
    setConfirmDeleteId(null)
    setEditingId(s.id)
    setEditingTitle(s.title ?? '')
  }

  const commitRename = async () => {
    const id = editingId
    const title = editingTitle.trim()
    setEditingId(null)
    if (!id || !title) return
    const prev = sessions
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, title } : s)))
    try {
      await renameSession(id, title)
    } catch {
      setSessions(prev)
    }
  }

  const removeSession = async (id: string) => {
    setConfirmDeleteId(null)
    const prev = sessions
    setSessions((list) => list.filter((s) => s.id !== id))
    if (id === activeId) startNewChat()
    try {
      await deleteSession(id)
    } catch {
      setSessions(prev)
    }
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <span className="user-chip" title={userEmail}>
          {userEmail}
        </span>
        <button className="topbar-btn" aria-label="退出登录" title="退出登录" onClick={onLogout}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m16 17 5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </header>

      <nav className="rail" ref={railRef}>
        <img className="rail-logo" src="/ek-icon.png" alt="EasyKOL" />
        <div className="rail-divider" />
        <button className="rail-btn" onClick={startNewChat}>
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
          <div className="session-list">
            {visibleSessions.length === 0 && <div className="muted">暂无会话</div>}
            {visibleSessions.map((s) =>
              editingId === s.id ? (
                <div key={s.id} className="session-item editing">
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                </div>
              ) : (
                <div
                  key={s.id}
                  className={`session-item ${s.id === activeId ? 'active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveId(s.id)
                    setHistoryOpen(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setActiveId(s.id)
                      setHistoryOpen(false)
                    }
                  }}
                >
                  <div className="session-item-main">
                    <div className="session-title">{s.title ?? '未命名会话'}</div>
                    <div className="session-meta">{relativeTime(s.updatedAt)}</div>
                  </div>
                  <div className="session-actions" onClick={(e) => e.stopPropagation()}>
                    {confirmDeleteId === s.id ? (
                      <button className="session-action danger confirm" onClick={() => removeSession(s.id)}>
                        确认删除
                      </button>
                    ) : (
                      <>
                        <button
                          className="session-action"
                          aria-label="重命名"
                          title="重命名"
                          onClick={() => beginRename(s)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                        </button>
                        <button
                          className="session-action danger"
                          aria-label="删除"
                          title="删除"
                          onClick={() => setConfirmDeleteId(s.id)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ),
            )}
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
        onTurnDone={refresh}
      />
    </div>
  )
}

function isNoiseSession(session: SessionSummary): boolean {
  const title = (session.title ?? '').trim()
  if (session.quotaSpent > 0) return false
  return title.length <= 2
}

function relativeTime(value: string): string {
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const minute = 60_000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  const days = Math.floor(diff / (24 * 60 * minute))
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
