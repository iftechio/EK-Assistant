import type { FastifyInstance } from 'fastify'
import { authenticate, AuthError } from '../auth.js'
import { BackendClient } from '../backend/client.js'
import { CostMeter } from '../cost/meter.js'
import { executeApprovedAction } from '../permissions/gate.js'
import { getToolByName } from '../tools/registry.js'
import type { SessionStore } from '../session/store.js'
import type { ToolContext, ToolDisplay } from '../tools/types.js'

interface ConfirmBody {
  approved: boolean
}

/** 高风险/超限操作的确认执行入口（确认卡片的"批准/拒绝"落点） */
export function registerActionRoutes(app: FastifyInstance, store: SessionStore) {
  app.post<{ Params: { id: string }; Body: ConfirmBody }>(
    '/api/actions/:id/confirm',
    async (request, reply) => {
      let user
      try {
        user = await authenticate(request.headers.authorization)
      } catch (e) {
        return reply.status(401).send({ error: e instanceof AuthError ? e.message : '鉴权失败' })
      }

      const action = await store.getPendingAction(request.params.id, user.userId)
      if (!action) return reply.status(404).send({ error: '确认项不存在' })
      if (action.status !== 'pending') {
        return reply.status(409).send({ error: `确认项已处理（${action.status}）` })
      }

      if (!request.body?.approved) {
        await store.resolvePendingAction(action.id, 'rejected')
        await store.appendMessage(action.session_id, {
          role: 'assistant',
          content: `【系统】用户拒绝了操作：${action.summary}。该操作未执行。`,
        })
        return reply.send({ status: 'rejected' })
      }

      const tool = getToolByName(action.tool_name)
      if (!tool) return reply.status(500).send({ error: `未知工具 ${action.tool_name}` })

      const session = await store.getSession(action.session_id, user.userId)
      if (!session) return reply.status(404).send({ error: '会话不存在' })

      const displays: ToolDisplay[] = []
      const costMeter = new CostMeter(store, session.id, session.quota_spent)
      const ctx: ToolContext = {
        userId: user.userId,
        jwt: user.jwt,
        sessionId: session.id,
        backend: new BackendClient(user.jwt),
        costMeter,
        emit: (event) => {
          if (event.type === 'tool-result' && event.display) displays.push(event.display)
        },
        logActivity: (summary, detail) =>
          store.logActivity({
            sessionId: session.id,
            userId: user.userId,
            toolName: action.tool_name,
            summary,
            detail,
          }),
      }

      try {
        const result = await executeApprovedAction(tool, action.input, ctx)
        if (action.estimated_quota) {
          await costMeter.add(action.estimated_quota)
        }
        await store.resolvePendingAction(action.id, 'executed', result)
        await store.appendMessage(
          action.session_id,
          {
            role: 'assistant',
            content: `【系统】用户批准并已执行操作：${action.summary}。执行结果：${truncateJson(result, 2000)}`,
          },
          displays.length ? displays : undefined,
        )
        return reply.send({
          status: 'executed',
          result,
          display: displays[0] ?? null,
          quotaSpent: costMeter.spentSoFar,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await store.resolvePendingAction(action.id, 'failed', { error: message })
        await store.appendMessage(action.session_id, {
          role: 'assistant',
          content: `【系统】用户批准了操作：${action.summary}，但执行失败：${message}`,
        })
        return reply.status(500).send({ status: 'failed', error: message })
      }
    },
  )
}

function truncateJson(value: unknown, n: number): string {
  const s = JSON.stringify(value) ?? ''
  return s.length > n ? `${s.slice(0, n)}…` : s
}
