import { jwtVerify, decodeJwt } from 'jose'
import { config } from './config.js'

export interface AuthUser {
  userId: string
  email?: string
  jwt: string
}

/**
 * 校验 Supabase JWT（与 backend src/middlewares/auth.ts 同款：HS256 对称密钥本地验签）。
 * 未配置 SUPABASE_JWT_SECRET 时仅解码不验签（仅限本地开发；Gateway 自己的会话/记忆数据
 * 不经过 backend 验签，生产环境缺失该配置会在启动时直接报错，见 index.ts）。
 */
export async function authenticate(authorizationHeader: string | undefined): Promise<AuthUser> {
  if (!authorizationHeader) throw new AuthError('缺少 Authorization header')
  const [type, token] = authorizationHeader.split(' ')
  if (type !== 'Bearer' || !token) throw new AuthError('Authorization 格式应为 Bearer <token>')

  let payload: Record<string, unknown>
  if (config.supabaseJwtSecret) {
    try {
      const secret = new TextEncoder().encode(config.supabaseJwtSecret)
      const verified = await jwtVerify(token, secret)
      payload = verified.payload as Record<string, unknown>
    } catch {
      throw new AuthError('JWT 校验失败')
    }
  } else {
    try {
      payload = decodeJwt(token) as Record<string, unknown>
    } catch {
      throw new AuthError('JWT 解码失败')
    }
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : ''
  if (!userId) throw new AuthError('JWT 缺少 sub')
  const exp = typeof payload.exp === 'number' ? payload.exp : 0
  if (exp && exp * 1000 < Date.now()) throw new AuthError('JWT 已过期')

  return {
    userId,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    jwt: token,
  }
}

export class AuthError extends Error {}
