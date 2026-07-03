import { generateText } from 'ai'
import { config } from '../config.js'
import { getModelPool } from '../ai/models.js'
import type { SessionStore, MessageRow } from '../session/store.js'

/** 粗略 token 估算：JSON 字符数 / 4 */
export function estimateTokens(value: unknown): number {
  const s = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  return Math.ceil(s.length / 4)
}

/** 压缩后保留的最近消息条数 */
const KEEP_RECENT = 8

/**
 * 上下文压缩：长会话逼近 token 预算时，把较早的消息压缩成一段摘要
 * 存到会话上（参考 claude-code services/compact 思路的精简版）。
 * @returns 是否发生了压缩
 */
export async function maybeCompact(
  store: SessionStore,
  sessionId: string,
  existingSummary: string | null,
): Promise<boolean> {
  const rows = await store.listMessages(sessionId)
  const total = rows.reduce((sum, r) => sum + estimateTokens(r.content), 0)
  if (total <= config.contextTokenBudget) return false

  const toCompact = rows.slice(0, Math.max(0, rows.length - KEEP_RECENT))
  if (toCompact.length === 0) return false

  const transcript = toCompact
    .map((r) => `${r.role}: ${truncate(stringifyContent(r), 2000)}`)
    .join('\n')

  const model = getModelPool()[0]
  const { text } = await generateText({
    model: model.model,
    system:
      '你是对话摘要器。把达人营销助手的历史对话压缩成要点，必须保留：用户的目标与偏好、已找到的关键 KOL（名字/平台/粉丝量级）、已创建的任务及其 ID、已发送或待确认的邮件操作、重要数字结论。用列表输出，不超过600字。',
    prompt: `${existingSummary ? `已有摘要：\n${existingSummary}\n\n` : ''}需要并入摘要的新对话：\n${transcript}`,
  })

  await store.compactMessages(
    sessionId,
    toCompact.map((r) => r.id),
    text,
  )
  return true
}

function stringifyContent(row: MessageRow): string {
  return typeof row.content === 'string' ? row.content : JSON.stringify(row.content)
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
