import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { INTERRUPTED_RESULT, repairToolPairing } from './history.js'

const user = (text: string): ModelMessage => ({ role: 'user', content: text })
const assistantText = (text: string): ModelMessage => ({ role: 'assistant', content: text })
const assistantCall = (id: string): ModelMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: id, toolName: 'search_kols', input: {} }],
  }) as ModelMessage
const toolResult = (id: string): ModelMessage =>
  ({
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId: id, toolName: 'search_kols', output: { type: 'json', value: {} } },
    ],
  }) as ModelMessage

describe('repairToolPairing', () => {
  it('配对完整的历史原样返回', () => {
    const history = [user('找达人'), assistantCall('c1'), toolResult('c1'), assistantText('找到了')]
    expect(repairToolPairing(history)).toEqual(history)
  })

  it('孤儿 tool-call 后面补合成中断结果', () => {
    const history = [user('找达人'), assistantCall('c1'), user('怎么样了')]
    const repaired = repairToolPairing(history)
    expect(repaired).toHaveLength(4)
    expect(repaired[2].role).toBe('tool')
    const part = (repaired[2].content as any[])[0]
    expect(part.toolCallId).toBe('c1')
    expect(part.output.value).toBe(INTERRUPTED_RESULT)
    expect(repaired[3]).toEqual(user('怎么样了'))
  })

  it('历史末尾的孤儿 tool-call 也补齐', () => {
    const repaired = repairToolPairing([user('找达人'), assistantCall('c1')])
    expect(repaired).toHaveLength(3)
    expect(repaired[2].role).toBe('tool')
  })

  it('孤儿 tool-result（无前置 tool-call）整条剥离', () => {
    const repaired = repairToolPairing([toolResult('ghost'), user('你好')])
    expect(repaired).toEqual([user('你好')])
  })

  it('tool 消息里混有孤儿 part 时只保留配对上的', () => {
    const mixed = {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'c1', toolName: 'search_kols', output: { type: 'json', value: {} } },
        { type: 'tool-result', toolCallId: 'ghost', toolName: 'search_kols', output: { type: 'json', value: {} } },
      ],
    } as ModelMessage
    const repaired = repairToolPairing([assistantCall('c1'), mixed])
    expect((repaired[1].content as any[]).map((p) => p.toolCallId)).toEqual(['c1'])
  })

  it('多个未配对 tool-call 一次补齐', () => {
    const multi = {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'a', toolName: 'x', input: {} },
        { type: 'tool-call', toolCallId: 'b', toolName: 'y', input: {} },
      ],
    } as ModelMessage
    const repaired = repairToolPairing([multi, toolResult('a')])
    expect(repaired).toHaveLength(3)
    expect((repaired[2].content as any[]).map((p) => p.toolCallId)).toEqual(['b'])
  })
})
