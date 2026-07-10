import { Component, useEffect, useState, type ReactNode } from 'react'
import { downloadBlob, downloadCommentsExcel, listProjects, rateKolInProject, type ProjectSummary } from '../api'
import { safeHref } from '../safeHref'
import type { ToolDisplay } from '../types'
import MarkdownText from './MarkdownText'

type SearchRequirementState = {
  country: string
  language: string
  projectId: string
  followerMin: string
  followerMax: string
  viewMin: string
  viewMax: string
  skinTone: string
  gender: string
  age: string
  realPerson: boolean
  hasContact: boolean
  hasTikTokShop: boolean
}

const DEFAULT_REQUIREMENTS: SearchRequirementState = {
  country: '全球',
  language: '所有语言',
  projectId: '',
  followerMin: '1000',
  followerMax: '',
  viewMin: '1000',
  viewMax: '',
  skinTone: '不限',
  gender: '不限',
  age: '不限',
  realPerson: false,
  hasContact: false,
  hasTikTokShop: false,
}

const COUNTRY_OPTIONS = ['全球', '美国', '英国', '加拿大', '澳大利亚', '新加坡', '马来西亚', '菲律宾', '印度尼西亚', '泰国', '越南', '日本', '韩国']
const LANGUAGE_OPTIONS = ['所有语言', '英语', '中文', '西班牙语', '葡萄牙语', '法语', '德语', '日语', '韩语', '泰语', '越南语', '印尼语']
const SKIN_TONE_OPTIONS = ['不限', '浅肤色', '中等肤色', '深肤色']
const GENDER_OPTIONS = ['不限', '女性', '男性']
const AGE_OPTIONS = ['不限', '18-24', '25-34', '35-44', '45+']

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
  const [targetProject, setTargetProject] = useState<{ label: string; value: string } | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState(false)
  const preview = kols.slice(0, 20)
  const visibleEmailCount = preview.filter((k) => getEmail(k)).length
  const platform = normalizePlatform(data.platform ?? kols[0]?.platform)
  const platformName = platformLabel(platform)
  const shownCount = preview.length
  const currentProject = data.projectId ? projectTargetFromId(data.projectId, projects) : null
  const projectTarget = targetProject ?? currentProject

  useEffect(() => {
    let alive = true
    setProjectsLoading(true)
    setProjectsError(false)
    listProjects()
      .then((list) => {
        if (alive) setProjects(list)
      })
      .catch(() => {
        if (alive) setProjectsError(true)
      })
      .finally(() => {
        if (alive) setProjectsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])
  if (!kols.length) {
    return (
      <div className="card kol-card kol-results-card">
        <div className="kol-results-head">
          <div>
            <div className="kol-results-title">
              <span className="status-dot" />
              搜索结果
              {platformName && <PlatformBadge platform={platform} />}
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
          <div className="kol-filter-bar" aria-label="搜索摘要">
            <span className="filter-chip active">{platformName ? <PlatformBadge platform={platform} compact /> : '全平台'}</span>
            <span className="filter-chip">展示 {fmt(shownCount)} 位</span>
            <span className="filter-chip">{fmt(visibleEmailCount)} 位有邮箱</span>
            {data.source && <span className="filter-chip">种子 {String(data.source)}</span>}
            {data.mode && <span className="filter-chip">模式 {String(data.mode)}</span>}
          </div>
        </div>
        <div className="kol-actions">
          <label className="project-select-wrap">
            <span>项目</span>
            <select
              className="project-select"
              value={projectTarget?.value ?? ''}
              onChange={(event) => setTargetProject(projectTargetFromId(event.target.value, projects))}
            >
              {!projectTarget && <option value="">{projectsLoading ? '加载项目中' : '选择项目'}</option>}
              {currentProject && !projects.some((project) => project.id === currentProject.value) && (
                <option value={currentProject.value}>{currentProject.label}</option>
              )}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
              {projectsError && !projects.length && <option value="">项目加载失败</option>}
            </select>
          </label>
          <button className="ghost primary" disabled={!data.projectId} onClick={() => requestMoreKols(data, platformName || platform)}>
            再找一批
          </button>
          <button className="ghost" disabled={!kols.length} onClick={() => downloadKolsCsv(kols)}>
            下载 CSV
          </button>
        </div>
      </div>

      <div className="kol-table-shell" role="table" aria-label="达人搜索结果">
        {preview.map((k, i) => (
          <KolItem
            kol={k}
            platform={data.platform}
            projectTarget={projectTarget}
            key={`${getAccount(k)}-${i}`}
          />
        ))}
      </div>

      {kols.length > preview.length && (
        <div className="kol-more">已展示 {preview.length} / {kols.length}，下载 CSV 查看完整名单。</div>
      )}
    </div>
  )
}

/** 单个博主行：头像/昵称/主页链接/内容预览/关键指标，取值方式与 easykol-web 的 platform-adapters 一致 */
function KolItem({
  kol: k,
  platform,
  projectTarget,
}: {
  kol: any
  platform?: string
  projectTarget: { label: string; value: string } | null
}) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [rating, setRating] = useState<'LIKE' | 'DISLIKE' | null>(null)
  const [ratingBusy, setRatingBusy] = useState(false)
  const [ratingError, setRatingError] = useState('')
  const p = normalizePlatform(k.platform ?? platform)
  const name = getDisplayName(k, p)
  const avatar = getAvatar(k, p)
  const profileUrl = safeHref(getProfileUrl(k, p))
  const region = getRegion(k)
  const contentImages = getContentImages(k, 4)
  const profileHref = safeHref(profileUrl)
  const tags = getTags(k).slice(0, 4)
  const description = getDescription(k)
  const email = getEmail(k)
  return (
    <div className="kol-result-row" role="row">
      <div className="kol-profile-cell">
        {profileHref ? (
          <a className="kol-avatar-link" href={profileHref} target="_blank" rel="noreferrer" aria-label={`打开 ${name} 主页`}>
            {avatar && !avatarFailed ? (
              <img className="kol-avatar" src={avatar} alt={name} referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />
            ) : (
              <div className="kol-avatar">{initialOf(name)}</div>
            )}
          </a>
        ) : avatar && !avatarFailed ? (
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
          </div>
          <div className="kol-account">{getAccount(k)}</div>
          <div className="kol-region">
            {flagOf(region) && <span className="kol-flag" title={region}>{flagOf(region)}</span>}
            {countryLabel(region)}
          </div>
          <div className="kol-mini-metrics">
            <span>{fmt(getFollowers(k))} 粉丝</span>
            <span>{getSecondaryStatValue(k, p)} {secondaryShortLabel(p)}</span>
          </div>
        </div>
      </div>
      <div className="kol-detail-cell">
        <div className="kol-content-cell">
          {contentImages.length > 0 ? (
            contentImages.map((src, i) => (
              <img key={`${src}-${i}`} src={src} alt="" referrerPolicy="no-referrer" />
            ))
          ) : (
            <div className="kol-content-empty">暂无内容预览</div>
          )}
        </div>
        <div className="kol-insight-cell">
          {tags.length > 0 && (
            <div className="kol-tags">
              {tags.map((tag, i) => (
                <span key={`${tag}-${i}`}>{tag}</span>
              ))}
            </div>
          )}
          <div className="kol-description">{description || '暂无简介'}</div>
          {email && <div className="kol-email" title={email}>联系：{email}</div>}
        </div>
      </div>
      <div className="kol-row-actions">
        <button
          className={ratingError ? 'kol-action-btn collect error' : rating === 'LIKE' ? 'kol-action-btn collect active' : 'kol-action-btn collect'}
          disabled={ratingBusy || !projectTarget || !getKolId(k)}
          onClick={() => saveKolRating(k, projectTarget, 'LIKE', setRating, setRatingBusy, setRatingError)}
        >
          {ratingBusy ? '保存中' : ratingError ? '保存失败' : rating === 'LIKE' ? '已收藏' : '收藏'}
        </button>
        <button
          className={rating === 'DISLIKE' ? 'kol-action-btn reject active' : 'kol-action-btn reject'}
          disabled={ratingBusy || !projectTarget || !getKolId(k)}
          onClick={() => saveKolRating(k, projectTarget, 'DISLIKE', setRating, setRatingBusy, setRatingError)}
        >
          {ratingBusy ? '保存中' : rating === 'DISLIKE' ? '已标 No' : 'No'}
        </button>
        <button className="kol-action-btn" onClick={() => requestSimilarKols(k, p)}>
          找相似
        </button>
      </div>
    </div>
  )
}

function requestMoreKols(data: any, platformLabelText?: string) {
  const projectId = data.projectId
  if (!projectId) return
  const platformText = platformLabelText ? `${platformLabelText} ` : ''
  window.dispatchEvent(
    new CustomEvent('ek-assistant:intent-search', {
      detail: `基于当前搜索条件，在项目 ${projectId} 里继续换一批${platformText}达人；请使用 nextPage=true，排除已经展示过的结果。`,
    }),
  )
}

function projectTargetFromId(projectId: string, projects: ProjectSummary[]) {
  if (!projectId) return null
  const project = projects.find((item) => item.id === projectId)
  return {
    label: project?.title ?? '当前搜索项目',
    value: projectId,
  }
}

async function saveKolRating(
  kol: any,
  projectTarget: { label: string; value: string } | null,
  attitude: 'LIKE' | 'DISLIKE',
  setRating: (rating: 'LIKE' | 'DISLIKE') => void,
  setRatingBusy: (busy: boolean) => void,
  setRatingError: (error: string) => void,
) {
  const kolId = getKolId(kol)
  if (!projectTarget || !kolId) return
  setRatingBusy(true)
  setRatingError('')
  try {
    await rateKolInProject({ projectId: projectTarget.value, kolId, attitude })
    setRating(attitude)
  } catch {
    setRatingError('保存失败')
  } finally {
    setRatingBusy(false)
  }
}

function requestSimilarKols(kol: any, platform: string) {
  const source = getAccount(kol)
  window.dispatchEvent(
    new CustomEvent('ek-assistant:intent-search', {
      detail: `帮我找和 ${source} 相似的 ${platformLabel(platform) || platform} 达人。`,
    }),
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
  const platforms = String(data.platform ?? '')
    .split('/')
    .map((item) => normalizePlatform(item.trim()))
    .filter(Boolean)
  return (
    <div className="card track-created-card">
      <div className="track-created-head">
        <div className="track-created-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div>
          <div className="card-title track-created-title">已加入投放追踪</div>
          <div className="track-created-subtitle">
            {platforms.length > 0 && (
              <span className="track-platforms">
                {platforms.map((platform) => (
                  <PlatformBadge key={platform} platform={platform} compact />
                ))}
              </span>
            )}
            <span>{urls.length} 条内容</span>
          </div>
        </div>
      </div>
      <div className="track-link-list">
        {urls.slice(0, 20).map((u, i) => (
          <div key={i} className="track-link-row">
            <span>内容 {i + 1}</span>
            {safeHref(u) ? (
              <a href={safeHref(u)} target="_blank" rel="noreferrer">打开链接</a>
            ) : (
              <span className="muted">链接不可打开</span>
            )}
          </div>
        ))}
        {urls.length > 20 && <div className="muted">还有 {urls.length - 20} 条内容未展示。</div>}
      </div>
      <div className="track-created-footer">
        <div className="track-created-note">数据正在后台抓取，通常几分钟后可以查看播放、点赞、评论和互动表现。</div>
        <button
          className="track-result-btn"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('ek-assistant:intent-search', { detail: '查看刚刚加入追踪的投放数据明细，包括播放、点赞、评论和互动表现' }))
          }}
        >
          查看结果
        </button>
      </div>
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
  const tags: any[] = (data.canonicalTags ?? []).slice(0, 12)
  const keywords: any[] = (data.keywords ?? []).slice(0, 12)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  const [requirements, setRequirements] = useState<SearchRequirementState>(DEFAULT_REQUIREMENTS)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const selectedText = buildIntentSelectionText(selectedTags, selectedKeywords)
  const baseSearchText = selectedText || '请按当前基础要求搜索达人。'
  const searchText = appendSearchRequirements(baseSearchText, requirements, projects)

  useEffect(() => {
    let cancelled = false
    listProjects()
      .then((items) => {
        if (cancelled) return
        setProjects(items)
        setRequirements((prev) => (prev.projectId || !items[0] ? prev : { ...prev, projectId: items[0].id }))
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [])

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
      <section className="requirements-panel intent-requirements" aria-labelledby="intent-requirements-title">
        <div className="requirements-head">
          <h2 id="intent-requirements-title">基础要求</h2>
          <span>限制搜索范围，不决定内容匹配</span>
        </div>
        <div className="requirements-grid">
          <label className="requirement-field">
            <span>国家地区</span>
            <select
              value={requirements.country}
              onChange={(e) => setRequirements((prev) => ({ ...prev, country: e.target.value }))}
            >
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="requirement-field">
            <span>语言</span>
            <select
              value={requirements.language}
              onChange={(e) => setRequirements((prev) => ({ ...prev, language: e.target.value }))}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="requirement-field">
            <span>项目选择</span>
            <select
              value={requirements.projectId}
              onChange={(e) => setRequirements((prev) => ({ ...prev, projectId: e.target.value }))}
            >
              {projects.length === 0 && <option value="">Default Project</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title || 'Default Project'}
                </option>
              ))}
            </select>
          </label>
          <label className="requirement-field range-field">
            <span>粉丝数量</span>
            <div className="range-inputs">
              <input
                inputMode="numeric"
                value={requirements.followerMin}
                onChange={(e) => setRequirements((prev) => ({ ...prev, followerMin: numbersOnly(e.target.value) }))}
                aria-label="粉丝数量最小值"
              />
              <span aria-hidden="true">→</span>
              <input
                inputMode="numeric"
                value={requirements.followerMax}
                placeholder="∞"
                onChange={(e) => setRequirements((prev) => ({ ...prev, followerMax: numbersOnly(e.target.value) }))}
                aria-label="粉丝数量最大值"
              />
            </div>
          </label>
          <label className="requirement-field range-field">
            <span>平均播放量</span>
            <div className="range-inputs">
              <input
                inputMode="numeric"
                value={requirements.viewMin}
                onChange={(e) => setRequirements((prev) => ({ ...prev, viewMin: numbersOnly(e.target.value) }))}
                aria-label="平均播放量最小值"
              />
              <span aria-hidden="true">→</span>
              <input
                inputMode="numeric"
                value={requirements.viewMax}
                placeholder="∞"
                onChange={(e) => setRequirements((prev) => ({ ...prev, viewMax: numbersOnly(e.target.value) }))}
                aria-label="平均播放量最大值"
              />
            </div>
          </label>
          <label className="requirement-field">
            <span>肤色</span>
            <select
              value={requirements.skinTone}
              onChange={(e) => setRequirements((prev) => ({ ...prev, skinTone: e.target.value }))}
            >
              {SKIN_TONE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="requirement-field">
            <span>性别</span>
            <select
              value={requirements.gender}
              onChange={(e) => setRequirements((prev) => ({ ...prev, gender: e.target.value }))}
            >
              {GENDER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="requirement-field">
            <span>年龄</span>
            <select
              value={requirements.age}
              onChange={(e) => setRequirements((prev) => ({ ...prev, age: e.target.value }))}
            >
              {AGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="requirements-checks">
          <label>
            <input
              type="checkbox"
              checked={requirements.realPerson}
              onChange={(e) => setRequirements((prev) => ({ ...prev, realPerson: e.target.checked }))}
            />
            <span>真人出镜</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={requirements.hasContact}
              onChange={(e) => setRequirements((prev) => ({ ...prev, hasContact: e.target.checked }))}
            />
            <span>存在联系方式</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={requirements.hasTikTokShop}
              onChange={(e) => setRequirements((prev) => ({ ...prev, hasTikTokShop: e.target.checked }))}
            />
            <span>开通了 TK 橱窗</span>
          </label>
        </div>
      </section>
      <div className="intent-selection-bar">
        <div className="intent-selection-text">
          {selectedText || '未选择标签或关键词，将只按基础要求继续搜索。'}
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
            onClick={() => {
              window.dispatchEvent(new CustomEvent('ek-assistant:intent-search', { detail: searchText }))
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

function numbersOnly(value: string): string {
  return value.replace(/[^\d]/g, '')
}

function appendSearchRequirements(
  message: string,
  requirements: SearchRequirementState,
  projects: ProjectSummary[],
): string {
  if (!message || message.includes('搜索范围限制（只用于筛选，不用于内容匹配）')) return message
  const projectTitle =
    projects.find((project) => project.id === requirements.projectId)?.title ||
    (requirements.projectId ? requirements.projectId : 'Default Project')
  const flags = [
    requirements.realPerson ? '真人出镜' : '',
    requirements.hasContact ? '存在联系方式' : '',
    requirements.hasTikTokShop ? '开通了 TK 橱窗' : '',
  ].filter(Boolean)
  const lines = [
    '搜索范围限制（只用于筛选，不用于内容匹配）：',
    `- 国家地区：${requirements.country}`,
    `- 语言：${requirements.language}`,
    `- 项目选择：${projectTitle}`,
    `- 粉丝数量：${formatRange(requirements.followerMin, requirements.followerMax)}`,
    `- 平均播放量：${formatRange(requirements.viewMin, requirements.viewMax)}`,
    `- 肤色：${requirements.skinTone}`,
    `- 性别：${requirements.gender}`,
    `- 年龄：${requirements.age}`,
  ]
  if (flags.length) lines.push(`- 额外要求：${flags.join('、')}`)
  return `${message}\n\n${lines.join('\n')}`
}

function formatRange(min: string, max: string): string {
  const start = min.trim() || '不限'
  const end = max.trim() || '不限'
  return `${start} 至 ${end}`
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

/** 受众画像卡片：用业务标签展示关键判断，避免把后端字段名直接暴露给用户 */
function AudienceAnalysisCard({ data }: { data: any }) {
  const portrait = data.userPortraitResult ?? {}
  const region = data.regionAnalysisResult ?? {}
  const fake = data.fakeRadarData ?? {}
  const range = data.dataRangeStats ?? {}
  const ageItems = [
    { key: 'age18to25', label: '18-25 岁', value: readPercent(portrait, ['age.age18to25', 'age18to25']) },
    { key: 'age25to45', label: '25-45 岁', value: readPercent(portrait, ['age.age25to45', 'age25to45']) },
    { key: 'above45', label: '45 岁以上', value: readPercent(portrait, ['age.above45', 'above45']) },
    { key: 'under18', label: '18 岁以下', value: readPercent(portrait, ['age.under18', 'under18']) },
  ].filter((item) => item.value != null)
  const genderItems = [
    { key: 'female', label: '女性', value: readPercent(portrait, ['gender.female', 'female']) },
    { key: 'male', label: '男性', value: readPercent(portrait, ['gender.male', 'male']) },
  ].filter((item) => item.value != null)
  const fakeRate = readPercent(fake, ['suspectedFakeRate', 'fakeRate'])
  const fakeTone = fakeRate == null ? 'neutral' : fakeRate >= 40 ? 'danger' : fakeRate >= 20 ? 'warning' : 'success'
  const regionTotal = readNumber(region, ['total', 'countryCount', 'regionCount'])
  const regionItems = extractRegionItems(region)
  const fakeFacts = [
    { label: '分析视频', value: fmt(readNumber(fake, ['videoCount'])) },
    { label: '分析用户', value: fmt(readNumber(fake, ['totalUserCount'])) },
    { label: '疑似假号', value: fmt(readNumber(fake, ['suspectedFakeCount'])) },
    { label: '评论总数', value: fmt(readNumber(fake, ['totalCommentCount'])) },
    { label: '平均评论用户', value: fmtDecimal(readNumber(fake, ['avgCommentUserCount'])) },
    { label: '无地区用户', value: fmt(readNumber(fake, ['userWithoutCountryCount'])) },
    { label: '无地区用户占比', value: fmtPercent(readPercent(fake, ['userWithoutCountryRate'])) },
  ].filter((item) => item.value !== '-')
  const hasFakeRadar = fakeRate != null || fakeFacts.length > 0
  const rangeFacts = [
    { label: '采样倍数', value: fmt(readNumber(range, ['multiplier'])) },
    { label: '已分析视频', value: fmt(readNumber(range, ['videosAnalyzed'])) },
    { label: '已分析帖子', value: fmt(readNumber(range, ['postsAnalyzed'])) },
    { label: '评论用户', value: fmt(readNumber(range, ['commentUsersCount'])) },
    { label: '点赞抽样用户', value: fmt(readNumber(range, ['sampledLikesCount'])) },
    { label: '粉丝抽样用户', value: fmt(readNumber(range, ['followerUsersCount'])) },
    { label: '样本总用户数', value: fmt(readNumber(range, ['totalUsersAnalyzed'])) },
  ].filter((item) => item.value !== '-')

  return (
    <div className="card audience-card">
      <div className="audience-head">
        <div>
          <div className="card-title audience-title">受众分析</div>
          <div className="audience-subtitle">
            <span>{data.source ? `@${data.source}` : '达人账号'}</span>
            {data.platform && <PlatformBadge platform={normalizePlatform(data.platform)} compact />}
          </div>
        </div>
        <DownloadLink url={data.exportUrl} label="下载 Excel" />
      </div>

      {(rangeFacts.length > 0 || data.updatedAt) && (
        <div className="audience-meta-line">
          {rangeFacts.map((f, i) => (
            <span key={f.label}>
              {i > 0 && <span className="audience-meta-dot">·</span>}
              {f.label} {f.value}
            </span>
          ))}
          {data.updatedAt && (
            <span>
              {rangeFacts.length > 0 && <span className="audience-meta-dot">·</span>}
              分析于 {fmtDate(data.updatedAt)}
            </span>
          )}
        </div>
      )}

      {fakeRate != null && (
        <div className="audience-highlight-grid">
          <AudienceMetric value={`${fmtPercent(fakeRate)}`} label="疑似假粉率" tone={fakeTone} />
        </div>
      )}

      <div className="audience-panel-grid">
        <div className="audience-panel audience-panel-profile">
          <div className="audience-panel-title">用户画像</div>
          <AudienceBars items={ageItems} />
          <AudienceBars items={genderItems} />
        </div>
        <div className="audience-panel audience-panel-region">
          <div className="audience-panel-title">地区分布</div>
          <div className="audience-region-total">{regionTotal != null ? fmt(regionTotal) : '-'}</div>
          <div className="audience-region-label">覆盖地区</div>
          {regionItems.length > 0 && (
            <div className="audience-region-list">
              {regionItems.slice(0, 12).map((item) => (
                <span key={item.label}>{item.label}{item.value != null ? ` ${fmtPercent(item.value)}` : ''}</span>
              ))}
              {regionItems.length > 12 && <span>还有 {regionItems.length - 12} 个地区</span>}
            </div>
          )}
        </div>
        {hasFakeRadar && (
          <div className="audience-panel audience-panel-risk">
            <div className="audience-panel-title">风险雷达</div>
            {fakeRate != null && <div className={`audience-risk ${fakeTone}`}>{fmtPercent(fakeRate)} 疑似假粉</div>}
            <AudienceFactGrid items={fakeFacts} />
          </div>
        )}
      </div>
    </div>
  )
}

function AudienceMetric({
  value,
  label,
  tone = 'neutral',
}: {
  value: ReactNode
  label: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  return (
    <div className={`audience-metric ${tone}`}>
      <div className="audience-metric-value">{value}</div>
      <div className="audience-metric-label">{label}</div>
    </div>
  )
}

function AudienceBars({ items }: { items: { key: string; label: string; value: number | null }[] }) {
  if (!items.length) return <div className="audience-empty">暂无数据</div>
  return (
    <div className="audience-bars">
      {items.map((item) => (
        <div key={item.key} className="audience-bar-row">
          <span>{item.label}</span>
          <div className="audience-bar-track">
            <div className="audience-bar-fill" style={{ width: `${clampPercent(item.value)}%` }} />
          </div>
          <strong>{fmtPercent(item.value)}</strong>
        </div>
      ))}
    </div>
  )
}

function AudienceFactGrid({ items }: { items: { label: string; value: string }[] }) {
  if (!items.length) return <div className="audience-empty">暂无数据</div>
  return (
    <div className="audience-fact-grid">
      {items.map((item) => (
        <div key={item.label} className="audience-fact">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  )
}

function readNumber(obj: any, paths: string[]): number | null {
  for (const path of paths) {
    const directValue = obj?.[path]
    const nestedValue = path.split('.').reduce<any>((current, part) => current?.[part], obj)
    const parsed = parseNumericValue(directValue ?? nestedValue)
    if (parsed != null) return parsed
  }
  return null
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/,/g, '').replace(/%$/, '')
  if (!normalized || !Number.isFinite(Number(normalized))) return null
  return Number(normalized)
}

/** 百分比专用解析：字符串自带 % 号（如 "0.79%"）说明后端已经是百分比数值，不能再当比例乘 100；
 *  只有不带 % 的裸数字（如 0.31）才按比例猜测换算，避免 0.79% 被误判成 79% */
function parsePercentValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value <= 1 ? value * 100 : value
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const hadPercentSign = trimmed.endsWith('%')
  const normalized = trimmed.replace(/,/g, '').replace(/%$/, '')
  if (!normalized || !Number.isFinite(Number(normalized))) return null
  const num = Number(normalized)
  if (hadPercentSign) return num
  return num > 0 && num <= 1 ? num * 100 : num
}

function readPercent(obj: any, paths: string[]): number | null {
  for (const path of paths) {
    const directValue = obj?.[path]
    const nestedValue = path.split('.').reduce<any>((current, part) => current?.[part], obj)
    const parsed = parsePercentValue(directValue ?? nestedValue)
    if (parsed != null) return parsed
  }
  return null
}

function fmtPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`
}

function fmtDecimal(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return Number.isInteger(value) ? fmt(value) : value.toFixed(2)
}

function clampPercent(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function extractRegionItems(region: any): { label: string; value?: number }[] {
  const found: { label: string; value?: number }[] = []
  collectRegionItems(region, found)
  const seen = new Set<string>()
  return found
    .filter((item) => {
      const key = item.label.toLowerCase()
      if (!item.label || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
}

function collectRegionItems(value: any, out: { label: string; value?: number }[], parentKey = ''): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const label = regionLabelFromObject(item)
      const amount = regionValueFromObject(item)
      if (label && amount != null) out.push({ label, value: amount })
      collectRegionItems(item, out, parentKey)
    }
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (isIgnoredRegionKey(key)) continue
    const amount = parsePercentValue(child)
    if (amount != null && isRegionDistributionKey(key, parentKey)) {
      out.push({ label: displayRegionLabel(key), value: amount })
      continue
    }
    if (child && typeof child === 'object') collectRegionItems(child, out, key)
  }
}

function regionLabelFromObject(item: Record<string, unknown>): string {
  const raw =
    item.countryName ??
    item.country ??
    item.countryCode ??
    item.country_code ??
    item.regionName ??
    item.region ??
    item.regionCode ??
    item.code ??
    item.name ??
    item.label
  return typeof raw === 'string' && raw.trim() ? displayRegionLabel(raw.trim()) : ''
}

function regionValueFromObject(item: Record<string, unknown>): number | null {
  // rate/ratio/percent... 是占比字段要走百分比解析；value/count 是原始计数，不能按百分比猜测换算
  const percent = parsePercentValue(item.rate ?? item.ratio ?? item.percent ?? item.percentage ?? item.proportion ?? item.share)
  if (percent != null) return percent
  return parseNumericValue(item.value ?? item.count)
}

function isIgnoredRegionKey(key: string): boolean {
  return [
    'total',
    'count',
    'countryCount',
    'regionCount',
    'userWithoutCountryCount',
    'userWithoutCountryRate',
  ].includes(key)
}

function isRegionDistributionKey(key: string, parentKey: string): boolean {
  const combined = `${parentKey}.${key}`.toLowerCase()
  if (combined.includes('age') || combined.includes('gender') || combined.includes('fake')) return false
  if (combined.includes('country') || combined.includes('region') || combined.includes('area')) return true
  return /^[A-Z]{2,3}$/.test(key) || /^T[1-3]$/i.test(key)
}

// UK 不是标准 ISO 3166-1 alpha-2 码（标准码是 GB），Intl.DisplayNames 不认识，单独兜底
const REGION_CODE_ALIASES: Record<string, string> = { UK: 'GB' }

const regionDisplayNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['zh-CN'], { type: 'region' })
    : null

/** 把后端给的 ISO 地区码翻成中文名，覆盖全量国家/地区而不是维护一张写死的小表 */
function displayRegionLabel(label: string): string {
  const code = label.toUpperCase()
  if (/^T[1-3]$/.test(code)) return `${code} 地区`
  if (/^[A-Z]{2}$/.test(code) && regionDisplayNames) {
    try {
      const name = regionDisplayNames.of(REGION_CODE_ALIASES[code] ?? code)
      if (name && name !== code) return `${name} (${code})`
    } catch {
      // 不是合法地区码，原样返回
    }
  }
  return label
}

const FAKE_RESULT_LABELS: Record<string, string> = {
  realpeople: '真人',
  influencer: '网红',
  fakeaccounts: '疑似假号',
}

/** backend 返回的判定值大小写/空格不固定（"Real People" / realPeople 都见过），统一归一化后再查表 */
function fakeResultLabel(key: string): string {
  return FAKE_RESULT_LABELS[key.replace(/\s+/g, '').toLowerCase()] ?? key
}

/** classifyUser/calculateFakeScore（insInfo.service.ts）打分逻辑里固定的英文短语，逐条对照翻译 */
const FAKE_REASON_PHRASES: Array<[RegExp, string]> = [
  [/^Has Avatar$/, '有头像'],
  [/^Public Account$/, '公开账号'],
  [/^Followers > 3k$/, '粉丝数 > 3000'],
  [/^Following\/Follower Ratio < 0\.5$/, '关注/粉丝比 < 0.5'],
  [/^Anonymous\/Default Avatar \(-(\d+)\)$/, '匿名/默认头像 (-$1)'],
  [/^Username Contains Many Digits \(-1\)$/, '用户名含大量数字 (-1)'],
  [/^Zero Posts \(-1\)$/, '发帖数为 0 (-1)'],
  [/^Zero Followers \(-1\)$/, '粉丝数为 0 (-1)'],
  [/^Zero Following \(-1\)$/, '关注数为 0 (-1)'],
  [/^Posts > 50 \(\+4\)$/, '发帖数 > 50 (+4)'],
  [/^5 <= Posts <= 50 \(\+2\)$/, '发帖数 5-50 (+2)'],
  [/^1 <= Posts < 5 \(\+1\)$/, '发帖数 1-4 (+1)'],
  [/^Has Bio \(\+1\)$/, '有个人简介 (+1)'],
  [/^Full Name Differs from Username \(\+1\)$/, '昵称与用户名不同 (+1)'],
  [/^Followers > 60 \(\+2\)$/, '粉丝数 > 60 (+2)'],
  [/^20 <= Followers <= 60 \(\+1\)$/, '粉丝数 20-60 (+1)'],
  [/^Healthy Following\/Follower Ratio \(\+1\)$/, '关注/粉丝比健康 (+1)'],
  [/^Has External Link \(\+4\)$/, '有外部链接 (+4)'],
  [/^Has Highlight Reels \(\+4\)$/, '有精选故事 (+4)'],
  [/^Private Account$/, '私密账号'],
]

function translateFakeReasonClause(clause: string): string {
  const trimmed = clause.trim()
  for (const [pattern, replacement] of FAKE_REASON_PHRASES) {
    const match = trimmed.match(pattern)
    if (match) return match[1] != null ? replacement.replace('$1', match[1]) : replacement
  }
  return trimmed
}

/** "Score: 10 (Has Bio (+1), ...)" 这类打分理由翻成中文；未识别的短语原样保留，不吞信息 */
function translateFakeReason(reason: string | null | undefined): string {
  if (!reason) return '-'
  const scored = reason.match(/^Score:\s*(-?\d+)\s*\((.*)\)$/)
  if (scored) {
    const [, score, inner] = scored
    const clauses = inner ? inner.split(',').map(translateFakeReasonClause) : []
    return `评分 ${score}${clauses.length ? `（${clauses.join('、')}）` : ''}`
  }
  return reason.split(',').map(translateFakeReasonClause).join('、')
}

// 好 → 中性 → 风险的固定阅读顺序，不跟着 backend JSON 的 key 顺序随意摆
const FAKE_RESULT_ORDER = ['realpeople', 'influencer', 'fakeaccounts']

function fakeResultTone(key: string, pct: number): 'neutral' | 'success' | 'warning' | 'danger' {
  if (key.replace(/\s+/g, '').toLowerCase() !== 'fakeaccounts') return 'neutral'
  return pct >= 40 ? 'danger' : pct >= 20 ? 'warning' : 'success'
}

function FakeDetectionCard({ data }: { data: any }) {
  const breakdown: Record<string, number> = data.breakdown ?? {}
  const accounts: any[] = data.accounts ?? []
  const total = data.sampleTotal || 1
  const items = Object.entries(breakdown).sort(
    ([a], [b]) =>
      FAKE_RESULT_ORDER.indexOf(a.replace(/\s+/g, '').toLowerCase()) -
      FAKE_RESULT_ORDER.indexOf(b.replace(/\s+/g, '').toLowerCase()),
  )
  return (
    <div className="card">
      <div className="card-title">
        假粉检测（{data.mode === 'audience' ? '受众' : '帖子点赞'}）{data.fromCache ? ' · 缓存结果' : ''}
      </div>
      {data.target && <div className="muted">对象：{data.target}</div>}
      <div className="audience-highlight-grid">
        {items.map(([k, v]) => {
          const pct = Math.round((v / total) * 100)
          return <AudienceMetric key={k} value={`${pct}%`} label={`${fakeResultLabel(k)}（${v}）`} tone={fakeResultTone(k, pct)} />
        })}
      </div>
      <details>
        <summary>抽样明细（{accounts.length}）</summary>
        <DataTable
          columns={[
            { header: '账号', cell: (a: any) => <FakeAccountLink account={a} /> },
            { header: '判定', cell: (a: any) => fakeResultLabel(a.result) },
            { header: '理由', cell: (a: any) => translateFakeReason(a.reason) },
          ]}
          rows={accounts}
        />
      </details>
    </div>
  )
}

function FakeAccountLink({ account }: { account: any }) {
  const username = String(account.username ?? account.handler ?? account.uniqueId ?? '').replace(/^@/, '').trim()
  if (!username) return '-'
  const href = safeHref(account.profileUrl ?? account.url ?? `https://instagram.com/${username}`)
  if (!href) return username
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {username}
    </a>
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

function PlatformBadge({ platform, compact = false }: { platform: string; compact?: boolean }) {
  const normalized = normalizePlatform(platform)
  const label = platformLabel(normalized) || normalized
  return (
    <span className={`platform-badge ${normalized.toLowerCase()} ${compact ? 'compact' : ''}`}>
      <PlatformIcon platform={normalized} />
      <span>{label}</span>
    </span>
  )
}

function PlatformIcon({ platform }: { platform: string }) {
  const src =
    platform === 'INSTAGRAM'
      ? '/platform-icons/instagram.png'
      : platform === 'YOUTUBE'
        ? '/platform-icons/youtube.png'
        : platform === 'TIKTOK'
          ? '/platform-icons/tiktok.png'
          : ''
  if (src) return <img src={src} alt="" aria-hidden="true" />
  return <span className="platform-badge-fallback" aria-hidden="true">人</span>
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

function secondaryShortLabel(platform: string): string {
  if (platform === 'INSTAGRAM') return '均赞'
  if (platform === 'YOUTUBE') return '均观看'
  return '均播'
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

function getContentImages(k: any, limit = 3): string[] {
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
      if (urls.length >= limit) return urls
    }
  }
  return urls
}

function getDescription(k: any): string {
  const value =
    k.description ??
    k.signature ??
    k.bio ??
    k.introduction ??
    nestedUser(k)?.description ??
    nestedUser(k)?.signature ??
    nestedUser(k)?.bio ??
    ''
  return String(value || '').trim()
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

function getKolId(k: any): string {
  return k.kolId ?? k.id ?? nestedUser(k)?.kolId ?? nestedUser(k)?.id ?? ''
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
