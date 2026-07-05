import type { ModelMessage } from 'ai'

/** 补给孤儿 tool-call 的合成结果文案 */
export const INTERRUPTED_RESULT = '（工具执行被中断，没有结果；如仍需要请重新调用）'

interface ToolCallPartLike {
  type?: string
  toolCallId?: string
  toolName?: string
}

/**
 * 历史合法化兜底（参考 claude-code ensureToolResultPairing）：
 * 进程中途崩溃/部分落库可能留下没有 tool-result 的 tool-call（或反之），
 * 这样的历史每轮都会被模型 API 拒绝，会话永久不可用。加载时修复：
 * - assistant 的 tool-call 缺少配对结果 → 紧随其后补一条合成的中断错误 tool 消息
 * - 没有前置 tool-call 的孤儿 tool-result → 剥离（整条全是孤儿时剥掉整条消息）
 */
export function repairToolPairing(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  let pending = new Map<string, string>() // toolCallId -> toolName

  const flushMissing = () => {
    if (!pending.size) return
    out.push({
      role: 'tool',
      content: [...pending.entries()].map(([toolCallId, toolName]) => ({
        type: 'tool-result',
        toolCallId,
        toolName,
        output: { type: 'error-text', value: INTERRUPTED_RESULT },
      })),
    } as ModelMessage)
    pending = new Map()
  }

  for (const msg of messages) {
    if (msg.role === 'tool') {
      const parts = Array.isArray(msg.content) ? (msg.content as ToolCallPartLike[]) : []
      const matched = parts.filter(
        (p) => p?.type === 'tool-result' && p.toolCallId != null && pending.has(p.toolCallId),
      )
      for (const p of matched) pending.delete(p.toolCallId!)
      if (matched.length === parts.length && parts.length > 0) {
        out.push(msg)
      } else if (matched.length > 0) {
        out.push({ ...msg, content: matched } as ModelMessage)
      }
      // matched 为空：整条都是孤儿 tool-result，剥离
      continue
    }

    // 非 tool 消息出现时，未配对的 tool-call 已不可能再有结果，先补齐
    flushMissing()
    out.push(msg)
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content as ToolCallPartLike[]) {
        if (part?.type === 'tool-call' && part.toolCallId != null) {
          pending.set(part.toolCallId, part.toolName ?? 'unknown')
        }
      }
    }
  }
  flushMissing()
  return out
}
