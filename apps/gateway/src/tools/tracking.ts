import { z } from 'zod'
import { defineTool } from './types.js'
import { truncate } from './helpers.js'

const TRACK_PLATFORMS = [
  'TIKTOK',
  'YOUTUBE',
  'INSTAGRAM',
  'DOUYIN',
  'XHS',
  'FACEBOOK',
  'THREADS',
  'BILIBILI',
] as const

/** platform → track-new 请求体里的字段名 */
const PLATFORM_KEY: Record<(typeof TRACK_PLATFORMS)[number], string> = {
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  INSTAGRAM: 'instagram',
  DOUYIN: 'douyin',
  XHS: 'xhs',
  FACEBOOK: 'facebook',
  THREADS: 'threads',
  BILIBILI: 'bilibili',
}

export const trackPublications = defineTool({
  name: 'track_publications',
  description:
    '把合作视频/帖子链接加入投放数据追踪（播放/点赞/评论/互动率等指标会持续更新）。数据抓取在后台进行，稍后用 get_tracking_results 查看。注意：backend 会按链接数量扣配额。',
  permission: 'write_logged',
  inputSchema: z.object({
    platform: z.enum(TRACK_PLATFORMS),
    urls: z.array(z.string().url()).min(1).max(50).describe('要追踪的视频/帖子链接'),
    tagIds: z.array(z.string()).optional().describe('给这批追踪打的标签 ID'),
  }),
  summarize: (input) => `追踪 ${input.platform} 的 ${input.urls.length} 条发布数据`,
  execute: async (input, ctx) => {
    const body: Record<string, unknown> = {
      [PLATFORM_KEY[input.platform]]: { urls: input.urls },
      ...(input.tagIds?.length ? { tagIds: input.tagIds } : {}),
    }
    const task = await ctx.backend.post<{ id: string; status: string }>(
      '/api/publicationStatistics/task/track-new',
      body,
    )
    return {
      forModel: {
        taskId: task.id,
        status: task.status,
        tracked: input.urls.length,
        note: '追踪任务已创建，数据抓取在后台进行（通常几分钟内），之后可用 get_tracking_results 查看',
      },
      display: { kind: 'track-created', data: { taskId: task.id, platform: input.platform, urls: input.urls } },
    }
  },
})

export const getTrackingResults = defineTool({
  name: 'get_tracking_results',
  description:
    '查看投放追踪数据。view=summary 返回汇总（总视频数/总播放/成本/CPM）；view=list 返回单条明细（播放/点赞/评论/互动率等）。可按博主名、平台、日期范围筛选。只读，不消耗配额。',
  permission: 'auto',
  inputSchema: z.object({
    view: z.enum(['summary', 'list']),
    bloggerName: z.string().optional(),
    platforms: z.array(z.enum(TRACK_PLATFORMS)).optional(),
    startDate: z.string().optional().describe('YYYY-MM-DD'),
    endDate: z.string().optional().describe('YYYY-MM-DD'),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }),
  summarize: (input) => (input.view === 'summary' ? '查看投放数据汇总' : '查看投放数据明细'),
  execute: async (input, ctx) => {
    const filters = {
      bloggerName: input.bloggerName,
      platforms: input.platforms,
      startDate: input.startDate,
      endDate: input.endDate,
    }
    if (input.view === 'summary') {
      const summary = await ctx.backend.post('/api/publicationStatistics/summary', filters)
      return { forModel: summary as object, display: { kind: 'tracking-summary', data: summary } }
    }
    const result = await ctx.backend.post<{ data: any[]; total: number; page: number }>(
      '/api/publicationStatistics/publications',
      { ...filters, page: input.page ?? 1, pageSize: input.pageSize ?? 20 },
    )
    const rows = result.data ?? []
    return {
      forModel: {
        total: result.total,
        publications: rows.slice(0, 20).map((p) => ({
          id: p.id,
          blogger: p.nickName ?? p.influencer,
          platform: p.platform,
          publishDate: p.publishDate,
          views: p.views,
          likes: p.likes,
          comments: p.comments,
          shares: p.shares,
          engagementRate: p.engagementRate,
          cpm: p.cpm,
          postLink: p.postLink,
        })),
        note: rows.length > 20 ? '仅展示前20条，完整列表见界面卡片' : undefined,
      },
      display: { kind: 'tracking-list', data: result },
    }
  },
})

const TASK_TYPES = [
  'WEB_SEARCH',
  'SIMILAR',
  'EASYKOL_TRACK',
  'AUDIENCE_ANALYSIS',
  'COMPETITOR_TRACK',
  'KOL_EMAIL',
] as const

export const listMyTasks = defineTool({
  name: 'list_my_tasks',
  description:
    '查询我的后台任务。传 taskIds 查具体任务的状态与结果；或传 taskType 查该类型下所有未结束的任务。只读，不消耗配额。',
  permission: 'auto',
  inputSchema: z.object({
    taskIds: z.array(z.string()).min(1).max(50).optional().describe('任务 ID 列表'),
    taskType: z.enum(TASK_TYPES).optional().describe('任务类型（查未结束任务时用）'),
  }),
  summarize: (input) =>
    input.taskIds ? `查询 ${input.taskIds.length} 个任务状态` : `查询 ${input.taskType ?? ''} 未结束任务`,
  execute: async (input, ctx) => {
    if (input.taskIds?.length) {
      const tasks = await ctx.backend.post<any[]>('/api/tasks/batch', { taskIds: input.taskIds })
      return {
        forModel: {
          tasks: (tasks ?? []).map((t) => ({
            id: t.id,
            type: t.type,
            status: t.status,
            createdAt: t.createdAt,
            errors: t.errors ? truncate(JSON.stringify(t.errors), 200) : null,
          })),
        },
        display: { kind: 'task-list', data: tasks },
      }
    }
    if (!input.taskType) {
      return { forModel: { error: '请提供 taskIds 或 taskType 其中之一' } }
    }
    const tasks = await ctx.backend.get<any[]>('/api/tasks/user/unterminatedTasks', {
      taskType: input.taskType,
    })
    return {
      forModel: {
        tasks: (tasks ?? []).slice(0, 20).map((t) => ({
          id: t.id,
          type: t.type,
          status: t.status,
          projectId: t.projectId,
          createdAt: t.createdAt,
        })),
      },
      display: { kind: 'task-list', data: tasks },
    }
  },
})
