import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { config } from '../config.js'

/**
 * 模型池：沿用 backend infras/ai 的思路 —— 统一编码 + 环境变量控制 failover 顺序。
 * 编码格式 "provider:modelId"，如 gemini:gemini-2.5-flash / deepseek:deepseek-chat
 */
export interface PooledModel {
  code: string
  model: LanguageModel
}

function resolveModel(code: string): PooledModel {
  const idx = code.indexOf(':')
  const provider = idx === -1 ? code : code.slice(0, idx)
  const modelId = idx === -1 ? '' : code.slice(idx + 1)
  switch (provider) {
    case 'gemini': {
      const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey })
      return { code, model: google(modelId || 'gemini-2.5-flash') }
    }
    case 'deepseek': {
      const deepseek = createOpenAICompatible({
        name: 'deepseek',
        baseURL: config.deepseekBaseUrl,
        apiKey: config.deepseekApiKey,
      })
      return { code, model: deepseek(modelId || 'deepseek-chat') }
    }
    case 'aihubmix': {
      const aihubmix = createOpenAICompatible({
        name: 'aihubmix',
        baseURL: config.aihubmixBaseUrl,
        apiKey: config.aihubmixApiKey,
      })
      return { code, model: aihubmix(modelId || 'gemini-2.5-flash') }
    }
    case 'openrouter': {
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        baseURL: config.openrouterBaseUrl,
        apiKey: config.openrouterApiKey,
      })
      return { code, model: openrouter(modelId || 'google/gemini-2.5-flash') }
    }
    default:
      throw new Error(`未知模型 provider: ${provider}（支持 gemini/deepseek/aihubmix/openrouter）`)
  }
}

export function getModelPool(): PooledModel[] {
  return config.modelFailoverOrder
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(resolveModel)
}
