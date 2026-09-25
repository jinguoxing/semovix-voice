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
# 部分 Python 3.12 的 librosa/numba 组合会在 site-packages 导入阶段启用
# 不可定位的缓存。缓存不参与 TTS 推理，默认关闭 JIT 以避免预热前崩溃。
export NUMBA_DISABLE_JIT="${SEMOVIX_NUMBA_DISABLE_JIT:-1}"

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
echo "[Semovix Worker] NUMBA_DISABLE_JIT=$NUMBA_DISABLE_JIT"

# 预检：必须验证完整推理栈。仅 FastAPI 可用时继续启动，会让 Node 侧误以为
# Worker 可达、却在第一次预热时才因缺 qwen_tts 失败，无法作为可交付运行状态。
if ! $PY -c "import fastapi, uvicorn, dotenv" >/dev/null 2>&1; then
  echo "[Semovix Worker] 预检失败：所选解释器缺少 fastapi/uvicorn/python-dotenv。"
  echo "[Semovix Worker]   安装依赖:  pip install -r requirements-base.txt"
  echo "[Semovix Worker]   （macOS/MPS 参考 requirements-macos.txt，CUDA 参考 requirements-cuda.txt）"
  echo "[Semovix Worker]   或用 SEMOVIX_PYTHON_BIN / SEMOVIX_CONDA_ENV 指向已装好依赖的解释器。"
  exit 1
fi

if ! $PY -c "import torch, qwen_tts, transformers, librosa" >/dev/null 2>&1; then
  echo "[Semovix Worker] 预检失败：所选解释器缺少 Qwen3-TTS 或 Whisper 推理依赖。"
  echo "[Semovix Worker]   请在同一解释器环境安装:  pip install -r requirements-base.txt"
  echo "[Semovix Worker]   然后执行:  python doctor.py"
  echo "[Semovix Worker]   可用 SEMOVIX_PYTHON_BIN / SEMOVIX_CONDA_ENV 选择正确环境。"
  exit 1
fi

exec $PY -m uvicorn app:app --host 127.0.0.1 --port "$PORT"
