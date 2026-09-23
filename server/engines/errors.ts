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
