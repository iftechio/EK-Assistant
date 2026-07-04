import { describe, expect, it } from 'vitest'
import { inferPlatform } from './comments.js'

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
