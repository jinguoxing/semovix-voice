#!/bin/bash
# Semovix Voice Worker 启动器（Qwen3-TTS + Whisper，FastAPI，端口 8800）
# 双击运行；依赖 conda env `qwen3-tts`（模型与 torch 已装好）
cd "$(dirname "$0")" || exit 1
echo "[Semovix Worker] 启动 FastAPI Worker → http://127.0.0.1:8800"
echo "[Semovix Worker] 模型懒加载：首次 /tts/qwen 或 /asr/whisper 调用时加载（约 30-90 秒）"
exec /Users/kingnet/anaconda3/envs/qwen3-tts/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8800
