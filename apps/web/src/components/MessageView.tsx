import type { ChatMessage } from '../types'
import ToolCard from './ToolCard'
import ConfirmCard from './ConfirmCard'

export default function MessageView({ message }: { message: ChatMessage }) {
  return (
    <div className={`message ${message.role}`}>
      <div className="avatar">{message.role === 'user' ? '我' : 'EK'}</div>
      <div className="bubble-area">
        {message.activities.map((a, i) => (
          <div key={i} className="tool-activity">
            <span className={`tool-chip ${a.status}`}>
              {a.status === 'running' ? '⏳' : '✅'} {a.toolName}
              {a.estimatedQuota ? `（预估消耗 ${a.estimatedQuota} 配额）` : ''}
            </span>
            {a.display && <ToolCard display={a.display} />}
          </div>
        ))}
        {message.confirmations.map((c, i) => (
          <ConfirmCard key={i} confirmation={c} />
        ))}
        {message.text && <div className="bubble">{message.text}</div>}
        {message.error && <div className="error-text">⚠️ {message.error}</div>}
      </div>
    </div>
  )
}
