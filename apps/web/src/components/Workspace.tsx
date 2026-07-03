import { useCallback, useEffect, useState } from 'react'
import { listSessions } from '../api'
import type { SessionSummary } from '../types'
import Chat from './Chat'

export default function Workspace({ userEmail }: { userEmail: string }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

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

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="logo">EK-Assistant</span>
          <button className="ghost" onClick={() => setActiveId(null)}>
            ＋ 新会话
          </button>
        </div>
        <div className="session-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`session-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(s.id)}
            >
              <div className="session-title">{s.title ?? '未命名会话'}</div>
              <div className="session-meta">配额 {s.quotaSpent}</div>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <span className="muted" title={userEmail}>
            {userEmail}
          </span>
        </div>
      </aside>
      <Chat
        key={activeId ?? 'new'}
        sessionId={activeId}
        onSessionCreated={(id) => {
          setActiveId(id)
          refresh()
        }}
      />
    </div>
  )
}
