import { z } from 'zod'
import { defineTool } from './types.js'
import { requireParam } from './helpers.js'

const TERMINAL = new Set(['COMPLETED', 'FAILED'])

interface DownloadTaskCreated {
  taskId: string
  downloadType: string
  status: string
  message?: string
}

interface DownloadTaskDetail {
  taskId: string
  status: string
  result?: { url: string; message?: string; fileName?: string }
  errors?: unknown
}

export const exportKols = defineTool({
  name: 'export_kols',
  description:
    '把 KOL 名单导出成 Excel：scope=project 导出某个项目的达人（含待筛选候选与已收藏两个 sheet）；scope=likes 导出我收藏的达人（可按平台/日期/项目过滤）。免费，不扣配额。返回可下载的文件链接。',
  permission: 'auto',
  inputSchema: z.object({
    scope: z.enum(['project', 'likes']),
    projectId: z.string().optional().describe('scope=project 时必填'),
    recentDays: z
      .union([z.literal(0), z.literal(1), z.literal(7), z.literal(30)])
      .optional()
      .describe('已收藏 sheet 的时间范围：0=仅当前批次，1/7/30=最近 N 天，不传=全部'),
    platforms: z.array(z.enum(['TIKTOK', 'YOUTUBE', 'INSTAGRAM', 'TWITTER'])).optional().describe('scope=likes 的平台过滤'),
    startDate: z.string().optional().describe('scope=likes：YYYY-MM-DD'),
    endDate: z.string().optional().describe('scope=likes：YYYY-MM-DD'),
    projectIds: z.array(z.string()).optional().describe('scope=likes 的项目过滤'),
  }),
  summarize: (input) => (input.scope === 'project' ? `导出项目 ${input.projectId} 的 KOL` : '导出我收藏的 KOL'),
  execute: async (input, ctx) => {
    const body =
      input.scope === 'project'
        ? {
            downloadType: 'KOL_EXPORT',
            projectId: requireParam(input.projectId, 'projectId'),
            recentDays: input.recentDays,
          }
        : {
            downloadType: 'USER_LIKES',
            filters: {
              platforms: input.platforms,
              startDate: input.startDate,
              endDate: input.endDate,
              projectIds: input.projectIds,
            },
          }
    const detail = await ctx.backend.callBackendTask<DownloadTaskCreated, DownloadTaskDetail>({
      create: (client) => client.post<DownloadTaskCreated>('/api/tasks/download/create', body),
      poll: (client, created) => client.get<DownloadTaskDetail>(`/api/tasks/download/${created.taskId}`),
      isDone: (t) => TERMINAL.has(t.status),
    })
    if (detail.status === 'FAILED' || !detail.result?.url) {
      return { forModel: { error: '导出任务失败，可稍后重试' } }
    }
    return {
      forModel: {
        url: detail.result.url,
        fileName: detail.result.fileName,
        note: '导出完成，用户可在界面卡片点击下载',
      },
      display: {
        kind: 'export-result',
        data: { title: 'KOL 导出完成', url: detail.result.url, fileName: detail.result.fileName },
      },
    }
  },
})

export const manageExcludeList = defineTool({
  name: 'manage_exclude_list',
  description:
    '博主去重（排除名单）：stats=查看名单规模；add=上传达人链接加入排除名单（这些达人此后不会出现在搜索结果里，消耗配额：每 5 条链接 1 分）；export=导出名单 Excel。',
  permission: 'quota',
  inputSchema: z.object({
    action: z.enum(['stats', 'add', 'export']),
    links: z.array(z.string()).min(1).max(1000).optional().describe('add 时必填：达人主页链接'),
  }),
  estimateQuota: (input) => (input.action === 'add' ? Math.max(1, Math.ceil((input.links?.length ?? 0) / 5)) : 0),
  summarize: (input) => {
    const map: Record<string, string> = {
      stats: '查看排除名单统计',
      add: `把 ${input.links?.length ?? 0} 个达人加入排除名单`,
      export: '导出排除名单',
    }
    return map[input.action] ?? input.action
  },
  execute: async (input, ctx) => {
    switch (input.action) {
      case 'stats': {
        const s = await ctx.backend.get<{
          count: number
          tiktokCount?: number
          youtubeCount?: number
          instagramCount?: number
        }>('/api/excludeList/statistic')
        return {
          forModel: s,
          display: {
            kind: 'op-result',
            data: {
              title: `排除名单（共 ${s.count} 个）`,
              items: [
                { label: 'TikTok', value: s.tiktokCount ?? 0 },
                { label: 'YouTube', value: s.youtubeCount ?? 0 },
                { label: 'Instagram', value: s.instagramCount ?? 0 },
              ],
            },
          },
        }
      }
      case 'add': {
        const links = requireParam(input.links, 'links')
        const detail = await ctx.backend.callBackendTask<{ id: string }, { id: string; status: string }>({
          create: (client) => client.post<{ id: string }>('/api/excludeList/upload', { links }),
          poll: (client, created) => client.get<{ id: string; status: string }>(`/api/excludeList/${created.id}`),
          isDone: (t) => TERMINAL.has(t.status),
        })
        if (detail.status === 'FAILED') {
          return { forModel: { error: '排除名单任务失败（配额已自动处理），可稍后重试' } }
        }
        return {
          forModel: { added: links.length },
          display: {
            kind: 'op-result',
            data: { title: '✅ 已加入排除名单', items: [{ label: '新增链接', value: links.length }] },
          },
        }
      }
      case 'export': {
        const r = await ctx.backend.post<{ url: string | null }>('/api/excludeList/export')
        if (!r.url) {
          return { forModel: { note: '排除名单为空，没有可导出的内容' } }
        }
        return {
          forModel: { url: r.url },
          display: { kind: 'export-result', data: { title: '排除名单导出完成', url: r.url } },
        }
      }
    }
  },
})
