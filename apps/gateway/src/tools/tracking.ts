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

function inferTrackingPlatform(url: string): (typeof TRACK_PLATFORMS)[number] | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (/(^|\.)tiktok\.com$/.test(host)) return 'TIKTOK'
  if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host)) return 'YOUTUBE'
  if (/(^|\.)instagram\.com$/.test(host)) return 'INSTAGRAM'
  if (/(^|\.)douyin\.com$/.test(host)) return 'DOUYIN'
  if (/(^|\.)xiaohongshu\.com$/.test(host) || /(^|\.)xhslink\.com$/.test(host)) return 'XHS'
  if (/(^|\.)facebook\.com$/.test(host) || /(^|\.)fb\.watch$/.test(host)) return 'FACEBOOK'
  if (/(^|\.)threads\.net$/.test(host)) return 'THREADS'
  if (/(^|\.)bilibili\.com$/.test(host) || /(^|\.)b23\.tv$/.test(host)) return 'BILIBILI'
  return null
}

function groupTrackingUrls(input: {
  platform?: (typeof TRACK_PLATFORMS)[number]
  urls: string[]
}) {
  const groups = new Map<(typeof TRACK_PLATFORMS)[number], string[]>()
  const unknown: string[] = []
  for (const url of input.urls) {
    const platform = input.platform ?? inferTrackingPlatform(url)
    if (!platform) {
      unknown.push(url)
      continue
    }
    groups.set(platform, [...(groups.get(platform) ?? []), url])
  }
  return { groups, unknown }
}

export const trackPublications = defineTool({
  name: 'track_publications',
  description:
    '把合作视频/帖子链接加入投放数据追踪（播放/点赞/评论/互动率等指标会持续更新）。平台可由链接自动识别：youtube.com/youtu.be=YOUTUBE，tiktok.com=TIKTOK，instagram.com=INSTAGRAM；不要在能从域名判断时反问用户平台。数据抓取在后台进行，用户稍后可以直接问"查看投放数据"。按链接数量扣配额（1 配额/条）。',
  permission: 'quota',
  estimateQuota: (input) => input.urls.length,
  inputSchema: z.object({
    platform: z.enum(TRACK_PLATFORMS).optional().describe('平台；不传则根据链接域名自动识别'),
    urls: z.array(z.string().url()).min(1).max(50).describe('要追踪的视频/帖子链接'),
    tagIds: z.array(z.string()).optional().describe('给这批追踪打的标签 ID'),
  }),
  summarize: (input) => {
    const { groups } = groupTrackingUrls(input)
    const platforms = [...groups.keys()].join(' / ') || input.platform || ''
    return `追踪 ${platforms} 的 ${input.urls.length} 条发布数据`
  },
  execute: async (input, ctx) => {
    const { groups, unknown } = groupTrackingUrls(input)
    if (unknown.length || !groups.size) {
      return {
        forModel: {
          error: '无法从链接识别平台，目前支持 YouTube / TikTok / Instagram 等公开视频或帖子链接',
          unknownUrls: unknown.slice(0, 5),
        },
      }
    }
    const body: Record<string, unknown> = {
      ...(input.tagIds?.length ? { tagIds: input.tagIds } : {}),
    }
    for (const [platform, urls] of groups) {
      body[PLATFORM_KEY[platform]] = { urls }
    }
    const task = await ctx.backend.post<{ id: string; status: string }>(
      '/api/publicationStatistics/task/track-new',
      body,
    )
    const platforms = [...groups.keys()]
    return {
      forModel: {
        taskId: task.id,
        status: task.status,
        tracked: input.urls.length,
        platforms,
        note: '追踪任务已创建，数据抓取在后台进行（通常几分钟内），之后可直接询问"查看投放数据"',
      },
      display: { kind: 'track-created', data: { taskId: task.id, platform: platforms.join(' / '), urls: input.urls } },
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

export const manageTracking = defineTool({
  name: 'manage_tracking',
  description:
    '管理已有的投放追踪数据：update_batch=按发布 ID 批量刷新数据（按条数扣配额，1 配额/条）；delete_batch=批量删除投放数据（免费）。发布 ID 从 get_tracking_results view=list 的结果里取。',
  permission: 'quota',
  estimateQuota: (input) => (input.action === 'update_batch' ? input.publicationIds.length : 0),
  inputSchema: z.object({
    action: z.enum(['update_batch', 'delete_batch']),
    publicationIds: z.array(z.string()).min(1).max(100).describe('发布数据 ID 列表'),
  }),
  summarize: (input) =>
    input.action === 'update_batch'
      ? `刷新 ${input.publicationIds.length} 条投放数据`
      : `删除 ${input.publicationIds.length} 条投放数据`,
  execute: async (input, ctx) => {
    if (input.action === 'update_batch') {
      const task = await ctx.backend.post<{ id?: string; taskId?: string }>(
        '/api/publicationStatistics/task/update-batch',
        { publicationIds: input.publicationIds },
      )
      const taskId = task?.id ?? task?.taskId
      return {
        forModel: {
          taskId,
          updating: input.publicationIds.length,
          note: '数据刷新任务已创建，在后台执行（通常几分钟内），之后用 get_tracking_results 查看最新数据',
        },
        display: {
          kind: 'op-result',
          data: {
            title: '✅ 数据刷新任务已创建',
            items: [
              { label: '刷新条数', value: input.publicationIds.length },
              ...(taskId ? [{ label: '任务 ID', value: taskId }] : []),
            ],
          },
        },
      }
    }
    await ctx.backend.post('/api/publicationStatistics/delete-batch', {
      publicationIds: input.publicationIds,
    })
    return {
      forModel: { deleted: input.publicationIds.length },
      display: {
        kind: 'op-result',
        data: {
          title: '✅ 投放数据已删除',
          items: [{ label: '删除条数', value: input.publicationIds.length }],
        },
      },
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
  'VIDEO_COMMENTS',
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
