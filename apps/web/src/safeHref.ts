/**
 * 链接协议白名单：只放行 http/https，拦截 javascript:/data: 等可执行协议。
 * 模型输出与后端/抓取数据里的 URL 都必须经过这里再进 <a href>。
 */
export function safeHref(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url
  } catch {
    // 非绝对 URL（相对路径等）不属于业务里的合法外链，一律拦下
  }
  return undefined
}
