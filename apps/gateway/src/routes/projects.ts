import type { FastifyInstance } from 'fastify'
import { authenticate, AuthError } from '../auth.js'
import { BackendClient, BackendError } from '../backend/client.js'

interface ProjectView {
  id: string
  title: string
}

interface RateKolBody {
  kolId?: string
  attitude?: 'LIKE' | 'SUPERLIKE' | 'DISLIKE' | 'NORATE'
}

/** 当前用户项目列表：前端只读使用，JWT 继续透传到 backend。 */
export function registerProjectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async (request, reply) => {
    let user
    try {
      user = await authenticate(request.headers.authorization)
    } catch (e) {
      return reply.status(401).send({ error: e instanceof AuthError ? e.message : '鉴权失败' })
    }

    try {
      const projects = await new BackendClient(user.jwt).get<any[]>('/api/projects/')
      return (projects ?? []).map((project): ProjectView => ({
        id: String(project.id),
        title: String(project.title ?? project.name ?? project.id),
      }))
    } catch (e) {
      if (e instanceof BackendError) {
        return reply.status(e.status || 502).send({ error: e.message })
      }
      return reply.status(502).send({ error: e instanceof Error ? e.message : '项目列表加载失败' })
    }
  })

  app.post<{ Params: { projectId: string }; Body: RateKolBody }>(
    '/api/projects/:projectId/kols/rate',
    async (request, reply) => {
      let user
      try {
        user = await authenticate(request.headers.authorization)
      } catch (e) {
        return reply.status(401).send({ error: e instanceof AuthError ? e.message : '鉴权失败' })
      }

      const kolId = request.body?.kolId?.trim()
      const attitude = request.body?.attitude
      if (!kolId) return reply.status(400).send({ error: '缺少 kolId' })
      if (!attitude) return reply.status(400).send({ error: '缺少 attitude' })

      try {
        await new BackendClient(user.jwt).post('/api/projectkol/rate', {
          projectId: request.params.projectId,
          kolId,
          attitude,
        })
        return { ok: true }
      } catch (e) {
        if (e instanceof BackendError) {
          return reply.status(e.status || 502).send({ error: e.message })
        }
        return reply.status(502).send({ error: e instanceof Error ? e.message : '达人标记失败' })
      }
    },
  )
}
