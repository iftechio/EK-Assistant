import type { z } from 'zod'
import type { BackendClient } from '../backend/client.js'
import type { CostMeter } from '../cost/meter.js'

/**
 * 权限分级（风险+成本两个维度）：
 * - auto:         只读且不消耗配额 —— 全自动执行
 * - quota:        只读但消耗配额 —— 告知预估消耗，单会话超限需确认
 * - write_logged: 可逆写操作 —— 自动执行 + 活动日志
 * - confirm:      不可逆高风险（发邮件）—— 必须用户在 UI 确认后执行
 */
export type PermissionTier = 'auto' | 'quota' | 'write_logged' | 'confirm'

/** 推给前端的 SSE 事件 */
export type AgentEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-start'; toolName: string; input: unknown; estimatedQuota?: number }
  | { type: 'tool-result'; toolName: string; display?: ToolDisplay }
  | { type: 'confirmation-required'; action: PendingActionView }
  | { type: 'cost'; spent: number; cap: number; accountRemaining?: number }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId: string }

/** 工具结果里给 UI 渲染卡片用的完整数据（不进模型上下文） */
export interface ToolDisplay {
  kind: string
  data: unknown
}

export interface PendingActionView {
  id: string
  toolName: string
  summary: string
  input: unknown
  estimatedQuota?: number
}

export interface ToolContext {
  userId: string
  jwt: string
  sessionId: string
  backend: BackendClient
  costMeter: CostMeter
  emit: (event: AgentEvent) => void
  logActivity: (summary: string, detail?: unknown) => Promise<void>
  /** 轻量记忆：按 (user, key) 持久化的用户偏好（remember_preference 工具用） */
  saveMemory: (key: string, value: unknown) => Promise<void>
  deleteMemory: (key: string) => Promise<void>
}

export interface ToolExecuteResult {
  /** 喂回模型的紧凑结果（按工具语义截断，避免撑爆上下文） */
  forModel: unknown
  /** 给前端卡片的完整数据 */
  display?: ToolDisplay
}

export interface AssistantTool<In = any> {
  name: string
  description: string
  inputSchema: z.ZodType<In>
  permission: PermissionTier
  /** permission === 'quota' 时必须提供：预估本次调用消耗的 backend 配额 */
  estimateQuota?: (input: In) => number
  /** 生成确认卡片/活动日志里的一句话摘要 */
  summarize: (input: In) => string
  execute: (input: In, ctx: ToolContext) => Promise<ToolExecuteResult>
}

export function defineTool<In>(tool: AssistantTool<In>): AssistantTool<In> {
  return tool
}
