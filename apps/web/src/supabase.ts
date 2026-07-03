import { createClient } from '@supabase/supabase-js'

// 与 easykol-web 同一 Supabase 项目（anon key 为前端公开密钥）
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://avznliiawayrwjqqxzcw.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2em5saWlhd2F5cndqcXF4emN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTY0NzM4OTYsImV4cCI6MjAzMjA0OTg5Nn0.rHiIBFzk00peS4LKjv85UTevB5EKcNUyXOQJPgH9-0c'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
})

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/** 用 easykol-web 接力签发的一次性 token（/api/auth/ext-session）换取本应用的独立会话 */
export async function signInWithEkWebToken(tokenHash: string) {
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
  if (error) throw new Error(error.message)
  return data.session
}
