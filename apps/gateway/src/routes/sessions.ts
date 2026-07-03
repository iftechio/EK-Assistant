import type { FastifyInstance } from 'fastify'
import { authenticate, AuthError } from '../auth.js'
import type { SessionStore } from '../session/store.js'

export function registerSessionRoutes(app: FastifyInstance, store: SessionStore) {
  const auth = async (request: any, reply: any) => {
    try {
      return await authenticate(request.headers.authorization)
    } catch (e) {
      reply.status(401).send({ error: e instanceof AuthError ? e.message : '鉴权失败' })
      return null
    }
  }

  app.get('/api/sessions', async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    const sessions = await store.listSessions(user.userId)
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      quotaSpent: s.quota_spent,
      updatedAt: s.updated_at,
    }))
  })

  app.get<{ Params: { id: string } }>('/api/sessions/:id/messages', async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    const session = await store.getSession(request.params.id, user.userId)
    if (!session) return reply.status(404).send({ error: '会话不存在' })
    const messages = await store.listMessages(session.id, true)
    return {
      session: {
        id: session.id,
        title: session.title,
        quotaSpent: session.quota_spent,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        display: m.display,
        createdAt: m.created_at,
      })),
    }
  })

  app.get<{ Querystring: { sessionId?: string } }>('/api/activity', async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    return store.listActivity(user.userId, request.query.sessionId)
  })
}
