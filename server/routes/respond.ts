/**
 * 统一错误响应结构：{ error, code, ...extra }
 * code 为机器可读错误码（unsupported_tts_model / engine_unavailable / …），
 * 前端据此展示真实失败原因，绝不伪造成功结果（硬性约束 #1）。
 */
import type { Response } from 'express';

export function fail(
  res: Response,
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>
): void {
  res.status(status).json({ error: message, code, ...extra });
}
