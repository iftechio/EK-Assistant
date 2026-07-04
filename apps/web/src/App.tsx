import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { signInWithEkWebToken, supabase } from './supabase'
import Workspace from './components/Workspace'

const EK_WEB_URL = import.meta.env.VITE_EK_WEB_URL || 'http://localhost:3001'
const REDIRECT_THROTTLE_KEY = 'ek.assistant.lastAuthRedirect'
const REDIRECT_THROTTLE_MS = 30_000

/** 跳到 easykol-web 的接力页，由其签发一次性 token 带回本应用 */
function redirectToEkWebAuth() {
  const returnTo = encodeURIComponent(window.location.origin + window.location.pathname)
  window.location.replace(`${EK_WEB_URL}/assistant-auth?returnTo=${returnTo}`)
}

/** 自动跳转带节流：30 秒内只跳一次，异常时避免两边互踢打环 */
function autoRedirectToEkWebAuth(): boolean {
  const last = Number(sessionStorage.getItem(REDIRECT_THROTTLE_KEY) || 0)
  if (Date.now() - last < REDIRECT_THROTTLE_MS) return false
  sessionStorage.setItem(REDIRECT_THROTTLE_KEY, String(Date.now()))
  redirectToEkWebAuth()
  return true
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [phase, setPhase] = useState<'loading' | 'redirecting' | 'error'>('loading')
  const [error, setError] = useState('')
  // StrictMode 下 effect 会执行两次；并发跑两个 bootstrap 会在 verifyOtp 在途时误判无会话而跳走
  const bootstrapped = useRef(false)
  const hadSession = useRef(false)
  // 主动登出时跳 easykol-web 首页而不是登录接力页，否则接力页会瞬间重新登录，登出变成无操作
  const loggingOut = useRef(false)

  useEffect(() => {
    const bootstrap = async () => {
      // 1) 从 easykol-web 接力回跳：URL hash 携带一次性 token，换取本应用独立会话
      const tokenHash = new URLSearchParams(window.location.hash.slice(1)).get('token_hash')
      if (tokenHash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        try {
          const s = await signInWithEkWebToken(tokenHash)
          if (s) {
            hadSession.current = true
            setSession(s)
            return
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
          setPhase('error')
          return
        }
      }
      // 2) 本地已有会话
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        hadSession.current = true
        setSession(data.session)
        return
      }
      // 3) 无会话：跳 easykol-web 接力登录（未登录会先走其登录流程再回来）
      if (autoRedirectToEkWebAuth()) {
        setPhase('redirecting')
      } else {
        setError('自动跳转过于频繁，已暂停，请手动重试')
        setPhase('error')
      }
    }

    if (!bootstrapped.current) {
      bootstrapped.current = true
      bootstrap()
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (s) {
        hadSession.current = true
        setSession(s)
      } else if (event === 'SIGNED_OUT' && hadSession.current) {
        if (loggingOut.current) {
          window.location.replace(EK_WEB_URL)
          return
        }
        // 只在确实登录过之后的登出才重新接力，避免初始化期间的清理事件触发跳转
        autoRedirectToEkWebAuth()
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session)
    return (
      <Workspace
        userEmail={session.user.email ?? ''}
        onLogout={async () => {
          loggingOut.current = true
          await supabase.auth.signOut()
        }}
      />
    )
  if (phase === 'error') {
    return (
      <div className="center-page">
        <div>
          <p>登录接力失败：{error}</p>
          <button
            onClick={() => {
              sessionStorage.removeItem(REDIRECT_THROTTLE_KEY)
              redirectToEkWebAuth()
            }}
          >
            重新登录
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="center-page">
      {phase === 'redirecting' ? '正在跳转 EasyKOL 登录…' : '加载中…'}
    </div>
  )
}
