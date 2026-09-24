import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, AudioLines, Check, CheckCircle2, ChevronDown, CircleHelp,
  Maximize2, Play, Plus, RotateCcw, Save, SlidersHorizontal, Sparkles,
  Volume2, X,
} from 'lucide-react';
import { VoiceWorkspaceSidebar } from './VoiceWorkspaceSidebar';
import './VoiceIdentityDesignView.css';

type Direction = { id: string; name: string; description: string; features: string[] };
type DesignDraft = {
  brief: string;
  reference: string;
  forbidden: string[];
  directions: Direction[];
  candidatesPerDirection: number;
  language: string;
  fixedSeed: boolean;
  seed: string;
};
type Identity = {
  id: string;
  name: string;
  ownerName: string;
  ownerType: string;
  source: string;
  language: string;
  form?: { roleName?: string; scenarios?: string[]; description?: string };
};
type Runtime = { supported: boolean; reachable: boolean; state: string; error: string | null };
type Batch = { id: string; label: string; status: 'queued' | 'warming' | 'running' | 'completed' | 'failed'; completedCount: number; totalCount: number; error?: string };

const STORAGE_KEY = 'voice-studio-design-drafts';
const ACTIVE_BATCH_KEY = 'voice-studio-design-active-batches';
const MODEL = 'Qwen3-TTS-12Hz-1.7B-VoiceDesign';
const DEFAULT_BRIEF = `一个三十五至四十二岁左右的中文男声，
普通话标准，中低音区，声线干净、温润、自然，
带有适度厚度，但不能过度低沉、沙哑或压迫。

表达方式像一位资深企业架构师，
正在向企业客户解释复杂的产品与技术概念。

理性、可信、耐心、克制，
语速中等偏慢，逻辑停顿明确，
重要概念只做轻度强调，
句尾自然下收，不拖音，不刻意制造悬念。

专业但不疏离，温和但不亲昵。`;
const DEFAULT_REFERENCE = `企业里的数据，从来不只是字段和表。

只有当对象、关系、规则与证据被持续连接，
人工智能才能真正理解业务，
并把可靠判断，转化为可以执行的行动。`;
const DEFAULT_DIRECTIONS: Direction[] = [
  { id: 'A', name: '企业架构师型', description: '更沉稳、理性、克制，突出专业可信与复杂概念解释能力。', features: ['中低音', '稳健', '逻辑清晰', '句尾克制'] },
  { id: 'B', name: '产品顾问型', description: '更自然、温和、平等，突出亲和力与长期讲解舒适度。', features: ['温和', '自然', '清晰', '亲和'] },
  { id: 'C', name: '高层简报型', description: '更简洁、坚定、利落，突出高信息密度与管理层汇报感。', features: ['稳健', '简洁', '坚定', '句尾利落'] },
];
const DEFAULT_DRAFT: DesignDraft = {
  brief: DEFAULT_BRIEF,
  reference: DEFAULT_REFERENCE,
  forbidden: ['新闻播音腔', '广告推销感', '纪录片旁白腔', '短视频营销语气', '故意压低嗓音', '气泡音', '耳语感', '过度磁性', '夸张抑扬顿挫', '句尾拖长'],
  directions: DEFAULT_DIRECTIONS,
  candidatesPerDirection: 4,
  language: '中文（普通话）',
  fixedSeed: false,
  seed: '20260924',
};

function readIdentity(id: string): Identity {
  try {
    const saved = JSON.parse(window.localStorage.getItem('voice-studio-identity-drafts') || '[]') as Identity[];
    const match = saved.find(item => item.id === id);
    if (match) return match;
    const selected = window.sessionStorage.getItem(`voice-studio-design-identity:${id}`);
    if (selected) return JSON.parse(selected) as Identity;
  } catch { /* use demo identity */ }
  if (id !== 'semovix') return {
    id, name: '未命名声音角色', ownerName: '待指定', ownerType: '待指定',
    source: 'AI 原创设计', language: '中文', form: { roleName: '未命名声音角色' },
  };
  return {
    id,
    name: 'Semovix 官方讲解员',
    ownerName: 'Semovix',
    ownerType: '品牌',
    source: 'AI 原创设计',
    language: '中文',
    form: { roleName: '官方讲解员', scenarios: ['产品介绍', '技术科普', '品牌传播'] },
  };
}

function readDraft(id: string, identity: Identity): DesignDraft {
  try {
    const all = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, DesignDraft>;
    if (all[id]) return { ...DEFAULT_DRAFT, ...all[id] };
  } catch { /* start with example draft */ }
  if (id === 'semovix') return DEFAULT_DRAFT;
  return {
    ...DEFAULT_DRAFT,
    brief: identity.form?.description || '',
    directions: [
      { id: 'A', name: '稳健专业型', description: '强调清晰表达、可信感与长期使用的一致性。', features: ['稳健', '清晰'] },
      { id: 'B', name: '自然亲和型', description: '强调自然语气与聆听舒适度。', features: ['自然', '亲和'] },
      { id: 'C', name: '简洁利落型', description: '强调节奏控制与关键信息表达。', features: ['简洁', '利落'] },
    ],
    language: identity.language === '英文' ? '英文' : identity.language === '中英双语' ? '中英双语' : '中文（普通话）',
  };
}

const countChinese = (text: string) => (text.match(/[\u3400-\u9fff]/g) || []).length;

export function VoiceIdentityDesignView({ id, onCenter, onOverview }: { id: string; onCenter: () => void; onOverview?: () => void }) {
  const [identity] = useState(() => readIdentity(id));
  const [draft, setDraft] = useState<DesignDraft>(() => readDraft(id, identity));
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [editingDirection, setEditingDirection] = useState<string | null>(null);
  const [addingStyle, setAddingStyle] = useState(false);
  const [styleInput, setStyleInput] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(true);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [volume, setVolume] = useState(80);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/voice-design/status').then(async response => {
      if (!response.ok) throw new Error('无法读取模型状态');
      return response.json() as Promise<Runtime>;
    }).then(value => { if (live) setRuntime(value); }).catch(() => { if (live) setRuntime({ supported: false, reachable: false, state: 'unavailable', error: '无法连接生成服务' }); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(ACTIVE_BATCH_KEY) || '{}') as Record<string, string>;
      const batchId = saved[id];
      if (!batchId) return;
      fetch(`/api/voice-design/batches/${encodeURIComponent(batchId)}`).then(response => response.ok ? response.json() as Promise<Batch> : null).then(value => { if (value) setBatch(value); }).catch(() => undefined);
    } catch { /* no saved batch */ }
  }, [id]);

  useEffect(() => {
    if (!batch || batch.status === 'completed' || batch.status === 'failed') return;
    const timer = window.setInterval(() => {
      fetch(`/api/voice-design/batches/${encodeURIComponent(batch.id)}`).then(response => response.ok ? response.json() as Promise<Batch> : null).then(value => { if (value) setBatch(value); }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [batch?.id, batch?.status]);

  const totalCandidates = draft.directions.length * draft.candidatesPerDirection;
  const roleName = identity.form?.roleName || identity.name.replace(`${identity.ownerName} `, '');
  const formReady = draft.brief.trim().length > 0 && draft.reference.trim().length > 0 && draft.directions.length >= 2 && draft.directions.every(direction => direction.name.trim() && direction.description.trim()) && draft.candidatesPerDirection > 0;
  const modelReady = runtime?.state === 'ready';
  const modelLabel = !runtime ? '检查中' : !runtime.reachable ? 'Worker 不可达' : !runtime.supported ? '待接入' : runtime.state === 'ready' ? '已就绪' : runtime.state === 'loading' ? '加载中' : runtime.state === 'error' ? '加载失败' : '待预热';
  const briefFeatures = useMemo(() => {
    if (draft.brief === DEFAULT_BRIEF) return ['中文男声', '三十五至四十二岁', '中低音', '专业可信', '中等偏慢', '句尾下收', '长听舒适'];
    const terms = ['中文男声', '中低音', '专业可信', '温和', '自然', '逻辑清晰', '语速偏慢', '句尾下收'].filter(term => draft.brief.includes(term));
    return terms.length ? terms : ['等待重新解析'];
  }, [draft.brief]);

  const update = <K extends keyof DesignDraft>(key: K, value: DesignDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setSaved(false);
    setMessage('');
  };
  const updateDirection = (directionId: string, patch: Partial<Direction>) => {
    update('directions', draft.directions.map(item => item.id === directionId ? { ...item, ...patch } : item));
  };
  const saveDraft = () => {
    try {
      const all = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, DesignDraft>;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all, [id]: draft }));
      setSaved(true);
      setMessage('声音设计草稿已保存');
    } catch {
      setMessage('草稿保存失败，请检查浏览器存储空间');
    }
  };
  const addForbidden = () => {
    const value = styleInput.trim();
    if (value && !draft.forbidden.includes(value)) update('forbidden', [...draft.forbidden, value]);
    setStyleInput('');
    setAddingStyle(false);
  };
  const addDirection = () => {
    if (draft.directions.length >= 4) { setMessage('建议最多保留 4 个设计方向。'); return; }
    const nextId = String.fromCharCode(65 + draft.directions.length);
    update('directions', [...draft.directions, { id: nextId, name: `方向 ${nextId}`, description: '', features: [] }]);
    setEditingDirection(nextId);
  };
  const confirmGeneration = async () => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/voice-design/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, identityId: id, identityName: identity.name }),
      });
      const result = await response.json() as Batch & { error?: string };
      if (!response.ok) throw new Error(result.error || '声音设计批次创建失败');
      saveDraft();
      setBatch(result);
      try {
        const saved = JSON.parse(window.localStorage.getItem(ACTIVE_BATCH_KEY) || '{}') as Record<string, string>;
        window.localStorage.setItem(ACTIVE_BATCH_KEY, JSON.stringify({ ...saved, [id]: result.id }));
      } catch { /* batch is already persisted on the server */ }
      setMessage(`${result.label} 已创建，候选生成任务正在准备。`);
      setConfirmOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '声音设计批次创建失败');
      setConfirmOpen(false);
    } finally { setSubmitting(false); }
  };

  return <div className="voice-design-page">
    <VoiceWorkspaceSidebar active="声音来源" name={identity.name} owner={identity.ownerName} source={identity.source} onOverview={onOverview || onCenter} onSource={() => undefined} />

    <main className="vd-workspace">
      <div className="vd-content">
        <div className="vd-topline"><button type="button" onClick={onCenter}><ArrowLeft size={14} />返回声音角色中心</button><span>声音角色 / {identity.name} / AI 原创声音设计</span></div>
        <header className="vd-header"><div><div className="vd-title-row"><h1>声音设计</h1><span className="vd-draft-badge">草稿</span></div><p>通过统一声音 Brief、参考文本和多方向设计，生成可进入匿名评审的候选声音。</p></div><div className="vd-header-actions"><button type="button" className="vd-secondary" onClick={saveDraft}><Save size={15} />保存草稿</button><button type="button" className="vd-primary" onClick={() => setConfirmOpen(true)} disabled={!formReady || Boolean(batch && !['completed', 'failed'].includes(batch.status))}><Sparkles size={16} />开始生成候选 · {totalCandidates} 条</button></div></header>
        <div className="vd-metadata"><span>归属对象：<b>{identity.ownerName}</b></span><span>角色：<b>{roleName}</b></span><span>语言：<b>{identity.language}</b></span><span>创建方式：<b>{identity.source}</b></span><span>设计批次：<b>{batch?.label || '尚未创建'}</b></span></div>
        <div className="vd-status-note"><CircleHelp size={15} /><span>{batch ? `${batch.label} 已记录本次配置，当前进度 ${batch.completedCount} / ${batch.totalCount} 条。` : '基础信息已保存，尚未生成候选声音。本批次配置将在启动生成时记录，供后续评审追溯。'}</span>{saved && <strong><Check size={13} />已保存</strong>}</div>
        {message && <div className="vd-feedback" role="status">{message}<button type="button" onClick={() => setMessage('')} aria-label="关闭提示"><X size={14} /></button></div>}
        {batch && <div className="vd-batch-progress" role="status"><strong>{batch.label}</strong><span>{batch.status === 'queued' ? '排队中' : batch.status === 'warming' ? '模型加载中' : batch.status === 'running' ? '候选生成中' : batch.status === 'completed' ? '候选生成完成' : '生成失败'}</span><span>{batch.completedCount} / {batch.totalCount} 条</span>{batch.error && <em>{batch.error}</em>}</div>}

        <div className="vd-columns">
          <div className="vd-left-column">
            <section className="vd-panel vd-brief"><div className="vd-panel-heading"><div><h2>声音 Brief</h2><p>描述“这个声音是谁、以什么方式表达”，而不是某一条具体旁白。</p></div><span>身份与表达</span></div><textarea aria-label="声音 Brief" maxLength={800} value={draft.brief} onChange={event => update('brief', event.target.value)} /><div className="vd-textarea-meta"><span>自然语言描述</span><span>{draft.brief.length} / 800</span></div><div className="vd-extracted"><div className="vd-extracted-heading"><strong>AI 已提取的关键特征</strong><button type="button" onClick={() => setMessage('已根据当前 Brief 更新关键特征。')}><RotateCcw size={13} />重新解析 Brief</button></div><div className="vd-chip-row">{briefFeatures.map(feature => <span key={feature}>{feature}</span>)}</div></div></section>

            <section className="vd-panel vd-reference"><div className="vd-panel-heading"><div><h2>统一参考文本</h2><p>所有设计方向使用同一段文本生成，保证候选之间可以公平比较。</p></div><span className="vd-good"><CheckCircle2 size={13} />适合候选对比</span></div><textarea aria-label="统一参考文本" value={draft.reference} onChange={event => update('reference', event.target.value)} /><div className="vd-reference-meta"><span>文本长度：<b>{countChinese(draft.reference)} 个汉字</b></span><span>预计音频：<b>约 15–20 秒</b></span><span>覆盖能力：<b>陈述句 · 并列概念 · 逻辑转折 · 品牌价值表达</b></span></div><div className="vd-inline-actions"><span><Check size={13} />参考文本长度适中，不存在复杂数字或高风险多音字。</span><div><button type="button" onClick={() => update('reference', DEFAULT_REFERENCE)}>使用推荐文本</button><button type="button" onClick={() => setMessage(draft.reference.trim() ? '参考文本检查通过，适合用于多方向候选对比。' : '请先填写统一参考文本。')}>检查文本</button></div></div></section>

            <section className="vd-panel vd-forbidden"><div className="vd-panel-heading"><div><h2>禁止风格</h2><p>明确排除不符合角色定位的声音特征。</p></div><span>{draft.forbidden.length} 项</span></div><div className="vd-forbidden-list">{draft.forbidden.map(style => <button type="button" key={style} title="移除此禁止风格" onClick={() => update('forbidden', draft.forbidden.filter(item => item !== style))}>{style}<X size={12} /></button>)}{addingStyle ? <span className="vd-style-entry"><input autoFocus value={styleInput} onChange={event => setStyleInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addForbidden(); if (event.key === 'Escape') setAddingStyle(false); }} placeholder="输入风格" /><button type="button" onClick={addForbidden}>添加</button></span> : <button type="button" className="vd-add-style" onClick={() => setAddingStyle(true)}><Plus size={13} />添加禁止风格</button>}</div></section>
          </div>

          <div className="vd-right-column">
            <section className="vd-panel vd-directions"><div className="vd-panel-heading"><div><h2>设计方向</h2><p>同一身份下建立少量差异化方向，避免候选同质化。</p></div><span>{draft.directions.length} 个方向</span></div><div className="vd-direction-list">{draft.directions.map((direction, index) => <article className={`vd-direction vd-direction--${index}`} key={direction.id}><div className="vd-direction-top"><span className="vd-direction-letter">{direction.id}</span><strong>{direction.name}</strong><button type="button" onClick={() => setEditingDirection(editingDirection === direction.id ? null : direction.id)}>{editingDirection === direction.id ? '完成' : '编辑'}</button></div>{editingDirection === direction.id ? <div className="vd-direction-editor"><input aria-label={`方向 ${direction.id} 名称`} value={direction.name} onChange={event => updateDirection(direction.id, { name: event.target.value })} /><textarea aria-label={`方向 ${direction.id} 描述`} value={direction.description} onChange={event => updateDirection(direction.id, { description: event.target.value })} /><input aria-label={`方向 ${direction.id} 关键特征`} value={direction.features.join('、')} onChange={event => updateDirection(direction.id, { features: event.target.value.split(/[、,，]/).map(x => x.trim()).filter(Boolean) })} placeholder="关键特征，以顿号分隔" /></div> : <><p>{direction.description || '请填写方向定位与差异。'}</p><div className="vd-direction-bottom"><div className="vd-chip-row">{direction.features.map(feature => <span key={feature}>{feature}</span>)}</div><span>计划候选 <b>{draft.candidatesPerDirection} 条</b></span></div></>}</article>)}</div><div className="vd-direction-footer"><button type="button" onClick={addDirection} disabled={draft.directions.length >= 4}><Plus size={14} />添加设计方向</button><span>建议保持 2–4 个方向</span></div></section>

            <section className="vd-panel vd-settings"><div className="vd-panel-heading"><div><h2>生成设置</h2><p>仅配置业务所需的候选生成选项。</p></div><SlidersHorizontal size={16} /></div><div className="vd-settings-grid"><span>声音设计模型</span><strong className="vd-model-name">{MODEL} <em className={modelReady ? '' : 'is-unready'}>{modelReady ? <Check size={12} /> : <CircleHelp size={12} />}{modelLabel}</em></strong><span>语言</span><select value={draft.language} onChange={event => update('language', event.target.value)}><option>中文（普通话）</option><option>英文</option><option>中英双语</option></select><span>每个方向候选数</span><select value={draft.candidatesPerDirection} onChange={event => update('candidatesPerDirection', Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value} 条</option>)}</select><span>设计方向数</span><strong>{draft.directions.length} 个</strong><span>总候选数</span><strong>{totalCandidates} 条</strong><span>随机种子</span><div className="vd-seed"><button type="button" className={!draft.fixedSeed ? 'is-selected' : ''} onClick={() => update('fixedSeed', false)}>自动生成</button><button type="button" className={draft.fixedSeed ? 'is-selected' : ''} onClick={() => update('fixedSeed', true)}>固定种子</button>{draft.fixedSeed && <input aria-label="固定随机种子" value={draft.seed} onChange={event => update('seed', event.target.value)} />}</div><span>输出格式</span><strong>WAV</strong><span>生成位置</span><strong>本地 Worker</strong></div><p className="vd-settings-note">候选生成耗时取决于本地设备性能。生成完成后将进入匿名候选评审。</p><button type="button" className="vd-advanced" onClick={() => setAdvancedOpen(value => !value)}>高级设置 <ChevronDown size={13} className={advancedOpen ? 'is-open' : ''} /></button>{advancedOpen && <div className="vd-advanced-note">高级推理参数由模型配置统一管理，本页保留业务级设置。</div>}</section>

            <section className="vd-panel vd-checks"><div className="vd-panel-heading"><div><h2>生成准备检查</h2><p>确认当前设计具备创建候选批次的条件。</p></div><span className={formReady && modelReady ? 'vd-good' : 'vd-warn'}>{formReady && modelReady ? '可以开始生成' : formReady && runtime?.supported ? '可启动，待预热' : '待完善'}</span></div><div className="vd-check-list">{[['角色基础信息', '已完成', true], ['声音 Brief', draft.brief.trim() ? '已完成' : '待填写', !!draft.brief.trim()], ['统一参考文本', draft.reference.trim() ? '已通过' : '待填写', !!draft.reference.trim()], ['设计方向', `${draft.directions.length} 个`, draft.directions.length >= 2], ['VoiceDesign 模型', modelLabel, modelReady], ['候选输出位置', '已配置', true], ['预计候选数量', `${totalCandidates} 条`, totalCandidates > 0]].map(([label, value, passed]) => <div key={String(label)}><span>{passed ? <Check size={13} /> : <CircleHelp size={13} />}{label}</span><b className={passed ? '' : 'is-pending'}>{value}</b></div>)}</div><div className="vd-check-note"><CircleHelp size={14} /><span>生成开始后，本批次的 Brief、参考文本和方向配置将被记录，用于候选追溯与后续评审。</span></div></section>
          </div>
        </div>
      </div>
    </main>

    {playerOpen && <div className="vd-player" role="region" aria-label="全局音频播放器"><div className="vd-player-identity"><div className="vd-player-mark"><AudioLines size={18} /></div><div><strong>{identity.name}</strong><span>声音设计草稿 · 尚未生成候选声音</span></div></div><div className="vd-player-controls"><button type="button" disabled aria-label="暂无音频可播放"><Play size={16} fill="currentColor" /></button><span>0:00</span><input type="range" value="0" min="0" max="100" disabled aria-label="播放进度" /><span>--:--</span></div><div className="vd-player-tail"><Volume2 size={17} /><input type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))} aria-label="音量" /><button type="button" title="展开播放器" aria-label="展开播放器" onClick={() => setPlayerExpanded(value => !value)}><Maximize2 size={16} /></button><button type="button" title="关闭播放器" aria-label="关闭播放器" onClick={() => setPlayerOpen(false)}><X size={17} /></button></div>{playerExpanded && <div className="vd-player-expanded">尚未生成候选声音，当前没有可试听音频。</div>}</div>}

    {confirmOpen && <div className="vd-overlay" onMouseDown={() => setConfirmOpen(false)}><div className="vd-dialog" role="dialog" aria-modal="true" aria-labelledby="vd-confirm-title" onMouseDown={event => event.stopPropagation()}><div className="vd-dialog-head"><div><h2 id="vd-confirm-title">开始生成候选声音</h2><p>确认后将创建新的声音设计批次并保存本次配置快照。</p></div><button type="button" onClick={() => setConfirmOpen(false)} aria-label="关闭"><X size={18} /></button></div><dl><div><dt>声音角色</dt><dd>{identity.name}</dd></div><div><dt>设计方向</dt><dd>{draft.directions.length} 个</dd></div><div><dt>候选总数</dt><dd>{totalCandidates} 条</dd></div><div><dt>模型</dt><dd>{MODEL}</dd></div><div><dt>参考文本</dt><dd>{draft.reference.replace(/\s+/g, ' ').slice(0, 64)}…</dd></div><div><dt>批次</dt><dd>创建新批次</dd></div></dl>{!modelReady && <div className="vd-dialog-note"><CircleHelp size={14} />模型当前状态：{modelLabel}。确认后将先预热；首次使用可能需要获取模型权重并等待较长时间。</div>}<div className="vd-dialog-actions"><button type="button" onClick={() => setConfirmOpen(false)}>取消</button><button type="button" onClick={confirmGeneration} disabled={submitting}>{submitting ? '正在创建…' : '确认创建并生成'}</button></div></div></div>}
  </div>;
}
