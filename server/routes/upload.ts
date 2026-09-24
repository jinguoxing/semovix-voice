/**
 * 统一 multipart 上传中间件（P01）：
 * 内存暂存 + 100MB 硬上限，multer 错误映射为规范失败响应
 * （LIMIT_FILE_SIZE → 413 file_too_large，其余 → 400 invalid_request）。
 */
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { fail } from './respond';

export const MAX_UPLOAD_MB = 100;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

export function uploadSingle(field: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    upload.single(field)(req, res, (err?: unknown) => {
      if (!err) return next();
      const e = err as { code?: string; message?: string };
      if (e.code === 'LIMIT_FILE_SIZE') {
        return fail(
          res,
          413,
          `上传文件超过大小上限（${MAX_UPLOAD_MB}MB）。请裁剪或压缩后重试。`,
          'file_too_large'
        );
      }
      return fail(res, 400, `上传解析失败: ${e.message || String(err)}`, 'invalid_request');
    });
  };
}
