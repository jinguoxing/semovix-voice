# -*- coding: utf-8 -*-
"""
Semovix Voice Studio - Python FastAPI Worker（硬性约束 #14）

独立进程承载两个本地引擎，Node 后端只与本 Worker 通信：
  - Qwen3-TTS (Qwen3-TTS-12Hz-1.7B-CustomVoice, MPS)
  - Whisper   (openai/whisper-large-v3-turbo, MPS)

端点：
  GET  /health          引擎就绪状态（不触发模型加载）
  GET  /voices          Qwen 官方 speaker 精确 ID（模型运行时 get_supported_speakers()，硬性约束 #6）
  POST /tts/qwen        {"text","speaker","language"?,"instruct"?} → audio/wav 字节（非 Base64，硬性约束 #7）
  POST /asr/whisper     multipart 文件上传 → {"transcript","language","duration"}

音频传输一律文件/字节流，不走 JSON Base64（硬性约束 #7）。
"""
from __future__ import annotations

import io
import os
import wave
from typing import Any, Optional

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# 模型 checkpoint：默认本机路径，可用环境变量覆盖；缺省回退 HuggingFace repo id
DEFAULT_TTS_CKPT = "/Volumes/King的扩展盘/qwen LLM/Qwen3-TTS/models/Qwen3-TTS-12Hz-1.7B-CustomVoice"
TTS_CKPT = os.environ.get("SEMOVIX_TTS_CKPT", DEFAULT_TTS_CKPT)
ASR_MODEL_ID = os.environ.get("SEMOVIX_ASR_MODEL", "openai/whisper-large-v3-turbo")

app = FastAPI(title="Semovix Voice Worker", version="1.0.0")

# ---------------------------------------------------------------------------
# 引擎状态（懒加载；_load_* 失败不崩溃进程，端点如实返回 503）
# ---------------------------------------------------------------------------

_tts_state: dict[str, Any] = {"loaded": False, "error": None, "model": None, "speakers": [], "languages": []}
_asr_state: dict[str, Any] = {"loaded": False, "error": None, "processor": None, "model": None, "device": None, "dtype": None}


def _pick_device() -> str:
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda:0"
    return "cpu"


def _load_tts():
    if _tts_state["loaded"] or _tts_state.get("loading"):
        return
    _tts_state["loading"] = True
    try:
        import torch
        from qwen_tts import Qwen3TTSModel

        device = _pick_device()
        # 与既有 qwen-tts-demo 运行参数一致：MPS + bf16 + 不用 flash-attn
        dtype = torch.bfloat16 if device == "mps" else torch.float32
        tts = Qwen3TTSModel.from_pretrained(TTS_CKPT, device_map=device, dtype=dtype, attn_implementation=None)
        speakers: list[str] = list(tts.get_supported_speakers() or [])
        languages: list[str] = list(tts.get_supported_languages() or [])
        _tts_state.update(loaded=True, model=tts, speakers=speakers, languages=languages, device=device, checkpoint=TTS_CKPT)
        print(f"[worker] Qwen3-TTS 就绪 device={device} speakers={speakers}")
    except Exception as e:  # noqa: BLE001 - 状态如实上报，不崩溃
        _tts_state["error"] = f"{type(e).__name__}: {e}"
        print(f"[worker] Qwen3-TTS 加载失败: {_tts_state['error']}")
    finally:
        _tts_state["loading"] = False


def _load_asr():
    if _asr_state["loaded"] or _asr_state.get("loading"):
        return
    _asr_state["loading"] = True
    try:
        import torch
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        device = _pick_device()
        dtype = torch.float16 if device == "mps" else torch.float32
        processor = WhisperProcessor.from_pretrained(ASR_MODEL_ID)
        model = WhisperForConditionalGeneration.from_pretrained(ASR_MODEL_ID, torch_dtype=dtype).to(device)
        _asr_state.update(loaded=True, processor=processor, model=model, device=device, dtype=dtype)
        print(f"[worker] Whisper 就绪 device={device} model={ASR_MODEL_ID}")
    except Exception as e:  # noqa: BLE001
        _asr_state["error"] = f"{type(e).__name__}: {e}"
        print(f"[worker] Whisper 加载失败: {_asr_state['error']}")
    finally:
        _asr_state["loading"] = False


def _engine_unavailable(engine: str, detail: str) -> HTTPException:
    return HTTPException(status_code=503, detail={"error": detail, "code": "engine_unavailable", "engine": engine})


# ---------------------------------------------------------------------------
# TTS
# ---------------------------------------------------------------------------


class TtsRequest(BaseModel):
    text: str = Field(min_length=1)
    speaker: str = Field(min_length=1)
    language: str = "Auto"
    instruct: Optional[str] = None


def _float_to_wav_bytes(wav: Any, sample_rate: int) -> bytes:
    """float32 ndarray → 16-bit PCM RIFF/WAV 字节"""
    import numpy as np

    arr = np.asarray(wav, dtype=np.float32)
    if arr.ndim > 1:
        arr = arr.mean(axis=tuple(range(1, arr.ndim)))  # 多声道 → 单声道
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    if peak > 0:
        arr = arr / peak * 0.95  # 防削波
    pcm = (arr * 32767.0).astype("<i2")

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


@app.post("/tts/qwen")
def tts_qwen(req: TtsRequest) -> Response:
    _load_tts()
    if not _tts_state["loaded"]:
        raise _engine_unavailable("qwen_tts", f"Qwen3-TTS 引擎不可用：{_tts_state['error'] or '模型未加载完成'}")

    speakers = _tts_state["speakers"]
    # 硬性约束 #6：speaker 必须是官方精确 ID，不接受展示名/别名
    if speakers and req.speaker not in speakers:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"非官方 Qwen speaker ID: {req.speaker}（官方: {', '.join(speakers)}）",
                "code": "unsupported_speaker",
                "engine": "qwen_tts",
                "speakers": speakers,
            },
        )
    if req.language not in (_tts_state["languages"] or []) and req.language != "Auto":
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"不支持的语言: {req.language}",
                "code": "unsupported_language",
                "engine": "qwen_tts",
                "languages": _tts_state["languages"],
            },
        )

    try:
        wavs, sr = _tts_state["model"].generate_custom_voice(
            text=req.text.strip(),
            language=req.language,
            speaker=req.speaker,
            instruct=(req.instruct or "").strip() or None,
        )
        if not wavs:
            raise RuntimeError("模型未返回音频")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail={"error": f"{type(e).__name__}: {e}", "code": "tts_failed", "engine": "qwen_tts"})

    return Response(content=_float_to_wav_bytes(wavs[0], sr), media_type="audio/wav", headers={"X-Sample-Rate": str(sr)})


# ---------------------------------------------------------------------------
# ASR
# ---------------------------------------------------------------------------


@app.post("/asr/whisper")
async def asr_whisper(file: UploadFile, language: str = Form("auto")) -> JSONResponse:
    _load_asr()
    if not _asr_state["loaded"]:
        raise _engine_unavailable("whisper_asr", f"Whisper 引擎不可用：{_asr_state['error'] or '模型未加载完成'}")

    if language not in ("auto", "zh", "en"):
        raise HTTPException(status_code=400, detail={"error": f"不支持的语言: {language}", "code": "unsupported_language", "engine": "whisper_asr"})

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail={"error": "音频文件为空", "code": "invalid_request", "engine": "whisper_asr"})

    try:
        import librosa
        import torch

        speech, _ = librosa.load(io.BytesIO(audio_bytes), sr=16000, mono=True)
        duration = len(speech) / 16000.0

        processor, model = _asr_state["processor"], _asr_state["model"]
        device, dtype = _asr_state["device"], _asr_state["dtype"]
        inputs = processor(speech, sampling_rate=16000, return_tensors="pt")
        input_features = inputs.input_features.to(device, dtype)

        gen_kwargs: dict[str, Any] = dict(task="transcribe")
        if duration > 30:
            gen_kwargs["return_timestamps"] = True
        if language != "auto":
            gen_kwargs["language"] = language

        with torch.no_grad():
            predicted_ids = model.generate(input_features, **gen_kwargs)
        text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail={"error": f"{type(e).__name__}: {e}", "code": "asr_failed", "engine": "whisper_asr"})

    return JSONResponse({"success": True, "transcript": text, "language": language, "duration": round(duration, 2)})


# ---------------------------------------------------------------------------
# 目录与健康
# ---------------------------------------------------------------------------


@app.get("/voices")
def voices() -> JSONResponse:
    _load_tts()
    if not _tts_state["loaded"]:
        raise _engine_unavailable("qwen_tts", f"Qwen3-TTS 引擎不可用：{_tts_state['error'] or '模型未加载完成'}")
    return JSONResponse(
        {
            "checkpoint": _tts_state.get("checkpoint"),
            "speakers": _tts_state["speakers"],  # 官方精确 ID（下划线式，如 Uncle_Fu）
            "languages": _tts_state["languages"],
        }
    )


@app.get("/health")
def health() -> JSONResponse:
    # health 不触发加载：如实报告当前状态（未加载 ≠ 不可用，但 available 只有加载成功才为 true）
    return JSONResponse(
        {
            "ok": True,
            "engines": {
                "qwen_tts": {"available": _tts_state["loaded"], "loading": bool(_tts_state.get("loading")), "error": _tts_state["error"], "checkpoint": TTS_CKPT},
                "whisper_asr": {"available": _asr_state["loaded"], "loading": bool(_asr_state.get("loading")), "error": _asr_state["error"], "model": ASR_MODEL_ID, "dtype": str(_asr_state["dtype"]) if _asr_state["dtype"] else None},
            },
        }
    )


@app.get("/warmup")
def warmup() -> JSONResponse:
    """显式预加载（首次合成前调用可避免请求超时）"""
    _load_tts()
    _load_asr()
    return health()
