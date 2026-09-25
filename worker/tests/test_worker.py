# -*- coding: utf-8 -*-
"""
Worker API 单元测试（P01 六：测试与 CI）

通过替换 worker.app._BUILDERS 注入伪模型——不下载任何真实权重，
覆盖引擎冷启动状态机与推理端点契约：

  - GET  /health       冷态永不触发加载（loadAttempts 恒 0）
  - POST /warmup/qwen  cold → 202 loading；loading 期间重复 warmup 幂等（不重复加载）；
                       ready → 200；error → 503 + retry 且自动重载
  - GET  /voices       未就绪如实 503 engine_not_ready
  - POST /tts/qwen     ready 后输出合法 RIFF/WAV；非官方 speaker 400；不支持语言 400
  - POST /asr/whisper  返回转录文本；空音频 400；不支持语言 400；长音频请求时间戳

torch / librosa 以轻量伪模块注入 sys.modules：这里测的是端点契约，
不依赖（也不下载）真实推理栈，CI 只需 requirements-base。
"""
import contextlib
import io
import sys
import threading
import time
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as worker  # noqa: E402

OFFICIAL_SPEAKERS = ["aiden", "dylan", "eric", "ono_anna", "ryan", "serena", "sohee", "uncle_fu", "vivian"]
SMOKE_TEXT = "赛慕维，让企业人工智能从能回答走向能执行。"

client = TestClient(worker.app)


# ---------------- 伪模型（_BUILDERS 注入） ----------------


class FakeTtsModel:
    """generate_custom_voice 记录入参并返回 0.5s 24kHz 正弦波"""

    def __init__(self):
        self.calls: list[dict] = []

    def generate_custom_voice(self, text, language, speaker, instruct):
        self.calls.append({"text": text, "language": language, "speaker": speaker, "instruct": instruct})
        samples = np.arange(12000, dtype=np.float32)
        return [np.sin(samples * 0.05) * 0.5], 24000


class FakeVoiceDesignModel:
    def __init__(self):
        self.calls: list[dict] = []

    def generate_voice_design(self, text, language, instruct):
        self.calls.append({"text": text, "language": language, "instruct": instruct})
        return [np.zeros(2400, dtype=np.float32)], 24000


class FakeVoiceCloneModel:
    def __init__(self):
        self.calls: list[dict] = []

    def generate_voice_clone(self, text, language, ref_audio, ref_text):
        self.calls.append({"text": text, "language": language, "ref_audio_rate": ref_audio[1], "ref_text": ref_text})
        return [np.zeros(2400, dtype=np.float32)], 24000


class FakeAsrProcessor:
    def __init__(self):
        self.speech_len = -1

    def __call__(self, speech, sampling_rate, return_tensors):
        assert sampling_rate == 16000
        self.speech_len = len(speech)
        return SimpleNamespace(input_features=SimpleNamespace(to=lambda device, dtype: "fake-features"))

    def batch_decode(self, predicted_ids, skip_special_tokens):
        assert skip_special_tokens is True
        return [" " + SMOKE_TEXT + " "]  # 两端带空格：验证服务端 strip


class FakeAsrModel:
    def __init__(self):
        self.calls: list[dict] = []

    def generate(self, input_features, **kwargs):
        assert input_features == "fake-features"
        self.calls.append(kwargs)
        return "fake-ids"


class FakeTorchModule:
    """ASR 端点只用到 no_grad 上下文"""

    @staticmethod
    def no_grad():
        return contextlib.nullcontext()


class FakeLibrosaModule:
    """librosa.load 伪实现：返回可配置时长的 16kHz 单声道"""

    duration_s = 1.0

    @staticmethod
    def load(buf, sr, mono):
        assert mono is True
        if sr is None:
            return np.zeros(24000, dtype=np.float32), 24000
        assert sr == 16000
        return np.zeros(int(16000 * FakeLibrosaModule.duration_s), dtype=np.float32), 16000


def tts_payload() -> dict:
    return {
        "model": FakeTtsModel(),
        "speakers": list(OFFICIAL_SPEAKERS),
        "languages": ["Auto", "Chinese", "English"],
        "device": "cpu",
        "checkpoint": "fake-ckpt",
    }


def asr_payload() -> dict:
    return {"model": FakeAsrModel(), "processor": FakeAsrProcessor(), "device": "cpu", "dtype": "float32"}


def test_voice_design_uses_its_own_model_and_outputs_wav(monkeypatch):
    design = worker.EngineState(id="voice_design")
    model = FakeVoiceDesignModel()
    monkeypatch.setattr(worker, "_VOICE_DESIGN", design)
    monkeypatch.setitem(worker._BUILDERS, "voice_design", lambda: {"model": model, "device": "cpu", "checkpoint": "fake-voice-design"})

    request = {"text": "统一参考文本", "instruct": "专业可信、自然克制", "language": "Chinese"}
    cold = client.post("/tts/voice-design", json=request)
    assert cold.status_code == 503
    assert cold.json()["detail"]["engine"] == "voice_design"

    warmup = client.post("/warmup/voice-design")
    assert warmup.status_code == 202
    wait_for_state(design, "ready")
    result = client.post("/tts/voice-design", json=request)
    assert result.status_code == 200
    assert result.content[:4] == b"RIFF"
    assert model.calls == [request]
    assert client.get("/health").json()["engines"]["voice_design"]["state"] == "ready"


def test_voice_clone_uses_base_engine_and_requires_reference_audio(monkeypatch):
    clone = worker.EngineState(id="voice_clone")
    model = FakeVoiceCloneModel()
    monkeypatch.setattr(worker, "_VOICE_CLONE", clone)
    monkeypatch.setitem(worker._BUILDERS, "voice_clone", lambda: {"model": model, "device": "cpu", "checkpoint": "fake-base"})
    monkeypatch.setitem(sys.modules, "librosa", FakeLibrosaModule)

    cold = client.post("/tts/voice-clone", files=wav_form(), data={"text": "测试文本", "reference_text": "参考文本", "language": "Chinese"})
    assert cold.status_code == 503
    assert cold.json()["detail"]["engine"] == "voice_clone"

    assert client.post("/warmup/voice-clone").status_code == 202
    wait_for_state(clone, "ready")
    result = client.post("/tts/voice-clone", files=wav_form(), data={"text": "测试文本", "reference_text": "参考文本", "language": "Chinese"})
    assert result.status_code == 200
    assert result.content[:4] == b"RIFF"
    assert model.calls == [{"text": "测试文本", "language": "Chinese", "ref_audio_rate": 24000, "ref_text": "参考文本"}]


class GatedBuilder:
    """release() 前一直停在 loading，用于断言 loading 期间的幂等性"""

    def __init__(self):
        self._gate = threading.Event()
        self.calls = 0

    def __call__(self):
        self.calls += 1
        assert self._gate.wait(timeout=10), "测试未调用 release()"
        return tts_payload()

    def release(self):
        self._gate.set()


# ---------------- 夹具与工具 ----------------


@pytest.fixture()
def engines(monkeypatch):
    """每个用例全新的 EngineState（monkeypatch 自动还原全局引用，后台线程绝不跨用例泄漏状态）"""
    tts = worker.EngineState(id="qwen_tts")
    asr = worker.EngineState(id="whisper_asr")
    monkeypatch.setattr(worker, "_TTS", tts)
    monkeypatch.setattr(worker, "_ASR", asr)
    return SimpleNamespace(tts=tts, asr=asr)


def wait_for_state(es: worker.EngineState, state: str, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if es.state == state:
            return
        time.sleep(0.01)
    raise AssertionError(f"{es.id} 未在 {timeout}s 内进入 {state}（当前 {es.state}: {es.error}）")


def warmup_until_ready(monkeypatch, engines, engine: str = "qwen_tts") -> dict:
    payload = tts_payload() if engine == "qwen_tts" else asr_payload()
    monkeypatch.setitem(worker._BUILDERS, engine, lambda: payload)
    r = client.post(f"/warmup/{worker._WARMUP_PATH[engine]}")
    assert r.status_code == 202
    es = engines.tts if engine == "qwen_tts" else engines.asr
    wait_for_state(es, "ready")
    return payload


def wav_form() -> dict:
    """任意非空 WAV 字节即可（ASR 处理栈已被伪模块替换）"""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 160)
    return {"file": ("a.wav", buf.getvalue(), "audio/wav")}


# ---------------- 状态机 ----------------


class TestEngineStateMachine:
    def test_health_cold_never_loads(self, engines, monkeypatch):
        def must_not_load():
            raise AssertionError("健康检查绝不能触发模型加载")

        monkeypatch.setitem(worker._BUILDERS, "qwen_tts", must_not_load)
        monkeypatch.setitem(worker._BUILDERS, "whisper_asr", must_not_load)

        r = client.get("/health")
        assert r.status_code == 200
        engines_json = r.json()["engines"]
        for engine_id in ("qwen_tts", "whisper_asr"):
            snap = engines_json[engine_id]
            assert snap["state"] == "cold"
            assert snap["available"] is False
            assert snap["loadAttempts"] == 0

        # 目录端点同样不触发加载：未就绪如实 503
        r2 = client.get("/voices")
        assert r2.status_code == 503
        assert r2.json()["detail"]["code"] == "engine_not_ready"
        assert engines.tts.state == "cold"

    def test_warmup_cold_returns_202_and_no_duplicate_load(self, engines, monkeypatch):
        gate = GatedBuilder()
        monkeypatch.setitem(worker._BUILDERS, "qwen_tts", gate)

        r = client.post("/warmup/qwen")
        assert r.status_code == 202
        assert r.json() == {"engine": "qwen_tts", "state": "loading", "retry": True}
        assert engines.tts.state == "loading"
        assert engines.tts.load_attempts == 1

        # loading 期间反复 warmup：幂等，绝不重复加载
        for _ in range(3):
            assert client.post("/warmup/qwen").status_code == 202
        assert engines.tts.load_attempts == 1
        assert gate.calls == 1

        gate.release()
        wait_for_state(engines.tts, "ready")
        assert engines.tts.load_attempts == 1

    def test_warmup_ready_returns_200(self, engines, monkeypatch):
        monkeypatch.setitem(worker._BUILDERS, "qwen_tts", lambda: tts_payload())
        assert client.post("/warmup/qwen").status_code == 202
        wait_for_state(engines.tts, "ready")

        r = client.post("/warmup/qwen")
        assert r.status_code == 200
        assert r.json() == {"engine": "qwen_tts", "state": "ready", "retry": False}
        assert engines.tts.load_attempts == 1  # ready 后 warmup 不再加载

        snap = client.get("/health").json()["engines"]["qwen_tts"]
        assert snap["available"] is True
        assert snap["error"] is None

    def test_error_state_surfaces_real_cause(self, engines, monkeypatch):
        def boom():
            raise RuntimeError("checkpoint 目录不存在")

        monkeypatch.setitem(worker._BUILDERS, "qwen_tts", boom)
        client.post("/warmup/qwen")
        wait_for_state(engines.tts, "error")

        snap = client.get("/health").json()["engines"]["qwen_tts"]
        assert snap["state"] == "error"
        assert snap["available"] is False
        assert "RuntimeError" in snap["error"]
        assert "checkpoint 目录不存在" in snap["error"]

        # 未就绪端点如实 503，错误信息带真实原因（不伪造成功）
        r = client.post("/tts/qwen", json={"text": SMOKE_TEXT, "speaker": "uncle_fu"})
        assert r.status_code == 503
        detail = r.json()["detail"]
        assert detail["code"] == "engine_not_ready"
        assert detail["state"] == "error"
        assert "checkpoint 目录不存在" in detail["error"]

    def test_error_warmup_retries_load(self, engines, monkeypatch):
        remaining = {"failures": 1}

        def flaky():
            if remaining["failures"]:
                remaining["failures"] -= 1
                raise OSError("显存不足")
            return tts_payload()

        monkeypatch.setitem(worker._BUILDERS, "qwen_tts", flaky)
        client.post("/warmup/qwen")
        wait_for_state(engines.tts, "error")

        # error → warmup：503 + retry:true，且后台已自动重新加载
        r = client.post("/warmup/qwen")
        assert r.status_code == 503
        body = r.json()
        assert body["state"] == "loading"
        assert body["retry"] is True
        assert "显存不足" in body["error"]
        assert engines.tts.load_attempts == 2

        wait_for_state(engines.tts, "ready")
        assert remaining["failures"] == 0


# ---------------- TTS 端点 ----------------


class TestTtsEndpoint:
    def test_returns_valid_riiff_wav(self, engines, monkeypatch):
        payload = warmup_until_ready(monkeypatch, engines)
        model = payload["model"]

        r = client.post("/tts/qwen", json={"text": SMOKE_TEXT, "speaker": "uncle_fu"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("audio/wav")
        assert r.headers["x-sample-rate"] == "24000"

        raw = r.content
        assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE"  # 真实 WAV 字节，不是占位数据
        with wave.open(io.BytesIO(raw)) as w:
            assert w.getnchannels() == 1
            assert w.getsampwidth() == 2  # 16-bit PCM
            assert w.getframerate() == 24000
            assert w.getnframes() == 12000  # 0.5s

        # 请求参数如实传给模型（speaker 精确 ID 原样到达）
        assert model.calls == [
            {"text": SMOKE_TEXT, "language": "Auto", "speaker": "uncle_fu", "instruct": None}
        ]

    def test_rejects_non_official_speaker(self, engines, monkeypatch):
        payload = warmup_until_ready(monkeypatch, engines)
        # 硬性约束 #5/#6：Google Voice ID、展示名、错误大小写一律拒绝
        for bad in ("Kore", "Uncle Fu", "Uncle_Fu", "陈叔叔"):
            r = client.post("/tts/qwen", json={"text": SMOKE_TEXT, "speaker": bad})
            assert r.status_code == 400, bad
            detail = r.json()["detail"]
            assert detail["code"] == "unsupported_speaker"
            assert detail["speakers"] == OFFICIAL_SPEAKERS
        assert payload["model"].calls == []  # 校验先于推理

    def test_rejects_unsupported_language(self, engines, monkeypatch):
        warmup_until_ready(monkeypatch, engines)
        r = client.post("/tts/qwen", json={"text": SMOKE_TEXT, "speaker": "uncle_fu", "language": "French"})
        assert r.status_code == 400
        detail = r.json()["detail"]
        assert detail["code"] == "unsupported_language"
        assert detail["languages"] == ["Auto", "Chinese", "English"]

    def test_normalizes_language_to_runtime_catalog_casing(self, engines, monkeypatch):
        payload = warmup_until_ready(monkeypatch, engines)
        engines.tts.languages = ["auto", "chinese", "english"]
        r = client.post("/tts/qwen", json={"text": SMOKE_TEXT, "speaker": "uncle_fu", "language": "Chinese"})
        assert r.status_code == 200
        assert payload["model"].calls[-1]["language"] == "chinese"


# ---------------- ASR 端点 ----------------


class TestAsrEndpoint:
    @pytest.fixture(autouse=True)
    def _fake_inference_stack(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "torch", FakeTorchModule)
        monkeypatch.setitem(sys.modules, "librosa", FakeLibrosaModule)
        monkeypatch.setattr(FakeLibrosaModule, "duration_s", 1.0)

    def test_returns_transcript(self, engines, monkeypatch):
        payload = warmup_until_ready(monkeypatch, engines, engine="whisper_asr")

        r = client.post("/asr/whisper", files=wav_form(), data={"language": "zh"})
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["transcript"] == SMOKE_TEXT  # 服务端已 strip
        assert body["language"] == "zh"
        assert body["duration"] == 1.0
        # 推理参数如实传递：指定语言、短音频不加时间戳
        assert payload["model"].calls == [{"task": "transcribe", "language": "zh"}]
        assert payload["processor"].speech_len == 16000

    def test_long_audio_requests_timestamps(self, engines, monkeypatch):
        monkeypatch.setattr(FakeLibrosaModule, "duration_s", 31.0)
        payload = warmup_until_ready(monkeypatch, engines, engine="whisper_asr")

        r = client.post("/asr/whisper", files=wav_form(), data={"language": "auto"})
        assert r.status_code == 200
        assert payload["model"].calls[0] == {"task": "transcribe", "return_timestamps": True}

    def test_empty_audio_rejected(self, engines, monkeypatch):
        warmup_until_ready(monkeypatch, engines, engine="whisper_asr")
        r = client.post("/asr/whisper", files={"file": ("a.wav", b"", "audio/wav")}, data={"language": "auto"})
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "invalid_request"

    def test_unsupported_language_rejected(self, engines, monkeypatch):
        warmup_until_ready(monkeypatch, engines, engine="whisper_asr")
        r = client.post("/asr/whisper", files=wav_form(), data={"language": "fr"})
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "unsupported_language"

    def test_not_ready_returns_503(self, engines):
        r = client.post("/asr/whisper", files=wav_form(), data={"language": "auto"})
        assert r.status_code == 503
        assert r.json()["detail"]["code"] == "engine_not_ready"
