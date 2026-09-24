#!/bin/bash
# Semovix Voice Worker 启动器（Qwen3-TTS + Whisper，FastAPI，端口 8800）
#
# 可移植启动（P01：不含任何机器专属路径）——按优先级解析 Python 解释器：
#   1) SEMOVIX_PYTHON_BIN   直接指定解释器绝对路径（最高优先级）
#   2) SEMOVIX_CONDA_ENV    conda run -n <env>（默认 qwen3-tts）
#   3) PATH 上的 python3    兜底
set -u
cd "$(dirname "$0")" || exit 1

PORT="${SEMOVIX_WORKER_PORT:-8800}"
CONDA_ENV="${SEMOVIX_CONDA_ENV:-qwen3-tts}"

if [ -n "${SEMOVIX_PYTHON_BIN:-}" ]; then
  PY="$SEMOVIX_PYTHON_BIN"
elif command -v conda >/dev/null 2>&1; then
  PY="conda run --no-capture-output -n $CONDA_ENV python"
else
  PY="python3"
fi

echo "[Semovix Worker] Python 解释器: $PY"
echo "[Semovix Worker] 启动 FastAPI Worker → http://127.0.0.1:$PORT"
echo "[Semovix Worker] 模型懒加载：预热/首次调用时加载（约 30-90 秒，视设备而定）"

# 预检：解释器可用 + Web 层依赖可导入；缺依赖时给出明确指引，不带病启动
if ! $PY -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "[Semovix Worker] 预检失败：所选解释器缺少 fastapi/uvicorn。"
  echo "[Semovix Worker]   安装依赖:  pip install -r requirements-base.txt"
  echo "[Semovix Worker]   （macOS/MPS 参考 requirements-macos.txt，CUDA 参考 requirements-cuda.txt）"
  echo "[Semovix Worker]   或用 SEMOVIX_PYTHON_BIN / SEMOVIX_CONDA_ENV 指向已装好依赖的解释器。"
  exit 1
fi

exec $PY -m uvicorn app:app --host 127.0.0.1 --port "$PORT"
