import { useState } from 'react'
import type { ChatMessage } from '../types'
import ToolCard from './ToolCard'
import ConfirmCard from './ConfirmCard'
import MarkdownText from './MarkdownText'

export default function MessageView({
  message,
  active = false,
  elapsedSeconds = 0,
}: {
  message: ChatMessage
  active?: boolean
  elapsedSeconds?: number
}) {
  if (message.role === 'assistant') {
    return (
      <section className={`assistant-turn ${active ? 'active' : ''}`}>
        <div className="turn-gutter">
          <img className="turn-avatar" src="/ek-icon.png" alt="" />
        </div>
        <div className="turn-body">
          {(message.activities.length > 0 || active) && (
            <StepsPanel message={message} active={active} elapsedSeconds={elapsedSeconds} />
          )}

          {message.text && (
            <div className={`assistant-prose ${active ? 'streaming' : ''}`}>
              <MarkdownText text={message.text} />
            </div>
          )}

          {message.confirmations.map((c, i) => (
            <ConfirmCard key={i} confirmation={c} />
          ))}
          {message.error && <div className="error-text">⚠️ {message.error}</div>}
        </div>
      </section>
    )
  }

  return (
    <div className="user-note">
      <div className="user-note-avatar">我</div>
      <div className="user-note-chip">
        <MarkdownText text={message.text} />
      </div>
    </div>
  )
}

/** 工具执行过程折叠面板：步骤行常显，结果卡片点击展开 */
function StepsPanel({
  message,
  active,
  elapsedSeconds,
}: {
  message: ChatMessage
  active: boolean
  elapsedSeconds: number
}) {
  const hasCards = message.activities.some((a) => a.display)
  const [expanded, setExpanded] = useState(false)
  const seconds = active ? elapsedSeconds : message.processedSeconds

  return (
    <div className={`steps-panel ${active ? 'active' : ''}`}>
      <button
        className="steps-head"
        onClick={() => hasCards && setExpanded((v) => !v)}
        disabled={!hasCards}
      >
        <span className="steps-title">
          {active ? '处理中' : '已处理'}
          {seconds ? ` · ${seconds}s` : ''}
        </span>
        {hasCards && (
          <span className={`steps-chevron ${expanded ? 'open' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        )}
      </button>

      {message.activities.map((a, i) => (
        <div key={i} className="steps-item">
          <div className={`step-row ${a.status}`}>
            <span className="step-icon">
              {a.status === 'running' ? (
                <span className="step-spinner" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </span>
            <span className="step-label">
              {toolLabel(a.toolName)}
              {a.status === 'running' ? ' 执行中' : ' 已完成'}
              {a.estimatedQuota ? ` · 预估消耗 ${a.estimatedQuota} 配额` : ''}
            </span>
          </div>
          {expanded && a.display && (
            <div className="step-card">
              <ToolCard display={a.display} />
            </div>
          )}
        </div>
      ))}

      {active && message.activities.length === 0 && (
        <div className="steps-item">
          <div className="step-row running">
            <span className="step-icon">
              <span className="step-spinner" />
            </span>
            <span className="step-label">思考中…</span>
          </div>
        </div>
      )}
    </div>
  )
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    search_kols: '达人搜索',
    find_similar_kols: '相似达人',
    save_kols_to_project: '收藏达人',
    manage_email_template: '邮件模板',
    send_outreach_batch: '邮件发送',
    get_outreach_status: '邮件状态',
    track_publications: '数据追踪',
    get_tracking_results: '追踪结果',
    list_my_tasks: '任务状态',
    export_comments: '评论导出',
    analyze_comments_feedback: '评论分析',
    compare_campaign_performance: '效果对比',
  }
  return labels[name] ?? name
}
