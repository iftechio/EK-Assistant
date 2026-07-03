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
        <div className="assistant-turn-status">
          <span>{active ? '处理中' : '已处理'}</span>
          {(active || message.processedSeconds) && (
            <span>{active ? elapsedSeconds : message.processedSeconds}s</span>
          )}
        </div>
        <div className="assistant-turn-rule" />

        {message.text && (
          <div className={`assistant-prose ${active ? 'streaming' : ''}`}>
            <MarkdownText text={message.text} />
          </div>
        )}

        {message.activities.map((a, i) => (
          <div key={i} className={`activity-row ${a.status}`}>
            <span className="activity-icon">{a.status === 'running' ? '⌁' : '✓'}</span>
            <span>
              {a.status === 'running' ? '正在执行' : '已完成'} {toolLabel(a.toolName)}
              {a.estimatedQuota ? ` · 预估消耗 ${a.estimatedQuota} 配额` : ''}
            </span>
            {a.display && <ToolCard display={a.display} />}
          </div>
        ))}

        {message.confirmations.map((c, i) => (
          <ConfirmCard key={i} confirmation={c} />
        ))}
        {message.error && <div className="error-text">⚠️ {message.error}</div>}
      </section>
    )
  }

  return (
    <div className={`message ${message.role}`}>
      <div className="avatar">{message.role === 'user' ? '我' : 'EK'}</div>
      <div className="bubble-area">
        {message.activities.map((a, i) => (
          <div key={i} className="tool-activity">
            <span className={`tool-chip ${a.status}`}>
              {a.status === 'running' ? '⏳' : '✅'} {toolLabel(a.toolName)}
              {a.estimatedQuota ? `（预估消耗 ${a.estimatedQuota} 配额）` : ''}
            </span>
            {a.display && <ToolCard display={a.display} />}
          </div>
        ))}
        {message.confirmations.map((c, i) => (
          <ConfirmCard key={i} confirmation={c} />
        ))}
        {message.text && (
          <div className="bubble">
            <MarkdownText text={message.text} />
          </div>
        )}
        {message.error && <div className="error-text">⚠️ {message.error}</div>}
      </div>
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
