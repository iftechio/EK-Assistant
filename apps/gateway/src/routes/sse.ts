import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AgentEvent } from '../tools/types.js'

/** 接管 reply 为 SSE 流；返回 emit/close */
export function openSse(request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
        }
      : {}),
  })
  reply.raw.flushHeaders?.()

  const heartbeat = setInterval(() => {
    if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n')
  }, 15000)

  return {
    emit(event: AgentEvent) {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    },
    close() {
      clearInterval(heartbeat)
      if (!reply.raw.writableEnded) reply.raw.end()
    },
  }
}
