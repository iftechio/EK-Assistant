import { z } from 'zod'
import { defineTool } from './types.js'
import { ensureProject, requireParam } from './helpers.js'

const PLATFORMS = ['TIKTOK', 'YOUTUBE', 'INSTAGRAM'] as const

interface SingleAudienceResult {
  userPortraitResult: Record<string, unknown> | null
  regionAnalysisResult: Record<string, unknown> | null
  fakeRadarData: Record<string, unknown> | null
  dataRangeStats: Record<string, unknown> | null
  taskId?: string
  needCreateTask: boolean
  updatedAt: string | null
}

interface BatchDetail {
  progress: number
  totalTasks: number
  statusCounts: { completed: number; failed: number; processing: number; pending: number }
}

export const analyzeAudience = defineTool({
  name: 'analyze_audience',
  description:
    '受众画像分析：mode=single 分析单个达人的受众（性别/年龄画像、地区分布、虚假粉丝雷达，传平台账号名，约 20 配额，近 30 天分析过的账号免费复用）；mode=batch 批量分析一批达人或帖子链接（≤50 条，每条约 20 配额，按成功数实扣），完成后给出 Excel。分析在后台跑，可能需要几分钟。',
  permission: 'quota',
  inputSchema: z.object({
    mode: z.enum(['single', 'batch']),
    platform: z.enum(PLATFORMS).optional().describe('single 必填'),
    source: z.string().optional().describe('single 必填：平台账号名（handle，不是链接）'),
    projectId: z.string().optional().describe('single 可选；不传自动创建'),
    links: z.array(z.string()).min(1).max(50).optional().describe('batch 必填：达人或帖子链接'),
    batchTarget: z.enum(['author', 'post']).optional().describe('batch 分析对象：author=达人受众（默认），post=帖子受众'),
  }),
  estimateQuota: (input) => (input.mode === 'single' ? 20 : (input.links?.length ?? 1) * 20),
  summarize: (input) =>
    input.mode === 'single'
      ? `分析 ${input.source ?? ''} 的受众画像`
      : `批量分析 ${input.links?.length ?? 0} 条链接的受众`,
  execute: async (input, ctx) => {
    if (input.mode === 'single') {
      const platform = requireParam(input.platform, 'platform')
      const source = requireParam(input.source, 'source').replace(/^@/, '')
      const projectId = await ensureProject(ctx, input.projectId)
      await ctx.backend.post('/api/search/audienceAnalysis', { projectId, platform, source })
      // 轮询结果接口：进行中会带 taskId，完成后画像字段有值
      const result = await ctx.backend.callBackendTask<null, SingleAudienceResult>({
        create: async () => null,
        poll: (client) => client.get<SingleAudienceResult>('/api/search/audienceAnalysis', { platform, source }),
        isDone: (r) => !r.taskId && (!r.needCreateTask || Boolean(r.userPortraitResult)),
        timeoutMs: 600_000,
      })
      if (!result.userPortraitResult && !result.regionAnalysisResult) {
        return { forModel: { error: '受众分析未产出结果，可稍后重试或换一个账号' } }
      }
      let exportUrl: string | null = null
      try {
        const ex = await ctx.backend.get<{ url: string }>('/api/search/audienceAnalysis/export', {
          platform,
          source,
        })
        exportUrl = ex.url
      } catch {
        // 导出失败不影响分析结果
      }
      return {
        forModel: {
          source,
          platform,
          userPortrait: result.userPortraitResult,
          regionAnalysis: result.regionAnalysisResult,
          fakeRadar: result.fakeRadarData,
          updatedAt: result.updatedAt,
        },
        display: {
          kind: 'audience-analysis',
          data: {
            source,
            platform,
            userPortraitResult: result.userPortraitResult,
            regionAnalysisResult: result.regionAnalysisResult,
            fakeRadarData: result.fakeRadarData,
            dataRangeStats: result.dataRangeStats,
            exportUrl,
            updatedAt: result.updatedAt,
          },
        },
      }
    }

    const links = requireParam(input.links, 'links')
    const created = await ctx.backend.post<{
      batchId: string
      summary: { total: number; success: number; failed: number }
    }>('/api/tasks/audience-tasks', { links, mode: input.batchTarget === 'post' ? 2 : 1 })
    const detail = await ctx.backend.callBackendTask<{ batchId: string }, BatchDetail>({
      create: async () => ({ batchId: created.batchId }),
      poll: (client, c) => client.get<BatchDetail>(`/api/tasks/audience-tasks/batch/${c.batchId}`),
      isDone: (d) => d.totalTasks > 0 && d.statusCounts.completed + d.statusCounts.failed >= d.totalTasks,
      timeoutMs: 600_000,
    })
    let exportUrl: string | null = null
    if (detail.statusCounts.completed > 0) {
      try {
        exportUrl = await ctx.backend.get<string>(`/api/tasks/audience-tasks/batch/${created.batchId}/export`)
      } catch {
        // 导出失败不影响任务结果
      }
    }
    return {
      forModel: {
        batchId: created.batchId,
        submitted: created.summary,
        completed: detail.statusCounts.completed,
        failed: detail.statusCounts.failed,
        exportUrl,
        note: exportUrl ? '结果 Excel 可在界面卡片下载' : '没有成功完成的子任务',
      },
      display: {
        kind: 'export-result',
        data: {
          title: `受众批量分析完成（成功 ${detail.statusCounts.completed} / 失败 ${detail.statusCounts.failed}）`,
          url: exportUrl,
        },
      },
    }
  },
})
