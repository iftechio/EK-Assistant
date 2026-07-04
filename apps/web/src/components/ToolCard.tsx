import { Component, useState, type ReactNode } from 'react'
import { downloadCommentsExcel } from '../api'
import { safeHref } from '../safeHref'
import type { ToolDisplay } from '../types'

/**
 * 卡片渲染兜底：任何一张卡片因脏数据抛错都不能拖垮整个对话界面
 * （脏数据已持久化时，历史会话每次进入都会复现，没有兜底就是永久白屏）。
 */
class CardErrorBoundary extends Component<{ data: unknown; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) return <JsonCard data={this.props.data} />
    return this.props.children
  }
}

/** 工具结果卡片：完整数据在这里渲染（模型上下文里只有截断版） */
export default function ToolCard({ display }: { display: ToolDisplay }) {
  if (!display?.data) return null
  return (
    <CardErrorBoundary data={display.data}>
      <ToolCardInner display={display} />
    </CardErrorBoundary>
  )
}

function ToolCardInner({ display }: { display: ToolDisplay }) {
  switch (display.kind) {
    case 'kol-list':
      return <KolListCard data={display.data} />
    case 'comments':
      return <CommentsCard data={display.data} />
    case 'outreach-stat':
      return <StatCard title="今日发送统计" data={display.data} />
    case 'tracking-summary':
      return <StatCard title="投放数据汇总" data={display.data} />
    case 'performance-comparison':
      return <ComparisonCard data={display.data} />
    case 'comment-analysis':
      return <CommentAnalysisCard data={display.data} />
    case 'email-templates':
      return <EmailTemplatesCard data={display.data} />
    case 'email-template':
      return <EmailTemplateCard data={display.data} />
    case 'send-result':
      return <SendResultCard data={display.data} />
    case 'outreach-records':
      return <OutreachRecordsCard data={display.data} />
    case 'outreach-queue':
      return <OutreachQueueCard data={display.data} />
    case 'tracking-list':
      return <TrackingListCard data={display.data} />
    case 'track-created':
      return <TrackCreatedCard data={display.data} />
    case 'task-list':
      return <TaskListCard data={display.data} />
    case 'collect-result':
      return <CollectResultCard data={display.data} />
    case 'op-result':
      return <OpResultCard data={display.data} />
    case 'search-intent':
      return <SearchIntentCard data={display.data} />
    case 'export-result':
      return <ExportResultCard data={display.data} />
    case 'kol-emails':
      return <KolEmailsCard data={display.data} />
    case 'fake-detection':
      return <FakeDetectionCard data={display.data} />
    case 'competitor-posts':
      return <CompetitorPostsCard data={display.data} />
    case 'audience-analysis':
      return <AudienceAnalysisCard data={display.data} />
    default:
      return <JsonCard data={display.data} />
  }
}

function KolListCard({ data }: { data: any }) {
  const kols: any[] = data.kols ?? []
  const [expanded, setExpanded] = useState(false)
  const emailCount = kols.filter((k) => getEmail(k)).length
  const preview = kols.slice(0, 12)
  return (
    <div className="card kol-card">
      <div className="kol-card-head">
        <div>
          <div className="card-title">KOL 结果</div>
          <div className="kol-summary">
            共 {data.total ?? kols.length} 个，已返回 {data.returned ?? kols.length} 个
            {emailCount ? `，${emailCount} 个有邮箱` : ''}
          </div>
        </div>
        <div className="kol-actions">
          <button className="ghost" disabled={!kols.length} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起表格' : '展开表格'}
          </button>
          <button className="ghost" disabled={!kols.length} onClick={() => downloadKolsCsv(kols)}>
            下载 CSV
          </button>
        </div>
      </div>

      <div className="kol-grid">
        {preview.map((k, i) => (
          <KolItem kol={k} platform={data.platform} key={`${getAccount(k)}-${i}`} />
        ))}
      </div>

      {kols.length > preview.length && (
        <div className="kol-more">还有 {kols.length - preview.length} 个结果，下载 CSV 查看完整名单。</div>
      )}

      {expanded && (
        <div className="table-scroll compact-table">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>账号</th>
                <th>粉丝</th>
                <th>地区</th>
                <th>邮箱</th>
              </tr>
            </thead>
            <tbody>
              {kols.slice(0, 100).map((k, i) => (
                <tr key={i}>
                  <td>{getName(k)}</td>
                  <td>{getAccount(k)}</td>
                  <td>{fmt(getFollowers(k))}</td>
                  <td>{getRegion(k)}</td>
                  <td>{getEmail(k) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {kols.length > 100 && <div className="muted">表格仅预览前 100 条，下载 CSV 查看全部。</div>}
        </div>
      )}
    </div>
  )
}

/** 单个博主卡片：头像/昵称/主页链接/旗帜/简介/统计，取值方式与 easykol-web 的 platform-adapters 一致 */
function KolItem({ kol: k, platform }: { kol: any; platform?: string }) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const p = normalizePlatform(k.platform ?? platform)
  const name = getDisplayName(k, p)
  const avatar = getAvatar(k, p)
  const profileUrl = safeHref(getProfileUrl(k, p))
  const region = getRegion(k)
  const secondary = getSecondaryStat(k, p)
  return (
    <div className="kol-item">
      {avatar && !avatarFailed ? (
        <img className="kol-avatar" src={avatar} alt={name} referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />
      ) : (
        <div className="kol-avatar">{initialOf(name)}</div>
      )}
      <div className="kol-main">
        <div className="kol-name">
          {profileUrl ? (
            <a href={profileUrl} target="_blank" rel="noreferrer">{name}</a>
          ) : (
            name
          )}
          {flagOf(region) && <span className="kol-flag" title={region}>{flagOf(region)}</span>}
        </div>
        <div className="kol-account">{getAccount(k)}</div>
        {k.description && <div className="kol-desc">{k.description}</div>}
        <div className="kol-meta">
          <span>{fmt(getFollowers(k))} 粉丝</span>
          {secondary && <span>{secondary}</span>}
          {!flagOf(region) && region !== '地区未知' && <span>{region}</span>}
          {getEmail(k) && <span title={getEmail(k)}>有邮箱</span>}
        </div>
      </div>
    </div>
  )
}

function CommentsCard({ data }: { data: any }) {
  const [busy, setBusy] = useState(false)
  const comments: any[] = data.comments ?? []
  return (
    <div className="card">
      <div className="card-title">
        评论（{data.total}）
        <button
          className="ghost"
          disabled={busy || !data.taskId}
          onClick={async () => {
            setBusy(true)
            try {
              await downloadCommentsExcel({ taskId: data.taskId })
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '导出中…' : '⬇ 下载 Excel'}
        </button>
      </div>
      <div className="comment-list">
        {comments.slice(0, 100).map((c, i) => (
          <div key={i} className="comment-row">
            <span className="muted">{c.author}</span> {c.text}
            <span className="muted">（赞 {c.likeCount}）</span>
          </div>
        ))}
        {comments.length > 100 && <div className="muted">…下载 Excel 查看全部</div>}
      </div>
    </div>
  )
}

function StatCard({ title, data }: { title: string; data: any }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="stat-grid">
        {Object.entries(data ?? {})
          .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
          .map(([k, v]) => (
            <div key={k} className="stat-item">
              <div className="stat-value">{String(v)}</div>
              <div className="stat-label">{k}</div>
            </div>
          ))}
      </div>
    </div>
  )
}

function ComparisonCard({ data }: { data: any }) {
  const comparison = data.comparison ?? {}
  return (
    <div className="card">
      <div className="card-title">表现对比（基线 {data.baselineCount} 条）</div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>指标</th>
              <th>本条</th>
              <th>基线中位数</th>
              <th>倍数</th>
              <th>百分位</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(comparison).map(([metric, c]: [string, any]) => (
              <tr key={metric}>
                <td>{metric}</td>
                <td>{fmt(c.target)}</td>
                <td>{fmt(c.baseline?.median)}</td>
                <td>{c.vsMedian ?? '-'}</td>
                <td>{c.percentile != null ? `P${c.percentile}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** 评论反馈分析：结构化（正/负面/高频问题）优先，旧数据回退纯文本 */
function CommentAnalysisCard({ data }: { data: any }) {
  if (!data.positives && !data.negatives) {
    return (
      <div className="card">
        <div className="card-title">评论反馈分析（{data.analyzedComments} 条）</div>
        <pre className="prewrap">{data.analysis}</pre>
      </div>
    )
  }
  const sentiment = data.sentiment
  return (
    <div className="card">
      <div className="card-title">评论反馈分析（{data.analyzedComments} 条）</div>
      {sentiment && (
        <div className="stat-grid">
          <div className="stat-item">
            <div className="stat-value">{sentiment.positivePct}%</div>
            <div className="stat-label">正面</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{sentiment.negativePct}%</div>
            <div className="stat-label">负面</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{sentiment.neutralPct}%</div>
            <div className="stat-label">中性</div>
          </div>
        </div>
      )}
      {data.summary && <p className="analysis-summary">{data.summary}</p>}
      <FeedbackSection title="👍 正面反馈" items={data.positives} />
      <FeedbackSection title="👎 负面反馈" items={data.negatives} />
      {data.questions?.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title">❓ 高频问题</div>
          <ul className="analysis-list">
            {data.questions.map((q: string, i: number) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function FeedbackSection({ title, items }: { title: string; items?: { point: string; quotes?: string[] }[] }) {
  if (!items?.length) return null
  return (
    <div className="analysis-section">
      <div className="analysis-section-title">{title}</div>
      <ul className="analysis-list">
        {items.map((item, i) => (
          <li key={i}>
            {item.point}
            {item.quotes?.length ? (
              <div className="analysis-quotes">
                {item.quotes.map((q, j) => (
                  <div key={j} className="muted">「{q}」</div>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmailTemplatesCard({ data }: { data: any }) {
  const templates: any[] = Array.isArray(data) ? data : (data?.templates ?? [])
  if (!templates.length) {
    return (
      <div className="card">
        <div className="card-title">邮件模板</div>
        <div className="muted">暂无模板</div>
      </div>
    )
  }
  return (
    <div className="card">
      <div className="card-title">邮件模板（{templates.length}）</div>
      {templates.map((t) => (
        <TemplateRow key={t.id} template={t} />
      ))}
    </div>
  )
}

function EmailTemplateCard({ data }: { data: any }) {
  return (
    <div className="card">
      <div className="card-title">邮件模板</div>
      <TemplateRow template={data} defaultOpen />
    </div>
  )
}

function TemplateRow({ template: t, defaultOpen = false }: { template: any; defaultOpen?: boolean }) {
  return (
    <details className="template-row" open={defaultOpen}>
      <summary>
        <span className="template-name">{t.name || '未命名模板'}</span>
        <span className="muted"> · {t.subject}</span>
      </summary>
      {t.cc?.length > 0 && <div className="muted">抄送：{t.cc.join('、')}</div>}
      <pre className="prewrap template-content">{t.content}</pre>
      <div className="muted">模板 ID：{t.id}</div>
    </details>
  )
}

function SendResultCard({ data }: { data: any }) {
  return (
    <div className="card">
      <div className="card-title">✅ 邮件已加入发送队列</div>
      <div className="stat-grid">
        <div className="stat-item">
          <div className="stat-value">{data.inserted ?? '-'}</div>
          <div className="stat-label">已入队</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{data.receivers ?? '-'}</div>
          <div className="stat-label">收件人</div>
        </div>
      </div>
      <div className="muted">按设定间隔逐封发送，进度可随时询问「邮件发送状态」。</div>
    </div>
  )
}

const EMAIL_STATUS_LABELS: Record<string, string> = {
  SENT: '已发送',
  PENDING: '待发送',
  SENDING: '发送中',
  FAILED: '失败',
  CANCELED: '已取消',
  PAUSED: '已暂停',
}

function OutreachRecordsCard({ data }: { data: any }) {
  const list: any[] = data.list ?? []
  const stats = data.statistics
  const total = data.pagination?.total ?? list.length
  return (
    <div className="card">
      <div className="card-title">邮件发送明细（共 {total} 条）</div>
      {stats && (
        <div className="stat-grid">
          {Object.entries(stats)
            .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
            .map(([k, v]) => (
              <div key={k} className="stat-item">
                <div className="stat-value">{String(v)}</div>
                <div className="stat-label">{k}</div>
              </div>
            ))}
        </div>
      )}
      <div className="table-scroll compact-table">
        <table>
          <thead>
            <tr>
              <th>收件人</th>
              <th>主题</th>
              <th>状态</th>
              <th>发送时间</th>
              <th>已读</th>
              <th>跟进</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 100).map((r, i) => (
              <tr key={i}>
                <td>{r.to ?? '-'}</td>
                <td>{r.subject ?? '-'}</td>
                <td>{EMAIL_STATUS_LABELS[r.status] ?? r.status ?? '-'}</td>
                <td>{fmtDate(r.sentAt)}</td>
                <td>{r.isRead ? `是${r.readCount ? ` (${r.readCount})` : ''}` : '否'}</td>
                <td>{r.followups?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 100 && <div className="muted">仅展示前 100 条。</div>}
      </div>
    </div>
  )
}

function OutreachQueueCard({ data }: { data: any }) {
  const list: any[] = data.list ?? []
  const total = data.pagination?.total ?? list.length
  return (
    <div className="card">
      <div className="card-title">自动邮件队列（共 {total} 条）</div>
      <div className="table-scroll compact-table">
        <table>
          <thead>
            <tr>
              <th>收件人</th>
              <th>发件邮箱</th>
              <th>状态</th>
              <th>模板</th>
              <th>计划发送时间</th>
              <th>计划 ID</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 100).map((p, i) => (
              <tr key={i}>
                <td>{p.nickname ? `${p.nickname}（${p.email}）` : p.email ?? '-'}</td>
                <td>{p.from ?? '-'}</td>
                <td>{EMAIL_STATUS_LABELS[p.status] ?? p.status ?? '-'}</td>
                <td>{p.template?.templateName ?? p.template?.templateId ?? '-'}</td>
                <td>{fmtDate(p.scheduledAt)}</td>
                <td className="muted">{p.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 100 && <div className="muted">仅展示前 100 条。</div>}
      </div>
    </div>
  )
}

function TrackingListCard({ data }: { data: any }) {
  const rows: any[] = data.data ?? []
  return (
    <div className="card">
      <div className="card-title">投放数据明细（共 {data.total ?? rows.length} 条）</div>
      <div className="table-scroll compact-table">
        <table>
          <thead>
            <tr>
              <th>博主</th>
              <th>平台</th>
              <th>发布日期</th>
              <th>播放</th>
              <th>点赞</th>
              <th>评论</th>
              <th>分享</th>
              <th>互动率</th>
              <th>CPM</th>
              <th>链接</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((p, i) => (
              <tr key={i}>
                <td>{p.nickName ?? p.influencer ?? '-'}</td>
                <td>{p.platform ?? '-'}</td>
                <td>{fmtDate(p.publishDate)}</td>
                <td>{fmt(p.views)}</td>
                <td>{fmt(p.likes)}</td>
                <td>{fmt(p.comments)}</td>
                <td>{fmt(p.shares)}</td>
                <td>{p.engagementRate != null ? `${p.engagementRate}%` : '-'}</td>
                <td>{p.cpm ?? '-'}</td>
                <td>
                  {safeHref(p.postLink) ? (
                    <a href={safeHref(p.postLink)} target="_blank" rel="noreferrer">查看</a>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 100 && <div className="muted">仅展示前 100 条。</div>}
      </div>
    </div>
  )
}

function TrackCreatedCard({ data }: { data: any }) {
  const urls: string[] = data.urls ?? []
  return (
    <div className="card">
      <div className="card-title">✅ 追踪任务已创建</div>
      <div className="muted">
        平台 {data.platform} · {urls.length} 条链接 · 任务 {data.taskId}
      </div>
      <ul className="analysis-list">
        {urls.slice(0, 20).map((u, i) => (
          <li key={i}>
            {safeHref(u) ? (
              <a href={safeHref(u)} target="_blank" rel="noreferrer">{u}</a>
            ) : (
              u
            )}
          </li>
        ))}
        {urls.length > 20 && <li className="muted">…还有 {urls.length - 20} 条</li>}
      </ul>
      <div className="muted">数据抓取在后台进行（通常几分钟内），之后可询问「投放数据」。</div>
    </div>
  )
}

const TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: '排队中',
  PROCESSING: '进行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  TERMINATED: '已终止',
}

function TaskListCard({ data }: { data: any }) {
  const tasks: any[] = Array.isArray(data) ? data : (data?.tasks ?? [])
  if (!tasks.length) {
    return (
      <div className="card">
        <div className="card-title">后台任务</div>
        <div className="muted">没有找到任务</div>
      </div>
    )
  }
  return (
    <div className="card">
      <div className="card-title">后台任务（{tasks.length}）</div>
      <div className="table-scroll compact-table">
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>任务 ID</th>
            </tr>
          </thead>
          <tbody>
            {tasks.slice(0, 50).map((t, i) => (
              <tr key={i}>
                <td>{t.type ?? '-'}</td>
                <td>{TASK_STATUS_LABELS[t.status] ?? t.status ?? '-'}</td>
                <td>{fmtDate(t.createdAt)}</td>
                <td className="muted">{t.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CollectResultCard({ data }: { data: any }) {
  const results: any[] = data.results ?? []
  const ok = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  const verb = data.action === 'rate_kols' ? '评分' : '收藏'
  return (
    <div className="card">
      <div className="card-title">
        {failed.length ? `${verb}完成（部分失败）` : `✅ ${verb}完成`}
      </div>
      <div className="stat-grid">
        <div className="stat-item">
          <div className="stat-value">{ok.length}</div>
          <div className="stat-label">成功</div>
        </div>
        {failed.length > 0 && (
          <div className="stat-item">
            <div className="stat-value">{failed.length}</div>
            <div className="stat-label">失败</div>
          </div>
        )}
      </div>
      <div className="muted">项目 {data.projectId} · 态度 {data.attitude}</div>
      {failed.length > 0 && (
        <ul className="analysis-list">
          {failed.slice(0, 10).map((r, i) => (
            <li key={i} className="muted">
              {r.kolId}：{r.error ?? '未知错误'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 智能搜索意图解析卡片：规范化标签 + 博主原文词（带库存命中量），在对话里确认后再搜索 */
function SearchIntentCard({ data }: { data: any }) {
  const tags: any[] = data.canonicalTags ?? []
  const keywords: any[] = data.keywords ?? []
  return (
    <div className="card">
      <div className="card-title">搜索意图解析{data.platform ? `（${data.platform}）` : ''}</div>
      {data.sentence && <div className="muted">「{data.sentence}」</div>}
      {tags.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title">🏷 规范化标签</div>
          <div className="chip-wrap">
            {tags.map((t, i) => (
              <span key={i} className="chip">
                {t.name} <span className="chip-count">{fmt(t.count)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {keywords.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title">🔤 博主原文词</div>
          <div className="chip-wrap">
            {keywords.map((k, i) => (
              <span key={i} className={`chip ${k.source === 'ai' ? 'chip-ai' : ''}`}>
                {k.name} <span className="chip-count">{fmt(k.count)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {data.mustExclude?.length > 0 && (
        <div className="muted">排除词：{data.mustExclude.join('、')}</div>
      )}
      <div className="muted">在对话里告诉我保留哪些标签/词，我再执行搜索（每选一项约多 50 个结果 / 1 配额）。</div>
    </div>
  )
}

function ExportResultCard({ data }: { data: any }) {
  return (
    <div className="card">
      <div className="card-title">✅ {data.title ?? '导出完成'}</div>
      {safeHref(data.url) ? (
        <a className="download-link" href={safeHref(data.url)} target="_blank" rel="noreferrer">
          ⬇ 下载 {data.fileName ?? 'Excel 文件'}
        </a>
      ) : (
        <div className="muted">没有可下载的文件</div>
      )}
    </div>
  )
}

function KolEmailsCard({ data }: { data: any }) {
  const receivers: any[] = data.receivers ?? []
  return (
    <div className="card">
      <div className="card-title">
        邮箱提取结果
        {safeHref(data.downloadUrl) && (
          <a className="download-link" href={safeHref(data.downloadUrl)} target="_blank" rel="noreferrer">
            ⬇ 下载 Excel
          </a>
        )}
      </div>
      <div className="stat-grid">
        <div className="stat-item">
          <div className="stat-value">{data.totalCount ?? '-'}</div>
          <div className="stat-label">查询达人</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{data.emailCount ?? '-'}</div>
          <div className="stat-label">发现邮箱</div>
        </div>
      </div>
      <div className="table-scroll compact-table">
        <table>
          <thead>
            <tr>
              <th>达人</th>
              <th>邮箱</th>
              <th>平台</th>
            </tr>
          </thead>
          <tbody>
            {receivers.slice(0, 100).map((r, i) => (
              <tr key={i}>
                <td>{r.nickname ?? '-'}</td>
                <td>{r.email}</td>
                <td>{r.platform ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {receivers.length > 100 && <div className="muted">仅展示前 100 条，下载 Excel 查看全部。</div>}
      </div>
      {data.unknownUrls?.length > 0 && (
        <div className="muted">跳过 {data.unknownUrls.length} 条无法识别的链接。</div>
      )}
    </div>
  )
}

function CompetitorPostsCard({ data }: { data: any }) {
  const rows: any[] = data.contents ?? []
  return (
    <div className="card">
      <div className="card-title">竞品命中内容（共 {data.total ?? rows.length} 条）</div>
      <div className="table-scroll compact-table">
        <table>
          <thead>
            <tr>
              <th>标题</th>
              <th>账号</th>
              <th>平台</th>
              <th>播放</th>
              <th>点赞</th>
              <th>评论</th>
              <th>命中标签</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((c, i) => (
              <tr key={i}>
                <td>{c.title ?? '-'}</td>
                <td>{c.uniqueId ?? c.platformAccount ?? '-'}</td>
                <td>{c.platform ?? '-'}</td>
                <td>{fmt(c.viewCount)}</td>
                <td>{fmt(c.likeCount)}</td>
                <td>{fmt(c.commentCount)}</td>
                <td>{(c.hitTags ?? []).join('、') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 100 && <div className="muted">仅展示前 100 条。</div>}
      </div>
    </div>
  )
}

/** 受众画像卡片：画像/地区/假粉雷达按对象泛化渲染成分区 stat */
function AudienceAnalysisCard({ data }: { data: any }) {
  return (
    <div className="card">
      <div className="card-title">
        受众画像（{data.source} · {data.platform}）
        {safeHref(data.exportUrl) && (
          <a className="download-link" href={safeHref(data.exportUrl)} target="_blank" rel="noreferrer">
            ⬇ 下载 Excel
          </a>
        )}
      </div>
      <AudienceSection title="👥 用户画像" obj={data.userPortraitResult} />
      <AudienceSection title="🌍 地区分布" obj={data.regionAnalysisResult} />
      <AudienceSection title="🛡 虚假粉丝雷达" obj={data.fakeRadarData} />
      <AudienceSection title="📊 采集范围" obj={data.dataRangeStats} />
      {data.updatedAt && <div className="muted">分析时间：{fmtDate(data.updatedAt)}</div>}
    </div>
  )
}

function AudienceSection({ title, obj }: { title: string; obj: any }) {
  if (!obj || typeof obj !== 'object') return null
  const flat = flattenEntries(obj)
  if (!flat.length) return null
  return (
    <div className="analysis-section">
      <div className="analysis-section-title">{title}</div>
      <div className="stat-grid">
        {flat.slice(0, 12).map(([k, v]) => (
          <div key={k} className="stat-item">
            <div className="stat-value">{formatStatValue(v)}</div>
            <div className="stat-label">{k}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 把嵌套一层的对象压平成 [label, value]，只保留可直接展示的标量 */
function flattenEntries(obj: Record<string, any>): [string, unknown][] {
  const out: [string, unknown][] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      out.push([k, v])
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (typeof v2 === 'number' || typeof v2 === 'string') out.push([`${k}.${k2}`, v2])
      }
    }
  }
  return out
}

function formatStatValue(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? fmt(v) : v.toFixed(2)
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}

const FAKE_RESULT_LABELS: Record<string, string> = {
  realPeople: '真人',
  influencer: '网红',
  fakeAccounts: '疑似假号',
}

function FakeDetectionCard({ data }: { data: any }) {
  const breakdown: Record<string, number> = data.breakdown ?? {}
  const accounts: any[] = data.accounts ?? []
  const total = data.sampleTotal || 1
  return (
    <div className="card">
      <div className="card-title">
        假粉检测（{data.mode === 'audience' ? '受众' : '帖子点赞'}）{data.fromCache ? ' · 缓存结果' : ''}
      </div>
      {data.target && <div className="muted">对象：{data.target}</div>}
      <div className="stat-grid">
        {Object.entries(breakdown).map(([k, v]) => (
          <div key={k} className="stat-item">
            <div className="stat-value">{Math.round((v / total) * 100)}%</div>
            <div className="stat-label">
              {FAKE_RESULT_LABELS[k] ?? k}（{v}）
            </div>
          </div>
        ))}
      </div>
      <details>
        <summary>抽样明细（{accounts.length}）</summary>
        <div className="table-scroll compact-table">
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>判定</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={i}>
                  <td>{a.username}</td>
                  <td>{FAKE_RESULT_LABELS[a.result] ?? a.result}</td>
                  <td>{a.reason ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/** 通用操作反馈卡片：写操作（创建项目/标签、移动收藏等）的轻量结果展示 */
function OpResultCard({ data }: { data: any }) {
  return (
    <div className="card">
      <div className="card-title">{data.title ?? '操作完成'}</div>
      {data.items?.length > 0 && (
        <div className="stat-grid">
          {data.items.map((item: { label: string; value: unknown }, i: number) => (
            <div key={i} className="stat-item">
              <div className="stat-value">{String(item.value ?? '-')}</div>
              <div className="stat-label">{item.label}</div>
            </div>
          ))}
        </div>
      )}
      {data.list?.length > 0 && (
        <ul className="analysis-list">
          {data.list.slice(0, 50).map((line: string, i: number) => (
            <li key={i}>{line}</li>
          ))}
          {data.list.length > 50 && <li className="muted">…还有 {data.list.length - 50} 项</li>}
        </ul>
      )}
    </div>
  )
}

function fmtDate(value: unknown): string {
  if (!value) return '-'
  const d = new Date(value as string)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function JsonCard({ data }: { data: any }) {
  return (
    <div className="card">
      <pre className="prewrap">{JSON.stringify(data, null, 2).slice(0, 3000)}</pre>
    </div>
  )
}

function fmt(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function getName(k: any): string {
  return k.title ?? k.nickName ?? k.nickname ?? k.name ?? '未命名达人'
}

function normalizePlatform(platform: unknown): string {
  return String(platform ?? '').toUpperCase()
}

/** 昵称优先级与 easykol-web platform-adapters 一致 */
function getDisplayName(k: any, platform: string): string {
  if (platform === 'TIKTOK' && k.tiktokUser) {
    return k.tiktokUser.nickname || k.tiktokUser.uniqueId || getName(k)
  }
  if (platform === 'INSTAGRAM' && k.instagramUser) {
    return k.instagramUser.fullName || k.instagramUser.username || getName(k)
  }
  if (platform === 'YOUTUBE' && k.youtubeChannel) {
    const c = k.youtubeChannel
    const legacyTitle = c.title && !/^UC[\w-]{10,}$/.test(c.title) ? c.title : ''
    return c.channelName || legacyTitle || c.channelHandle || getName(k)
  }
  return getName(k)
}

function getAvatar(k: any, platform: string): string {
  if (platform === 'TIKTOK') return k.tiktokUser?.avatar ?? k.avatar ?? ''
  if (platform === 'INSTAGRAM') return k.instagramUser?.profilePicUrl ?? k.avatar ?? ''
  if (platform === 'YOUTUBE') return k.avatar ?? k.youtubeChannel?.thumbnail ?? ''
  return k.avatar ?? ''
}

function getProfileUrl(k: any, platform: string): string {
  if (platform === 'TIKTOK') {
    const username = k.tiktokUser?.uniqueId ?? k.uniqueId ?? k.platformAccount
    return username ? `https://tiktok.com/@${username}` : ''
  }
  if (platform === 'INSTAGRAM') {
    const username = k.instagramUser?.username ?? k.platformAccount
    return username ? `https://instagram.com/${username}` : ''
  }
  if (platform === 'YOUTUBE') {
    const handle = k.youtubeChannel?.channelHandle
    if (handle?.startsWith('@')) return `https://youtube.com/${handle}`
    const channelId = k.youtubeChannel?.channelId ?? k.platformAccount?.replace('channel/', '')
    return channelId ? `https://youtube.com/channel/${channelId}/videos` : ''
  }
  return k.url ?? k.link ?? ''
}

/** 平台特有二级指标：TikTok 均播 / Instagram 均赞 / YouTube 均观看 */
function getSecondaryStat(k: any, platform: string): string {
  if (platform === 'TIKTOK' && k.tiktokUser?.averagePlayCount != null) {
    return `均播 ${fmt(k.tiktokUser.averagePlayCount)}`
  }
  if (platform === 'INSTAGRAM' && k.instagramUser?.averageLikeCount != null) {
    return `均赞 ${fmt(k.instagramUser.averageLikeCount)}`
  }
  if (platform === 'YOUTUBE' && k.youtubeChannel?.videosAverageViewCount != null) {
    return `均观看 ${fmt(k.youtubeChannel.videosAverageViewCount)}`
  }
  return ''
}

/** ISO 两位国家码 → 旗帜 emoji；与 easykol-web 一致，TW 不展示旗帜 */
function flagOf(region: string): string {
  const code = String(region ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code) || code === 'TW') return ''
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

function getAccount(k: any): string {
  return k.platformAccount ?? k.account ?? k.uniqueId ?? k.authorUniqueId ?? '-'
}

/** similars 等接口返回 kolInfo，粉丝/地区在嵌套的平台对象里 */
function nestedUser(k: any) {
  return k.tiktokUser ?? k.youtubeChannel ?? k.instagramUser
}

function getFollowers(k: any): unknown {
  return (
    k.subscribers ??
    k.followers ??
    k.followerCount ??
    nestedUser(k)?.numericSubscriberCount ??
    nestedUser(k)?.followerCount
  )
}

function getRegion(k: any): string {
  return k.region ?? k.country ?? nestedUser(k)?.country ?? nestedUser(k)?.region ?? '地区未知'
}

function getEmail(k: any): string {
  return k.email ?? ''
}

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || 'K'
}

function downloadKolsCsv(kols: any[]) {
  const headers = [
    'name',
    'account',
    'followers',
    'region',
    'email',
    'platform',
    'url',
    'description',
  ]
  const rows = kols.map((k) => [
    getName(k),
    getAccount(k),
    getFollowers(k) ?? '',
    k.region ?? k.country ?? nestedUser(k)?.country ?? nestedUser(k)?.region ?? '',
    k.email ?? '',
    k.platform ?? '',
    k.url ?? k.link ?? k.postLink ?? '',
    k.description ?? '',
  ])
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `kols-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
}
