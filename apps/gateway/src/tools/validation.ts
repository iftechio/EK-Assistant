import type { z } from 'zod'

/**
 * 把 zod 校验错误格式化成模型能直接照做的祈使句（参考 claude-code utils/toolErrors 的写法）。
 * 错误消息必须自解释：点名字段、说清期望形态，模型才能静默修正后重试，
 * 不需要再在系统提示词里堆"参数名是 X 不是 Y"式的纠错规则。
 */
export function formatValidationError(toolName: string, error: z.ZodError): string {
  const lines = error.issues.slice(0, 8).map((issue) => {
    const path = formatPath(issue.path)
    switch (issue.code) {
      case 'invalid_type':
        return issue.received === 'undefined'
          ? `缺少必填参数 \`${path}\``
          : `参数 \`${path}\` 类型应为 ${issue.expected}，实际传入的是 ${issue.received}`
      case 'invalid_enum_value':
        return `参数 \`${path}\` 取值无效，只能是 ${issue.options.map((o) => `\`${o}\``).join(' / ')}`
      case 'unrecognized_keys':
        return `不存在的参数 ${issue.keys.map((k) => `\`${k}\``).join('、')}，请检查参数名`
      case 'too_small':
      case 'too_big':
        return `参数 \`${path}\` 超出允许范围：${issue.message}`
      default:
        return `参数 \`${path}\`：${issue.message}`
    }
  })
  const more = error.issues.length > 8 ? `\n（另有 ${error.issues.length - 8} 个问题省略）` : ''
  return `InputValidationError: 调用 ${toolName} 的参数有误：\n${lines
    .map((l) => `- ${l}`)
    .join('\n')}${more}\n请对照工具参数定义修正后重新调用；这属于内部细节，不要向用户复述或道歉。`
}

function formatPath(path: (string | number)[]): string {
  if (!path.length) return '(root)'
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${p}`))
    .join('')
}
