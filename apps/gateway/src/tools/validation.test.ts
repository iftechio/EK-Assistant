import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { formatValidationError } from './validation.js'

const schema = z.object({
  platform: z.enum(['TIKTOK', 'YOUTUBE', 'INSTAGRAM']),
  urls: z.array(z.string()).min(1),
  maxCount: z.number().int().optional(),
})

function fail(input: unknown) {
  const r = schema.safeParse(input)
  if (r.success) throw new Error('用例应当校验失败')
  return r.error
}

describe('formatValidationError', () => {
  it('缺少必填参数时点名字段', () => {
    const msg = formatValidationError('extract_kol_emails', fail({ platform: 'TIKTOK' }))
    expect(msg).toContain('缺少必填参数 `urls`')
    expect(msg).toContain('extract_kol_emails')
  })

  it('类型错误时说明期望类型与实际类型', () => {
    const msg = formatValidationError('t', fail({ platform: 'TIKTOK', urls: ['a'], maxCount: '10' }))
    expect(msg).toContain('`maxCount`')
    expect(msg).toContain('number')
    expect(msg).toContain('string')
  })

  it('枚举错误时列出可选值', () => {
    const msg = formatValidationError('t', fail({ platform: 'TWITTER', urls: ['a'] }))
    expect(msg).toContain('`platform`')
    expect(msg).toContain('`TIKTOK`')
    expect(msg).toContain('`YOUTUBE`')
  })

  it('嵌套路径用点号与下标表示', () => {
    const nested = z.object({ receivers: z.array(z.object({ email: z.string() })) })
    const r = nested.safeParse({ receivers: [{ email: 1 }] })
    if (r.success) throw new Error('用例应当校验失败')
    const msg = formatValidationError('send_outreach_batch', r.error)
    expect(msg).toContain('`receivers[0].email`')
  })
})
