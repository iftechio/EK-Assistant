import { useState } from 'react'
import { downloadCommentsExcel } from '../api'
import type { ToolDisplay } from '../types'

/** 工具结果卡片：完整数据在这里渲染（模型上下文里只有截断版） */
export default function ToolCard({ display }: { display: ToolDisplay }) {
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
      return (
        <div className="card">
          <div className="card-title">评论反馈分析（{display.data.analyzedComments} 条）</div>
          <pre className="prewrap">{display.data.analysis}</pre>
        </div>
      )
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
          <div className="kol-item" key={`${getAccount(k)}-${i}`}>
            <div className="kol-avatar">{initialOf(getName(k))}</div>
            <div className="kol-main">
              <div className="kol-name">{getName(k)}</div>
              <div className="kol-account">{getAccount(k)}</div>
              <div className="kol-meta">
                <span>{fmt(getFollowers(k))} 粉丝</span>
                <span>{getRegion(k)}</span>
                {getEmail(k) && <span>有邮箱</span>}
              </div>
            </div>
          </div>
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
