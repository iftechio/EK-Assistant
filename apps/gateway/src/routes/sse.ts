import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import type { AgentEvent } from '../tools/types.js'

/** 接管 reply 为 SSE 流；返回 emit/close */
export function openSse(request: FastifyRequest, reply: FastifyReply) {
  const rawOrigin = request.headers.origin
  // 与 CORS 插件同一套白名单：配置了 ASSISTANT_ALLOWED_ORIGINS 时只反射白名单内的 origin
  const origin =
    rawOrigin && (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(rawOrigin))
      ? rawOrigin
      : undefined
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

  // 客户端异常断开时 socket 是 destroyed 而 writableEnded 仍为 false，
  // 只查 writableEnded 会继续往已销毁的流上写
  const gone = () => reply.raw.writableEnded || reply.raw.destroyed

  const heartbeat = setInterval(() => {
    if (!gone()) reply.raw.write(': ping\n\n')
  }, 15000)

  return {
    emit(event: AgentEvent) {
      if (!gone()) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    },
    close() {
      clearInterval(heartbeat)
      if (!gone()) reply.raw.end()
    },
  }
}
