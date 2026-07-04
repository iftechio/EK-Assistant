import type { AssistantTool, ToolContext } from '../tools/types.js'
import type { SessionStore } from '../session/store.js'

/**
 * Permission Gate：包装工具执行，按 风险+成本 两个维度分级放行。
 * 参考 claude-code 的分级确认设计（hooks→rules→风险分类→confirm）的精简版。
 *
 * 被拦下的调用会落库为 pending action，返回给模型一段"等待用户确认"的说明，
 * 模型据此告知用户在 UI 的确认卡片上批准；批准走 POST /api/actions/:id/confirm。
 */
export async function executeWithGate(
  tool: AssistantTool,
  input: unknown,
  ctx: ToolContext,
  store: SessionStore,
): Promise<unknown> {
  const summary = tool.summarize(input)

  const requireConfirmation = async (reason: string, estimatedQuota?: number) => {
    const action = await store.createPendingAction({
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      toolName: tool.name,
      input,
      summary,
      estimatedQuota,
    })
    ctx.emit({ type: 'confirmation-required', action })
    return {
      status: 'awaiting_user_confirmation',
      confirmationId: action.id,
      reason,
      summary,
      instruction:
        '该操作已生成确认卡片等待用户在界面上批准，尚未执行。告知用户需要在确认卡片上批准或拒绝，不要假设已执行，也不要重复发起同一操作。',
    }
  }

  switch (tool.permission) {
    case 'auto':
      return runTool(tool, input, ctx)

    case 'quota': {
      const estimate = tool.estimateQuota ? tool.estimateQuota(input) : 0
      ctx.emit({ type: 'tool-start', toolName: tool.name, input, estimatedQuota: estimate })
      // 账户真实余额预检：不足时直接拦下（backend 也会拒绝），避免让用户白确认
      const accountRemaining = await fetchAccountRemainingQuota(ctx)
      if (accountRemaining !== null && estimate > accountRemaining) {
        // 与 tool-start 配对，否则前端卡片永远停在"正在执行"
        ctx.emit({ type: 'tool-result', toolName: tool.name })
        return {
          status: 'insufficient_quota',
          accountRemainingQuota: accountRemaining,
          estimatedQuota: estimate,
          instruction:
            '用户账户剩余配额不足以执行本次操作。告知用户当前余额与预估消耗，建议缩小规模（如减少数量/批次）或前往充值，不要原样重试。',
        }
      }
      if (ctx.costMeter.wouldExceed(estimate)) {
        ctx.emit({ type: 'tool-result', toolName: tool.name })
        return requireConfirmation(
          `本次操作预估消耗 ${estimate} 配额，会话累计将超过上限 ${ctx.costMeter.cap}（已用 ${ctx.costMeter.spentSoFar}${
            accountRemaining !== null ? `，账户剩余 ${accountRemaining}` : ''
          }）`,
          estimate,
        )
      }
      const result = await runTool(tool, input, ctx, { skipStartEvent: true })
      const spent = await ctx.costMeter.add(estimate)
      ctx.emit({
        type: 'cost',
        spent,
        cap: ctx.costMeter.cap,
        accountRemaining: accountRemaining !== null ? Math.max(0, accountRemaining - estimate) : undefined,
      })
      return result
    }

    case 'write_logged': {
      const result = await runTool(tool, input, ctx)
      await ctx.logActivity(summary, { toolName: tool.name, input })
      return result
    }

    case 'confirm':
      return requireConfirmation('高风险不可逆操作（如真实发送邮件），必须由用户显式确认')
  }
}

/** 已被用户批准的 pending action 的真正执行入口（confirm 路由调用） */
export async function executeApprovedAction(
  tool: AssistantTool,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const result = await runTool(tool, input, ctx)
  await ctx.logActivity(`[用户已确认] ${tool.summarize(input)}`, { toolName: tool.name, input })
  return result
}

/**
 * 查询用户账户真实剩余配额（GET /api/quota/user-info）。
 * 查询失败（如企业账户无个人 membership）时返回 null，不阻塞工具执行。
 */
async function fetchAccountRemainingQuota(ctx: ToolContext): Promise<number | null> {
  try {
    const info = await ctx.backend.get<{ remainingQuota?: number }>('/api/quota/user-info')
    return typeof info?.remainingQuota === 'number' ? info.remainingQuota : null
  } catch {
    return null
  }
}

async function runTool(
  tool: AssistantTool,
  input: unknown,
  ctx: ToolContext,
  opts: { skipStartEvent?: boolean } = {},
): Promise<unknown> {
  if (!opts.skipStartEvent) {
    ctx.emit({ type: 'tool-start', toolName: tool.name, input })
  }
  const { forModel, display } = await tool.execute(input, ctx)
  ctx.emit({ type: 'tool-result', toolName: tool.name, display })
  return forModel
}
