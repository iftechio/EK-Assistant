import { z } from 'zod'
import { defineTool } from './types.js'
import { truncate, requireParam as must } from './helpers.js'

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
    '管理 outreach 邮件模板：列出/查看/创建/更新/删除模板，以及查看自动跟进（followup）配置。模板正文支持变量占位。每用户最多 8 个模板。这只是保存草稿，不会发送任何邮件。配置跟进邮件请用 set_template_followups（需用户确认）。',
  permission: 'write_logged',
  inputSchema: z.object({
    action: z
      .enum(['list', 'get', 'create', 'update', 'delete', 'get_followups'])
      .describe(
        '操作类型，只能取这些值：list=列出模板 / get=查看单个 / create=创建 / update=更新 / delete=删除 / get_followups=查看跟进配置',
      ),
    templateId: z.string().optional().describe('get/update/delete/get_followups 时必填'),
    name: z.string().max(100).optional(),
    subject: z.string().max(255).optional(),
    content: z.string().max(10000).optional().describe('邮件正文'),
    cc: z.array(z.string()).optional(),
  }),
  summarize: (input) => {
    const map: Record<string, string> = {
      list: '查看邮件模板列表',
      get: `查看模板 ${input.templateId}`,
      create: `创建邮件模板「${input.name ?? ''}」`,
      update: `更新邮件模板 ${input.templateId}`,
      delete: `删除邮件模板 ${input.templateId}`,
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
        const t = await ctx.backend.get<EmailTemplate>(`/api/emails/templates/${encodeURIComponent(must(input.templateId, 'templateId'))}`)
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
          `/api/emails/templates/${encodeURIComponent(must(input.templateId, 'templateId'))}`,
          { name: input.name, subject: input.subject, content: input.content, cc: input.cc },
        )
        return { forModel: compact(t), display: { kind: 'email-template', data: t } }
      }
      case 'delete': {
        const t = await ctx.backend.request<EmailTemplate>(
          'DELETE',
          `/api/emails/templates/${encodeURIComponent(must(input.templateId, 'templateId'))}`,
        )
        return {
          forModel: { deleted: true, id: t?.id ?? input.templateId },
          display: {
            kind: 'op-result',
            data: {
              title: '✅ 模板已删除',
              items: [{ label: '模板 ID', value: t?.id ?? input.templateId }],
            },
          },
        }
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

export const setTemplateFollowups = defineTool({
  name: 'set_template_followups',
  description:
    '【高风险】配置模板的自动跟进（followup）邮件序列。followups 里的每一项必须是跟进邮件正文 content 和初始邮件后第几天发送 daysAfter，不是跟进模板 ID。配置后，用该模板发出的每封初始邮件都会按 daysAfter 自动发送跟进邮件（真实发送、不可撤回），因此必须由用户在确认卡片上批准后才生效。',
  permission: 'confirm',
  inputSchema: z.object({
    templateId: z.string().describe('要配置跟进的邮件模板 ID'),
    followups: z
      .array(z.object({ content: z.string(), daysAfter: z.number().int().min(1) }))
      .min(1)
      .describe('跟进邮件序列：初始邮件后第 daysAfter 天发送 content'),
  }),
  summarize: (input) =>
    `配置模板 ${input.templateId} 的自动跟进邮件（${input.followups.length} 封，此后该模板发出的每封邮件都会自动跟进）`,
  execute: async (input, ctx) => {
    const r = await ctx.backend.post('/api/email-manage/templates/followup', {
      templateId: input.templateId,
      followupEmails: input.followups,
    })
    return {
      forModel: r as object,
      display: {
        kind: 'op-result',
        data: {
          title: '✅ 跟进邮件已配置',
          items: [
            { label: '模板 ID', value: input.templateId },
            { label: '跟进封数', value: input.followups.length },
          ],
          list: input.followups.map((f, i) => `第 ${i + 1} 封 · 初始邮件后第 ${f.daysAfter} 天发送`),
        },
      },
    }
  },
})

export const sendOutreachBatch = defineTool({
  name: 'send_outreach_batch',
  description:
    '【高风险】批量发送 outreach 邮件给真实达人，不可撤回。调用后会生成确认卡片，必须等用户在界面上批准后才真正发送。只接受 templateId + receivers[]（每项 email/nickname），不接受 kolIds、kolEmails、kolHandles 或 projectId；如果用户给的是达人名单，必须先从工具结果里取出有邮箱的 receivers。调用前先确保：模板已建好、收件人列表明确。建议同时给用户一份完整计划（发给谁、用什么模板、何时跟进）。',
  permission: 'confirm',
  inputSchema: z.object({
    templateId: z.string().describe('使用的邮件模板 ID'),
    receivers: z
      .array(z.object({ email: z.string().email(), nickname: z.string().optional() }))
      .min(1)
      .max(1000)
      .describe(
        '收件人列表。每项必须带 email（取达人数据里的 email 字段），可选 nickname 用于称呼；没有邮箱的达人不能加入，直接跳过并在回复里说明。不接受 kolId。',
      ),
    usingEmail: z.string().email().optional().describe('指定发信邮箱；不传用默认'),
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
    '查询 outreach 邮件状态：view=stat 看今日发送统计与队列；view=records 看发送/已读/回复明细（可按已回复、状态等筛选）；view=queue 看自动邮件计划队列（含计划 ID，取消/重分配前先用它查）。只读，不消耗配额。',
  permission: 'auto',
  inputSchema: z.object({
    view: z.enum(['stat', 'records', 'queue']),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    isReplied: z.boolean().optional(),
    isRead: z.boolean().optional(),
    search: z.string().optional().describe('按收件人/主题搜索（仅 records）'),
    status: z.enum(['SENT', 'PENDING', 'FAILED', 'CANCELED', 'PAUSED', 'SENDING']).optional(),
    source: z.enum(['all', 'sent', 'followup', 'auto']).optional(),
  }),
  summarize: (input) =>
    input.view === 'stat' ? '查看今日邮件发送统计' : input.view === 'queue' ? '查看自动邮件队列' : '查看邮件发送明细',
  execute: async (input, ctx) => {
    if (input.view === 'stat') {
      const stat = await ctx.backend.get('/api/auto-email/stat')
      return { forModel: stat as object, display: { kind: 'outreach-stat', data: stat } }
    }
    if (input.view === 'queue') {
      const result = await ctx.backend.post<{ list: any[]; pagination?: { total?: number } }>(
        '/api/auto-email/list',
        {
          page: input.page ?? 1,
          pageSize: input.pageSize ?? 20,
          ...(input.status ? { filters: { status: [input.status] } } : {}),
        },
      )
      const list = result.list ?? []
      return {
        forModel: {
          total: result.pagination?.total ?? list.length,
          plans: list.slice(0, 20).map((p) => ({
            id: p.id,
            to: p.email,
            nickname: p.nickname,
            from: p.from,
            status: p.status,
            template: p.template?.templateName ?? p.template?.templateId,
            scheduledAt: p.scheduledAt,
          })),
        },
        display: { kind: 'outreach-queue', data: result },
      }
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

export const sendSingleEmail = defineTool({
  name: 'send_single_email',
  description:
    '【高风险】给单个达人立即发送一封模板邮件（不入队、即时投递，不可撤回）。调用后生成确认卡片，必须等用户批准。需要 kolId（搜索/收藏结果里的）、templateId、projectId；不传 email 时自动用达人档案里的邮箱。批量发送请用 send_outreach_batch。',
  permission: 'confirm',
  inputSchema: z.object({
    kolId: z.string().describe('达人 kolId'),
    templateId: z.string().describe('邮件模板 ID'),
    projectId: z.string().describe('项目 ID'),
    email: z.string().email().optional().describe('收件邮箱；不传则用达人档案邮箱'),
    usingEmail: z.string().email().optional().describe('发件邮箱；不传用默认'),
  }),
  summarize: (input) =>
    `用模板 ${input.templateId} 给达人 ${input.kolId} 立即发送一封邮件${input.email ? `（${input.email}）` : ''}`,
  execute: async (input, ctx) => {
    const r = await ctx.backend.post<{
      record: { id: string; to: string; subject: string; status: string; sentAt: string | null }
      followupThread: { id: string; status: string } | null
    }>('/api/emails/sendWithPolish', {
      kolId: input.kolId,
      templateId: input.templateId,
      projectId: input.projectId,
      email: input.email,
      usingEmail: input.usingEmail,
    })
    return {
      forModel: {
        sent: true,
        to: r.record?.to,
        subject: r.record?.subject,
        status: r.record?.status,
        followupCreated: Boolean(r.followupThread),
      },
      display: {
        kind: 'op-result',
        data: {
          title: '✅ 邮件已发送',
          items: [
            { label: '收件人', value: r.record?.to ?? '-' },
            { label: '主题', value: r.record?.subject ?? '-' },
            { label: '跟进', value: r.followupThread ? '已创建跟进线程' : '无' },
          ],
        },
      },
    }
  },
})

export const manageOutreachQueue = defineTool({
  name: 'manage_outreach_queue',
  description:
    '管理自动邮件发送队列：cancel_pending=批量取消待发送（PENDING）的计划（需先用 get_outreach_status view=queue 查到计划 ID）；resume_paused=恢复所有因授权失败暂停的邮件计划；reassign_paused=把暂停（PAUSED）的邮件随机重新分配到其它可用发件邮箱。可逆操作，自动执行并记入活动日志。',
  permission: 'write_logged',
  inputSchema: z.object({
    action: z.enum(['cancel_pending', 'resume_paused', 'reassign_paused']),
    planIds: z.array(z.string()).min(1).max(1000).optional().describe('cancel_pending 时必填：自动邮件计划 ID'),
    fromEmail: z.string().email().optional().describe('reassign_paused 可选：只迁移这个发件邮箱下暂停的任务'),
    toEmails: z.array(z.string().email()).max(50).optional().describe('reassign_paused 可选：目标发件邮箱列表，不传用所有可用邮箱'),
  }),
  summarize: (input) => {
    const map: Record<string, string> = {
      cancel_pending: `取消 ${input.planIds?.length ?? 0} 封待发送邮件`,
      resume_paused: '恢复所有暂停的邮件计划',
      reassign_paused: `重新分配暂停的邮件${input.fromEmail ? `（来自 ${input.fromEmail}）` : ''}`,
    }
    return map[input.action] ?? input.action
  },
  execute: async (input, ctx) => {
    switch (input.action) {
      case 'cancel_pending': {
        const r = await ctx.backend.post<{ canceled: number; skipped: number }>(
          '/api/auto-email/cancel-many',
          { ids: must(input.planIds, 'planIds') },
        )
        return {
          forModel: { ...r, note: '只有待发送（PENDING）状态会被取消，其它状态跳过' },
          display: {
            kind: 'op-result',
            data: {
              title: '✅ 已取消待发送邮件',
              items: [
                { label: '已取消', value: r.canceled },
                { label: '已跳过', value: r.skipped },
              ],
            },
          },
        }
      }
      case 'resume_paused': {
        const r = await ctx.backend.post('/api/email-manage/resume')
        return {
          forModel: r as object,
          display: {
            kind: 'op-result',
            data: { title: '✅ 已恢复暂停的邮件计划', items: resultItems(r) },
          },
        }
      }
      case 'reassign_paused': {
        const r = await ctx.backend.post<{ reassigned: number; skipped: number; targetSenders: string[] }>(
          '/api/auto-email/reassign-paused',
          { fromEmail: input.fromEmail, toEmails: input.toEmails },
        )
        return {
          forModel: r,
          display: {
            kind: 'op-result',
            data: {
              title: '✅ 已重新分配暂停的邮件',
              items: [
                { label: '已重分配', value: r.reassigned },
                { label: '已跳过', value: r.skipped },
              ],
              list: (r.targetSenders ?? []).map((s) => `目标发件邮箱：${s}`),
            },
          },
        }
      }
    }
  },
})

/** 把未知形状的结果对象压成 op-result 的 items（只取一层数字/字符串字段） */
function resultItems(r: unknown): { label: string; value: string | number }[] {
  if (!r || typeof r !== 'object') return []
  return Object.entries(r)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .slice(0, 8)
    .map(([k, v]) => ({ label: k, value: v as string | number }))
}
