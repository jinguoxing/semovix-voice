# -*- coding: utf-8 -*-
"""
Semovix Voice Studio - Python FastAPI Worker（硬性约束 #14）

独立进程承载本地引擎，Node 后端只与本 Worker 通信：
  - Qwen3-TTS (Qwen3-TTS-12Hz-1.7B-CustomVoice)
  - Qwen3-TTS (Qwen3-TTS-12Hz-1.7B-VoiceDesign)
  - Qwen3-TTS (Qwen3-TTS-12Hz-1.7B-Base, 授权真人克隆)
  - Whisper   (openai/whisper-large-v3-turbo)

引擎冷启动状态机（P01）：

    cold ──warmup──▶ loading ──成功──▶ ready
                        │
                        └──失败──▶ error ──再次 warmup──▶ loading（自动重试）

  - GET  /health          永不触发加载；进程可达即 200，如实上报各引擎 state
  - POST /warmup/qwen     ready → 200；cold/loading → 202 {retry:true}；error → 503 {retry:true}（同时触发重载）
  - POST /warmup/whisper  同上
  - GET  /voices          不触发加载；未就绪 → 503 engine_not_ready
  - POST /tts/qwen        不触发加载；未就绪 → 503 engine_not_ready
  - POST /asr/whisper     不触发加载；未就绪 → 503 engine_not_ready

音频传输一律文件/字节流，不走 JSON Base64（硬性约束 #7）。
"""
from __future__ import annotations

import io
import os
import threading
import wave
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# 与 Node 服务使用同一份项目环境配置。先保留进程显式传入的变量，再加载
# worker/.env 与项目根 .env，便于本机路径和部署密钥都只维护一处。
_WORKER_ROOT = Path(__file__).resolve().parent
load_dotenv(_WORKER_ROOT.parent / ".env", override=False)
load_dotenv(_WORKER_ROOT / ".env", override=False)

# 模型 checkpoint：默认 HuggingFace repo id（可移植；首次启动自动下载）。
# 本机已有权重时用 SEMOVIX_TTS_CKPT 指向本地目录，避免重复下载。
DEFAULT_TTS_CKPT = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
TTS_CKPT = os.environ.get("SEMOVIX_TTS_CKPT", DEFAULT_TTS_CKPT)
VOICE_DESIGN_CKPT = os.environ.get("SEMOVIX_VOICE_DESIGN_CKPT", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
VOICE_CLONE_CKPT = os.environ.get("SEMOVIX_VOICE_CLONE_CKPT", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
ASR_MODEL_ID = os.environ.get("SEMOVIX_ASR_MODEL", "openai/whisper-large-v3-turbo")

app = FastAPI(title="Semovix Voice Worker", version="1.1.0")


# ---------------------------------------------------------------------------
# 引擎状态机：cold → loading → ready | error（线程安全，加载在后台线程执行）
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class EngineState:
    id: str
    state: str = "cold"  # cold | loading | ready | error
    error: Optional[str] = None
    load_started_at: Optional[str] = None
    loaded_at: Optional[str] = None
    load_attempts: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    # 以下载荷仅在 state == "ready" 时有效
    model: Any = None
    processor: Any = None
    speakers: list = field(default_factory=list)
    languages: list = field(default_factory=list)
    device: Optional[str] = None
    dtype: Any = None
    checkpoint: Optional[str] = None


_TTS = EngineState(id="qwen_tts")
_VOICE_DESIGN = EngineState(id="voice_design")
_VOICE_DESIGN_INFER_LOCK = threading.Lock()
_VOICE_CLONE = EngineState(id="voice_clone")
_VOICE_CLONE_INFER_LOCK = threading.Lock()
_ASR = EngineState(id="whisper_asr")
_ENGINES: dict[str, EngineState] = {"qwen_tts": _TTS, "voice_design": _VOICE_DESIGN, "voice_clone": _VOICE_CLONE, "whisper_asr": _ASR}


def _pick_device() -> str:
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda:0"
    return "cpu"


def _build_tts() -> dict[str, Any]:
    """真实加载 Qwen3-TTS（测试通过替换 _BUILDERS 注入伪模型）"""
    import torch
    from qwen_tts import Qwen3TTSModel

    device = _pick_device()
    # 与既有 qwen-tts-demo 运行参数一致：MPS + bf16 + 不用 flash-attn
    dtype = torch.bfloat16 if device == "mps" else torch.float32
    tts = Qwen3TTSModel.from_pretrained(TTS_CKPT, device_map=device, dtype=dtype, attn_implementation=None)
    return {
        "model": tts,
        "speakers": list(tts.get_supported_speakers() or []),
        "languages": list(tts.get_supported_languages() or []),
        "device": device,
        "checkpoint": TTS_CKPT,
    }


def _build_voice_design() -> dict[str, Any]:
    """VoiceDesign 单独加载；绝不复用 CustomVoice 权重或 speaker 命名空间。"""
    import torch
    from qwen_tts import Qwen3TTSModel

    device = _pick_device()
    dtype = torch.bfloat16 if device == "mps" else torch.float32
    model = Qwen3TTSModel.from_pretrained(
        VOICE_DESIGN_CKPT, device_map=device, dtype=dtype, attn_implementation=None
    )
    return {"model": model, "device": device, "checkpoint": VOICE_DESIGN_CKPT}


def _build_voice_clone() -> dict[str, Any]:
    """Base 单独加载；真人克隆不能误用 CustomVoice 或 VoiceDesign checkpoint。"""
    import torch
    from qwen_tts import Qwen3TTSModel

    device = _pick_device()
    dtype = torch.bfloat16 if device == "mps" else torch.float32
    model = Qwen3TTSModel.from_pretrained(
        VOICE_CLONE_CKPT, device_map=device, dtype=dtype, attn_implementation=None
    )
    return {"model": model, "device": device, "checkpoint": VOICE_CLONE_CKPT}


def _build_asr() -> dict[str, Any]:
    """真实加载 Whisper（测试通过替换 _BUILDERS 注入伪模型）"""
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    device = _pick_device()
    dtype = torch.float16 if device == "mps" else torch.float32
    processor = WhisperProcessor.from_pretrained(ASR_MODEL_ID)
    model = WhisperForConditionalGeneration.from_pretrained(ASR_MODEL_ID, torch_dtype=dtype).to(device)
    return {"model": model, "processor": processor, "device": device, "dtype": dtype}


_BUILDERS: dict[str, Callable[[], dict[str, Any]]] = {"qwen_tts": _build_tts, "voice_design": _build_voice_design, "voice_clone": _build_voice_clone, "whisper_asr": _build_asr}


def _load_engine(es: EngineState) -> None:
    """后台线程中执行真实加载；任何异常 → state=error（带真实原因），进程不崩溃。"""
    try:
        payload = _BUILDERS[es.id]()
    except Exception as e:  # noqa: BLE001 - 状态如实上报，不崩溃
        es.error = f"{type(e).__name__}: {e}"
        es.state = "error"
        print(f"[worker] {es.id} 加载失败（第 {es.load_attempts} 次）: {es.error}", flush=True)
        return

    # 先写载荷再置 ready，保证读到 ready 时载荷一定完整
    es.model = payload.get("model")
    es.processor = payload.get("processor")
    es.speakers = payload.get("speakers", [])
    es.languages = payload.get("languages", [])
    es.device = payload.get("device")
    es.dtype = payload.get("dtype")
    es.checkpoint = payload.get("checkpoint")
    es.error = None
    es.loaded_at = _now_iso()
    es.state = "ready"
    print(f"[worker] {es.id} 就绪 device={es.device}", flush=True)


def _request_load(es: EngineState) -> None:
    """cold/error → 启动后台加载线程；loading/ready → 不重复加载（幂等）。"""
    with es.lock:
        if es.state in ("loading", "ready"):
            return
        es.state = "loading"
        es.error = None
        es.load_attempts += 1
        es.load_started_at = _now_iso()
        threading.Thread(target=_load_engine, args=(es,), daemon=True, name=f"load-{es.id}").start()


def _snapshot(es: EngineState) -> dict[str, Any]:
    return {
        "state": es.state,
        "available": es.state == "ready",
        "error": es.error,
        "loadStartedAt": es.load_started_at,
        "loadedAt": es.loaded_at,
        "loadAttempts": es.load_attempts,
    }


_WARMUP_PATH = {"qwen_tts": "qwen", "voice_design": "voice-design", "voice_clone": "voice-clone", "whisper_asr": "whisper"}


def _require_ready(es: EngineState) -> None:
    """推理端点守卫：未就绪一律 503 engine_not_ready（绝不内联加载，避免请求线程被模型加载卡死）"""
    if es.state != "ready":
        hint = es.error or f"模型尚未加载，请先 POST /warmup/{_WARMUP_PATH[es.id]} 并轮询 /health 至 ready"
        raise HTTPException(
            status_code=503,
            detail={
                "error": f"{es.id} 引擎未就绪（state={es.state}）：{hint}",
                "code": "engine_not_ready",
                "engine": es.id,
                "state": es.state,
                "retry": es.state in ("cold", "loading"),
            },
        )


# ---------------------------------------------------------------------------
# TTS
# ---------------------------------------------------------------------------


class TtsRequest(BaseModel):
    text: str = Field(min_length=1)
    speaker: str = Field(min_length=1)
    language: str = "auto"
    instruct: Optional[str] = None


class VoiceDesignRequest(BaseModel):
    text: str = Field(min_length=1)
    instruct: str = Field(min_length=1)
    language: str = "Chinese"
    seed: Optional[int] = None


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
    _require_ready(_TTS)

    speakers = _TTS.speakers
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
    # 不同 Qwen checkpoint 会返回 `auto/chinese` 或 `Auto/Chinese`。由运行时
    # 目录做大小写无关匹配，再把模型返回的精确值传回推理层，不能写死一套枚举。
    language_by_key = {str(language).casefold(): str(language) for language in (_TTS.languages or [])}
    language = language_by_key.get(req.language.strip().casefold())
    if not language:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"不支持的语言: {req.language}",
                "code": "unsupported_language",
                "engine": "qwen_tts",
                "languages": _TTS.languages,
            },
        )

    try:
        wavs, sr = _TTS.model.generate_custom_voice(
            text=req.text.strip(),
            language=language,
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


@app.post("/tts/voice-design")
def tts_voice_design(req: VoiceDesignRequest) -> Response:
    _require_ready(_VOICE_DESIGN)
    if req.language not in ("Chinese", "English", "Auto"):
        raise HTTPException(status_code=400, detail={"error": f"不支持的语言: {req.language}", "code": "unsupported_language", "engine": "voice_design"})
    try:
        with _VOICE_DESIGN_INFER_LOCK:
            if req.seed is not None:
                import torch
                torch.manual_seed(req.seed)
            wavs, sr = _VOICE_DESIGN.model.generate_voice_design(
                text=req.text.strip(), language=req.language, instruct=req.instruct.strip()
            )
        if not wavs:
            raise RuntimeError("模型未返回音频")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail={"error": f"{type(e).__name__}: {e}", "code": "voice_design_failed", "engine": "voice_design"})
    return Response(content=_float_to_wav_bytes(wavs[0], sr), media_type="audio/wav", headers={"X-Sample-Rate": str(sr)})


@app.post("/tts/voice-clone")
async def tts_voice_clone(
    file: UploadFile,
    text: str = Form(...),
    reference_text: str = Form(...),
    language: str = Form("Chinese"),
) -> Response:
    """用 Base checkpoint 的 ICL reference audio + transcript 生成一次克隆样音。"""
    _require_ready(_VOICE_CLONE)
    if language not in ("Chinese", "English", "Auto"):
        raise HTTPException(status_code=400, detail={"error": f"不支持的语言: {language}", "code": "unsupported_language", "engine": "voice_clone"})
    if not text.strip() or not reference_text.strip():
        raise HTTPException(status_code=400, detail={"error": "测试文本和参考文本不能为空", "code": "invalid_request", "engine": "voice_clone"})
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail={"error": "参考音频为空", "code": "invalid_request", "engine": "voice_clone"})
    try:
        import librosa
        speech, sample_rate = librosa.load(io.BytesIO(audio_bytes), sr=None, mono=True)
        if len(speech) == 0:
            raise ValueError("参考音频没有有效采样")
        with _VOICE_CLONE_INFER_LOCK:
            wavs, sr = _VOICE_CLONE.model.generate_voice_clone(
                text=text.strip(), language=language, ref_audio=(speech, sample_rate), ref_text=reference_text.strip()
            )
        if not wavs:
            raise RuntimeError("模型未返回音频")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail={"error": f"{type(e).__name__}: {e}", "code": "voice_clone_failed", "engine": "voice_clone"})
    return Response(content=_float_to_wav_bytes(wavs[0], sr), media_type="audio/wav", headers={"X-Sample-Rate": str(sr)})


# ---------------------------------------------------------------------------
# ASR
# ---------------------------------------------------------------------------


@app.post("/asr/whisper")
async def asr_whisper(file: UploadFile, language: str = Form("auto")) -> JSONResponse:
    _require_ready(_ASR)

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

        processor, model = _ASR.processor, _ASR.model
        device, dtype = _ASR.device, _ASR.dtype
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
# 目录 / 健康 / 预热
# ---------------------------------------------------------------------------


@app.get("/voices")
def voices() -> JSONResponse:
    # 不触发加载：未就绪如实 503（目录只有模型运行时才权威，硬性约束 #6）
    _require_ready(_TTS)
    return JSONResponse(
        {
            "checkpoint": _TTS.checkpoint,
            "speakers": _TTS.speakers,  # 官方精确 ID（下划线式，如 uncle_fu）
            "languages": _TTS.languages,
        }
    )


@app.get("/health")
def health() -> JSONResponse:
    # 永不触发加载：进程可达即 200，如实上报各引擎状态（available ≡ state == 'ready'）
    return JSONResponse(
        {
            "ok": True,
            "engines": {
                "qwen_tts": {**_snapshot(_TTS), "checkpoint": _TTS.checkpoint or TTS_CKPT},
                "voice_design": {**_snapshot(_VOICE_DESIGN), "checkpoint": _VOICE_DESIGN.checkpoint or VOICE_DESIGN_CKPT},
                "voice_clone": {**_snapshot(_VOICE_CLONE), "checkpoint": _VOICE_CLONE.checkpoint or VOICE_CLONE_CKPT},
                "whisper_asr": {**_snapshot(_ASR), "model": ASR_MODEL_ID},
            },
        }
    )


def _warmup_response(es: EngineState) -> JSONResponse:
    with es.lock:
        state_before = es.state
        last_error = es.error

    if state_before == "ready":
        return JSONResponse({"engine": es.id, "state": "ready", "retry": False})

    _request_load(es)  # cold → 启动加载；loading → 幂等 no-op；error → 触发重载

    if state_before == "error":
        # 上一次加载失败：503 + retry=true（后台已重新开始加载，客户端稍后重试/轮询）
        return JSONResponse(
            status_code=503,
            content={"engine": es.id, "state": "loading", "error": last_error, "retry": True},
        )
    return JSONResponse(status_code=202, content={"engine": es.id, "state": "loading", "retry": True})


@app.post("/warmup/qwen")
def warmup_qwen() -> JSONResponse:
    return _warmup_response(_TTS)


@app.post("/warmup/voice-design")
def warmup_voice_design() -> JSONResponse:
    return _warmup_response(_VOICE_DESIGN)


@app.post("/warmup/voice-clone")
def warmup_voice_clone() -> JSONResponse:
    return _warmup_response(_VOICE_CLONE)


@app.post("/warmup/whisper")
def warmup_whisper() -> JSONResponse:
    return _warmup_response(_ASR)
