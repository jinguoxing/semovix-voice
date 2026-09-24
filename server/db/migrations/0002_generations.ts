/**
 * 0002: generations 生成记录表（可追溯性地基）
 * 每次 TTS/ASR 等引擎调用都留痕：引擎、模型、音色、参数、输入、输出文件、状态（含失败）。
 */
import type { Migration } from '../migrations';

export const generations: Migration = {
  version: '0002',
  name: 'generations',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS generations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,              -- 'tts' | 'asr'
        engine TEXT NOT NULL,            -- 'gemini' | 'qwen3-tts-local' | 'whisper-local' ...
        model TEXT,
        voice TEXT,                      -- 使用的音色/speaker 精确 ID
        params TEXT,                     -- JSON：speed/emotion/temperature/systemInstruction 等
        input_text TEXT,                 -- 输入文本（合成文本或转录结果）
        item_id TEXT,                    -- 关联素材（可选）
        output_file TEXT,                -- 输出音频文件（artifacts/ 下文件名）
        duration_sec REAL,
        sample_rate INTEGER,
        status TEXT NOT NULL DEFAULT 'done',  -- 'done' | 'failed'
        error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_generations_created ON generations (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_generations_item ON generations (item_id);
    `);
  },
};
