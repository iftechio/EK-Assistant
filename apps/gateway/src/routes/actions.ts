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
  /** 拒绝理由（可选）：会写入会话历史回喂模型，模型下轮按理由调整 */
  reason?: string
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

      const approved = Boolean(request.body?.approved)
      const action = await store.claimPendingAction(
        request.params.id,
        user.userId,
        approved ? 'approved' : 'rejected',
      )
      if (!action) {
        const existing = await store.getPendingAction(request.params.id, user.userId)
        if (!existing) return reply.status(404).send({ error: '确认项不存在' })
        return reply.status(409).send({ error: `确认项已处理（${existing.status}）` })
      }

      if (!approved) {
        const reason =
          typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 500) : ''
        await store.resolvePendingAction(action.id, 'rejected', reason ? { reason } : undefined)
        // 拒绝必须落历史且语义明确（参考 claude-code REJECT_MESSAGE 的 STOP 语义），
        // 否则模型下轮不知道用户拒过、为什么拒，很可能再次发起同样的操作
        await store.appendMessage(action.session_id, {
          role: 'assistant',
          content: `【系统】用户拒绝了操作：${action.summary}。${
            reason ? `拒绝理由：${reason}。` : ''
          }该操作未执行。停止推进此操作，等待用户下一步指示；除非用户主动重新提出，不要再次发起相同或类似的操作${
            reason ? '，如要继续请先按拒绝理由调整方案' : ''
          }。`,
        })
        return reply.send({ status: 'rejected' })
      }

      const tool = getToolByName(action.tool_name)
      if (!tool) {
        await store.resolvePendingAction(action.id, 'failed', { error: `未知工具 ${action.tool_name}` })
        return reply.status(500).send({ error: `未知工具 ${action.tool_name}` })
      }

      const session = await store.getSession(action.session_id, user.userId)
      if (!session) {
        await store.resolvePendingAction(action.id, 'failed', { error: '会话不存在' })
        return reply.status(404).send({ error: '会话不存在' })
      }

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
