import { config } from '../config.js'

export class BackendError extends Error {
  constructor(
    public status: number,
    public path: string,
    message: string,
  ) {
    super(`backend ${status} ${path}: ${message}`)
  }
}

/** backend 统一响应包裹：{ statusCode, error, message, data } */
interface Envelope<T> {
  statusCode: number
  error: string | null
  message: string
  data: T
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

/**
 * talent-marking-backend /api/* 的轻量客户端。
 * 用户的 Supabase JWT 原样转发，行为、配额、审计与用户手动操作一致。
 */
export class BackendClient {
  constructor(
    private readonly jwt: string,
    private readonly baseUrl: string = config.backendBaseUrl,
  ) {}

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.jwt}`,
          'Content-Type': 'application/json',
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(config.backendRequestTimeoutMs),
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new BackendError(0, path, `请求超时（${config.backendRequestTimeoutMs}ms）`)
      }
      throw err
    }
    const text = await res.text()
    if (!res.ok) {
      throw new BackendError(res.status, path, truncate(text, 500))
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new BackendError(res.status, path, `非 JSON 响应: ${truncate(text, 200)}`)
    }
    const envelope = parsed as Envelope<T>
    // backend 统一包裹格式；个别端点直接返回数据时兜底
    if (envelope && typeof envelope === 'object' && 'data' in envelope) {
      return envelope.data
    }
    return parsed as T
  }

  get<T = unknown>(path: string, query?: RequestOptions['query']) {
    return this.request<T>('GET', path, { query })
  }

  post<T = unknown>(path: string, body?: unknown, query?: RequestOptions['query']) {
    return this.request<T>('POST', path, { body, query })
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body })
  }

  /**
   * backend 统一的 create→poll 异步任务原语。
   * @param create   发起任务，返回可供轮询的标识
   * @param poll     用 create 的返回值轮询一次
   * @param isDone   判断轮询结果是否终态
   */
  async callBackendTask<C, P>(args: {
    create: (client: BackendClient) => Promise<C>
    poll: (client: BackendClient, created: C) => Promise<P>
    isDone: (polled: P) => boolean
    intervalMs?: number
    timeoutMs?: number
    onProgress?: (polled: P) => void
  }): Promise<P> {
    const interval = args.intervalMs ?? config.taskPollIntervalMs
    const timeout = args.timeoutMs ?? config.taskPollTimeoutMs
    const created = await args.create(this)
    const deadline = Date.now() + timeout
    for (;;) {
      const polled = await args.poll(this, created)
      if (args.isDone(polled)) return polled
      args.onProgress?.(polled)
      if (Date.now() > deadline) {
        throw new Error(`backend 任务轮询超时（${timeout}ms）`)
      }
      await sleep(interval)
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
