export interface ToolDisplay {
  kind: string
  data: any
}

export interface PendingActionView {
  id: string
  toolName: string
  summary: string
  input: unknown
  estimatedQuota?: number
}

export type AgentEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-start'; toolName: string; input: unknown; estimatedQuota?: number }
  | { type: 'tool-result'; toolName: string; display?: ToolDisplay }
  | { type: 'confirmation-required'; action: PendingActionView }
  | { type: 'cost'; spent: number; cap: number }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId: string }

export interface ToolActivity {
  toolName: string
  status: 'running' | 'done'
  estimatedQuota?: number
  display?: ToolDisplay
}

export interface Confirmation {
  action: PendingActionView
  status: 'pending' | 'executed' | 'rejected' | 'failed'
  result?: unknown
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  activities: ToolActivity[]
  confirmations: Confirmation[]
  error?: string
}

export interface SessionSummary {
  id: string
  title: string | null
  quotaSpent: number
  updatedAt: string
}
