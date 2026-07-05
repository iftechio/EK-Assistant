import type { FastifyInstance } from 'fastify'
import { authenticate, AuthError } from '../auth.js'
import { runAgentTurn } from '../agent/loop.js'
import type { SessionStore } from '../session/store.js'
import { openSse } from './sse.js'

interface ChatBody {
  sessionId?: string
  message: string
}

/** 正在进行 agent turn 的会话（互斥标记） */
const activeSessions = new Set<string>()
/**
 * 同会话串行队列：并发消息不再 409 拒绝，而是排队等上一轮完成后自动开始
 * （长搜索一跑几分钟，用户中途补充的消息不该被打回）。value 是队尾 promise。
 */
const sessionQueues = new Map<string, Promise<void>>()
/** 排队等待上限：超过后放弃本条消息，避免长队积压 */
const QUEUE_WAIT_TIMEOUT_MS = 5 * 60 * 1000

export function registerChatRoutes(app: FastifyInstance, store: SessionStore) {
  app.post<{ Body: ChatBody }>('/api/chat', async (request, reply) => {
    let user
    try {
      user = await authenticate(request.headers.authorization)
    } catch (e) {
      return reply.status(401).send({ error: e instanceof AuthError ? e.message : '鉴权失败' })
    }

    const { sessionId, message } = request.body ?? ({} as ChatBody)
    if (!message || typeof message !== 'string') {
      return reply.status(400).send({ error: 'message 必填' })
    }
    if (message.length > 20000) {
      return reply.status(400).send({ error: '消息过长（上限 20000 字符），请拆分后发送' })
    }

    const session = sessionId
      ? await store.getSession(sessionId, user.userId)
      : await store.createSession(user.userId)
    if (!session) {
      return reply.status(404).send({ error: '会话不存在' })
    }

    const sse = openSse(request, reply)
    sse.emit({ type: 'session', sessionId: session.id })
    // 客户端断开（关页面/断网）时中止 agent，停止继续烧模型 token 和用户配额
    const abort = new AbortController()
    request.raw.on('close', () => abort.abort())

    const prior = sessionQueues.get(session.id)
    const run = (async () => {
      if (prior) {
        sse.emit({ type: 'queued' })
        const finished = await Promise.race([
          prior.then(() => true),
          sleep(QUEUE_WAIT_TIMEOUT_MS).then(() => false),
        ])
        // 超时（前一轮卡死）或前一轮仍占着互斥标记时放弃，避免交错写历史
        if (!finished || activeSessions.has(session.id)) {
          sse.emit({ type: 'error', message: '排队等待上一条消息超时，请稍后重新发送' })
          sse.emit({ type: 'done', sessionId: session.id })
          return
        }
      }
      // 排队期间客户端已断开：不再开跑
      if (abort.signal.aborted) return
      activeSessions.add(session.id)
      try {
        // 排过队的要重读会话：上一轮已更新 quota_spent / context_summary，旧快照会少计配额
        const fresh = prior ? ((await store.getSession(session.id, user.userId)) ?? session) : session
        await runAgentTurn({
          store,
          session: fresh,
          user,
          userMessage: message,
          emit: sse.emit,
          abortSignal: abort.signal,
        })
      } finally {
        activeSessions.delete(session.id)
      }
    })()

    const tail = run.catch(() => {})
    sessionQueues.set(session.id, tail)
    try {
      await run
    } catch (err) {
      sse.emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      if (sessionQueues.get(session.id) === tail) sessionQueues.delete(session.id)
      sse.close()
    }
  })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
