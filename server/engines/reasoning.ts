/**
 * 本地推理引擎（Ollama）：音效配方 / 节拍编曲 / 智能打标
 * （自 server.ts 原样迁移；地址/模型名改为经 config 懒读取）
 */
import { getConfig } from '../config';
import { hasGeminiApiKey } from './geminiClient';

export const LOCAL_REASONING_ID = 'qwen-local-reasoning';

export function ollamaModelName(): string {
  return getConfig().ollamaModel;
}

export async function ollamaIsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getConfig().ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 本地 LLM 结构化生成：Ollama format=JSON Schema 约束输出，返回解析后的对象 */
export async function ollamaGenerateJson(prompt: string, schema: Record<string, any>, model = ollamaModelName()): Promise<any> {
  const res = await fetch(`${getConfig().ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false, // qwen3.5 为思考模型：关闭思考链，避免 token 预算被烧光导致正文为空
      format: schema,
      options: { temperature: 0.7, num_predict: 2500 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json() as any;
  const text = String(data?.message?.content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')  // 思考模型保险剥层
    .trim();
  const jsonStr = text.startsWith('{') ? text : (text.match(/\{[\s\S]*\}/)?.[0] ?? '');
  if (!jsonStr) {
    console.warn('Ollama 原始返回: done_reason=%s eval_count=%s thinking=%j content前300=%j',
      data?.done_reason, data?.eval_count, String(data?.message?.thinking ?? '').slice(0, 80), text.slice(0, 300));
    throw new Error('Ollama 未返回 JSON。');
  }
  return JSON.parse(jsonStr);
}

/** 推理引擎路由：显式本地选择 → Ollama；有 Gemini key 且模型为 gemini-* → 云端；否则 Ollama；再退回内置配方 */
export async function resolveReasoningEngine(preferredModel?: string): Promise<'gemini' | 'ollama' | 'fallback'> {
  if (preferredModel === LOCAL_REASONING_ID) {
    return (await ollamaIsAvailable()) ? 'ollama' : 'fallback';
  }
  if (hasGeminiApiKey() && (!preferredModel || preferredModel.startsWith('gemini'))) return 'gemini';
  if (await ollamaIsAvailable()) return 'ollama';
  return hasGeminiApiKey() ? 'gemini' : 'fallback';
}
