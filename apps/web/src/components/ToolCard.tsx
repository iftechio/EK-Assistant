import { Component, useState, type ReactNode } from 'react'
import { downloadBlob, downloadCommentsExcel } from '../api'
import { safeHref } from '../safeHref'
import type { ToolDisplay } from '../types'
import MarkdownText from './MarkdownText'

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
      return <TrackingSummaryCard data={display.data} />
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

/** 通用统计格：stat-grid + 若干 stat-item，7 处同构统计卡片共用 */
function StatGrid({ items }: { items: { key?: string | number; value: ReactNode; label: ReactNode }[] }) {
  return (
    <div className="stat-grid">
      {items.map((item, i) => (
        <div key={item.key ?? i} className="stat-item">
          <div className="stat-value">{item.value}</div>
          <div className="stat-label">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

/** 通用数据表：table-scroll(+compact-table) + thead/tbody，6 张同构表格卡共用 */
function DataTable<T>({
  columns,
  rows,
  limit,
  rowKey,
  footer,
  compact = true,
}: {
  columns: { header: string; cell: (row: T, i: number) => ReactNode }[]
  rows: T[]
  limit?: number
  rowKey?: (row: T, i: number) => React.Key
  footer?: ReactNode
  compact?: boolean
}) {
  const shown = limit ? rows.slice(0, limit) : rows
  return (
    <div className={compact ? 'table-scroll compact-table' : 'table-scroll'}>
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i}>
              {columns.map((c, ci) => (
                <td key={ci}>{c.cell(row, i)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  )
}

/** 通用下载链接：safeHref 校验通过才渲染，否则展示 fallback */
function DownloadLink({ url, label, fallback }: { url?: string; label: string; fallback?: ReactNode }) {
  const href = safeHref(url)
  if (!href) return <>{fallback ?? null}</>
  return (
    <a className="download-link" href={href} target="_blank" rel="noreferrer">
      ⬇ {label}
    </a>
  )
}

function KolListCard({ data }: { data: any }) {
  const kols: any[] = data.kols ?? []
  const [expanded, setExpanded] = useState(false)
  const emailCount = kols.filter((k) => getEmail(k)).length
  const preview = kols.slice(0, 20)
  const platform = normalizePlatform(data.platform ?? kols[0]?.platform)
  const platformName = platformLabel(platform)
  if (!kols.length) {
    return (
      <div className="card kol-card kol-results-card">
        <div className="kol-results-head">
          <div>
            <div className="kol-results-title">
              <span className="status-dot" />
              搜索结果
              {platformName && <span className="kol-title-badge">{platformName}</span>}
            </div>
            <div className="kol-summary">共找到 {fmt(data.total ?? 0)} 位达人，当前没有可展示结果</div>
          </div>
        </div>
        <div className="kol-empty">
          没有返回符合条件的达人。可以放宽地区、粉丝量、平均播放量，或先做意图解析后再搜索。
        </div>
      </div>
    )
  }
  return (
    <div className="card kol-card kol-results-card">
      <div className="kol-results-head">
        <div className="kol-results-title-wrap">
          <div className="kol-results-title">
            <span className="status-dot" />
            搜索结果
            {platformName && <span className="kol-title-badge">{platformName}</span>}
          </div>
          <div className="kol-filter-bar" aria-label="搜索摘要">
            <span className="filter-chip active">{platformName || '全平台'}</span>
            <span className="filter-chip">已返回 {fmt(data.returned ?? kols.length)}</span>
            <span className="filter-chip">有邮箱 {emailCount ? fmt(emailCount) : '0'}</span>
            {data.source && <span className="filter-chip">种子 {String(data.source)}</span>}
            {data.mode && <span className="filter-chip">模式 {String(data.mode)}</span>}
          </div>
        </div>
        <div className="kol-actions">
          <button className="ghost" disabled={!kols.length} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起明细' : '展开明细'}
          </button>
          <button className="ghost" disabled={!kols.length} onClick={() => downloadKolsCsv(kols)}>
            下载 CSV
          </button>
        </div>
      </div>

      <div className="kol-platform-tabs" aria-label="平台结果">
        <span className="kol-platform-tab active">
          {platformIcon(platform)}
          {platformName || '达人'}
          <span>{fmt(data.total ?? kols.length)}</span>
        </span>
      </div>

      <div className="kol-results-subhead">
        <span>{platformName || '当前'} 当前页 {preview.length} 位达人</span>
        <span>共找到 {fmt(data.total ?? kols.length)} 位达人</span>
      </div>

      <div className="kol-table-shell" role="table" aria-label="达人搜索结果">
        <div className="kol-table-toolbar">
          <label className="kol-check-row">
            <input type="checkbox" disabled />
            <span>共 {preview.length} 位达人</span>
          </label>
        </div>
        {preview.map((k, i) => (
          <KolItem kol={k} platform={data.platform} key={`${getAccount(k)}-${i}`} />
        ))}
      </div>

      {kols.length > preview.length && (
        <div className="kol-more">还有 {kols.length - preview.length} 个结果，下载 CSV 查看完整名单。</div>
      )}

      {expanded && (
        <DataTable
          columns={[
            { header: '名称', cell: (k: any) => getName(k) },
            { header: '账号', cell: (k: any) => getAccount(k) },
            { header: '粉丝', cell: (k: any) => fmt(getFollowers(k)) },
            { header: '地区', cell: (k: any) => getRegion(k) },
            { header: '邮箱', cell: (k: any) => getEmail(k) || '-' },
          ]}
          rows={kols}
          limit={100}
          footer={kols.length > 100 && <div className="muted">表格仅预览前 100 条，下载 CSV 查看全部。</div>}
        />
      )}
    </div>
  )
}

/** 单个博主行：头像/昵称/主页链接/内容预览/关键指标，取值方式与 easykol-web 的 platform-adapters 一致 */
function KolItem({ kol: k, platform }: { kol: any; platform?: string }) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const p = normalizePlatform(k.platform ?? platform)
  const name = getDisplayName(k, p)
  const avatar = getAvatar(k, p)
  const profileUrl = safeHref(getProfileUrl(k, p))
  const region = getRegion(k)
  const contentImages = getContentImages(k).slice(0, 3)
  const profileHref = safeHref(profileUrl)
  return (
    <div className="kol-result-row" role="row">
      <div className="kol-select-cell">
        <input type="checkbox" disabled aria-label={`选择 ${name}`} />
      </div>
      <div className="kol-profile-cell">
        {avatar && !avatarFailed ? (
          <img className="kol-avatar" src={avatar} alt={name} referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />
        ) : (
          <div className="kol-avatar">{initialOf(name)}</div>
        )}
        <div className="kol-main">
          <div className="kol-name">
            {profileHref ? (
              <a href={profileHref} target="_blank" rel="noreferrer">{name}</a>
            ) : (
              name
            )}
            <span className="platform-mark" title={platformLabel(p)}>{platformIcon(p)}</span>
            {getEmail(k) && <span className="mail-mark" title={getEmail(k)}>✉</span>}
          </div>
          <div className="kol-account">
            {getAccount(k)}
            <span className="copy-mark" aria-hidden="true">□</span>
          </div>
          <div className="kol-region">
            {flagOf(region) && <span className="kol-flag" title={region}>{flagOf(region)}</span>}
            {countryLabel(region)}
          </div>
          <div className="kol-tags">
            {getTags(k).slice(0, 2).map((tag, i) => (
              <span key={`${tag}-${i}`}>{tag}</span>
            ))}
            {getTags(k).length > 2 && <span>...</span>}
          </div>
        </div>
      </div>
      <div className="kol-content-cell">
        {contentImages.length > 0 ? (
          contentImages.map((src, i) => (
            <img key={`${src}-${i}`} src={src} alt="" referrerPolicy="no-referrer" />
          ))
        ) : (
          <div className="kol-content-empty">暂无内容预览</div>
        )}
      </div>
      <MetricCell label="粉丝数" value={fmt(getFollowers(k))} />
      <MetricCell label={secondaryLabel(p)} value={getSecondaryStatValue(k, p)} />
      <MetricCell label="互动率" value={getEngagementRate(k)} />
      <MetricCell label="最新视频" value={getLatestPublishDate(k)} />
      <div className="kol-row-actions">
        {profileHref ? (
          <a className="kol-action-link" href={profileHref} target="_blank" rel="noreferrer">主页</a>
        ) : (
          <span className="kol-action-link disabled">主页</span>
        )}
        <button className="kol-action-btn" disabled>找相似</button>
      </div>
    </div>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="kol-metric-cell">
      <div className="kol-metric-label">{label}</div>
      <div className="kol-metric-value">{value}</div>
    </div>
  )
}

function CommentsCard({ data }: { data: any }) {
  const [busy, setBusy] = useState(false)
  const comments: any[] = data.comments ?? []
  const hasComments = comments.length > 0
  return (
    <div className="card">
      <div className="card-title">
        评论（{data.total ?? comments.length}）
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
        {!hasComments && (
          <div className="muted">
            本次任务没有抓取到评论。可以先下载 Excel 留档；若要继续分析，请换真实公开视频链接或确认评论区公开。
          </div>
        )}
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
  const items = Object.entries(data ?? {})
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .map(([k, v]) => ({ key: k, value: String(v), label: k }))
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <StatGrid items={items} />
    </div>
  )
}

function TrackingSummaryCard({ data }: { data: any }) {
  const totalVideos = data?.totalVideos ?? 0
  const totalViews = data?.totalViews ?? 0
  const cost = data?.cost ?? 0
  const cpm = data?.cpm ?? 0
  const videosWithCost = data?.videosWithCost ?? 0
  const viewsWithCost = data?.viewsWithCost ?? 0
  const hasCost = videosWithCost > 0 || cost > 0
  return (
    <div className="card">
      <div className="card-title">投放数据汇总</div>
      <StatGrid
        items={[
          { key: 'videos', value: fmt(totalVideos), label: '追踪视频' },
          { key: 'views', value: fmt(totalViews), label: '总播放量' },
          { key: 'cost', value: hasCost ? fmtMoney(cost) : '-', label: '已录入成本' },
          { key: 'cpm', value: hasCost ? fmtMoney(cpm) : '-', label: 'CPM' },
        ]}
      />
      {!hasCost && totalVideos > 0 && (
        <div className="muted">当前追踪内容还没有录入成本，因此暂时无法计算真实 CPM。</div>
      )}
      {hasCost && (
        <div className="muted">
          已录入成本的视频 {fmt(videosWithCost)} 条，覆盖播放量 {fmt(viewsWithCost)}。
        </div>
      )}
    </div>
  )
}

function ComparisonCard({ data }: { data: any }) {
  const rows = Object.entries(data.comparison ?? {}) as [string, any][]
  return (
    <div className="card">
      <div className="card-title">表现对比（基线 {data.baselineCount} 条）</div>
      <DataTable
        compact={false}
        columns={[
          { header: '指标', cell: ([metric]) => metric },
          { header: '本条', cell: ([, c]) => fmt(c.target) },
          { header: '基线中位数', cell: ([, c]) => fmt(c.baseline?.median) },
          { header: '倍数', cell: ([, c]) => c.vsMedian ?? '-' },
          { header: '百分位', cell: ([, c]) => (c.percentile != null ? `P${c.percentile}` : '-') },
        ]}
        rows={rows}
        rowKey={([metric]) => metric}
      />
    </div>
  )
}

/** 评论反馈分析：结构化（正/负面/高频问题）优先，旧数据回退纯文本 */
function CommentAnalysisCard({ data }: { data: any }) {
  if (!data.positives && !data.negatives) {
    return (
      <div className="card">
        <div className="card-title">评论反馈分析（{data.analyzedComments} 条）</div>
        <MarkdownText text={data.analysis || ''} />
      </div>
    )
  }
  const sentiment = data.sentiment
  return (
    <div className="card">
      <div className="card-title">评论反馈分析（{data.analyzedComments} 条）</div>
      {sentiment && (
        <StatGrid
          items={[
            { key: 'positive', value: `${sentiment.positivePct}%`, label: '正面' },
            { key: 'negative', value: `${sentiment.negativePct}%`, label: '负面' },
            { key: 'neutral', value: `${sentiment.neutralPct}%`, label: '中性' },
          ]}
        />
      )}
      {data.summary && <p className="analysis-summary">{data.summary}</p>}
      <FeedbackSection title="👍 正面反馈" items={data.positives} />
      <FeedbackSection title="👎 负面反馈" items={data.negatives} />
      <FeedbackSection title="购买意向" items={data.purchaseIntent} />
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
      {data.recommendedActions?.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title">下一步建议</div>
          <ul className="analysis-list">
            {data.recommendedActions.map((action: string, i: number) => (
              <li key={i}>{action}</li>
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
      <StatGrid
        items={[
          { key: 'inserted', value: data.inserted ?? '-', label: '已入队' },
          { key: 'receivers', value: data.receivers ?? '-', label: '收件人' },
        ]}
      />
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
        <StatGrid
          items={Object.entries(stats)
            .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
            .map(([k, v]) => ({ key: k, value: String(v), label: k }))}
        />
      )}
      <DataTable
        columns={[
          { header: '收件人', cell: (r: any) => r.to ?? '-' },
          { header: '主题', cell: (r: any) => r.subject ?? '-' },
          { header: '状态', cell: (r: any) => EMAIL_STATUS_LABELS[r.status] ?? r.status ?? '-' },
          { header: '发送时间', cell: (r: any) => fmtDate(r.sentAt) },
          { header: '已读', cell: (r: any) => (r.isRead ? `是${r.readCount ? ` (${r.readCount})` : ''}` : '否') },
          { header: '跟进', cell: (r: any) => r.followups?.length ?? 0 },
        ]}
        rows={list}
        limit={100}
        footer={list.length > 100 && <div className="muted">仅展示前 100 条。</div>}
      />
    </div>
  )
}

function OutreachQueueCard({ data }: { data: any }) {
  const list: any[] = data.list ?? []
  const total = data.pagination?.total ?? list.length
  return (
    <div className="card">
      <div className="card-title">自动邮件队列（共 {total} 条）</div>
      <DataTable
        columns={[
          { header: '收件人', cell: (p: any) => (p.nickname ? `${p.nickname}（${p.email}）` : p.email ?? '-') },
          { header: '发件邮箱', cell: (p: any) => p.from ?? '-' },
          { header: '状态', cell: (p: any) => EMAIL_STATUS_LABELS[p.status] ?? p.status ?? '-' },
          { header: '模板', cell: (p: any) => p.template?.templateName ?? p.template?.templateId ?? '-' },
          { header: '计划发送时间', cell: (p: any) => fmtDate(p.scheduledAt) },
          { header: '计划 ID', cell: (p: any) => <span className="muted">{p.id}</span> },
        ]}
        rows={list}
        limit={100}
        footer={list.length > 100 && <div className="muted">仅展示前 100 条。</div>}
      />
    </div>
  )
}

function TrackingListCard({ data }: { data: any }) {
  const rows: any[] = data.data ?? []
  return (
    <div className="card">
      <div className="card-title">投放数据明细（共 {data.total ?? rows.length} 条）</div>
      <DataTable
        columns={[
          { header: '博主', cell: (p: any) => p.nickName ?? p.influencer ?? '-' },
          { header: '平台', cell: (p: any) => p.platform ?? '-' },
          { header: '发布日期', cell: (p: any) => fmtDate(p.publishDate) },
          { header: '播放', cell: (p: any) => fmt(p.views) },
          { header: '点赞', cell: (p: any) => fmt(p.likes) },
          { header: '评论', cell: (p: any) => fmt(p.comments) },
          { header: '分享', cell: (p: any) => fmt(p.shares) },
          { header: '互动率', cell: (p: any) => (p.engagementRate != null ? `${p.engagementRate}%` : '-') },
          { header: 'CPM', cell: (p: any) => p.cpm ?? '-' },
          {
            header: '链接',
            cell: (p: any) =>
              safeHref(p.postLink) ? (
                <a href={safeHref(p.postLink)} target="_blank" rel="noreferrer">查看</a>
              ) : (
                '-'
              ),
          },
        ]}
        rows={rows}
        limit={100}
        footer={rows.length > 100 && <div className="muted">仅展示前 100 条。</div>}
      />
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
      <DataTable
        columns={[
          { header: '类型', cell: (t: any) => t.type ?? '-' },
          { header: '状态', cell: (t: any) => TASK_STATUS_LABELS[t.status] ?? t.status ?? '-' },
          { header: '创建时间', cell: (t: any) => fmtDate(t.createdAt) },
          { header: '任务 ID', cell: (t: any) => <span className="muted">{t.id}</span> },
        ]}
        rows={tasks}
        limit={50}
      />
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
      <StatGrid
        items={[
          { key: 'ok', value: ok.length, label: '成功' },
          ...(failed.length > 0 ? [{ key: 'failed', value: failed.length, label: '失败' }] : []),
        ]}
      />
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
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  const selectedText = buildIntentSelectionText(selectedTags, selectedKeywords)
  return (
    <div className="card intent-card">
      <div className="card-title">
        搜索条件选择{data.platform ? `（${data.platform}）` : ''}
        <span className="intent-selected-count">已选 {selectedTags.length + selectedKeywords.length}</span>
      </div>
      {tags.length > 0 && (
        <div className="intent-section">
          <div className="intent-section-head">
            <div>
              <div className="intent-section-title">达人标签</div>
              <div className="intent-section-desc">适合控制内容垂类、场景、风格等确定条件</div>
            </div>
            <span>{tags.length} 项</span>
          </div>
          <div className="intent-option-grid">
            {tags.map((t, i) => (
              <IntentOption
                key={`${t.name}-${i}`}
                active={selectedTags.includes(t.name)}
                label={t.name}
                count={t.count}
                onClick={() => setSelectedTags((current) => toggleValue(current, t.name))}
              />
            ))}
          </div>
        </div>
      )}
      {keywords.length > 0 && (
        <div className="intent-section">
          <div className="intent-section-head">
            <div>
              <div className="intent-section-title">关键词</div>
              <div className="intent-section-desc">适合扩大召回，按达人简介或内容原文匹配</div>
            </div>
            <span>{keywords.length} 项</span>
          </div>
          <div className="intent-option-grid">
            {keywords.map((k, i) => (
              <IntentOption
                key={`${k.name}-${i}`}
                active={selectedKeywords.includes(k.name)}
                label={k.name}
                count={k.count}
                meta={k.source === 'ai' ? 'AI 推荐' : undefined}
                onClick={() => setSelectedKeywords((current) => toggleValue(current, k.name))}
              />
            ))}
          </div>
        </div>
      )}
      {data.mustExclude?.length > 0 && (
        <div className="intent-exclude">排除词：{data.mustExclude.join('、')}</div>
      )}
      <div className="intent-selection-bar">
        <div className="intent-selection-text">
          {selectedText || '选择标签或关键词后，我会按这些条件继续搜索。'}
        </div>
        <div className="intent-selection-actions">
          <button
            className="intent-action"
            disabled={!selectedText}
            onClick={() => {
              setSelectedTags([])
              setSelectedKeywords([])
            }}
          >
            清空
          </button>
          <button
            className="intent-action primary"
            disabled={!selectedText}
            onClick={() => {
              if (!selectedText) return
              window.dispatchEvent(new CustomEvent('ek-assistant:intent-search', { detail: selectedText }))
            }}
          >
            搜索
          </button>
        </div>
      </div>
    </div>
  )
}

function IntentOption({
  active,
  label,
  count,
  meta,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  meta?: string
  onClick: () => void
}) {
  return (
    <button className={`intent-option ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <span className="intent-option-check">{active ? '✓' : ''}</span>
      <span className="intent-option-main">
        <span className="intent-option-name">{label}</span>
        <span className="intent-option-meta">
          {meta ? `${meta} · ` : ''}
          {fmt(count)}
        </span>
      </span>
    </button>
  )
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

function buildIntentSelectionText(tags: string[], keywords: string[]): string {
  const parts = []
  if (tags.length) parts.push(`保留达人标签：${tags.join('、')}`)
  if (keywords.length) parts.push(`保留关键词：${keywords.join('、')}`)
  return parts.length ? `${parts.join('；')}，请按这些条件搜索达人。` : ''
}

function ExportResultCard({ data }: { data: any }) {
  return (
    <div className="card">
      <div className="card-title">✅ {data.title ?? '导出完成'}</div>
      <DownloadLink
        url={data.url}
        label={`下载 ${data.fileName ?? 'Excel 文件'}`}
        fallback={<div className="muted">没有可下载的文件</div>}
      />
    </div>
  )
}

function KolEmailsCard({ data }: { data: any }) {
  const receivers: any[] = data.receivers ?? []
  return (
    <div className="card">
      <div className="card-title">
        邮箱提取结果
        <DownloadLink url={data.downloadUrl} label="下载 Excel" />
      </div>
      <StatGrid
        items={[
          { key: 'total', value: data.totalCount ?? '-', label: '查询达人' },
          { key: 'email', value: data.emailCount ?? '-', label: '发现邮箱' },
        ]}
      />
      <DataTable
        columns={[
          { header: '达人', cell: (r: any) => r.nickname ?? '-' },
          { header: '邮箱', cell: (r: any) => r.email },
          { header: '平台', cell: (r: any) => r.platform ?? '-' },
        ]}
        rows={receivers}
        limit={100}
        footer={receivers.length > 100 && <div className="muted">仅展示前 100 条，下载 Excel 查看全部。</div>}
      />
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
      <DataTable
        columns={[
          { header: '标题', cell: (c: any) => c.title ?? '-' },
          { header: '账号', cell: (c: any) => c.uniqueId ?? c.platformAccount ?? '-' },
          { header: '平台', cell: (c: any) => c.platform ?? '-' },
          { header: '播放', cell: (c: any) => fmt(c.viewCount) },
          { header: '点赞', cell: (c: any) => fmt(c.likeCount) },
          { header: '评论', cell: (c: any) => fmt(c.commentCount) },
          { header: '命中标签', cell: (c: any) => (c.hitTags ?? []).join('、') || '-' },
        ]}
        rows={rows}
        limit={100}
        footer={rows.length > 100 && <div className="muted">仅展示前 100 条。</div>}
      />
    </div>
  )
}

/** 受众画像卡片：画像/地区/假粉雷达按对象泛化渲染成分区 stat */
function AudienceAnalysisCard({ data }: { data: any }) {
  return (
    <div className="card">
      <div className="card-title">
        受众画像（{data.source} · {data.platform}）
        <DownloadLink url={data.exportUrl} label="下载 Excel" />
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
      <StatGrid items={flat.slice(0, 12).map(([k, v]) => ({ key: k, value: formatStatValue(v), label: k }))} />
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
      <StatGrid
        items={Object.entries(breakdown).map(([k, v]) => ({
          key: k,
          value: `${Math.round((v / total) * 100)}%`,
          label: `${FAKE_RESULT_LABELS[k] ?? k}（${v}）`,
        }))}
      />
      <details>
        <summary>抽样明细（{accounts.length}）</summary>
        <DataTable
          columns={[
            { header: '账号', cell: (a: any) => a.username },
            { header: '判定', cell: (a: any) => FAKE_RESULT_LABELS[a.result] ?? a.result },
            { header: '理由', cell: (a: any) => a.reason ?? '-' },
          ]}
          rows={accounts}
        />
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
        <StatGrid
          items={data.items.map((item: { label: string; value: unknown }, i: number) => ({
            key: i,
            value: String(item.value ?? '-'),
            label: item.label,
          }))}
        />
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

function fmtMoney(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function getName(k: any): string {
  return k.title ?? k.nickName ?? k.nickname ?? k.name ?? '未命名达人'
}

function normalizePlatform(platform: unknown): string {
  return String(platform ?? '').toUpperCase()
}

function platformLabel(platform: string): string {
  if (platform === 'TIKTOK') return 'TikTok'
  if (platform === 'INSTAGRAM') return 'Instagram'
  if (platform === 'YOUTUBE') return 'YouTube'
  return ''
}

function platformIcon(platform: string): string {
  if (platform === 'TIKTOK') return '♪'
  if (platform === 'INSTAGRAM') return '◎'
  if (platform === 'YOUTUBE') return '▶'
  return '人'
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

function secondaryLabel(platform: string): string {
  if (platform === 'INSTAGRAM') return '平均点赞'
  if (platform === 'YOUTUBE') return '平均观看'
  return '平均播放'
}

function getSecondaryStatValue(k: any, platform: string): string {
  const value =
    platform === 'INSTAGRAM'
      ? k.instagramUser?.averageLikeCount ?? k.averageLikeCount ?? k.avgLikes
      : platform === 'YOUTUBE'
        ? k.youtubeChannel?.videosAverageViewCount ?? k.averageViewCount ?? k.avgViews
        : k.tiktokUser?.averagePlayCount ?? k.averagePlayCount ?? k.averageViewCount ?? k.avgViews
  return fmt(value)
}

function getEngagementRate(k: any): string {
  const raw =
    k.engagementRate ??
    k.interactionRate ??
    nestedUser(k)?.engagementRate ??
    nestedUser(k)?.interactionRate
  if (typeof raw === 'string') return raw.includes('%') ? raw : `${raw}%`
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return '-'
  const pct = raw > 0 && raw <= 1 ? raw * 100 : raw
  return `${pct.toFixed(2)}%`
}

function getLatestPublishDate(k: any): string {
  const value =
    k.latestPublishDate ??
    k.lastPublishDate ??
    k.lastPublishedAt ??
    k.publishDate ??
    nestedUser(k)?.latestPublishDate ??
    nestedUser(k)?.lastPublishDate ??
    nestedUser(k)?.lastPublishedAt
  return fmtShortDate(value)
}

function fmtShortDate(value: unknown): string {
  if (!value) return '-'
  const d = new Date(value as string)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function getContentImages(k: any): string[] {
  const lists = [
    k.posts,
    k.postList,
    k.videos,
    k.videoList,
    k.contents,
    k.recentPosts,
    k.recentVideos,
    k.tiktokVideos,
    k.instagramPosts,
    k.youtubeVideos,
    nestedUser(k)?.posts,
    nestedUser(k)?.videos,
  ].filter(Array.isArray) as any[][]
  const urls: string[] = []
  for (const list of lists) {
    for (const item of list) {
      const src = pickImageUrl(item)
      if (src && !urls.includes(src)) urls.push(src)
      if (urls.length >= 3) return urls
    }
  }
  return urls
}

function pickImageUrl(item: any): string {
  if (!item || typeof item !== 'object') return ''
  const value =
    item.cover ??
    item.coverUrl ??
    item.thumbnail ??
    item.thumbnailUrl ??
    item.image ??
    item.imageUrl ??
    item.displayUrl ??
    item.mediaUrl ??
    item.videoCover
  return safeHref(value) ?? ''
}

function getTags(k: any): string[] {
  const candidates = [
    k.tags,
    k.labels,
    k.categories,
    k.categoryTags,
    k.keywords,
    k.signatureTags,
  ]
  const values = candidates.flatMap((item) => {
    if (!Array.isArray(item)) return []
    return item.map((v) => (typeof v === 'string' ? v : v?.name ?? v?.label)).filter(Boolean)
  })
  const desc = typeof k.description === 'string' ? k.description : ''
  if (!values.length && desc) values.push(...desc.split(/[，,/#\s]+/).filter(Boolean).slice(0, 2))
  return [...new Set(values.map((v) => String(v)).filter(Boolean))]
}

function countryLabel(region: string): string {
  const code = String(region ?? '').trim().toUpperCase()
  const labels: Record<string, string> = {
    US: 'United States',
    GB: 'United Kingdom',
    UK: 'United Kingdom',
    CA: 'Canada',
    AU: 'Australia',
    JP: 'Japan',
    KR: 'South Korea',
    DE: 'Germany',
    FR: 'France',
  }
  return labels[code] ?? (region && region !== '地区未知' ? region : '地区未知')
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
  downloadBlob(blob, `kols-${Date.now()}.csv`)
}

function csvCell(value: unknown): string {
  let text = String(value ?? '').replace(/\r?\n/g, ' ')
  // 防 CSV 公式注入：KOL 昵称等来自抓取的第三方内容，以 =+-@ 开头的单元格
  // 在 Excel 打开时会被当公式执行，加前导单引号中和
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
