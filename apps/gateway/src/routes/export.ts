import type { FastifyInstance } from 'fastify'
import { authenticate, AuthError } from '../auth.js'
import { config } from '../config.js'

interface ExportBody {
  taskId: string
}

/** 评论 Excel 下载透传：前端带 JWT 调这里，Gateway 转发 backend 并流回 xlsx（按已完成任务导出，免费） */
export function registerExportRoutes(app: FastifyInstance) {
  app.post<{ Body: ExportBody }>('/api/comments-export', async (request, reply) => {
    let user
    try {
      user = await authenticate(request.headers.authorization)
    } catch (e) {
      return reply.status(401).send({ error: e instanceof AuthError ? e.message : '鉴权失败' })
    }

    const { taskId } = request.body ?? {}
    if (!taskId) {
      return reply.status(400).send({ error: '缺少 taskId' })
    }

    const res = await fetch(
      new URL(`/api/videoComments/export/${encodeURIComponent(taskId)}`, config.backendBaseUrl),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${user.jwt}`,
        },
      },
    )
    if (!res.ok) {
      const text = await res.text()
      return reply.status(res.status).send({ error: text.slice(0, 500) })
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', res.headers.get('content-disposition') ?? 'attachment; filename="comments.xlsx"')
      .send(buffer)
  })
}
