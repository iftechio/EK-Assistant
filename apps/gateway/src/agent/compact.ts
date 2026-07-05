import { generateText } from 'ai'
import { config } from '../config.js'
import { getModelPool } from '../ai/models.js'
import type { SessionStore, MessageRow } from '../session/store.js'

/** 粗略 token 估算：JSON 字符数 / 4（仅在拿不到真实 usage 时兜底） */
export function estimateTokens(value: unknown): number {
  const s = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  return Math.ceil(s.length / 4)
}

/** 压缩后保留的最近消息条数 */
const KEEP_RECENT = 8

/** microcompact 清理旧工具结果时的占位标记（完整数据仍在 display 列供界面卡片使用） */
export const CLEARED_MARKER = '[早期工具结果已清理；完整数据在界面卡片中，如仍需请重新调用工具]'

/** LLM 总结连续失败达到该次数后，本会话（进程生命周期内）不再尝试，避免空烧 API */
const MAX_COMPACT_FAILURES = 3
const compactFailures = new Map<string, number>()

/**
 * 计算压缩切分点：保留最近 keepRecent 条，但切分点不能落在 assistant(tool-calls)
 * 与 tool(result) 之间——保留窗口若以孤儿 tool 消息开头，之后每轮模型调用都会被拒。
 * 向后推进切分点直到保留窗口的第一条不是 tool 消息（宁可多压一点）。
 */
export function compactCutIndex(rows: { role: string }[], keepRecent = KEEP_RECENT): number {
  let cut = Math.max(0, rows.length - keepRecent)
  while (cut < rows.length && rows[cut].role === 'tool') cut++
  return cut
}

/**
 * 上下文压缩（参考 claude-code 三层防线的精简版，两层）：
 * 1. microcompact：把保留窗口之外的旧 tool 结果原地清成占位标记——最便宜，
 *    不打 LLM、消息结构（tool-call/result 配对）保持合法；多数会话到这层就够了
 * 2. autocompact：仍超预算时，把较早消息用 LLM 压成结构化摘要存到会话上
 * @param realContextTokens 本轮最后一步的真实 usage（input+output），比 chars/4 估算准
 * @returns 是否发生了压缩
 */
export async function maybeCompact(
  store: SessionStore,
  sessionId: string,
  existingSummary: string | null,
  realContextTokens?: number,
): Promise<boolean> {
  const rows = await store.listMessages(sessionId)
  const total = realContextTokens ?? rows.reduce((sum, r) => sum + estimateTokens(r.content), 0)
  if (total <= config.contextTokenBudget) return false

  // 第一层 microcompact
  const cut = compactCutIndex(rows)
  let freed = 0
  for (const row of rows.slice(0, cut)) {
    if (row.role !== 'tool') continue
    const cleared = clearToolResults(row.content)
    if (!cleared) continue
    freed += Math.max(0, estimateTokens(row.content) - estimateTokens(cleared))
    await store.updateMessageContent(row.id, cleared)
  }
  if (total - freed <= config.contextTokenBudget) return freed > 0

  // 第二层 autocompact（带熔断）
  if ((compactFailures.get(sessionId) ?? 0) >= MAX_COMPACT_FAILURES) return freed > 0

  const fresh = await store.listMessages(sessionId)
  const toCompact = fresh.slice(0, compactCutIndex(fresh))
  if (toCompact.length === 0) return freed > 0

  const transcript = toCompact
    .map((r) => `${r.role}: ${truncate(stringifyContent(r), 2000)}`)
    .join('\n')

  try {
    const model = getModelPool()[0]
    const { text } = await generateText({
      model: model.model,
      system: SUMMARY_SYSTEM,
      prompt: `${existingSummary ? `已有摘要（需并入）：\n${existingSummary}\n\n` : ''}需要压缩的新对话：\n${transcript}`,
    })
    await store.compactMessages(
      sessionId,
      toCompact.map((r) => r.id),
      text,
    )
    compactFailures.delete(sessionId)
  } catch (err) {
    compactFailures.set(sessionId, (compactFailures.get(sessionId) ?? 0) + 1)
    throw err
  }
  return true
}

/**
 * 结构化摘要指令（参考 claude-code 9 段式总结 prompt 的精简版）：
 * 分区固定，尤其是"下一步逐字引用用户要求"——防止压缩后任务漂移
 */
const SUMMARY_SYSTEM = `你是达人营销助手的对话摘要器。把历史对话压缩成结构化要点，供助手接续任务使用。只输出纯文本摘要，按以下分区（无内容的分区省略）：
1. 用户目标与偏好：显式需求、限制条件（平台/地区/粉丝量/预算等）
2. 关键达人：已找到的重要 KOL（名字/平台/粉丝量级）及所在 projectId
3. 任务与 ID：已创建的搜索/追踪/导出等任务及其 ID 与状态
4. 邮件与外联：涉及的模板、已发送/待确认/被用户拒绝的发送操作及结果
5. 重要结论：工具算出的关键数字（对比、百分比），注明来源
6. 当前进展与下一步：正在做什么；下一步要做什么（逐字引用用户最近的明确要求，避免任务漂移）
总长度不超过 800 字。`

/**
 * 把 tool 消息里的 tool-result 输出替换为占位标记；保持消息结构合法
 * （tool-result part 与 toolCallId 保留，只清 output）。无可清理内容时返回 null。
 */
export function clearToolResults(content: unknown): unknown | null {
  if (!Array.isArray(content)) return null
  let changed = false
  const next = content.map((part) => {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: string }).type === 'tool-result'
    ) {
      const output = (part as { output?: { type?: string; value?: unknown } }).output
      if (output?.type === 'text' && output.value === CLEARED_MARKER) return part
      changed = true
      return { ...part, output: { type: 'text', value: CLEARED_MARKER } }
    }
    return part
  })
  return changed ? next : null
}

function stringifyContent(row: MessageRow): string {
  return typeof row.content === 'string' ? row.content : JSON.stringify(row.content)
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
