import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { SessionStore } from './session/store.js'
import { registerChatRoutes } from './routes/chat.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerExportRoutes } from './routes/export.js'
import { registerProjectRoutes } from './routes/projects.js'

async function main() {
  const app = Fastify({ logger: true })

  if (!config.supabaseJwtSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('缺少 SUPABASE_JWT_SECRET：生产环境禁止在 JWT 不验签的状态下运行')
    }
    app.log.warn('未配置 SUPABASE_JWT_SECRET，JWT 仅解码不验签——仅限本地开发使用')
  }

  await app.register(cors, {
    origin: config.allowedOrigins.length ? config.allowedOrigins : true,
    credentials: true,
  })

  const store = new SessionStore()
  await store.ensureSchema()

  app.get('/healthz', async () => ({ ok: true }))
  registerChatRoutes(app, store)
  registerActionRoutes(app, store)
  registerSessionRoutes(app, store)
  registerExportRoutes(app)
  registerProjectRoutes(app)

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return // 连续两次信号会二次 close，pool.end 重复调用报错
    shuttingDown = true
    // SSE 长连接不会自然结束，app.close() 可能无限等待，超时强退
    setTimeout(() => process.exit(1), 10000).unref()
    await app.close()
    await store.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await app.listen({ port: config.port, host: config.host })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
