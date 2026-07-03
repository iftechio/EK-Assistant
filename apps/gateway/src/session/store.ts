import pg from 'pg'
import { randomUUID } from 'node:crypto'
import type { ModelMessage } from 'ai'
import { config } from '../config.js'
import type { PendingActionView, ToolDisplay } from '../tools/types.js'

const { Pool } = pg

export interface SessionRow {
  id: string
  user_id: string
  title: string | null
  quota_spent: number
  context_summary: string | null
  created_at: Date
  updated_at: Date
}

export interface MessageRow {
  id: string
  session_id: string
  role: string
  content: unknown
  display: ToolDisplay[] | null
  compacted: boolean
  created_at: Date
}

export interface PendingActionRow {
  id: string
  session_id: string
  user_id: string
  tool_name: string
  input: unknown
  summary: string
  estimated_quota: number | null
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'
  result: unknown
  created_at: Date
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assistant_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  quota_spent INTEGER NOT NULL DEFAULT 0,
  context_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_sessions_user ON assistant_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content JSONB NOT NULL,
  display JSONB,
  compacted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_session ON assistant_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS assistant_pending_actions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input JSONB NOT NULL,
  summary TEXT NOT NULL,
  estimated_quota INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS assistant_activity_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_activity_user ON assistant_activity_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_memory (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
`

export class SessionStore {
  private pool: pg.Pool

  constructor(databaseUrl: string = config.databaseUrl) {
    if (!databaseUrl) {
      throw new Error('缺少 ASSISTANT_DATABASE_URL（EK-Assistant 会话库连接串）')
    }
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 })
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(SCHEMA)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  // ---- sessions ----

  async createSession(userId: string, title?: string): Promise<SessionRow> {
    const id = randomUUID()
    const { rows } = await this.pool.query<SessionRow>(
      `INSERT INTO assistant_sessions (id, user_id, title) VALUES ($1, $2, $3) RETURNING *`,
      [id, userId, title ?? null],
    )
    return rows[0]
  }

  async getSession(id: string, userId: string): Promise<SessionRow | null> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM assistant_sessions WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )
    return rows[0] ?? null
  }

  async listSessions(userId: string): Promise<SessionRow[]> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM assistant_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
      [userId],
    )
    return rows
  }

  async touchSession(id: string, patch: { title?: string }): Promise<void> {
    await this.pool.query(
      `UPDATE assistant_sessions
       SET title = COALESCE($2, title), updated_at = now()
       WHERE id = $1`,
      [id, patch.title ?? null],
    )
  }

  // ---- quota (Cost Meter 持久化) ----

  async addQuotaSpent(sessionId: string, amount: number): Promise<number> {
    const { rows } = await this.pool.query<{ quota_spent: number }>(
      `UPDATE assistant_sessions SET quota_spent = quota_spent + $2, updated_at = now()
       WHERE id = $1 RETURNING quota_spent`,
      [sessionId, amount],
    )
    return rows[0]?.quota_spent ?? 0
  }

  // ---- messages ----

  async appendMessage(
    sessionId: string,
    message: ModelMessage,
    display?: ToolDisplay[],
  ): Promise<string> {
    const id = randomUUID()
    await this.pool.query(
      `INSERT INTO assistant_messages (id, session_id, role, content, display)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, sessionId, message.role, JSON.stringify(message.content), display ? JSON.stringify(display) : null],
    )
    return id
  }

  async listMessages(sessionId: string, includeCompacted = false): Promise<MessageRow[]> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT * FROM assistant_messages WHERE session_id = $1
       ${includeCompacted ? '' : 'AND compacted = FALSE'}
       ORDER BY created_at ASC, id ASC`,
      [sessionId],
    )
    return rows
  }

  /** 压缩：把指定消息标记为已压缩，并把摘要写到会话上 */
  async compactMessages(sessionId: string, messageIds: string[], summary: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE assistant_messages SET compacted = TRUE WHERE session_id = $1 AND id = ANY($2)`,
        [sessionId, messageIds],
      )
      await client.query(
        `UPDATE assistant_sessions SET context_summary = $2, updated_at = now() WHERE id = $1`,
        [sessionId, summary],
      )
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  // ---- pending actions（高风险工具确认） ----

  async createPendingAction(args: {
    sessionId: string
    userId: string
    toolName: string
    input: unknown
    summary: string
    estimatedQuota?: number
  }): Promise<PendingActionView> {
    const id = randomUUID()
    await this.pool.query(
      `INSERT INTO assistant_pending_actions (id, session_id, user_id, tool_name, input, summary, estimated_quota)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, args.sessionId, args.userId, args.toolName, JSON.stringify(args.input), args.summary, args.estimatedQuota ?? null],
    )
    return {
      id,
      toolName: args.toolName,
      summary: args.summary,
      input: args.input,
      estimatedQuota: args.estimatedQuota,
    }
  }

  async getPendingAction(id: string, userId: string): Promise<PendingActionRow | null> {
    const { rows } = await this.pool.query<PendingActionRow>(
      `SELECT * FROM assistant_pending_actions WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )
    return rows[0] ?? null
  }

  async resolvePendingAction(
    id: string,
    status: PendingActionRow['status'],
    result?: unknown,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE assistant_pending_actions SET status = $2, result = $3, resolved_at = now() WHERE id = $1`,
      [id, status, result === undefined ? null : JSON.stringify(result)],
    )
  }

  // ---- activity log ----

  async logActivity(args: {
    sessionId: string
    userId: string
    toolName: string
    summary: string
    detail?: unknown
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO assistant_activity_log (id, session_id, user_id, tool_name, summary, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), args.sessionId, args.userId, args.toolName, args.summary, args.detail ? JSON.stringify(args.detail) : null],
    )
  }

  async listActivity(userId: string, sessionId?: string): Promise<unknown[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM assistant_activity_log WHERE user_id = $1
       ${sessionId ? 'AND session_id = $2' : ''}
       ORDER BY created_at DESC LIMIT 100`,
      sessionId ? [userId, sessionId] : [userId],
    )
    return rows
  }

  // ---- 轻量记忆（按 user 存偏好，如常用平台/项目） ----

  async getMemory(userId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM assistant_memory WHERE user_id = $1`,
      [userId],
    )
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  async setMemory(userId: string, key: string, value: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO assistant_memory (user_id, key, value, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [userId, key, JSON.stringify(value)],
    )
  }
}
