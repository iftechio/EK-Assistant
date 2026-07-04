import { getAccessToken } from './supabase'
import type { AgentEvent, PendingActionView, SessionSummary } from './types'

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3002'

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  if (!token) throw new Error('未登录')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/** 发送消息并消费 SSE 事件流 */
export async function streamChat(
  message: string,
  sessionId: string | null,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ message, sessionId: sessionId ?? undefined }),
    signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text()
    throw new Error(`请求失败 (${res.status}): ${text.slice(0, 200)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const handleFrame = (part: string) => {
    const line = part.split('\n').find((l) => l.startsWith('data: '))
    if (!line) return
    try {
      onEvent(JSON.parse(line.slice(6)) as AgentEvent)
    } catch {
      // 忽略不完整帧
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) handleFrame(part)
  }
  // flush 解码器残留并处理最后一个不以空行结尾的事件（如 done/error），否则会被静默丢弃
  buffer += decoder.decode()
  for (const part of buffer.split('\n\n')) handleFrame(part)
}

export async function confirmAction(
  actionId: string,
  approved: boolean,
): Promise<{ status: string; result?: unknown; error?: string; quotaSpent?: number }> {
  const res = await fetch(`${GATEWAY_URL}/api/actions/${actionId}/confirm`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ approved }),
  })
  // 网关 502/超时返回 HTML 时 res.json() 会抛无意义的解析错误
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`确认请求失败 (${res.status})，无法确定操作是否已执行，请刷新页面查看最新状态`)
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${GATEWAY_URL}/api/sessions`, { headers: await authHeaders() })
  if (!res.ok) return []
  return res.json()
}

export async function getSessionMessages(sessionId: string): Promise<{
  session: SessionSummary & { quotaSpent: number }
  messages: { id: string; role: string; content: any; display: any[] | null; createdAt: string }[]
  pendingActions?: PendingActionView[]
}> {
  const res = await fetch(`${GATEWAY_URL}/api/sessions/${sessionId}/messages`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error('加载会话失败')
  return res.json()
}

export async function downloadCommentsExcel(body: { taskId: string }): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/api/comments-export`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('导出失败')
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `comments-${Date.now()}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}
