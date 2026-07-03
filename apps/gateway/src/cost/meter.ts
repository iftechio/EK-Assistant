import { config } from '../config.js'
import type { SessionStore } from '../session/store.js'

/**
 * Cost Meter：跟踪本会话工具调用消耗的 backend 配额。
 * "只读"不等于"免费" —— 搜索/相似发现/评论拉取都按 quota 计费。
 * 超过单会话上限的消耗需要用户确认后才执行。
 */
export class CostMeter {
  constructor(
    private readonly store: SessionStore,
    private readonly sessionId: string,
    private spent: number,
    readonly cap: number = config.sessionQuotaCap,
  ) {}

  get spentSoFar(): number {
    return this.spent
  }

  wouldExceed(estimate: number): boolean {
    return this.spent + estimate > this.cap
  }

  async add(amount: number): Promise<number> {
    this.spent = await this.store.addQuotaSpent(this.sessionId, amount)
    return this.spent
  }
}
