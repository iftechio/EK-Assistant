import { z } from 'zod'
import { defineTool } from './types.js'
import { truncate } from './helpers.js'

interface EmailTemplate {
  id: string
  name: string | null
  subject: string
  content: string
  cc: string[]
}

export const manageEmailTemplate = defineTool({
  name: 'manage_email_template',
  description:
    '管理 outreach 邮件模板：列出/查看/创建/更新/删除模板，以及配置自动跟进（followup）邮件。模板正文支持变量占位。每用户最多 8 个模板。这只是保存草稿，不会发送任何邮件。',
  permission: 'write_logged',
  inputSchema: z.object({
    action: z
      .enum(['list', 'get', 'create', 'update', 'delete', 'set_followups', 'get_followups'])
      .describe(
        '操作类型，只能取这些值：list=列出模板 / get=查看单个 / create=创建 / update=更新 / delete=删除 / set_followups=配置跟进 / get_followups=查看跟进',
      ),
    templateId: z.string().optional().describe('get/update/delete/set_followups 时必填'),
    name: z.string().max(100).optional(),
    subject: z.string().max(255).optional(),
    content: z.string().max(10000).optional().describe('邮件正文'),
    cc: z.array(z.string()).optional(),
    followups: z
      .array(z.object({ content: z.string(), daysAfter: z.number().int().min(1) }))
      .optional()
      .describe('跟进邮件序列：初始邮件后第 daysAfter 天发送 content'),
  }),
  summarize: (input) => {
    const map: Record<string, string> = {
      list: '查看邮件模板列表',
      get: `查看模板 ${input.templateId}`,
      create: `创建邮件模板「${input.name ?? ''}」`,
      update: `更新邮件模板 ${input.templateId}`,
      delete: `删除邮件模板 ${input.templateId}`,
      set_followups: `配置模板 ${input.templateId} 的跟进邮件（${input.followups?.length ?? 0} 封）`,
      get_followups: `查看模板 ${input.templateId} 的跟进配置`,
    }
    return map[input.action] ?? input.action
  },
  execute: async (input, ctx) => {
    const compact = (t: EmailTemplate) => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      content: truncate(t.content ?? '', 500),
      cc: t.cc,
    })
    switch (input.action) {
      case 'list': {
        const templates = await ctx.backend.get<EmailTemplate[]>('/api/emails/templates')
        return {
          forModel: { templates: templates.map(compact) },
          display: { kind: 'email-templates', data: templates },
        }
      }
      case 'get': {
        const t = await ctx.backend.get<EmailTemplate>(`/api/emails/templates/${must(input.templateId, 'templateId')}`)
        return { forModel: { ...t, content: truncate(t.content ?? '', 2000) }, display: { kind: 'email-template', data: t } }
      }
      case 'create': {
        // 防止建出空模板被批量发送：subject/content 必填
        const t = await ctx.backend.post<EmailTemplate>('/api/emails/templates', {
          name: must(input.name, 'name'),
          subject: must(input.subject, 'subject'),
          content: must(input.content, 'content'),
          cc: input.cc,
        })
        return { forModel: compact(t), display: { kind: 'email-template', data: t } }
      }
      case 'update': {
        const t = await ctx.backend.patch<EmailTemplate>(
          `/api/emails/templates/${must(input.templateId, 'templateId')}`,
          { name: input.name, subject: input.subject, content: input.content, cc: input.cc },
        )
        return { forModel: compact(t), display: { kind: 'email-template', data: t } }
      }
      case 'delete': {
        const t = await ctx.backend.request<EmailTemplate>(
          'DELETE',
          `/api/emails/templates/${must(input.templateId, 'templateId')}`,
        )
        return { forModel: { deleted: true, id: t?.id ?? input.templateId } }
      }
      case 'set_followups': {
        const r = await ctx.backend.post('/api/email-manage/templates/followup', {
          templateId: must(input.templateId, 'templateId'),
          followupEmails: must(input.followups, 'followups'),
        })
        return { forModel: r as object }
      }
      case 'get_followups': {
        const r = await ctx.backend.get('/api/email-manage/templates/followup', {
          templateId: must(input.templateId, 'templateId'),
        })
        return { forModel: r as object }
      }
    }
  },
})

export const sendOutreachBatch = defineTool({
  name: 'send_outreach_batch',
  description:
    '【高风险】批量发送 outreach 邮件给真实达人，不可撤回。调用后会生成确认卡片，必须等用户在界面上批准后才真正发送。调用前先确保：模板已建好、收件人列表明确。建议同时给用户一份完整计划（发给谁、用什么模板、何时跟进）。',
  permission: 'confirm',
  inputSchema: z.object({
    templateId: z.string().describe('使用的邮件模板 ID'),
    receivers: z
      .array(z.object({ email: z.string(), nickname: z.string().optional() }))
      .min(1)
      .max(1000)
      .describe(
        '收件人列表。每项必须带 email（取达人数据里的 email 字段），可选 nickname 用于称呼；没有邮箱的达人不能加入，直接跳过并在回复里说明。不接受 kolId。',
      ),
    usingEmail: z.string().optional().describe('指定发信邮箱；不传用默认'),
    scheduledSendAtHours: z.number().int().min(0).max(24).optional().describe('延迟 N 小时发送，0/不传为立即'),
    sendDelaySeconds: z.number().int().min(60).max(3600).optional().describe('封与封之间的间隔秒数，默认300'),
    deduplicate: z.boolean().optional().describe('是否对已发过的收件人去重，默认 true'),
  }),
  summarize: (input) =>
    `使用模板 ${input.templateId} 向 ${input.receivers.length} 位达人发送邮件${
      input.scheduledSendAtHours ? `（${input.scheduledSendAtHours} 小时后开始）` : ''
    }`,
  execute: async (input, ctx) => {
    const result = await ctx.backend.post<{ inserted: number }>('/api/auto-email/import', {
      templateId: input.templateId,
      receivers: input.receivers,
      usingEmail: input.usingEmail,
      scheduledSendAt: input.scheduledSendAtHours,
      sendDelay: input.sendDelaySeconds,
      deduplicate: input.deduplicate ?? true,
    })
    return {
      forModel: {
        queued: result.inserted,
        note: `已加入发送队列 ${result.inserted} 封，按间隔逐封发送，进度可用 get_outreach_status 查看`,
      },
      display: { kind: 'send-result', data: { ...result, receivers: input.receivers.length } },
    }
  },
})

export const getOutreachStatus = defineTool({
  name: 'get_outreach_status',
  description:
    '查询 outreach 邮件状态：view=stat 看今日发送统计与队列；view=records 看发送/已读/回复明细（可按已回复、状态等筛选）。只读，不消耗配额。',
  permission: 'auto',
  inputSchema: z.object({
    view: z.enum(['stat', 'records']),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    isReplied: z.boolean().optional(),
    isRead: z.boolean().optional(),
    search: z.string().optional().describe('按收件人/主题搜索'),
    status: z.enum(['SENT', 'PENDING', 'FAILED', 'CANCELED', 'PAUSED', 'SENDING']).optional(),
    source: z.enum(['all', 'sent', 'followup', 'auto']).optional(),
  }),
  summarize: (input) => (input.view === 'stat' ? '查看今日邮件发送统计' : '查看邮件发送明细'),
  execute: async (input, ctx) => {
    if (input.view === 'stat') {
      const stat = await ctx.backend.get('/api/auto-email/stat')
      return { forModel: stat as object, display: { kind: 'outreach-stat', data: stat } }
    }
    const records = await ctx.backend.get<{
      list: any[]
      pagination: unknown
      statistics: unknown
    }>('/api/emails/records', {
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 20,
      isReplied: input.isReplied,
      isRead: input.isRead,
      search: input.search,
      status: input.status,
      source: input.source,
    })
    return {
      forModel: {
        statistics: records.statistics,
        pagination: records.pagination,
        records: (records.list ?? []).slice(0, 20).map((r) => ({
          to: r.to,
          subject: truncate(r.subject ?? '', 80),
          status: r.status,
          sentAt: r.sentAt,
          isRead: r.isRead,
          readCount: r.readCount,
          followups: r.followups?.length ?? 0,
        })),
      },
      display: { kind: 'outreach-records', data: records },
    }
  },
})

function must<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`缺少参数 ${name}`)
  }
  return value
}
