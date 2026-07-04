import { streamText, stepCountIs, tool as aiTool, type ModelMessage } from 'ai'
import { config } from '../config.js'
import { getModelPool } from '../ai/models.js'
import { BackendClient } from '../backend/client.js'
import { CostMeter } from '../cost/meter.js'
import { executeWithGate } from '../permissions/gate.js'
import { getTools } from '../tools/registry.js'
import type { SessionStore, SessionRow } from '../session/store.js'
import type { AuthUser } from '../auth.js'
import type { AgentEvent, ToolContext, ToolDisplay } from '../tools/types.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { maybeCompact } from './compact.js'

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
        inputSchema: t.inputSchema,
        execute: async (input: unknown) => {
          try {
            return await executeWithGate(t, input, ctx, store)
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

  let system = buildSystemPrompt({
    userEmail: user.email,
    memory,
    quotaSpent: costMeter.spentSoFar,
    quotaCap: costMeter.cap,
  })
  if (session.context_summary) {
    system += `\n\n[早前对话摘要]\n${session.context_summary}`
  }

  // history 已包含开头落库的本轮用户消息，不能再拼一次，否则模型会收到重复的 user 消息
  const messages: ModelMessage[] = [...history]

  const pool = getModelPool()
  let lastError: unknown
  for (const pooled of pool) {
    let textEmitted = false
    try {
      const result = streamText({
        model: pooled.model,
        system,
        messages,
        tools,
        stopWhen: stepCountIs(config.maxSteps),
      })

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          textEmitted = true
          emit({ type: 'text-delta', delta: part.text })
        } else if (part.type === 'error') {
          throw part.error
        }
      }

      const response = await result.response
      // 持久化本轮产生的 assistant/tool 消息（用户消息已在开头落库）
      for (let i = 0; i < response.messages.length; i++) {
        const msg = response.messages[i]
        const isLast = i === response.messages.length - 1
        await store.appendMessage(session.id, msg, isLast && displays.length ? displays : undefined)
      }

      emit({ type: 'done', sessionId: session.id })

      // 轮后异步压缩，不阻塞响应
      maybeCompact(store, session.id, session.context_summary).catch(() => {})
      return
    } catch (err) {
      lastError = err
      // 已开始输出文本（重复内容）或已执行过工具（重复扣配额/重复副作用）时禁止 failover 重放
      if (textEmitted || toolStarted) break
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  emit({ type: 'error', message: `模型调用失败: ${message}` })
  emit({ type: 'done', sessionId: session.id })
}

async function loadHistory(store: SessionStore, sessionId: string): Promise<ModelMessage[]> {
  const rows = await store.listMessages(sessionId)
  return rows.map((r) => ({ role: r.role, content: r.content }) as ModelMessage)
}
