import { z } from 'zod'
import { defineTool } from './types.js'

export const rememberPreference = defineTool({
  name: 'remember_preference',
  description:
    '记住用户的稳定偏好（跨会话生效，会注入后续对话的上下文）：如常用平台、默认目标地区/语言、品牌/产品品类、常用项目。当用户表达"以后都…""我一般…""我们是做…的"这类长期偏好时保存；用户要求忘掉时删除。不要保存一次性的任务参数。',
  permission: 'auto',
  inputSchema: z.object({
    action: z.enum(['set', 'delete']),
    key: z
      .string()
      .max(50)
      .describe('偏好键，简短中文或英文短语，如"常用平台"、"默认地区"、"品牌品类"'),
    value: z.string().max(500).optional().describe('set 时必填：偏好内容'),
  }),
  summarize: (input) =>
    input.action === 'set' ? `记住偏好：${input.key} = ${input.value ?? ''}` : `忘记偏好：${input.key}`,
  execute: async (input, ctx) => {
    if (input.action === 'set') {
      if (!input.value) {
        return { forModel: { error: 'set 时必须提供 value' } }
      }
      await ctx.saveMemory(input.key, input.value)
      return {
        forModel: { saved: true, key: input.key, value: input.value },
        display: {
          kind: 'op-result',
          data: { title: '📌 已记住偏好', items: [{ label: input.key, value: input.value }] },
        },
      }
    }
    await ctx.deleteMemory(input.key)
    return {
      forModel: { deleted: true, key: input.key },
      display: {
        kind: 'op-result',
        data: { title: '🗑 已忘记偏好', items: [{ label: '偏好键', value: input.key }] },
      },
    }
  },
})
