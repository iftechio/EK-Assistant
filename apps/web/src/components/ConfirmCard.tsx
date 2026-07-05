import { useState } from 'react'
import { confirmAction } from '../api'
import type { Confirmation } from '../types'

/**
 * 高风险操作确认卡片（"两者结合"里的强确定性环节）：
 * 发送邮件等操作必须在这里显式批准，Agent 无法绕过。
 * 拒绝时可填理由：理由会写入会话历史回喂模型，下轮按理由调整方案。
 */
export default function ConfirmCard({ confirmation }: { confirmation: Confirmation }) {
  const [status, setStatus] = useState(confirmation.status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const { action } = confirmation

  const decide = async (approved: boolean) => {
    setBusy(true)
    setError('')
    try {
      const res = await confirmAction(action.id, approved, approved ? undefined : reason.trim())
      if (res.status === 'executed') setStatus('executed')
      else if (res.status === 'rejected') setStatus('rejected')
      else {
        setStatus('failed')
        setError(res.error ?? '执行失败')
      }
    } catch (e) {
      setStatus('failed')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`confirm-card ${status}`}>
      <div className="confirm-header">
        {status === 'pending' && '⚠️ 需要你的确认'}
        {status === 'executed' && '✅ 已批准并执行'}
        {status === 'rejected' && '🚫 已拒绝'}
        {status === 'failed' && '❌ 执行失败'}
      </div>
      <div className="confirm-summary">{action.summary}</div>
      {action.estimatedQuota != null && (
        <div className="muted">预估消耗配额：{action.estimatedQuota}</div>
      )}
      <details>
        <summary>操作详情</summary>
        <pre className="prewrap">{JSON.stringify(action.input, null, 2).slice(0, 3000)}</pre>
      </details>
      {error && <div className="error-text">{error}</div>}
      {status === 'pending' && !rejecting && (
        <div className="confirm-actions">
          <button disabled={busy} onClick={() => decide(true)}>
            {busy ? '处理中…' : '批准执行'}
          </button>
          <button className="ghost" disabled={busy} onClick={() => setRejecting(true)}>
            拒绝
          </button>
        </div>
      )}
      {status === 'pending' && rejecting && (
        <div className="confirm-reject">
          <textarea
            className="confirm-reason"
            value={reason}
            placeholder="拒绝理由（可选）：会告知助手，便于它调整方案"
            maxLength={500}
            rows={2}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="confirm-actions">
            <button className="ghost" disabled={busy} onClick={() => decide(false)}>
              {busy ? '处理中…' : '确认拒绝'}
            </button>
            <button className="ghost" disabled={busy} onClick={() => setRejecting(false)}>
              返回
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
