# -*- coding: utf-8 -*-
"""
Semovix Voice Worker 环境体检（P01 运行环境可移植性）

逐项检查运行前提并输出 PASS / WARN / FAIL：

  1. Python 版本（>= 3.10）
  2. torch 及加速设备（MPS / CUDA / CPU）
  3. qwen_tts（Qwen3-TTS 引擎）
  4. transformers（Whisper 引擎）
  5. librosa / soundfile（音频解码）
  6. TTS 模型 checkpoint（本地目录存在，或 HF repo id 需首跑联网下载）
  7. FFmpeg（部分音频格式转码；WAV 主链路不依赖）
  8. 端口 8800 是否已被占用（Worker 是否已在运行）
  9. 可写目录（当前目录 + 系统临时目录）

存在 FAIL 时以非零码退出（可用于启动前预检 / CI）。
用法：python worker/doctor.py
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import socket
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

# 只关闭 librosa 的可选 Numba JIT 缓存，不影响 Qwen 的 PyTorch 推理。
# Python 3.12 + 部分 librosa/numba 组合否则会在 qwen_tts 导入阶段失败。
os.environ.setdefault("NUMBA_DISABLE_JIT", "1")
_WORKER_ROOT = Path(__file__).resolve().parent
load_dotenv(_WORKER_ROOT.parent / ".env", override=False)
load_dotenv(_WORKER_ROOT / ".env", override=False)

WORKER_PORT = int(os.environ.get("SEMOVIX_WORKER_PORT", "8800"))
DEFAULT_TTS_CKPT = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
TTS_CKPT = os.environ.get("SEMOVIX_TTS_CKPT", DEFAULT_TTS_CKPT)
VOICE_DESIGN_CKPT = os.environ.get("SEMOVIX_VOICE_DESIGN_CKPT", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
VOICE_CLONE_CKPT = os.environ.get("SEMOVIX_VOICE_CLONE_CKPT", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")

results: list[tuple[str, str, str]] = []  # (status, name, detail)


def record(status: str, name: str, detail: str = "") -> None:
    results.append((status, name, detail))


def has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def check_python() -> None:
    v = sys.version_info
    if v >= (3, 10):
        record("PASS", "Python", f"{v.major}.{v.minor}.{v.micro}")
    else:
        record("FAIL", "Python", f"{v.major}.{v.minor}.{v.micro}（需要 >= 3.10）")


def check_torch() -> None:
    if not has_module("torch"):
        record("FAIL", "torch", "未安装（按平台装 requirements-macos.txt / requirements-cuda.txt）")
        return
    try:
        import torch

        if torch.backends.mps.is_available():
            device = "mps"
        elif torch.cuda.is_available():
            device = f"cuda:0 ({torch.cuda.get_device_name(0)})"
        else:
            device = "cpu"
        status = "WARN" if device == "cpu" else "PASS"
        record(status, "torch", f"{torch.__version__} · 设备 {device}" + ("（无加速后端，合成/转写会很慢）" if device == "cpu" else ""))
    except Exception as e:  # pragma: no cover - 环境异常兜底
        record("FAIL", "torch", f"导入失败: {e}")


def check_module(name: str, label: str, on_fail: str = "FAIL") -> None:
    if has_module(name):
        try:
            mod = importlib.import_module(name)
            record("PASS", label, getattr(mod, "__version__", ""))
        except Exception as e:
            record("FAIL", label, f"导入失败: {e}")
    else:
        record(on_fail, label, f"未安装（pip install -r requirements-base.txt）")


def check_checkpoint(label: str, checkpoint: str) -> None:
    if os.path.isdir(checkpoint):
        record("PASS", label, f"本地目录 {checkpoint}")
        return
    if "/" in checkpoint and not os.path.exists(checkpoint):
        # 形如 org/name 的 HuggingFace repo id：首次运行需联网下载
        record(
            "WARN",
            label,
            f"HuggingFace repo id {checkpoint}（首次运行将联网下载，约 4-5GB；"
            "本机已有权重可通过对应 SEMOVIX_*_CKPT 指向本地目录）",
        )
        return
    record("FAIL", label, f"checkpoint 路径不存在: {checkpoint}")


def check_ffmpeg() -> None:
    for binname in ("ffmpeg", "ffprobe"):
        if not shutil.which(binname):
            record("WARN", "FFmpeg", f"未找到 {binname}（WAV 主链路不依赖；部分格式转码需要）")
            return
    record("PASS", "FFmpeg", "ffmpeg / ffprobe 可用")


def check_port() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        occupied = s.connect_ex(("127.0.0.1", WORKER_PORT)) == 0
    if occupied:
        record("WARN", f"端口 {WORKER_PORT}", "已被占用（Worker 已在运行？否则请释放端口或用 SEMOVIX_WORKER_PORT 换端口）")
    else:
        record("PASS", f"端口 {WORKER_PORT}", "空闲")


def check_writable() -> None:
    for label, path in (("工作目录", os.getcwd()), ("临时目录", tempfile.gettempdir())):
        try:
            probe = os.path.join(path, f".semovix-doctor-{os.getpid()}")
            with open(probe, "w") as f:
                f.write("ok")
            os.remove(probe)
        except Exception as e:
            record("FAIL", f"可写目录·{label}", f"{path} 不可写: {e}")
            return
    record("PASS", "可写目录", "工作目录与临时目录均可写")


def main() -> int:
    print("Semovix Voice Worker 环境体检")
    print(f"  Python: {sys.executable}")
    print(f"  CustomVoice checkpoint: {TTS_CKPT}")
    print("-" * 64)

    check_python()
    check_torch()
    check_module("qwen_tts", "qwen_tts")
    check_module("transformers", "transformers")
    check_module("librosa", "librosa", on_fail="WARN")
    check_module("soundfile", "soundfile", on_fail="WARN")
    check_checkpoint("CustomVoice checkpoint", TTS_CKPT)
    check_checkpoint("VoiceDesign checkpoint", VOICE_DESIGN_CKPT)
    check_checkpoint("Base checkpoint", VOICE_CLONE_CKPT)
    check_ffmpeg()
    check_port()
    check_writable()

    width = max(len(name) for _, name, _ in results)
    fails = warns = 0
    for status, name, detail in results:
        mark = {"PASS": "✅ PASS", "WARN": "⚠️  WARN", "FAIL": "❌ FAIL"}[status]
        line = f"{mark}  {name.ljust(width)}"
        if detail:
            line += f"  {detail}"
        print(line)
        fails += status == "FAIL"
        warns += status == "WARN"

    print("-" * 64)
    if fails:
        print(f"结论：FAIL（{fails} 项失败，{warns} 项警告）——请先修复失败项再启动 Worker。")
        return 1
    print(f"结论：{'PASS' if warns == 0 else 'PASS（带警告）'}（0 项失败，{warns} 项警告）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
