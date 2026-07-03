import { z } from 'zod'
import { defineTool } from './types.js'
import { compactKol } from './helpers.js'

const TAG_COLORS = [
  'RED',
  'VOLCANO',
  'ORANGE',
  'GOLD',
  'YELLOW',
  'LIME',
  'GREEN',
  'CYAN',
  'BLUE',
  'GEEKBLUE',
  'PURPLE',
  'MAGENTA',
] as const

export const saveKolsToProject = defineTool({
  name: 'save_kols_to_project',
  description:
    '管理 KOL 收藏库与项目分组：创建/列出项目、把搜索结果里的 KOL 收藏进项目（collect_kols，用 kolId）、查看已收藏列表、创建/列出标签、批量把收藏移到别的项目。可逆操作，自动执行并记入活动日志。',
  permission: 'write_logged',
  inputSchema: z.object({
    action: z.enum([
      'create_project',
      'list_projects',
      'collect_kols',
      'list_collects',
      'move_to_project',
      'create_tag',
      'list_tags',
    ]),
    projectId: z.string().optional().describe('collect_kols / move_to_project 时必填'),
    kolIds: z.array(z.string()).max(100).optional().describe('collect_kols 时必填：搜索结果里的 kolId'),
    attitude: z.enum(['LIKE', 'SUPERLIKE']).optional().describe('收藏态度，默认 LIKE'),
    projectKolIds: z.array(z.string()).max(100).optional().describe('move_to_project 时必填'),
    title: z.string().max(1000).optional().describe('create_project 时的项目名'),
    description: z.string().max(1000).optional(),
    tagName: z.string().max(30).optional().describe('create_tag 时必填'),
    tagColor: z.enum(TAG_COLORS).optional().describe('标签颜色，默认 BLUE'),
  }),
  summarize: (input) => {
    const map: Record<string, string> = {
      create_project: `创建项目「${input.title ?? ''}」`,
      list_projects: '查看项目列表',
      collect_kols: `收藏 ${input.kolIds?.length ?? 0} 个 KOL 到项目 ${input.projectId}`,
      list_collects: '查看已收藏的 KOL',
      move_to_project: `移动 ${input.projectKolIds?.length ?? 0} 个收藏到项目 ${input.projectId}`,
      create_tag: `创建标签「${input.tagName ?? ''}」`,
      list_tags: '查看标签列表',
    }
    return map[input.action] ?? input.action
  },
  execute: async (input, ctx) => {
    switch (input.action) {
      case 'create_project': {
        const project = await ctx.backend.post<{ id: string; title: string }>('/api/projects/', {
          title: must(input.title, 'title'),
          description: input.description,
        })
        return { forModel: project }
      }
      case 'list_projects': {
        const projects = await ctx.backend.get<any[]>('/api/projects/')
        return {
          forModel: {
            projects: (projects ?? []).slice(0, 30).map((p) => ({ id: p.id, title: p.title })),
          },
        }
      }
      case 'collect_kols': {
        const projectId = must(input.projectId, 'projectId')
        const kolIds = must(input.kolIds, 'kolIds')
        const attitude = input.attitude ?? 'LIKE'
        const results: { kolId: string; ok: boolean; error?: string }[] = []
        for (const kolId of kolIds) {
          try {
            await ctx.backend.post('/api/projectkol/rate', { projectId, kolId, attitude })
            results.push({ kolId, ok: true })
          } catch (err) {
            results.push({ kolId, ok: false, error: err instanceof Error ? err.message : String(err) })
          }
        }
        const okCount = results.filter((r) => r.ok).length
        return {
          forModel: {
            collected: okCount,
            failed: results.length - okCount,
            failures: results.filter((r) => !r.ok).slice(0, 5),
          },
          display: { kind: 'collect-result', data: { projectId, attitude, results } },
        }
      }
      case 'list_collects': {
        const result = await ctx.backend.post<{ data: any[]; total: number }>(
          '/api/kols/user/collects',
          { page: 1, pageSize: 50 },
        )
        const items = result.data ?? []
        return {
          forModel: {
            total: result.total,
            kols: items.slice(0, 20).map((item) => ({
              ...compactKol(item),
              projectKolId: item.projectKolId,
              projectTitle: item.projectTitle,
              tags: item.tags?.map((t: any) => t.name),
            })),
          },
          display: { kind: 'kol-list', data: { kols: items } },
        }
      }
      case 'move_to_project': {
        const result = await ctx.backend.patch('/api/kols/user/collects/project/batch', {
          projectKolIds: must(input.projectKolIds, 'projectKolIds'),
          projectId: must(input.projectId, 'projectId'),
        })
        return { forModel: result as object }
      }
      case 'create_tag': {
        const tag = await ctx.backend.post('/api/tags/', {
          name: must(input.tagName, 'tagName'),
          color: input.tagColor ?? 'BLUE',
        })
        return { forModel: tag as object }
      }
      case 'list_tags': {
        const tags = await ctx.backend.get<{ items: any[]; total: number }>('/api/tags/list')
        return {
          forModel: {
            tags: (tags.items ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color })),
          },
        }
      }
    }
  },
})

function must<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || (typeof value === 'string' && value === '')) {
    throw new Error(`缺少参数 ${name}`)
  }
  return value
}
