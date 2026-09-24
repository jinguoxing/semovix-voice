import {
  createGuofengComposition,
  isGuofengComposition,
  type GuofengComposition,
  type GuofengRequest,
} from './guofeng';

export interface GuofengGenerationResult {
  composition: GuofengComposition;
  engine: GuofengComposition['generator'];
  warning?: string;
}

function rulesFallback(request: GuofengRequest, reason: string): GuofengGenerationResult {
  return {
    composition: createGuofengComposition(request),
    engine: 'rules',
    warning: `${reason}，已使用内置编曲模板。`,
  };
}

/** Generate a score even when the optional reasoning service is unreachable or returns no body. */
export async function generateGuofeng(
  request: GuofengRequest,
  reasoningModel?: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<GuofengGenerationResult> {
  let response: Response;
  try {
    response = await fetcher('/api/generate-guofeng-composition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, reasoningModel }),
    });
  } catch {
    return rulesFallback(request, '无法连接国风编曲服务');
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return rulesFallback(request, `国风编曲服务响应中断（HTTP ${response.status}）`);
  }

  if (!body.trim()) {
    if (response.status >= 400 && response.status < 500 && response.status !== 404) {
      throw new Error(`国风编曲请求失败（HTTP ${response.status}）。`);
    }
    return rulesFallback(request, `国风编曲接口返回空响应（HTTP ${response.status}）`);
  }

  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(body);
    data = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    if (response.status >= 400 && response.status < 500 && response.status !== 404) {
      throw new Error(`国风编曲请求失败（HTTP ${response.status}）。`);
    }
    return rulesFallback(request, `国风编曲接口返回了非 JSON 内容（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    if (response.status >= 500 || response.status === 404) {
      return rulesFallback(request, `国风编曲服务暂不可用（HTTP ${response.status}）`);
    }
    throw new Error(typeof data.error === 'string' ? data.error : `国风编曲请求失败（HTTP ${response.status}）。`);
  }
  if (!isGuofengComposition(data.composition)) {
    return rulesFallback(request, '国风编曲接口返回了无效工程');
  }
  return {
    composition: data.composition,
    engine: data.composition.generator,
    warning: typeof data.warning === 'string' ? data.warning : undefined,
  };
}
