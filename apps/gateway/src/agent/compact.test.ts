import { describe, expect, it } from 'vitest'
import { compactCutIndex } from './compact.js'

const u = { role: 'user' }
const a = { role: 'assistant' }
const t = { role: 'tool' }

describe('compactCutIndex', () => {
  it('消息数不超过保留窗口时不压缩', () => {
    expect(compactCutIndex([u, a, u, a], 8)).toBe(0)
  })

  it('切分点不在 tool 消息上时按条数切', () => {
    // 10 条，保留 4 → cut=6，rows[6] 是 user，不用移动
    const rows = [u, a, u, a, t, a, u, a, u, a]
    expect(compactCutIndex(rows, 4)).toBe(6)
  })

  it('切分点落在 tool 消息上时向后推进，保留窗口不以孤儿 tool-result 开头', () => {
    // cut=2 落在 tool 上（assistant 的 tool-calls 在 index 1），推进到 index 4 的 assistant
    const rows = [u, a, t, t, a, u]
    expect(compactCutIndex(rows, 4)).toBe(4)
  })

  it('连续多条 tool 消息全部跳过', () => {
    const rows = [u, a, t, t, t, a]
    expect(compactCutIndex(rows, 4)).toBe(5)
  })

  it('切分点之后全是 tool 消息时压缩全部（保留窗口空但不残缺）', () => {
    const rows = [u, a, t, t]
    expect(compactCutIndex(rows, 2)).toBe(4)
  })
})
