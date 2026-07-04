import { z } from 'zod'
import { generateObject, generateText } from 'ai'
import { defineTool } from './types.js'
import { getModelPool } from '../ai/models.js'
import { truncate } from './helpers.js'

const COMMENT_PLATFORMS = ['TIKTOK', 'YOUTUBE'] as const

export interface FetchedComment {
  author: string
  text: string
  likeCount: number
  publishedAt: string | null
}

interface FetchCommentsResponse {
  platform: string
  url: string
  total: number
  comments: FetchedComment[]
}

interface VideoCommentsTaskCreated {
  id: string
  status: string
}

interface VideoCommentsTaskDetail {
  id: string
  status: string
  params: { platform: string; url: string; maxCount: number }
  result: { total: number; comments: FetchedComment[] } | null
  errors?: unknown
}

const TERMINAL_TASK_STATUS = new Set(['COMPLETED', 'FAILED'])

/** 从视频链接推断平台，避免要求模型必填枚举参数（小模型经常漏传） */
export function inferPlatform(url: string): (typeof COMMENT_PLATFORMS)[number] | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (/(^|\.)tiktok\.com$/.test(host)) return 'TIKTOK'
  if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host)) return 'YOUTUBE'
  return null
}

/**
 * 会话级评论缓存：analyze_comments_feedback 直接复用 export_comments 拉过的数据，
 * 不重复消耗配额。进程内缓存，1 小时过期。
 */
const commentCache = new Map<string, { at: number; data: FetchCommentsResponse }>()
const CACHE_TTL_MS = 60 * 60 * 1000

function cacheKey(sessionId: string, url: string) {
  return `${sessionId}:${url}`
}

export function getCachedComments(sessionId: string, url?: string): FetchCommentsResponse | null {
  const now = Date.now()
  for (const [key, entry] of commentCache) {
    if (now - entry.at > CACHE_TTL_MS) commentCache.delete(key)
  }
  if (url) {
    return commentCache.get(cacheKey(sessionId, url))?.data ?? null
  }
  // 未指定 url 时取该会话最近一次拉取
  let latest: { at: number; data: FetchCommentsResponse } | null = null
  for (const [key, entry] of commentCache) {
    if (key.startsWith(`${sessionId}:`) && (!latest || entry.at > latest.at)) latest = entry
  }
  return latest?.data ?? null
}

export const exportComments = defineTool({
  name: 'export_comments',
  description:
    '拉取某条视频的全部评论（支持 TIKTOK/YOUTUBE），供用户下载 Excel 或后续分析。消耗配额（每 100 条评论 1 个任务点，默认 200 条 = 2 点，任务失败自动退费）。拉取后可直接调用 analyze_comments_feedback 做反馈分析（不重复扣费）。',
  permission: 'quota',
  inputSchema: z.object({
    platform: z.enum(COMMENT_PLATFORMS).optional().describe('平台；不传则根据链接自动识别'),
    url: z.string().url().describe('视频链接'),
    maxCount: z.number().int().min(10).max(1000).optional().describe('最多拉取的评论数，默认200'),
  }),
  estimateQuota: (input) => Math.ceil((input.maxCount ?? 200) / 100),
  summarize: (input) =>
    `拉取 ${input.platform ?? inferPlatform(input.url) ?? ''} 视频评论：${truncate(input.url, 60)}`,
  execute: async (input, ctx) => {
    const platform = input.platform ?? inferPlatform(input.url)
    if (!platform) {
      return {
        forModel: {
          error: '无法从链接识别平台，目前仅支持 TikTok / YouTube 视频链接',
        },
      }
    }
    const maxCount = input.maxCount ?? 200
    // backend 为 create→poll 异步任务：创建任务后轮询直到终态
    const task = await ctx.backend.callBackendTask<
      VideoCommentsTaskCreated,
      VideoCommentsTaskDetail
    >({
      create: (client) =>
        client.post<VideoCommentsTaskCreated>('/api/videoComments/task', {
          platform,
          url: input.url,
          maxCount,
        }),
      poll: (client, created) =>
        client.get<VideoCommentsTaskDetail>(`/api/videoComments/task/${created.id}`),
      isDone: (t) => TERMINAL_TASK_STATUS.has(t.status),
      timeoutMs: 600_000, // 最多 1000 条需数十次串行分页，与 backend 任务超时对齐
    })
    if (task.status === 'FAILED' || !task.result) {
      return {
        forModel: {
          error: '评论拉取任务失败（任务点已自动退还），可稍后重试或换一个视频链接',
        },
      }
    }
    const result: FetchCommentsResponse = {
      platform,
      url: input.url,
      total: task.result.total,
      comments: task.result.comments,
    }
    commentCache.set(cacheKey(ctx.sessionId, input.url), { at: Date.now(), data: result })
    return {
      forModel: {
        url: input.url,
        total: result.total,
        fetched: result.comments.length,
        sample: result.comments.slice(0, 10).map((c) => truncate(c.text, 100)),
        note: '完整评论已缓存，可调用 analyze_comments_feedback 做反馈分析；用户可在界面卡片下载 Excel',
      },
      display: {
        kind: 'comments',
        data: {
          taskId: task.id,
          platform,
          url: input.url,
          maxCount,
          total: result.total,
          comments: result.comments.slice(0, 500),
        },
      },
    }
  },
})

export const analyzeCommentsFeedback = defineTool({
  name: 'analyze_comments_feedback',
  description:
    '对已拉取的视频评论做用户反馈分析：正面反馈、负面反馈、高频问题、总体情感倾向。需要先用 export_comments 拉取评论（本工具复用缓存，不消耗配额）。',
  permission: 'auto',
  inputSchema: z.object({
    url: z.string().optional().describe('视频链接；不传则分析本会话最近一次拉取的评论'),
    focus: z.string().optional().describe('分析侧重点，如"对产品 X 的评价"'),
  }),
  summarize: (input) => `分析视频评论反馈${input.focus ? `（侧重：${input.focus}）` : ''}`,
  execute: async (input, ctx) => {
    const cached = getCachedComments(ctx.sessionId, input.url)
    if (!cached) {
      return {
        forModel: {
          error: '没有可分析的评论缓存，请先用 export_comments 拉取该视频的评论',
        },
      }
    }
    // 控制输入体量：最多800条、总量约30k字符
    let budget = 30000
    const lines: string[] = []
    for (const c of cached.comments.slice(0, 800)) {
      const line = `[赞${c.likeCount}] ${c.text.replace(/\s+/g, ' ').slice(0, 200)}`
      if (budget - line.length < 0) break
      budget -= line.length
      lines.push(line)
    }

    const model = getModelPool()[0]
    if (!model) throw new Error('未配置任何模型 API Key，无法执行评论分析')
    const system =
      '你是社媒评论分析师。基于给定的视频评论输出反馈摘要：正面反馈要点（附代表性原句）、负面反馈要点（附代表性原句）、高频问题/疑问、总体情感倾向占比估计。只依据给定评论，不要编造。'
    const prompt = `${input.focus ? `分析侧重点：${input.focus}\n\n` : ''}视频（${cached.platform}）：${cached.url}\n共 ${cached.comments.length} 条评论（按点赞数附权重）：\n${lines.join('\n')}`

    // 优先结构化输出（前端分区渲染）；模型不支持/解析失败时回退纯文本
    try {
      const { object } = await generateObject({
        model: model.model,
        schema: FeedbackAnalysisSchema,
        system,
        prompt,
      })
      return {
        forModel: {
          analyzedComments: lines.length,
          summary: object.summary,
          sentiment: object.sentiment,
          positives: object.positives.map((p) => p.point),
          negatives: object.negatives.map((p) => p.point),
          questions: object.questions,
        },
        display: {
          kind: 'comment-analysis',
          data: { url: cached.url, analyzedComments: lines.length, ...object },
        },
      }
    } catch {
      const { text } = await generateText({ model: model.model, system, prompt })
      return {
        forModel: { analyzedComments: lines.length, analysis: text },
        display: { kind: 'comment-analysis', data: { url: cached.url, analyzedComments: lines.length, analysis: text } },
      }
    }
  },
})

const FeedbackAnalysisSchema = z.object({
  summary: z.string().describe('一句话总体结论'),
  sentiment: z.object({
    positivePct: z.number().min(0).max(100),
    negativePct: z.number().min(0).max(100),
    neutralPct: z.number().min(0).max(100),
  }),
  positives: z.array(z.object({ point: z.string(), quotes: z.array(z.string()).max(3) })).describe('正面反馈要点，quotes 为代表性评论原句'),
  negatives: z.array(z.object({ point: z.string(), quotes: z.array(z.string()).max(3) })),
  questions: z.array(z.string()).describe('评论区高频问题/疑问'),
})
