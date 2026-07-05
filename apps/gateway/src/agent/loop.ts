import { streamText, stepCountIs, tool as aiTool, jsonSchema, zodSchema, type ModelMessage } from 'ai'
import { config } from '../config.js'
import { getModelPool } from '../ai/models.js'
import { BackendClient } from '../backend/client.js'
import { CostMeter } from '../cost/meter.js'
import { executeWithGate } from '../permissions/gate.js'
import { getTools } from '../tools/registry.js'
import { formatValidationError } from '../tools/validation.js'
import type { SessionStore, SessionRow } from '../session/store.js'
import type { AuthUser } from '../auth.js'
import type { AgentEvent, ToolContext, ToolDisplay } from '../tools/types.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { maybeCompact } from './compact.js'
import { repairToolPairing } from './history.js'

/**
 * Agent Loop：组装 system prompt → streamText 多步工具循环 → 事件流回前端 → 落库。
 * 结构参考 claude-code QueryEngine 的精简版；模型层 Vercel AI SDK 多供应商 failover。
 */
export async function runAgentTurn(args: {
  store: SessionStore
  session: SessionRow
  user: AuthUser
  userMessage: string
  emit: (event: AgentEvent) => void
  /** 客户端断开时中止模型流，停止烧 token */
  abortSignal?: AbortSignal
}): Promise<void> {
  const { store, session, user, userMessage } = args

  const displays: ToolDisplay[] = []
  // 本轮是否已发起过工具调用：一旦有（配额可能已扣、pending action 可能已落库），
  // failover 重放整轮 messages 会重复执行工具，必须熔断
  let toolStarted = false
  const emit = (event: AgentEvent) => {
    if (event.type === 'tool-start') toolStarted = true
    if (event.type === 'tool-result' && event.display) displays.push(event.display)
    args.emit(event)
  }

  await store.appendMessage(session.id, { role: 'user', content: userMessage })
  if (!session.title) {
    await store.touchSession(session.id, { title: userMessage.slice(0, 40) })
  }

  const memory = await store.getMemory(user.userId)
  const history = await loadHistory(store, session.id)

  const costMeter = new CostMeter(store, session.id, session.quota_spent)
  const ctx: ToolContext = {
    userId: user.userId,
    jwt: user.jwt,
    sessionId: session.id,
    backend: new BackendClient(user.jwt),
    costMeter,
    emit,
    logActivity: (summary, detail) =>
      store.logActivity({
        sessionId: session.id,
        userId: user.userId,
        toolName: typeof detail === 'object' && detail && 'toolName' in detail ? String((detail as any).toolName) : '',
        summary,
        detail,
      }),
    saveMemory: (key, value) => store.setMemory(user.userId, key, value),
    deleteMemory: (key) => store.deleteMemory(user.userId, key),
  }

  const tools = Object.fromEntries(
    getTools().map((t) => [
      t.name,
      aiTool({
        description: t.description,
        // SDK 层只透传不校验（provider 仍收到完整 JSON Schema）：SDK 默认对非法参数
        // 回喂的是冗长的英文 zod 原始错误，模型难以照改；校验移到下面自己做，
        // 失败时回喂祈使句格式的自解释错误，模型静默修正后重试
        inputSchema: jsonSchema<Record<string, unknown>>(zodSchema(t.inputSchema).jsonSchema),
        execute: async (rawInput: unknown) => {
          const parsed = t.inputSchema.safeParse(rawInput)
          if (!parsed.success) {
            return { error: formatValidationError(t.name, parsed.error) }
          }
          try {
            return await executeWithGate(t, parsed.data, ctx, store)
          } catch (err) {
            // 工具失败喂回模型，让它向用户解释/换路子，而不是整轮崩掉
            // 同时补发 tool-result，否则前端工具卡片会永远停在"正在执行"
            emit({ type: 'tool-result', toolName: t.name })
            return { error: err instanceof Error ? err.message : String(err) }
          }
        },
      }),
    ]),
  )

  let system = buildSystemPrompt({ userEmail: user.email, memory })
  if (session.context_summary) {
    system += `\n\n[早前对话摘要]\n${session.context_summary}\n（以上是更早对话的压缩摘要。基于它直接继续当前任务；不要向用户复述摘要内容，也不要重新确认摘要中已确认过的事项。）`
  }

  // history 已包含开头落库的本轮用户消息，不能再拼一次，否则模型会收到重复的 user 消息
  const messages: ModelMessage[] = [...history]
  // 每轮变化的配额数字不进 system prompt（保持前缀逐字稳定以命中 provider 隐式缓存），
  // 以状态注入的形式挂在消息末尾，不落库
  messages.push({
    role: 'user',
    content: `[会话状态注入] 本会话已消耗 backend 配额 ${costMeter.spentSoFar}/${costMeter.cap}。这是界面自动附带的状态信息，不是用户发言，无需回应。`,
  })

  const pool = getModelPool()
  let lastError: unknown
  let anyTextEmitted = false
  // 增量落库游标：onStepFinish 的 response.messages 是累积数组，每步只落新增部分。
  // 这样流中途出错时，已执行的 tool-call/tool-result 也在历史里，下轮模型
  // 不会因为看不到已做过的搜索而重做一次、重扣一次配额。
  let persistedCount = 0
  let lastPersistedId: string | null = null
  // 最后一步的真实 usage：input+output ≈ 下一轮的上下文规模，压缩触发用它替代 chars/4 估算
  let contextTokens: number | undefined
  for (const pooled of pool) {
    let textEmitted = false
    try {
      const result = streamText({
        model: pooled.model,
        system,
        messages,
        tools,
        stopWhen: stepCountIs(config.maxSteps),
        abortSignal: args.abortSignal,
        onStepFinish: async (step) => {
          const usage = step.usage
          if (usage) {
            contextTokens =
              usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
          }
          const fresh = step.response.messages.slice(persistedCount)
          persistedCount = step.response.messages.length
          for (const msg of fresh) {
            lastPersistedId = await store.appendMessage(session.id, msg)
          }
        },
      })

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          textEmitted = true
          anyTextEmitted = true
          emit({ type: 'text-delta', delta: part.text })
        } else if (part.type === 'error') {
          throw part.error
        }
      }

      const response = await result.response
      // 各 step 的消息已增量落库；这里兜底收尾可能未经 onStepFinish 的尾部消息
      for (const msg of response.messages.slice(persistedCount)) {
        lastPersistedId = await store.appendMessage(session.id, msg)
      }
      persistedCount = response.messages.length
      if (displays.length && lastPersistedId) {
        await store.updateMessageDisplay(lastPersistedId, displays)
      }

      emit({ type: 'done', sessionId: session.id })

      // 轮后异步压缩，不阻塞响应
      maybeCompact(store, session.id, session.context_summary, contextTokens).catch((err) => {
        console.error(`[compact] 会话 ${session.id} 上下文压缩失败:`, err)
      })
      return
    } catch (err) {
      // 客户端已断开导致的中止：直接结束，不 failover 也不报错
      if (args.abortSignal?.aborted) return
      lastError = err
      // 已开始输出文本（重复内容）、已执行过工具（重复扣配额/重复副作用）或
      // 已有消息落库（重放会产生重复历史）时禁止 failover 重放
      if (textEmitted || toolStarted || persistedCount > 0) break
    }
  }

  if (displays.length) {
    const fallbackText = '工具已完成，结果见上方卡片；模型总结暂时生成失败。'
    lastPersistedId = await store.appendMessage(session.id, {
      role: 'assistant',
      content: anyTextEmitted ? '' : fallbackText,
    } as ModelMessage, displays)
    if (!anyTextEmitted) emit({ type: 'text-delta', delta: fallbackText })
    emit({ type: 'done', sessionId: session.id })
    maybeCompact(store, session.id, session.context_summary, contextTokens).catch((err) => {
      console.error(`[compact] 会话 ${session.id} 上下文压缩失败:`, err)
    })
    return
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  emit({ type: 'error', message: `模型调用失败: ${message}` })
  emit({ type: 'done', sessionId: session.id })
}

async function loadHistory(store: SessionStore, sessionId: string): Promise<ModelMessage[]> {
  const rows = await store.listMessages(sessionId)
  // 配对兜底：中途崩溃/部分落库留下的孤儿 tool-call/tool-result 会让该会话每轮
  // 都被模型 API 拒绝（永久变砖），加载时修复
  return repairToolPairing(rows.map((r) => ({ role: r.role, content: r.content }) as ModelMessage))
}
