import type { FastifyInstance } from 'fastify'
import { authenticate, AuthError } from '../auth.js'
import { runAgentTurn } from '../agent/loop.js'
import type { SessionStore } from '../session/store.js'
import { openSse } from './sse.js'

interface ChatBody {
  sessionId?: string
  message: string
}

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

    const session = sessionId
      ? await store.getSession(sessionId, user.userId)
      : await store.createSession(user.userId)
    if (!session) {
      return reply.status(404).send({ error: '会话不存在' })
    }

    const sse = openSse(request, reply)
    sse.emit({ type: 'session', sessionId: session.id })
    try {
      await runAgentTurn({
        store,
        session,
        user,
        userMessage: message,
        emit: sse.emit,
      })
    } catch (err) {
      sse.emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      sse.close()
    }
  })
}
