import { describe, expect, it } from 'vitest'
import { analyzeCommentsFeedback, exportComments, inferPlatform } from './comments.js'
import type { ToolContext } from './types.js'

describe('inferPlatform', () => {
  it('识别 YouTube 链接', () => {
    expect(inferPlatform('https://www.youtube.com/watch?v=-iIXxucYV9E')).toBe('YOUTUBE')
    expect(inferPlatform('https://youtu.be/-iIXxucYV9E')).toBe('YOUTUBE')
    expect(inferPlatform('https://m.youtube.com/watch?v=abc')).toBe('YOUTUBE')
  })

  it('识别 TikTok 链接', () => {
    expect(inferPlatform('https://www.tiktok.com/@user/video/123')).toBe('TIKTOK')
    expect(inferPlatform('https://vt.tiktok.com/ZS123/')).toBe('TIKTOK')
  })

  it('无法识别的链接返回 null', () => {
    expect(inferPlatform('https://www.instagram.com/reel/abc/')).toBeNull()
    expect(inferPlatform('not-a-url')).toBeNull()
    expect(inferPlatform('https://faketiktok.com/video/1')).toBeNull()
  })
})

describe('exportComments', () => {
  it('按 maxCount 预估配额', () => {
    expect(exportComments.estimateQuota?.({ url: 'https://youtu.be/abc', maxCount: 10 })).toBe(1)
  })
})

describe('analyzeCommentsFeedback', () => {
  it('空评论缓存直接返回空分析结果', async () => {
    const ctx = mockContext()

    await exportComments.execute({ url: 'https://youtu.be/empty', maxCount: 10 }, ctx)
    const result = await analyzeCommentsFeedback.execute({}, ctx)

    expect(result.forModel).toMatchObject({
      analyzedComments: 0,
      summary: '没有评论可分析',
      sentiment: { positivePct: 0, negativePct: 0, neutralPct: 100 },
      recommendedActions: ['换真实公开视频链接重试', '确认视频评论区公开', '如平台限制抓取，可上传评论 Excel/CSV 后再分析'],
    })
    expect(result.display).toMatchObject({
      kind: 'comment-analysis',
      data: { analyzedComments: 0, summary: '没有评论可分析' },
    })
  })
})

function mockContext(): ToolContext {
  return {
    userId: 'u1',
    jwt: 'jwt',
    sessionId: `s-${Date.now()}`,
    backend: {
      callBackendTask: async () => ({
        id: 'task-1',
        status: 'COMPLETED',
        params: { platform: 'YOUTUBE', url: 'https://youtu.be/empty', maxCount: 10 },
        result: { total: 0, comments: [] },
      }),
    } as any,
    costMeter: {} as any,
    emit: () => {},
    logActivity: async () => {},
    saveMemory: async () => {},
    deleteMemory: async () => {},
  }
}
