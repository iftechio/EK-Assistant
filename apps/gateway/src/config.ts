import 'dotenv/config'

function num(name: string, fallback: number): number {
  const v = process.env[name]
  if (!v) return fallback
  const n = Number(v)
  if (Number.isNaN(n)) {
    // NaN 参与比较恒为 false，会让配额上限等阈值静默失效，必须回退默认值
    console.warn(`环境变量 ${name}="${v}" 不是合法数字，已回退默认值 ${fallback}`)
    return fallback
  }
  return n
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const config = {
  port: num('ASSISTANT_PORT', 3002),
  host: process.env.ASSISTANT_HOST ?? '0.0.0.0',
  /** talent-marking-backend 地址，JWT 原样转发 */
  backendBaseUrl: process.env.BACKEND_BASE_URL ?? 'http://localhost:3000',
  /** EK-Assistant 自己的会话库（Postgres） */
  databaseUrl: process.env.ASSISTANT_DATABASE_URL ?? '',
  /** Supabase JWT 校验（HS256）。不配置时仅解码不验签（开发模式） */
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  /** 模型池与failover顺序，如 "gemini:gemini-2.5-flash,deepseek:deepseek-chat" */
  modelFailoverOrder:
    process.env.ASSISTANT_MODEL_FAILOVER_ORDER ?? 'gemini:gemini-2.5-flash',
  googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  /** 与 backend infras/ai 同款的 OpenAI 兼容通道（可直接复用 backend 的 key） */
  aihubmixApiKey: process.env.AIHUBMIX_API_KEY ?? '',
  aihubmixBaseUrl: process.env.AIHUBMIX_BASE_URL ?? 'https://aihubmix.com/v1',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  /** 单会话配额消耗上限（backend quota 口径），超限需用户确认 */
  sessionQuotaCap: num('ASSISTANT_SESSION_QUOTA_CAP', 200),
  /** 单轮对话最多工具步数 */
  maxSteps: num('ASSISTANT_MAX_STEPS', 12),
  /** 上下文 token 预算，超过触发压缩 */
  contextTokenBudget: num('ASSISTANT_CONTEXT_TOKEN_BUDGET', 24000),
  /** create→poll 轮询参数 */
  taskPollIntervalMs: num('ASSISTANT_TASK_POLL_INTERVAL_MS', 3000),
  taskPollTimeoutMs: num('ASSISTANT_TASK_POLL_TIMEOUT_MS', 300000),
  /** backend 单次 HTTP 请求超时（防止 backend 挂起拖死整轮对话） */
  backendRequestTimeoutMs: num('ASSISTANT_BACKEND_REQUEST_TIMEOUT_MS', 60000),
  /** CORS 允许的前端 origin（逗号分隔）；不配置时放行所有 origin（仅限本地开发） */
  allowedOrigins: list('ASSISTANT_ALLOWED_ORIGINS'),
}

export type Config = typeof config
