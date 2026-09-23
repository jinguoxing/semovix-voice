# Semovix Voice Worker（Python FastAPI）

独立 Python 进程承载本地引擎，Node 后端（Express）只与本 Worker 通信（硬性约束 #14）。
两个引擎在同一进程内**懒加载**：进程秒起，首次调用对应端点时才加载模型。

| 引擎 | 模型 | 设备 |
|---|---|---|
| Qwen3-TTS | `Qwen3-TTS-12Hz-1.7B-CustomVoice`（本机路径） | MPS |
| Whisper | `openai/whisper-large-v3-turbo` | MPS |

## 启动

双击 `启动Worker.command`，或：

```bash
cd worker
/Users/kingnet/anaconda3/envs/qwen3-tts/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8800
```

Node 侧默认连接 `http://127.0.0.1:8800`，可用 `SEMOVIX_WORKER_URL` 覆盖。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 引擎就绪状态（不触发加载） |
| GET | `/warmup` | 显式预加载两个模型 |
| GET | `/voices` | **Qwen 官方 speaker 精确 ID**（模型运行时 `get_supported_speakers()`，如 `Uncle_Fu`；硬性约束 #6） |
| POST | `/tts/qwen` | `{"text","speaker","language"?,"instruct"?}` → `audio/wav` 字节流（非 Base64；硬性约束 #7） |
| POST | `/asr/whisper` | multipart `file` + `language=auto|zh|en` → `{"transcript","language","duration"}` |

错误结构统一为 `{"detail": {"error", "code", "engine", ...}}`：
`engine_unavailable`（503）、`unsupported_speaker`（400，附官方 `speakers`）、
`unsupported_language`（400）、`tts_failed` / `asr_failed`（502）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SEMOVIX_TTS_CKPT` | 本机模型路径 | Qwen3-TTS checkpoint（可为 HF repo id） |
| `SEMOVIX_ASR_MODEL` | `openai/whisper-large-v3-turbo` | Whisper 模型 |
| `SEMOVIX_WORKER_URL` | `http://127.0.0.1:8800` | Node 侧连接地址（server/config.ts） |

## 设计要点

- **官方音色目录以引擎为唯一权威**：speaker 列表来自模型运行时，服务端不做任何
  persona→speaker 映射；非官方 ID 一律 400（硬性约束 #5/#6）。
- **音频走文件流**：TTS 响应为 WAV 字节，ASR 请求为 multipart 上传（硬性约束 #7）。
- 语速变速（WSOLA）在 Node 侧完成，Worker 只负责原生合成。
