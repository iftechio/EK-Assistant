import { z } from 'zod'
import { defineTool } from './types.js'
import { numericStats, percentileOf } from './helpers.js'

const METRICS = ['views', 'likes', 'comments', 'shares', 'engagementRate'] as const

/**
 * 合作视频 vs 达人平时表现对比归因。
 * 数值对比用确定性代码计算（中位数/百分位/倍数），不让 LLM 猜数字；
 * 归因推理由主模型基于返回的对比结果完成。
 * 基线来源：该达人其它已追踪的发布数据（MVP 口径；KOL 历史视频 JSON 基线为后续迭代）。
 */
export const compareCampaignPerformance = defineTool({
  name: 'compare_campaign_performance',
  description:
    '对比某条合作视频与该达人平时表现：给定博主名（和可选的目标视频链接），对播放/点赞/评论/互动率做中位数与百分位对比，返回确定性数字，供归因分析。基线取自该达人其它已追踪的发布。只读，不消耗配额。',
  permission: 'auto',
  inputSchema: z.object({
    bloggerName: z.string().min(1).describe('博主名（追踪数据里的 nickName）'),
    postLink: z.string().optional().describe('目标视频链接；不传则取该博主最新一条'),
    platforms: z.array(z.enum(['TIKTOK', 'YOUTUBE', 'INSTAGRAM', 'DOUYIN', 'XHS', 'BILIBILI'])).optional(),
  }),
  summarize: (input) => `对比 ${input.bloggerName} 的合作视频表现`,
  execute: async (input, ctx) => {
    const result = await ctx.backend.post<{ data: any[]; total: number }>(
      '/api/publicationStatistics/publications',
      { bloggerName: input.bloggerName, platforms: input.platforms, page: 1, pageSize: 100 },
    )
    const pubs = (result.data ?? []).filter((p) => p.views != null)
    if (!pubs.length) {
      return { forModel: { error: `没有找到 ${input.bloggerName} 的追踪数据，请先用 track_publications 添加追踪` } }
    }

    const target = input.postLink
      ? pubs.find((p) => normalizeLink(p.postLink) === normalizeLink(input.postLink))
      : [...pubs].sort((a, b) => String(b.publishDate ?? '').localeCompare(String(a.publishDate ?? '')))[0]
    if (!target) {
      return { forModel: { error: `在 ${input.bloggerName} 的追踪数据里没找到该链接，可先 track_publications 添加` } }
    }

    const baseline = pubs.filter((p) => p.id !== target.id)
    const comparison: Record<string, unknown> = {}
    for (const metric of METRICS) {
      const baseValues = baseline.map((p) => Number(p[metric])).filter(Number.isFinite)
      const targetValue = Number(target[metric])
      if (!Number.isFinite(targetValue)) continue
      const stats = numericStats(baseValues)
      comparison[metric] = {
        target: targetValue,
        baseline: stats,
        percentile: percentileOf(baseValues, targetValue),
        vsMedian: stats?.median ? Math.round((targetValue / stats.median) * 100) / 100 : null,
      }
    }

    return {
      forModel: {
        target: {
          id: target.id,
          postLink: target.postLink,
          publishDate: target.publishDate,
          platform: target.platform,
          followers: target.followers,
        },
        baselineCount: baseline.length,
        baselineNote:
          baseline.length < 3
            ? '基线样本少于3条（仅含该达人其它已追踪发布），对比结论置信度低，向用户说明这一点'
            : '基线为该达人其它已追踪发布的中位数',
        comparison,
        howToRead: 'vsMedian 为目标值/基线中位数的倍数；percentile 为目标值在基线中的百分位（0-100）',
      },
      display: { kind: 'performance-comparison', data: { target, baselineCount: baseline.length, comparison } },
    }
  },
})

/** 链接规范化后再比较：尾斜杠、query、协议差异都不应导致"没找到该链接" */
function normalizeLink(link: unknown): string {
  const s = String(link ?? '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return s.replace(/\/+$/, '').toLowerCase()
  }
}
