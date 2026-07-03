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
  return (
    <div className="card">
      <div className="card-title">
        <span>
          KOL 结果 {data.total != null ? `（共 ${data.total}，返回 ${data.returned ?? kols.length}）` : `（${kols.length}）`}
        </span>
        <button className="ghost" disabled={!kols.length} onClick={() => downloadKolsCsv(kols)}>
          ⬇ 下载 CSV
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>账号</th>
              <th>粉丝</th>
              <th>地区</th>
              <th>邮箱</th>
              <th>链接</th>
            </tr>
          </thead>
          <tbody>
            {kols.slice(0, 100).map((k, i) => (
              <tr key={i}>
                <td>{k.title ?? k.nickName ?? k.name ?? '-'}</td>
                <td>{k.platformAccount ?? k.account ?? k.uniqueId ?? '-'}</td>
                <td>{fmt(k.subscribers ?? k.followers)}</td>
                <td>{k.region ?? k.country ?? '-'}</td>
                <td>{k.email ?? '-'}</td>
                <td>{k.url ?? k.link ?? k.postLink ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {kols.length > 100 && <div className="muted">界面仅预览前 100 条，下载 CSV 查看全部。</div>}
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
    k.title ?? k.nickName ?? k.nickname ?? k.name ?? '',
    k.platformAccount ?? k.account ?? k.uniqueId ?? k.authorUniqueId ?? '',
    k.subscribers ?? k.followers ?? k.followerCount ?? '',
    k.region ?? k.country ?? '',
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
