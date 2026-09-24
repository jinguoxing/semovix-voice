/**
 * 本地端到端冒烟（P01 六：最终验收）
 *
 * 前置：Node 服务已启动（默认 http://127.0.0.1:3210，SMOKE_API_URL 覆盖）、
 *       worker/「启动Worker.command」已启动（端口 8800，SEMOVIX_TTS_CKPT 指向本地权重）。
 *
 * 全程走真实引擎与真实落盘，任何一步失败都以非零退出码如实失败（不伪造成功）：
 *   1. worker 健康检查（qwen 引擎可达）
 *   2. 预热 qwen_tts → 轮询至 ready
 *   3. uncle_fu 合成固定口号 → RIFF/WAV 字节校验
 *   4. 存入素材库（multipart）→ 重读校验（字节一致 + sha256 完整性）
 *   5. 预热 whisper_asr → 用合成音频转录，文本必须非空
 *   6. generations 台账核验（status=done、voice=uncle_fu、原文留痕）
 *   7. 清理冒烟素材
 */
const API = process.env.SMOKE_API_URL || 'http://127.0.0.1:3210';
const SMOKE_TEXT = '赛慕维，让企业人工智能从能回答走向能执行。';
const ITEM_ID = `smoke-${Date.now().toString(36)}`;

function step(n: number, total: number, label: string): void {
  console.log(`\n[${n}/${total}] ${label}`);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`冒烟失败: ${message}`);
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === 'object' && body ? ` ${body.code || ''} ${body.error || ''}` : ` ${String(text).slice(0, 200)}`;
    throw new Error(`冒烟失败: ${path} → HTTP ${res.status}${detail}`);
  }
  return body;
}

/** 轮询 /api/voice-model/status 直到目标引擎 ready（大模型首次加载较慢，宽限 6 分钟） */
async function waitEngineReady(engineId: string, label: string): Promise<void> {
  const deadline = Date.now() + 360_000;
  let last = 'unknown';
  while (Date.now() < deadline) {
    const status = await api('/api/voice-model/status');
    const engine = (status.engines as any[]).find((e: any) => e.id === engineId);
    assert(engine, `状态接口未上报引擎 ${engineId}`);
    last = `${engine.state}${engine.error ? `（${engine.error}）` : ''}`;
    if (engine.state === 'ready') {
      console.log(`  ${label} ready`);
      return;
    }
    if (engine.state === 'error') {
      throw new Error(`冒烟失败: ${label} 加载失败 ${engine.error}`);
    }
    process.stdout.write(`  ${label} ${engine.state}…\r`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`冒烟失败: 等待 ${label} 就绪超时（最后状态 ${last}）`);
}

async function main(): Promise<void> {
  const total = 7;
  console.log(`Semovix Voice Studio 本地冒烟 → ${API}`);

  step(1, total, 'Worker 健康检查');
  const status = await api('/api/voice-model/status');
  const qwenEngine = (status.engines as any[]).find((e: any) => e.id === 'qwen3-tts-local');
  assert(qwenEngine?.reachable, 'Worker 不可达：请先启动 worker/「启动Worker.command」');
  console.log(`  qwen_tts=${qwenEngine.state} whisper_asr=${(status.engines as any[]).find((e: any) => e.id === 'whisper-local')?.state}`);

  step(2, total, '预热 Qwen3-TTS（uncle_fu）');
  const warm = await api('/api/engines/qwen_tts/warmup', { method: 'POST' });
  console.log(`  warmup → ${warm.state}`);
  await waitEngineReady('qwen3-tts-local', 'qwen_tts');

  step(3, total, '真实合成（qwen3-tts-local / uncle_fu）');
  const gen = await api('/api/generate-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: SMOKE_TEXT, voiceName: 'uncle_fu', ttsModel: 'qwen3-tts-local' }),
  });
  assert(gen.success === true, 'generate-speech 未返回 success');
  assert(gen.voiceName === 'uncle_fu', `voiceName 应为 uncle_fu，实际 ${gen.voiceName}`);
  const wav = Buffer.from(await (await fetch(`${API}${gen.audioUrl}`)).arrayBuffer());
  assert(wav.length > 44, `音频过小（${wav.length}B）`);
  assert(wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE', '输出不是 RIFF/WAV（约束 #2：不得以占位音频冒充）');
  console.log(`  ${gen.generationId}: ${wav.length}B WAV @${gen.sampleRate}Hz ${gen.duration}s`);

  step(4, total, '素材库往返（multipart 落盘 → 重读一致性）');
  const form = new FormData();
  form.append('item', JSON.stringify({
    id: ITEM_ID,
    title: `[冒烟] ${SMOKE_TEXT.slice(0, 12)}…`,
    category: 'speech',
    format: 'wav',
    tags: ['smoke'],
    createdAt: new Date().toISOString(),
  }));
  form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'smoke.wav');
  const saved = await api('/api/library/items', { method: 'POST', body: form });
  assert(saved.item?.id === ITEM_ID, '素材保存未返回 id');
  assert(typeof saved.item?.sha256 === 'string' && saved.item.sha256.length === 64, '素材缺少 sha256 完整性元数据');

  const reread = Buffer.from(await (await fetch(`${API}/api/library/file/${ITEM_ID}`)).arrayBuffer());
  assert(reread.equals(wav), '重读字节与合成输出不一致');
  const item = await api(`/api/library/items`);
  assert(item.items.some((i: any) => i.id === ITEM_ID && i.sha256 === saved.item.sha256), '素材列表中未见冒烟素材');
  console.log(`  ${ITEM_ID}: ${reread.length}B 往返一致 sha256=${saved.item.sha256.slice(0, 12)}…`);

  step(5, total, '预热 Whisper → 转录合成音频');
  await api('/api/engines/whisper_asr/warmup', { method: 'POST' });
  await waitEngineReady('whisper-local', 'whisper_asr');
  const asrForm = new FormData();
  asrForm.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'smoke.wav');
  asrForm.append('transcribeModel', 'whisper-local');
  asrForm.append('language', 'zh');
  const asr = await api('/api/transcribe-audio', { method: 'POST', body: asrForm });
  assert(asr.success === true && typeof asr.transcript === 'string' && asr.transcript.trim().length > 0, '转录文本为空（约束 #3：不得写入模拟转录）');
  console.log(`  转录(${asr.duration}s): ${String(asr.transcript).slice(0, 40)}`);

  step(6, total, 'generations 台账核验');
  const ledger = await api('/api/generations?limit=50');
  const row = (ledger.generations as any[]).find((g: any) => g.id === gen.generationId);
  assert(row, `台账未见 ${gen.generationId}`);
  assert(row.status === 'done', `台账 status=${row.status}`);
  assert(row.engine === 'qwen3-tts-local' && row.voice === 'uncle_fu', `台账 engine/voice 异常: ${row.engine}/${row.voice}`);
  assert(String(row.input_text || '').includes('赛慕维'), '台账未留痕原文');
  assert(row.output_file, '台账缺少 output_file');
  console.log(`  ${row.id}: done / ${row.output_file} / ${String(row.input_text).slice(0, 18)}…`);

  step(7, total, '清理冒烟素材');
  await api(`/api/library/items/${ITEM_ID}`, { method: 'DELETE' });
  console.log(`  已删除 ${ITEM_ID}`);

  console.log('\nSMOKE PASS:\n- qwen_tts\n- library_roundtrip\n- whisper_asr\n- generation_ledger');
}

main().catch(err => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  console.error('SMOKE FAIL（见上方第一个失败步骤；不做任何降级或伪造）');
  process.exit(1);
});
