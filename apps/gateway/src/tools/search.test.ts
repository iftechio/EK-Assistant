import { describe, expect, it } from 'vitest'
import { buildSearchBody, type SearchKolsInput } from './search.js'

const base: SearchKolsInput = { platform: 'TIKTOK', kolDescription: '美妆测评博主' }

describe('buildSearchBody', () => {
  it('基础字段与固定参数（mode=7 / SEARCH）', () => {
    const body = buildSearchBody(base, 'p1')
    expect(body).toMatchObject({
      projectId: 'p1',
      platform: 'TIKTOK',
      mode: 7,
      reason: 'SEARCH',
      kolDescription: '美妆测评博主',
      batchCount: 1,
    })
    expect(body).not.toHaveProperty('excludeExistingInPool')
  })

  it('数值区间对象展开为 backend 的 min/max 字段', () => {
    const body = buildSearchBody(
      {
        ...base,
        followers: { min: 10000, max: 500000 },
        averageViews: { min: 5000 },
        averageLikes: { max: 300 },
      },
      'p1',
    )
    expect(body.minSubscribers).toBe(10000)
    expect(body.maxSubscribers).toBe(500000)
    expect(body.minVideosAverageViews).toBe(5000)
    expect(body.maxVideosAverageViews).toBeUndefined()
    expect(body.minAverageLikeCount).toBeUndefined()
    expect(body.maxAverageLikeCount).toBe(300)
  })

  it('attributeTags 正向/负向映射为布尔字段', () => {
    const body = buildSearchBody(
      { ...base, attributeTags: ['face_on_camera', 'no_pets', 'tk_shop', 'no_couple'] },
      'p1',
    )
    expect(body.faceOnCamera).toBe(true)
    expect(body.hasPets).toBe(false)
    expect(body.hasTkShop).toBe(true)
    expect(body.isCouple).toBe(false)
    expect(body.voiceOver).toBeUndefined()
  })

  it('demographics / category 分组展开', () => {
    const body = buildSearchBody(
      {
        ...base,
        demographics: { gender: 'female', ageRange: '18-24' },
        category: { main: 'beauty', tone: 'funny' },
      },
      'p1',
    )
    expect(body.gender).toBe('female')
    expect(body.ageRange).toBe('18-24')
    expect(body.skinColor).toBeUndefined()
    expect(body.mainCategory).toBe('beauty')
    expect(body.subCategory).toBeUndefined()
    expect(body.tone).toBe('funny')
  })

  it('nextPage → NEXT_PAGE + excludeExistingInPool', () => {
    const body = buildSearchBody({ ...base, nextPage: true }, 'p1')
    expect(body.reason).toBe('NEXT_PAGE')
    expect(body.excludeExistingInPool).toBe(true)
  })

  it('languages 包进 bloggerRequirements', () => {
    const body = buildSearchBody({ ...base, languages: ['en', 'zh'] }, 'p1')
    expect(body.bloggerRequirements).toEqual({ languages: ['en', 'zh'] })
  })

  it('batchCount 缺省时按 maxResults 推断（每批 50，上限 10）', () => {
    expect(buildSearchBody({ ...base, maxResults: 100 }, 'p1').batchCount).toBe(2)
    expect(buildSearchBody({ ...base, maxResults: 500 }, 'p1').batchCount).toBe(10)
    expect(buildSearchBody({ ...base, batchCount: 3, maxResults: 500 }, 'p1').batchCount).toBe(3)
  })

  it('智能搜索流程参数原样透传', () => {
    const body = buildSearchBody(
      { ...base, canonicalTags: ['makeup'], keywords: ['skincare'], expandedQuery: 'EXP' },
      'p1',
    )
    expect(body.canonicalTags).toEqual(['makeup'])
    expect(body.keywords).toEqual(['skincare'])
    expect(body.expandedQuery).toBe('EXP')
  })
})
