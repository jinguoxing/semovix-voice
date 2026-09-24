/**
 * 引擎层错误基类：业务校验失败（模型/音色不在目录内等）映射为 HTTP 400，
 * 与引擎调用失败（502）区分。路由通过 instanceof EngineValidationError 统一处理。
 */
export class EngineValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'EngineValidationError';
  }
}

/**
 * 提取可读的错误描述：undici 的 fetch 失败只报 "fetch failed"，
 * 真实原因（ECONNREFUSED / DNS / 超时）在 e.cause 里，必须带出来用户才能排障。
 */
export function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const cause: any = (e as any)?.cause;
  const causeDesc = cause?.code || cause?.message;
  return causeDesc && causeDesc !== msg ? `${msg}（原因: ${String(causeDesc).slice(0, 200)}）` : msg;
}
