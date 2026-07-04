import Fastify from 'fastify'
import { SignJWT } from 'jose'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { registerActionRoutes } from './actions.js'
import type { SessionStore } from '../session/store.js'

const { mockTool } = vi.hoisted(() => ({
  mockTool: {
    name: 'send_outreach_batch',
    description: 'test',
    inputSchema: null as any,
    permission: 'confirm' as const,
    summarize: () => '发送邮件',
    execute: vi.fn(),
  },
}))

vi.mock('../tools/registry.js', () => ({
  getToolByName: (name: string) => (name === 'send_outreach_batch' ? mockTool : undefined),
}))

const SECRET = 'test-secret'
let token: string

beforeAll(async () => {
  config.supabaseJwtSecret = SECRET
  token = await new SignJWT({ sub: 'u1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
})

interface ActionRecord {
  id: string
  session_id: string
  user_id: string
  tool_name: string
  input: unknown
  summary: string
  estimated_quota: number | null
  status: string
}

function makeStore(actions: Map<string, ActionRecord>) {
  return {
    // 与 SQL 原子 UPDATE 等价：无 await 的检查+翻转，单线程内不可分割
    claimPendingAction: vi.fn(async (id: string, userId: string, status: string) => {
      const act = actions.get(id)
      if (!act || act.user_id !== userId || act.status !== 'pending') return null
      act.status = status
      return { ...act }
    }),
    getPendingAction: vi.fn(async (id: string, userId: string) => {
      const act = actions.get(id)
      return act && act.user_id === userId ? { ...act } : null
    }),
    resolvePendingAction: vi.fn(async (id: string, status: string) => {
      const act = actions.get(id)
      if (act) act.status = status
    }),
    getSession: vi.fn(async (id: string) => ({ id, quota_spent: 0 })),
    appendMessage: vi.fn(async () => 'mid'),
    logActivity: vi.fn(async () => {}),
    setMemory: vi.fn(async () => {}),
    deleteMemory: vi.fn(async () => {}),
    addQuotaSpent: vi.fn(async (_id: string, n: number) => n),
  } as unknown as SessionStore
}

function pendingAction(): ActionRecord {
  return {
    id: 'a1',
    session_id: 's1',
    user_id: 'u1',
    tool_name: 'send_outreach_batch',
    input: { templateId: 't1' },
    summary: '发送邮件',
    estimated_quota: null,
    status: 'pending',
  }
}

async function makeApp(store: SessionStore) {
  const app = Fastify()
  registerActionRoutes(app, store)
  await app.ready()
  return app
}

const confirmReq = (approved: boolean) => ({
  method: 'POST' as const,
  url: '/api/actions/a1/confirm',
  headers: { authorization: `Bearer ${token}` },
  payload: { approved },
})

beforeEach(() => {
  mockTool.execute.mockReset()
  mockTool.execute.mockResolvedValue({ forModel: { sent: 1 } })
})

describe('POST /api/actions/:id/confirm', () => {
  it('并发双击批准：只有一个请求执行工具，另一个 409', async () => {
    const actions = new Map([['a1', pendingAction()]])
    const store = makeStore(actions)
    const app = await makeApp(store)
    // 让第一个请求在工具执行中停留，第二个请求此时到达 claim
    mockTool.execute.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ forModel: { sent: 1 } }), 30)),
    )

    const [r1, r2] = await Promise.all([app.inject(confirmReq(true)), app.inject(confirmReq(true))])

    const codes = [r1.statusCode, r2.statusCode].sort()
    expect(codes).toEqual([200, 409])
    expect(mockTool.execute).toHaveBeenCalledTimes(1)
    expect(actions.get('a1')!.status).toBe('executed')
  })

  it('批准后执行成功：落库 executed 并写入历史', async () => {
    const actions = new Map([['a1', pendingAction()]])
    const store = makeStore(actions)
    const app = await makeApp(store)

    const res = await app.inject(confirmReq(true))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('executed')
    expect(actions.get('a1')!.status).toBe('executed')
    expect(store.appendMessage).toHaveBeenCalled()
  })

  it('拒绝：不执行工具，落库 rejected', async () => {
    const actions = new Map([['a1', pendingAction()]])
    const store = makeStore(actions)
    const app = await makeApp(store)

    const res = await app.inject(confirmReq(false))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('rejected')
    expect(mockTool.execute).not.toHaveBeenCalled()
    expect(actions.get('a1')!.status).toBe('rejected')
  })

  it('已处理过的确认项再次批准：409 且不再执行', async () => {
    const record = { ...pendingAction(), status: 'executed' }
    const actions = new Map([['a1', record]])
    const store = makeStore(actions)
    const app = await makeApp(store)

    const res = await app.inject(confirmReq(true))
    expect(res.statusCode).toBe(409)
    expect(mockTool.execute).not.toHaveBeenCalled()
  })

  it('工具执行失败：500 且落库 failed，不卡在 approved', async () => {
    const actions = new Map([['a1', pendingAction()]])
    const store = makeStore(actions)
    const app = await makeApp(store)
    mockTool.execute.mockRejectedValue(new Error('backend 挂了'))

    const res = await app.inject(confirmReq(true))
    expect(res.statusCode).toBe(500)
    expect(actions.get('a1')!.status).toBe('failed')
  })

  it('伪造用户拿不到别人的确认项：404', async () => {
    const record = { ...pendingAction(), user_id: 'other-user' }
    const actions = new Map([['a1', record]])
    const store = makeStore(actions)
    const app = await makeApp(store)

    const res = await app.inject(confirmReq(true))
    expect(res.statusCode).toBe(404)
    expect(actions.get('a1')!.status).toBe('pending')
  })
})
