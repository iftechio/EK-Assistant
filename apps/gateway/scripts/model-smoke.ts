import { generateText } from 'ai'
import { getModelPool } from '../src/ai/models.js'

for (const pooled of getModelPool()) {
  try {
    const { text } = await generateText({
      model: pooled.model,
      prompt: '只回复两个字：正常',
    })
    console.log(`[OK] ${pooled.code} ->`, text.trim().slice(0, 20))
  } catch (e) {
    console.log(`[FAIL] ${pooled.code} ->`, e instanceof Error ? e.message.slice(0, 200) : e)
  }
}
