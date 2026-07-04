import type { ToolContext } from './types.js'

/** 没有 projectId 时自动建一个项目（backend 的搜索/相似/收藏都挂在 project 下） */
export async function ensureProject(ctx: ToolContext, projectId?: string): Promise<string> {
  if (projectId) return projectId
  const created = await ctx.backend.post<{ id: string }>('/api/projects/', {
    title: `EK-Assistant ${new Date().toISOString().slice(0, 10)}`,
    description: '由 EK-Assistant 对话自动创建',
  })
  return created.id
}

/** KOL 结果的语义截断：只保留模型需要的关键字段（完整数据走 display 卡片） */
export function compactKol(item: Record<string, any>): Record<string, unknown> {
  // similars 等接口返回 kolInfo，粉丝/地区在嵌套的平台对象里（与 easykol-web adapters.ts 取法一致）
  const nested = item.tiktokUser ?? item.youtubeChannel ?? item.instagramUser
  return pruneUndefined({
    kolId: item.id ?? item.kolId,
    name: item.title ?? item.nickName ?? item.nickname ?? item.name ?? nested?.title,
    account: item.platformAccount ?? item.uniqueId ?? item.authorUniqueId,
    platform: item.platform,
    followers:
      item.subscribers ??
      item.followers ??
      item.followerCount ??
      nested?.numericSubscriberCount ??
      nested?.followerCount,
    region: item.region ?? item.country ?? nested?.country ?? nested?.region,
    email: item.email,
    score: item.score,
    description: truncate(String(item.description ?? ''), 150) || undefined,
    link: item.url ?? item.link ?? item.postLink,
  })
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

export function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

/** 数值序列统计（确定性计算，不让 LLM 猜数字） */
export function numericStats(values: number[]) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!nums.length) return null
  const median =
    nums.length % 2 === 1
      ? nums[(nums.length - 1) / 2]
      : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
  return {
    count: nums.length,
    min: nums[0],
    max: nums[nums.length - 1],
    median,
    mean: Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100,
  }
}

/** value 在样本中的百分位（0-100） */
export function percentileOf(values: number[], value: number): number | null {
  const nums = values.filter((v) => Number.isFinite(v))
  if (!nums.length) return null
  const below = nums.filter((v) => v <= value).length
  return Math.round((below / nums.length) * 100)
}

/** 必填参数校验：模型漏传可选参数时给出明确错误，而不是打出畸形请求 */
export function requireParam<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null || (typeof value === 'string' && value === '')) {
    throw new Error(`缺少参数 ${name}`)
  }
  return value
}
