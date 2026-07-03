import { z } from 'zod'
import type { BackendClient } from '../backend/client.js'
import { defineTool } from './types.js'
import { compactKol, ensureProject } from './helpers.js'

const DISCOVERY_PLATFORMS = ['TIKTOK', 'YOUTUBE', 'INSTAGRAM'] as const

interface TaskDetail {
  id: string
  status: string
  projectId: string
}

interface PollStatus {
  status: string
  message: string
}

const TERMINAL = new Set(['COMPLETED', 'RESULT_READY', 'FAILED'])

/** 轮询 backend 统一任务状态接口 GET /api/similars/:taskId */
export async function pollTask(backend: BackendClient, task: TaskDetail): Promise<PollStatus> {
  if (TERMINAL.has(task.status)) return { status: task.status, message: '' }
  return backend.callBackendTask<TaskDetail, PollStatus>({
    create: async () => task,
    poll: (client, t) => client.get<PollStatus>(`/api/similars/${t.id}`),
    isDone: (p) => TERMINAL.has(p.status),
  })
}

export const searchKols = defineTool({
  name: 'search_kols',
  description:
    '智能搜索 KOL 达人。用自然语言描述想找的达人（kolDescription），可选关键词、地区、粉丝量等筛选。支持 TIKTOK/YOUTUBE/INSTAGRAM。消耗用户配额（TikTok/YouTube 每批约10分，Instagram 每批约20分）。翻页时传 nextPage=true 和上次的 projectId。',
  permission: 'quota',
  inputSchema: z.object({
    platform: z.enum(DISCOVERY_PLATFORMS).describe('平台'),
    kolDescription: z.string().min(1).describe('想找的达人的自然语言描述，如"美妆护肤类、擅长测评的博主"'),
    keywords: z.array(z.string().max(100)).max(20).optional().describe('检索关键词（OR 关系）'),
    regions: z.array(z.string()).optional().describe('地区（ISO 两位国家码，如 US、JP）'),
    languages: z.array(z.string()).optional().describe('语言代码，如 en、zh'),
    minSubscribers: z.number().optional(),
    maxSubscribers: z.number().optional(),
    projectId: z.string().optional().describe('项目 ID；不传则自动创建新项目'),
    nextPage: z.boolean().optional().describe('true 表示在同一项目里换一批结果'),
    batchCount: z.number().int().min(1).max(2).optional().describe('批数，默认1；每批约50个结果'),
  }),
  estimateQuota: (input) =>
    (input.platform === 'INSTAGRAM' ? 20 : 10) * (input.batchCount ?? 1),
  summarize: (input) =>
    `在 ${input.platform} 搜索达人：${input.kolDescription.slice(0, 60)}`,
  execute: async (input, ctx) => {
    const projectId = await ensureProject(ctx, input.projectId)
    const body: Record<string, unknown> = {
      projectId,
      platform: input.platform,
      mode: 7,
      reason: input.nextPage ? 'NEXT_PAGE' : 'SEARCH',
      kolDescription: input.kolDescription,
      keywords: input.keywords,
      regions: input.regions,
      minSubscribers: input.minSubscribers,
      maxSubscribers: input.maxSubscribers,
      batchCount: input.batchCount ?? 1,
      ...(input.nextPage ? { excludeExistingInPool: true } : {}),
      ...(input.languages?.length ? { bloggerRequirements: { languages: input.languages } } : {}),
    }
    const task = await ctx.backend.post<TaskDetail>('/api/search/v2/web-search', body)
    const polled = await pollTask(ctx.backend, task)
    if (polled.status === 'FAILED') {
      return { forModel: { projectId, taskId: task.id, error: `搜索失败：${polled.message || '无更多结果'}` } }
    }
    const results = await ctx.backend.get<{ data: any[]; total: number }>(
      '/api/search/web-search',
      { projectId, platform: input.platform, page: 1, pageSize: 50 },
    )
    const kols = results.data ?? []
    return {
      forModel: {
        projectId,
        taskId: task.id,
        total: results.total,
        returned: kols.length,
        kols: kols.slice(0, 20).map(compactKol),
        note: kols.length > 20 ? '仅展示前20个，完整列表见界面卡片' : undefined,
      },
      display: { kind: 'kol-list', data: { projectId, platform: input.platform, total: results.total, kols: kols.slice(0, 50) } },
    }
  },
})

export const findSimilarKols = defineTool({
  name: 'find_similar_kols',
  description:
    '相似达人发现：给定一个种子达人（主页链接或账号），找相似的达人。支持 TIKTOK/YOUTUBE/INSTAGRAM。消耗配额（TikTok/YouTube 约10分/轮，Instagram 约20分）。',
  permission: 'quota',
  inputSchema: z.object({
    source: z.string().min(1).describe('种子达人：主页 URL 或账号名'),
    platform: z.enum(DISCOVERY_PLATFORMS),
    projectId: z.string().optional().describe('项目 ID；不传则自动创建'),
    regions: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    minSubscribers: z.number().optional(),
    maxSubscribers: z.number().optional(),
    kolDescription: z.string().optional().describe('对目标达人的额外要求描述'),
  }),
  estimateQuota: (input) => (input.platform === 'INSTAGRAM' ? 20 : 10),
  summarize: (input) => `在 ${input.platform} 找与 ${input.source} 相似的达人`,
  execute: async (input, ctx) => {
    const projectId = await ensureProject(ctx, input.projectId)
    const task = await ctx.backend.post<TaskDetail>('/api/similars/create', {
      projectId,
      source: input.source,
      platform: input.platform,
      reason: 'SEARCH',
      regions: input.regions,
      languages: input.languages,
      minSubscribers: input.minSubscribers,
      maxSubscribers: input.maxSubscribers,
      kolDescription: input.kolDescription,
      forceCreate: true,
    })
    const polled = await pollTask(ctx.backend, task)
    if (polled.status === 'FAILED') {
      return { forModel: { projectId, taskId: task.id, error: `相似发现失败：${polled.message}` } }
    }
    const results = await ctx.backend.post<any>('/api/similars/single-search', {
      taskId: task.id,
    })
    const list: any[] = Array.isArray(results) ? results : (results?.data ?? [])
    return {
      forModel: {
        projectId,
        taskId: task.id,
        returned: list.length,
        kols: list.slice(0, 20).map(compactKol),
        note: list.length > 20 ? '仅展示前20个，完整列表见界面卡片' : undefined,
      },
      display: { kind: 'kol-list', data: { projectId, platform: input.platform, source: input.source, kols: list.slice(0, 50) } },
    }
  },
})
