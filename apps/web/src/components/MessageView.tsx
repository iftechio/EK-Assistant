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

          {message.confirmations.map((c) => (
            // key 必须用 action.id：index key 在切会话时会让 React 把 A 会话的
            // 确认状态复用到 B 会话的另一个 action 上（可能导致重复批准）
            <ConfirmCard key={c.action.id} confirmation={c} />
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

/** 工具执行过程面板：步骤行常显，结果卡片默认展开、可点击标题收起 */
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
  const [expanded, setExpanded] = useState(true)
  const seconds = active ? elapsedSeconds : message.processedSeconds

  return (
    <div className={`steps-panel ${active ? 'active' : ''}`}>
      <button
        className="steps-head"
        onClick={() => hasCards && setExpanded((v) => !v)}
        disabled={!hasCards}
      >
        <span className="steps-title">
          {active ? '任务进行中' : '任务已完成'}
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
              {toolStatusText(a.toolName, a.status)}
              {a.estimatedQuota ? <span className="quota-chip">预估 {a.estimatedQuota}</span> : null}
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

function toolStatusText(name: string, status: 'running' | 'done'): string {
  const action = toolAction(name)
  return status === 'running' ? `正在${action}` : `已返回：${action}`
}

function toolAction(name: string): string {
  const labels: Record<string, string> = {
    search_kols: '搜索达人',
    parse_search_intent: '解析搜索条件',
    'search-intent': '解析搜索条件',
    find_similar_kols: '寻找相似达人',
    discover_kols_by_source: '按来源发现达人',
    save_kols_to_project: '保存达人',
    manage_email_template: '处理邮件模板',
    send_outreach_batch: '准备批量外联',
    get_outreach_status: '查询邮件状态',
    manage_outreach_queue: '管理发送队列',
    track_publications: '创建追踪任务',
    get_tracking_results: '读取追踪结果',
    manage_tracking: '管理追踪任务',
    list_my_tasks: '查询后台任务',
    export_comments: '拉取评论',
    analyze_comments_feedback: '分析评论反馈',
    compare_campaign_performance: '对比投放表现',
    remember_preference: '保存偏好',
    send_single_email: '准备单封邮件',
    export_kols: '导出达人名单',
    manage_exclude_list: '处理排除名单',
    extract_kol_emails: '提取达人邮箱',
    detect_fake_followers: '检测假粉',
    track_competitors: '追踪竞品',
    analyze_audience: '分析受众画像',
    // 历史会话恢复时 activities 里存的是 display kind
    'export-result': '生成下载结果',
    'competitor-posts': '读取竞品内容',
    'audience-analysis': '生成受众画像',
    'kol-emails': '生成邮箱结果',
    'fake-detection': '生成假粉检测结果',
    'kol-list': '生成达人结果',
    comments: '生成评论列表',
    'comment-analysis': '生成评论分析',
    'outreach-stat': '生成邮件统计',
    'outreach-records': '生成发送明细',
    'outreach-queue': '生成邮件队列',
    'tracking-summary': '生成投放汇总',
    'tracking-list': '生成投放明细',
    'track-created': '生成追踪任务',
    'task-list': '生成任务状态',
    'collect-result': '生成保存结果',
    'send-result': '生成发送结果',
    'email-templates': '读取邮件模板',
    'email-template': '读取邮件模板',
    'performance-comparison': '生成效果对比',
    'op-result': '完成操作',
  }
  return labels[name] ?? name
}
