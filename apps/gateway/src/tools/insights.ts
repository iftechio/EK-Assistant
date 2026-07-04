import { z } from 'zod'
import { defineTool } from './types.js'
import { requireParam } from './helpers.js'

const TERMINAL = new Set(['COMPLETED', 'FAILED'])

/** 按域名把达人链接分到 tt/ytb/ins 三组（backend kol-emails 的入参形状） */
export function classifyKolUrls(urls: string[]): {
  ttUrls: string[]
  ytbUrls: string[]
  insUrls: string[]
  unknown: string[]
} {
  const groups = { ttUrls: [] as string[], ytbUrls: [] as string[], insUrls: [] as string[], unknown: [] as string[] }
  for (const url of urls) {
    let host = ''
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      groups.unknown.push(url)
      continue
    }
    if (/(^|\.)tiktok\.com$/.test(host)) groups.ttUrls.push(url)
    else if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host)) groups.ytbUrls.push(url)
    else if (/(^|\.)instagram\.com$/.test(host)) groups.insUrls.push(url)
    else groups.unknown.push(url)
  }
  return groups
}

export const extractKolEmails = defineTool({
  name: 'extract_kol_emails',
  description:
    '批量提取达人邮箱：给一批达人主页链接（TikTok/YouTube/Instagram，自动按域名识别平台，最多 500 个），后台提取公开邮箱，返回可直接用于 send_outreach_batch 的收件人列表和 Excel 下载链接。消耗配额：每 5 个链接 1 分。',
  permission: 'quota',
  inputSchema: z.object({
    urls: z.array(z.string()).min(1).max(500).describe('达人主页链接列表'),
  }),
  estimateQuota: (input) => Math.max(1, Math.ceil(input.urls.length / 5)),
  summarize: (input) => `提取 ${input.urls.length} 个达人的邮箱`,
  execute: async (input, ctx) => {
    const { ttUrls, ytbUrls, insUrls, unknown } = classifyKolUrls(input.urls)
    if (!ttUrls.length && !ytbUrls.length && !insUrls.length) {
      return { forModel: { error: '没有可识别的链接，仅支持 TikTok/YouTube/Instagram 达人主页链接' } }
    }
    const detail = await ctx.backend.callBackendTask<
      { id: string },
      { status: string; downloadUrl: string | null; totalCount: number; emailCount: number; receivers: any[] }
    >({
      create: (client) =>
        client.post<{ id: string }>('/api/tasks/kol-emails', {
          ...(ttUrls.length ? { ttUrls } : {}),
          ...(ytbUrls.length ? { ytbUrls } : {}),
          ...(insUrls.length ? { insUrls } : {}),
        }),
      poll: (client, created) => client.post(`/api/tasks/kol-emails/${created.id}`),
      isDone: (t) => TERMINAL.has(t.status),
      timeoutMs: 600_000,
    })
    if (detail.status === 'FAILED') {
      return { forModel: { error: '邮箱提取任务失败，可稍后重试' } }
    }
    const receivers = detail.receivers ?? []
    return {
      forModel: {
        totalCount: detail.totalCount,
        emailCount: detail.emailCount,
        skippedUnknownUrls: unknown.length ? unknown.slice(0, 5) : undefined,
        receivers: receivers.slice(0, 50).map((r) => ({ nickname: r.nickname, email: r.email, platform: r.platform })),
        note:
          receivers.length > 50
            ? '仅展示前50个收件人，完整名单见界面卡片；可直接把这批 receivers 用于 send_outreach_batch'
            : '可直接把这批 receivers 用于 send_outreach_batch',
      },
      display: {
        kind: 'kol-emails',
        data: {
          totalCount: detail.totalCount,
          emailCount: detail.emailCount,
          downloadUrl: detail.downloadUrl,
          receivers,
          unknownUrls: unknown,
        },
      },
    }
  },
})

const IG_POST_CODE = /instagram\.com\/(?:p|reel|tv)\/([\w-]+)/

export const detectFakeFollowers = defineTool({
  name: 'detect_fake_followers',
  description:
    'Instagram 假粉/假互动检测：mode=audience 分析某达人的受众里真人/网红/假号占比（传 IG 用户名）；mode=post 分析某条帖子点赞者的真实性（传帖子链接或 code）。消耗配额约 20 分/次（近期查过同一对象会命中缓存不扣费）。',
  permission: 'quota',
  inputSchema: z.object({
    mode: z.enum(['audience', 'post']),
    handler: z.string().optional().describe('audience 模式必填：Instagram 用户名（不带 @）'),
    post: z.string().optional().describe('post 模式必填：帖子链接或 code'),
  }),
  estimateQuota: () => 20,
  summarize: (input) =>
    input.mode === 'audience' ? `检测 @${input.handler ?? ''} 的受众真实性` : '检测帖子点赞者真实性',
  execute: async (input, ctx) => {
    const isAudience = input.mode === 'audience'
    let created: { task?: { id: string; status: string }; fromCache?: boolean }
    if (isAudience) {
      const handler = requireParam(input.handler, 'handler').replace(/^@/, '')
      created = await ctx.backend.post('/api/ins/audience-fake', undefined, { handler })
    } else {
      const raw = requireParam(input.post, 'post')
      // 链接解析失败时不能把整个 URL 当 code 传给 backend；裸 code（不含 /）原样放行
      const code = IG_POST_CODE.exec(raw)?.[1] ?? (raw.includes('/') ? null : raw)
      if (!code) throw new Error('无法从链接中识别 Instagram 帖子 code，请传入标准帖子链接或 code 本身')
      created = await ctx.backend.post('/api/ins/post-fake', { code })
    }
    if (!created?.task?.id) {
      throw new Error('backend 未返回检测任务，请稍后重试或检查账号/帖子是否有效')
    }
    const taskId = created.task.id
    if (!TERMINAL.has(created.task.status)) {
      await ctx.backend.callBackendTask<{ id: string }, { status: string }>({
        create: async () => ({ id: taskId }),
        poll: (client, t) => client.get<{ status: string }>(`/api/tasks/status/${t.id}`),
        isDone: (p) => TERMINAL.has(p.status),
        timeoutMs: 600_000,
      })
    }
    const accounts = await ctx.backend.get<any[]>(
      isAudience ? '/api/ins/audience-fake/accounts' : '/api/ins/post-fake/accounts',
      { taskId },
    )
    const list = accounts ?? []
    const counts: Record<string, number> = {}
    for (const a of list) {
      const key = a.result ?? 'unknown'
      counts[key] = (counts[key] ?? 0) + 1
    }
    return {
      forModel: {
        taskId,
        fromCache: created.fromCache,
        sampleTotal: list.length,
        breakdown: counts,
        examples: list.slice(0, 10).map((a) => ({ username: a.username, result: a.result, reason: a.reason })),
      },
      display: {
        kind: 'fake-detection',
        data: {
          mode: input.mode,
          target: isAudience ? input.handler : input.post,
          fromCache: created.fromCache,
          breakdown: counts,
          sampleTotal: list.length,
          accounts: list.slice(0, 200),
        },
      },
    }
  },
})
