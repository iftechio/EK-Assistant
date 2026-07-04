import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { executeWithGate } from './gate.js'
import { defineTool, type ToolContext } from '../tools/types.js'
import type { SessionStore } from '../session/store.js'

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'u1',
    jwt: 'jwt',
    sessionId: 's1',
    backend: {} as any,
    costMeter: {
      cap: 100,
      spentSoFar: 0,
      wouldExceed: () => false,
      add: vi.fn(async (n: number) => n),
    } as any,
    emit: vi.fn(),
    logActivity: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeStore() {
  return {
    createPendingAction: vi.fn(async (args: any) => ({
      id: 'action-1',
      toolName: args.toolName,
      summary: args.summary,
      input: args.input,
      estimatedQuota: args.estimatedQuota,
    })),
  } as unknown as SessionStore
}

const baseTool = {
  description: 'test',
  inputSchema: z.object({}),
  summarize: () => '测试操作',
}

describe('executeWithGate', () => {
  it('confirm 级工具绝不直接执行，落库为 pending action', async () => {
    const execute = vi.fn()
    const tool = defineTool({ ...baseTool, name: 'send', permission: 'confirm', execute })
    const store = makeStore()
    const ctx = makeCtx()

    const result = (await executeWithGate(tool, {}, ctx, store)) as any
    expect(execute).not.toHaveBeenCalled()
    expect(result.status).toBe('awaiting_user_confirmation')
    expect(result.confirmationId).toBe('action-1')
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'confirmation-required' }),
    )
  })

  it('quota 级工具超上限时转为需确认，且补发 tool-result 结束前端卡片', async () => {
    const execute = vi.fn()
    const tool = defineTool({
      ...baseTool,
      name: 'search',
      permission: 'quota',
      estimateQuota: () => 50,
      execute,
    })
    const store = makeStore()
    const ctx = makeCtx({
      costMeter: {
        cap: 100,
        spentSoFar: 80,
        wouldExceed: (n: number) => 80 + n > 100,
        add: vi.fn(),
      } as any,
    })

    const result = (await executeWithGate(tool, {}, ctx, store)) as any
    expect(execute).not.toHaveBeenCalled()
    expect(result.status).toBe('awaiting_user_confirmation')
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool-result', toolName: 'search' }),
    )
  })

  it('quota 级工具账户余额不足时拦下，且补发 tool-result 结束前端卡片', async () => {
    const execute = vi.fn()
    const tool = defineTool({
      ...baseTool,
      name: 'search',
      permission: 'quota',
      estimateQuota: () => 50,
      execute,
    })
    const store = makeStore()
    const ctx = makeCtx({
      backend: { get: vi.fn(async () => ({ remainingQuota: 10 })) } as any,
    })

    const result = (await executeWithGate(tool, {}, ctx, store)) as any
    expect(execute).not.toHaveBeenCalled()
    expect(result.status).toBe('insufficient_quota')
    expect(result.accountRemainingQuota).toBe(10)
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool-result', toolName: 'search' }),
    )
  })

  it('quota 级工具未超限时执行并计入消耗', async () => {
    const tool = defineTool({
      ...baseTool,
      name: 'search',
      permission: 'quota',
      estimateQuota: () => 10,
      execute: async () => ({ forModel: { ok: true } }),
    })
    const store = makeStore()
    const ctx = makeCtx()

    const result = (await executeWithGate(tool, {}, ctx, store)) as any
    expect(result.ok).toBe(true)
    expect(ctx.costMeter.add).toHaveBeenCalledWith(10)
  })

  it('write_logged 级工具执行后写活动日志', async () => {
    const tool = defineTool({
      ...baseTool,
      name: 'save',
      permission: 'write_logged',
      execute: async () => ({ forModel: { saved: 1 } }),
    })
    const store = makeStore()
    const ctx = makeCtx()

    const result = (await executeWithGate(tool, {}, ctx, store)) as any
    expect(result.saved).toBe(1)
    expect(ctx.logActivity).toHaveBeenCalledWith('测试操作', expect.anything())
  })
})
