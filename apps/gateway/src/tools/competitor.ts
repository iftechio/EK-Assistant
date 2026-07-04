import { z } from 'zod'
import { defineTool } from './types.js'
import { compactKol, requireParam } from './helpers.js'

const PLATFORMS = ['TIKTOK', 'YOUTUBE', 'INSTAGRAM'] as const

export const trackCompetitors = defineTool({
  name: 'track_competitors',
  description:
    '竞品/对标追踪：按竞品相关标签持续发现投放过同类内容的达人。create=创建追踪（消耗配额：标签数×平台数×10，任务在后台跑，通常需要几分钟到更久）；list=查看我的竞品任务及状态；contents=查看某任务命中的内容（视频/帖子）；creators=查看某任务发现的达人。',
  permission: 'quota',
  inputSchema: z.object({
    action: z.enum(['create', 'list', 'contents', 'creators']),
    tags: z.array(z.string()).min(1).max(20).optional().describe('create 必填：竞品相关标签，也可用于 contents 过滤'),
    platforms: z
      .array(
        z.object({
          name: z.enum(PLATFORMS),
          minLikeCount: z.number().optional().describe('最小点赞数（TikTok/Instagram）'),
          minViewCount: z.number().optional().describe('最小播放量（YouTube）'),
        }),
      )
      .min(1)
      .optional()
      .describe('create 必填：要追踪的平台及门槛'),
    taskId: z.string().optional().describe('contents / creators 必填'),
    platform: z.enum(PLATFORMS).optional().describe('creators 的平台过滤'),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }),
  estimateQuota: (input) =>
    input.action === 'create' ? (input.tags?.length ?? 1) * (input.platforms?.length ?? 1) * 10 : 0,
  summarize: (input) => {
    const map: Record<string, string> = {
      create: `创建竞品追踪：${(input.tags ?? []).join('、')}`,
      list: '查看竞品追踪任务',
      contents: `查看竞品任务 ${input.taskId} 命中的内容`,
      creators: `查看竞品任务 ${input.taskId} 发现的达人`,
    }
    return map[input.action] ?? input.action
  },
  execute: async (input, ctx) => {
    switch (input.action) {
      case 'create': {
        const r = await ctx.backend.post<{ taskId: string; status: string; message: string }>(
          '/api/tasks/competitorTrack/create',
          { tags: requireParam(input.tags, 'tags'), platform: requireParam(input.platforms, 'platforms') },
        )
        return {
          forModel: {
            taskId: r.taskId,
            status: r.status,
            note: '竞品追踪任务已创建，内容发现在后台进行（可能需要较长时间）；稍后用 action=creators 查看发现的达人',
          },
          display: {
            kind: 'op-result',
            data: {
              title: '✅ 竞品追踪已创建',
              items: [
                { label: '标签', value: (input.tags ?? []).join('、') },
                { label: '平台', value: (input.platforms ?? []).map((p) => p.name).join('、') },
                { label: '任务 ID', value: r.taskId },
              ],
            },
          },
        }
      }
      case 'list': {
        const tasks = await ctx.backend.get<any[]>('/api/tasks/competitorTrack/list')
        return {
          forModel: {
            tasks: (tasks ?? []).slice(0, 20).map((t) => ({
              id: t.id,
              status: t.status,
              tags: t.params?.tags,
              platforms: t.params?.platform?.map((p: any) => p.name),
              resultUpdatedAt: t.resultUpdatedAt,
            })),
          },
          display: {
            kind: 'op-result',
            data: {
              title: `竞品追踪任务（${tasks?.length ?? 0}）`,
              list: (tasks ?? []).map(
                (t) => `${(t.params?.tags ?? []).join('、')} · ${t.status} · ${t.id}`,
              ),
            },
          },
        }
      }
      case 'contents': {
        const r = await ctx.backend.post<{ taskId: string; data: any[]; meta: { total: number } }>(
          `/api/tasks/competitorTrack/${encodeURIComponent(requireParam(input.taskId, 'taskId'))}`,
          { tags: input.tags, page: input.page ?? 1, pageSize: input.pageSize ?? 20 },
        )
        const rows = r.data ?? []
        return {
          forModel: {
            total: r.meta?.total,
            contents: rows.slice(0, 20).map((c) => ({
              title: c.title,
              account: c.uniqueId ?? c.platformAccount,
              platform: c.platform,
              views: c.viewCount,
              likes: c.likeCount,
              comments: c.commentCount,
              hitTags: c.hitTags,
            })),
          },
          display: { kind: 'competitor-posts', data: { taskId: input.taskId, total: r.meta?.total, contents: rows } },
        }
      }
      case 'creators': {
        const r = await ctx.backend.get<{ data: any[]; total: number }>(
          `/api/tasks/competitorTrack/${encodeURIComponent(requireParam(input.taskId, 'taskId'))}/creators`,
          { page: input.page ?? 1, pageSize: input.pageSize ?? 40, platform: input.platform },
        )
        const kols = r.data ?? []
        if (!kols.length) {
          return {
            forModel: {
              total: r.total ?? 0,
              note: '暂无发现的达人；任务可能还在跑，可用 action=list 查看状态后再来取',
            },
          }
        }
        return {
          forModel: {
            total: r.total,
            returned: kols.length,
            kols: kols.slice(0, 20).map(compactKol),
            note: kols.length > 20 ? '仅展示前20个，完整列表见界面卡片' : undefined,
          },
          display: { kind: 'kol-list', data: { taskId: input.taskId, total: r.total, kols } },
        }
      }
    }
  },
})
