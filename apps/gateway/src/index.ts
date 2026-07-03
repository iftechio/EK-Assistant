import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { SessionStore } from './session/store.js'
import { registerChatRoutes } from './routes/chat.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerExportRoutes } from './routes/export.js'

async function main() {
  const app = Fastify({ logger: true })
  await app.register(cors, { origin: true, credentials: true })

  const store = new SessionStore()
  await store.ensureSchema()

  app.get('/healthz', async () => ({ ok: true }))
  registerChatRoutes(app, store)
  registerActionRoutes(app, store)
  registerSessionRoutes(app, store)
  registerExportRoutes(app)

  const shutdown = async () => {
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
