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
    '智能搜索 KOL 达人。用自然语言描述想找的达人（kolDescription），可选关键词、地区、粉丝量等筛选。一次只搜索一个平台，平台参数名必须是 platform（不是 platforms），取值为 TIKTOK/YOUTUBE/INSTAGRAM；多平台需求请拆成多次调用。消耗用户配额（TikTok/YouTube 每批约10分，Instagram 每批约20分）。翻页时传 nextPage=true 和上次的 projectId。',
  permission: 'quota',
  inputSchema: z.object({
    platform: z.enum(DISCOVERY_PLATFORMS).describe('单个平台；参数名必须是 platform，不存在 platforms 字段'),
    kolDescription: z.string().min(1).describe('想找的达人的自然语言描述，如"美妆护肤类、擅长测评的博主"'),
    keywords: z.array(z.string().max(100)).max(20).optional().describe('检索关键词（OR 关系）'),
    regions: z.array(z.string()).optional().describe('地区（ISO 两位国家码，如 US、JP）'),
    languages: z.array(z.string()).optional().describe('语言代码，如 en、zh'),
    minSubscribers: z.number().optional(),
    maxSubscribers: z.number().optional(),
    minAverageViews: z.number().optional().describe('最低平均播放量，TikTok/YouTube 使用'),
    maxAverageViews: z.number().optional().describe('最高平均播放量，TikTok/YouTube 使用'),
    minAverageLikes: z.number().optional().describe('最低平均点赞数，Instagram 使用'),
    maxAverageLikes: z.number().optional().describe('最高平均点赞数，Instagram 使用'),
    hasContactInfo: z.boolean().optional().describe('是否要求有邮箱/联系方式'),
    gender: z.string().optional().describe('达人性别标签，如 female/male 或 backend 支持的代码'),
    ageRange: z.string().optional().describe('达人年龄段标签，如 18-24 或 backend 支持的代码'),
    skinColor: z.string().optional().describe('肤色/族裔标签，按 backend 标签代码传入'),
    mainCategory: z.string().optional().describe('主垂类标签代码'),
    subCategory: z.string().optional().describe('子垂类标签代码'),
    tone: z.string().optional().describe('内容调性/风格标签代码'),
    hasTkShop: z.boolean().optional().describe('TikTok 达人是否有 Shop/橱窗'),
    isAmzPartner: z.boolean().optional().describe('Instagram 达人是否是 Amazon partner'),
    lastPublishedDays: z.number().int().min(1).max(3650).optional().describe('最近 N 天内发布过内容'),
    faceOnCamera: z.boolean().optional().describe('是否真人出镜'),
    voiceOver: z.boolean().optional().describe('是否有口播/旁白'),
    isVertical: z.boolean().optional().describe('是否垂类账号'),
    isCouple: z.boolean().optional().describe('是否情侣类账号'),
    hasKids: z.boolean().optional().describe('是否有孩子/亲子元素'),
    hasPets: z.boolean().optional().describe('是否有宠物元素'),
    useVisualScreening: z.boolean().optional().describe('是否启用 AI 视觉精筛'),
    mustWord: z.boolean().optional().describe('关键词是否必须命中'),
    mustExclude: z.array(z.string()).max(20).optional().describe('必须排除的词/标签'),
    formatTags: z.array(z.string()).max(50).optional().describe('视频形式标签'),
    sceneTags: z.array(z.string()).max(50).optional().describe('场景标签'),
    projectId: z.string().optional().describe('项目 ID；不传则自动创建新项目'),
    nextPage: z.boolean().optional().describe('true 表示在同一项目里换一批结果'),
    batchCount: z.number().int().min(1).max(10).optional().describe('批数，默认按 maxResults 自动推断；每批约50个结果'),
    maxResults: z.number().int().min(1).max(500).optional().describe('希望返回的结果数量，默认50，最多500'),
  }),
  estimateQuota: (input) =>
    (input.platform === 'INSTAGRAM' ? 20 : 10) * getBatchCount(input),
  summarize: (input) =>
    `在 ${input.platform} 搜索达人：${input.kolDescription.slice(0, 60)}`,
  execute: async (input, ctx) => {
    const projectId = await ensureProject(ctx, input.projectId)
    const batchCount = getBatchCount(input)
    const maxResults = Math.min(input.maxResults ?? batchCount * 50, 500)
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
      minVideosAverageViews: input.minAverageViews,
      maxVideosAverageViews: input.maxAverageViews,
      minAverageLikeCount: input.minAverageLikes,
      maxAverageLikeCount: input.maxAverageLikes,
      hasContactInfo: input.hasContactInfo,
      gender: input.gender,
      ageRange: input.ageRange,
      skinColor: input.skinColor,
      mainCategory: input.mainCategory,
      subCategory: input.subCategory,
      tone: input.tone,
      hasTkShop: input.hasTkShop,
      isAmzPartner: input.isAmzPartner,
      lastPublishedDays: input.lastPublishedDays,
      faceOnCamera: input.faceOnCamera,
      voiceOver: input.voiceOver,
      isVertical: input.isVertical,
      isCouple: input.isCouple,
      hasKids: input.hasKids,
      hasPets: input.hasPets,
      useVisualScreening: input.useVisualScreening,
      mustWord: input.mustWord,
      mustExclude: input.mustExclude,
      formatTags: input.formatTags,
      sceneTags: input.sceneTags,
      batchCount,
      ...(input.nextPage ? { excludeExistingInPool: true } : {}),
      ...(input.languages?.length ? { bloggerRequirements: { languages: input.languages } } : {}),
    }
    const task = await ctx.backend.post<TaskDetail>('/api/search/v2/web-search', body)
    const polled = await pollTask(ctx.backend, task)
    if (polled.status === 'FAILED') {
      return { forModel: { projectId, taskId: task.id, error: `搜索失败：${polled.message || '无更多结果'}` } }
    }
    const firstPage = await ctx.backend.get<{ data: any[]; total: number }>(
      '/api/search/web-search',
      { projectId, platform: input.platform, page: 1, pageSize: Math.min(maxResults, 100) },
    )
    const kols = [...(firstPage.data ?? [])]
    const pageSize = 100
    const maxPages = Math.ceil(maxResults / pageSize)
    for (let page = 2; page <= maxPages && kols.length < maxResults; page++) {
      const next = await ctx.backend.get<{ data: any[]; total: number }>('/api/search/web-search', {
        projectId,
        platform: input.platform,
        page,
        pageSize,
      })
      const rows = next.data ?? []
      if (!rows.length) break
      kols.push(...rows)
    }
    const limitedKols = kols.slice(0, maxResults)
    return {
      forModel: {
        projectId,
        taskId: task.id,
        total: firstPage.total,
        returned: limitedKols.length,
        kols: limitedKols.slice(0, 20).map(compactKol),
        note: limitedKols.length > 20 ? '仅展示前20个给模型，完整列表见界面卡片，可下载 CSV' : undefined,
      },
      display: {
        kind: 'kol-list',
        data: {
          projectId,
          platform: input.platform,
          total: firstPage.total,
          returned: limitedKols.length,
          kols: limitedKols,
        },
      },
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
    // 与 easykol-web 手动操作一致：TikTok 走 unionSearch，YouTube/Instagram 走 singleSearch
    const results =
      input.platform === 'TIKTOK'
        ? await ctx.backend.get<any>('/api/similars/unionSearch', { projectId, hasPost: true })
        : await ctx.backend.post<any>('/api/similars/singleSearch', { taskId: task.id, hasPost: true })
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

function getBatchCount(input: { batchCount?: number; maxResults?: number }): number {
  if (input.batchCount) return input.batchCount
  return Math.max(1, Math.min(10, Math.ceil((input.maxResults ?? 50) / 50)))
}
