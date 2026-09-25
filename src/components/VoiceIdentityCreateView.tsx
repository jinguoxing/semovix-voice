import React, { useEffect, useState } from 'react';
import { AudioLines, Check, ChevronRight, CircleHelp, FileInput, Headphones, Maximize2, Play, Save, UserRound, Volume2, X } from 'lucide-react';
import { VoiceWorkspaceSidebar } from './VoiceWorkspaceSidebar';
import './VoiceIdentityCreateView.css';

export type VoiceSource = 'AI 原创设计' | '授权真人克隆' | 'Provider 预置音色' | '导入已有 Voice Profile';
type Visibility = '仅自己可见' | '团队内可见' | '组织内可见';
type FormState = {
  ownerType: string;
  owner: string;
  roleName: string;
  language: string;
  description: string;
  visibility: Visibility;
};
type SavedDraft = { id: string; name: string; source: string; form?: Partial<FormState>; createdAt?: string };

const DEFAULT_FORM: FormState = {
  ownerType: '品牌', owner: 'Semovix', roleName: '', language: '中文（普通话）',
  description: '用于产品介绍、技术讲解和品牌传播的正式声音角色。', visibility: '团队内可见',
};
const METHODS: { id: VoiceSource; icon: typeof AudioLines; description: string; badge: string; audience: string; kind: string }[] = [
  { id: 'AI 原创设计', icon: AudioLines, description: '通过自然语言描述声音风格，由模型生成多个候选并进入匿名评审。', badge: '推荐', audience: '适合品牌 / 产品 / 栏目', kind: 'ai' },
  { id: '授权真人克隆', icon: UserRound, description: '使用已获得明确授权的真人录音，构建可复用声音版本。', badge: '需授权', audience: '适合讲师 / 主持人 / 代言人', kind: 'clone' },
  { id: 'Provider 预置音色', icon: Headphones, description: '选择模型或 Provider 提供的预置声音，快速创建轻量级声音角色。', badge: '快速', audience: '适合 Demo / 临时内容', kind: 'preset' },
  { id: '导入已有 Voice Profile', icon: FileInput, description: '导入已有参考音频、文本和 Profile 资产，完成兼容性检查。', badge: '迁移', audience: '适合已有声音资产', kind: 'import' },
];
const NEXT: Record<VoiceSource, string[]> = {
  'AI 原创设计': ['声音来源｜AI 原创设计', '填写声音 Brief', '编辑统一参考文本', '配置设计方向', '生成候选并进入匿名评审'],
  '授权真人克隆': ['声音来源｜授权与声音样本', '确认授权范围', '准备真人参考录音', '建立克隆声音版本', '进入验证与发布'],
  'Provider 预置音色': ['声音来源｜预置音色选择', '浏览 Provider 音色目录', '试听并确定适用音色', '核对使用许可', '进入验证与发布'],
  '导入已有 Voice Profile': ['声音来源｜导入与兼容性校验', '整理已有 Profile 资产', '导入参考音频与文本', '检查兼容性与使用范围', '进入验证与发布'],
};

function readSavedDrafts(): SavedDraft[] {
  try { const value = JSON.parse(window.localStorage.getItem('voice-studio-identity-drafts') || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function currentSavedDraft(): SavedDraft | undefined {
  const id = new URLSearchParams(window.location.search).get('draft');
  return id ? readSavedDrafts().find(item => item.id === id) : undefined;
}
function requestedDraftId() { return new URLSearchParams(window.location.search).get('draft') || undefined; }
function normalizeSource(value?: string): VoiceSource {
  if (value === '预置音色') return 'Provider 预置音色';
  return METHODS.find(item => item.id === value)?.id || 'AI 原创设计';
}
function formatCreatedAt(value?: string) {
  if (!value) return '今天 09:20';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '今天 09:20' : '今天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function VoiceIdentityCreateView({ onCancel, onContinue }: { onCancel: () => void; onContinue?: (id: string, source: VoiceSource) => void }) {
  const [savedDraft] = useState(currentSavedDraft);
  const [source, setSource] = useState<VoiceSource>(() => normalizeSource(savedDraft?.source));
  const [form, setForm] = useState<FormState>(() => ({ ...DEFAULT_FORM, ...savedDraft?.form }));
  const [draftId, setDraftId] = useState<string | null>(savedDraft?.id || requestedDraftId() || null);
  const [saved, setSaved] = useState(Boolean(savedDraft));
  const [createdAt, setCreatedAt] = useState(savedDraft?.createdAt);
  const [feedback, setFeedback] = useState('');
  const [playerOpen, setPlayerOpen] = useState(true);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [volume, setVolume] = useState(80);
  const missing = [!form.roleName.trim() ? '角色名称' : '', !form.owner.trim() ? '归属对象' : '', !form.language ? '主要语言' : '', !source ? '创建方式' : ''].filter(Boolean);

  useEffect(() => {
    if (!draftId?.startsWith('voice-')) return;
    let live = true;
    fetch(`/api/voice-identities/${encodeURIComponent(draftId)}`)
      .then(response => response.ok ? response.json() as Promise<{ identity: { name: string; ownerType: string; ownerName: string; source: string; language: string; description: string; visibility: Visibility; createdAt: string } }> : null)
      .then(result => {
        if (!live || !result?.identity) return;
        const identity = result.identity;
        setSource(normalizeSource(identity.source));
        setForm({
          ownerType: identity.ownerType, owner: identity.ownerName,
          roleName: identity.name === '未命名声音角色' ? '' : identity.name,
          language: identity.language === '中文' ? '中文（普通话）' : identity.language,
          description: identity.description === '用途说明待完善。' ? '' : identity.description,
          visibility: identity.visibility || '团队内可见',
        });
        setCreatedAt(identity.createdAt);
        setSaved(true);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [draftId]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(current => ({ ...current, [key]: value }));
    setSaved(false);
    setFeedback('');
  };

  const saveDraft = async (continueAfter = false) => {
    if (continueAfter && missing.length) { setFeedback('请先填写' + missing.join('、') + '。'); return; }
    try {
      const payload = { roleName: form.roleName, ownerType: form.ownerType, ownerName: form.owner, language: form.language, description: form.description, visibility: form.visibility, source };
      const serverId = draftId?.startsWith('voice-') ? draftId : undefined;
      const response = await fetch(serverId ? `/api/voice-identities/${encodeURIComponent(serverId)}` : '/api/voice-identities', {
        method: serverId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json() as { identity?: SavedDraft & { ownerName?: string; description?: string; language?: string; visibility?: Visibility; createdAt?: string }; error?: string };
      if (!response.ok || !result.identity) throw new Error(result.error || '声音角色草稿保存失败。');
      const identity = result.identity;
      const record = { ...identity, source, form, createdAt: identity.createdAt || createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      const drafts = readSavedDrafts().filter(item => item.id !== identity.id && !item.id.startsWith('new-'));
      window.localStorage.setItem('voice-studio-identity-drafts', JSON.stringify([record, ...drafts]));
      window.localStorage.setItem('voice-studio-identities-cache', JSON.stringify([record]));
      window.history.replaceState({}, '', '/voice-identities/new?draft=' + encodeURIComponent(identity.id));
      setDraftId(identity.id); setCreatedAt(record.createdAt); setSaved(true);
      setFeedback('声音角色草稿已保存。');
      if (continueAfter) onContinue?.(identity.id, source);
    } catch (error) { setFeedback(error instanceof Error ? error.message : '草稿保存失败，请检查网络连接。'); }
  };

  const readiness = [
    { label: '角色名称', value: form.roleName.trim() ? '已填写' : '待填写', okay: !!form.roleName.trim() },
    { label: '归属对象', value: form.owner.trim() ? '已选择' : '待选择', okay: !!form.owner.trim() },
    { label: '主要语言', value: form.language ? '已选择' : '待选择', okay: !!form.language },
    { label: '创建方式', value: source, okay: true },
    { label: '可见范围', value: form.visibility, okay: true },
  ];

  return <div className="voice-create-page">
    <VoiceWorkspaceSidebar active="概览" name={saved ? form.roleName.trim() : ''} owner={saved ? form.owner.trim() : ''} source={saved ? source : ''} createdAt={formatCreatedAt(createdAt)} isNew={!saved} onSource={draftId ? () => onContinue?.(draftId, source) : undefined} />
    <main className="vc-workspace"><div className="vc-content">
      <div className="vc-breadcrumb">声音角色工作台 <span>/</span> 新建状态</div>
      <header className="vc-page-header"><div><h1>新建声音角色</h1><p>先完成最小必要定义，保存后进入对应的声音来源工作区继续设计、克隆或导入。</p></div><div className="vc-header-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" onClick={() => void saveDraft()}><Save size={14} />保存草稿</button><button type="button" className="vc-primary" onClick={() => void saveDraft(true)}>保存并继续 <ChevronRight size={15} /></button></div></header>
      <div className="vc-info-strip"><CircleHelp size={15} /><span>声音角色用于定义“谁在说话”。创建后，可根据来源进入 AI 原创设计、授权真人克隆、预置音色选择或导入 Profile 的对应工作区。</span></div>
      {feedback && <div className="vc-feedback" role="status">{feedback}<button type="button" onClick={() => setFeedback('')} aria-label="关闭提示"><X size={14} /></button></div>}

      <div className="vc-columns"><div className="vc-left-column">
        <section className="vc-panel vc-basic"><div className="vc-panel-heading"><div><h2>基础信息</h2><p>建立声音角色的名称、归属与主要语言。</p></div><span>最小必要定义</span></div><div className="vc-fields">
          <label className="vc-field vc-field--name"><span>声音角色名称 <b>*</b></span><input value={form.roleName} onChange={event => update('roleName', event.target.value)} placeholder="例如：官方讲解员 / 产品助手女声 / 技术解读主持人" /></label>
          <label className="vc-field"><span>归属对象类型</span><select value={form.ownerType} onChange={event => update('ownerType', event.target.value)}>{['企业', '品牌', '产品', '栏目 / IP', 'Agent', '虚拟角色', '个人', '活动', '客户项目'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="vc-field"><span>归属对象 <b>*</b></span><input list="vc-owner-options" value={form.owner} onChange={event => update('owner', event.target.value)} placeholder="搜索或输入归属对象" /><datalist id="vc-owner-options"><option value="Semovix" /><option value="Xino" /></datalist></label>
          <label className="vc-field"><span>主要语言</span><select value={form.language} onChange={event => update('language', event.target.value)}><option>中文（普通话）</option><option>英文</option><option>中英双语</option></select></label>
        </div><div className="vc-field-note"><CircleHelp size={14} />归属对象用于明确该声音角色属于哪个业务单元；后续版本、使用记录和权限都会基于归属对象管理。</div></section>

        <section className="vc-panel vc-methods"><div className="vc-panel-heading"><div><h2>创建方式</h2><p>不同来源会决定后续工作区、所需资料和验证策略。</p></div></div><div className="vc-method-grid" role="radiogroup" aria-label="创建方式">{METHODS.map(method => { const Icon = method.icon; const selected = source === method.id; return <button key={method.id} type="button" role="radio" aria-checked={selected} className={'vc-method-card vc-method--' + method.kind + (selected ? ' is-selected' : '')} onClick={() => { setSource(method.id); setSaved(false); setFeedback(''); }}><div className="vc-method-top"><span className="vc-method-icon"><Icon size={18} strokeWidth={1.7} /></span>{selected && <span className="vc-selected-badge"><Check size={10} />当前选择</span>}</div><strong>{method.id}</strong><p>{method.description}</p><div className="vc-method-tags"><span className={method.kind === 'ai' ? 'is-recommended' : method.kind === 'clone' ? 'is-authorization' : ''}>{method.badge}</span><span>{method.audience}</span></div></button>; })}</div></section>

        <section className="vc-panel vc-extra"><div className="vc-panel-heading"><div><h2>补充信息</h2><p>更详细的授权、用途范围、验证结果和版本信息，将在后续工作区中继续补充。</p></div><span>可选</span></div><div className="vc-extra-grid"><label className="vc-field"><span>用途说明</span><textarea value={form.description} onChange={event => update('description', event.target.value)} rows={2} /></label><div className="vc-visibility"><strong>可见范围</strong><div>{(['仅自己可见', '团队内可见', '组织内可见'] as Visibility[]).map(value => <label key={value} className={form.visibility === value ? 'is-selected' : ''}><input type="radio" name="vc-visibility" checked={form.visibility === value} onChange={() => update('visibility', value)} />{value}</label>)}</div></div></div></section>
      </div>

      <div className="vc-right-column"><section className="vc-panel vc-readiness"><div className="vc-panel-heading"><div><h2>创建准备</h2><p>保存前确认最小必要信息。</p></div><span className={missing.length ? 'vc-pending' : 'vc-complete'}>{missing.length ? '还差 ' + missing.length + ' 项即可继续' : '可以继续'}</span></div><div className="vc-check-list">{readiness.map(item => <div key={item.label}><span>{item.okay ? <Check size={14} /> : <CircleHelp size={14} />}{item.label}</span><strong className={item.okay ? '' : 'is-pending'}>{item.value}</strong></div>)}</div><div className="vc-check-note">创建后将生成一个声音角色草稿，并自动进入对应来源工作区。</div></section>
        <section className="vc-panel vc-next"><div className="vc-panel-heading"><div><h2>下一步</h2><p>按当前选择预览后续工作区。</p></div></div><div className="vc-next-current"><span>当前选择</span><strong>{source}</strong></div><p>保存并继续后，将进入：</p><ol>{NEXT[source].map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol><div className="vc-next-note">后续验证与发布页面会根据声音来源自动切换验证策略。</div></section>
        <div className="vc-source-note"><AudioLines size={16} /><span><strong>来源说明</strong>四种来源共享同一套工作台外壳，仅中间工作区内容不同。</span></div>
      </div></div>
    </div></main>

    <div className="vc-actionbar"><button type="button" onClick={onCancel}>取消</button><span role="status">{feedback}</span><div><button type="button" onClick={() => void saveDraft()}>保存草稿</button><button type="button" className="vc-primary" onClick={() => void saveDraft(true)}>保存并继续 <ChevronRight size={15} /></button></div></div>
    {playerOpen && <div className="vc-player" role="region" aria-label="全局音频播放器"><div className="vc-player-left"><span className="vc-player-icon"><AudioLines size={17} /></span><div><strong>未选择样音</strong><span>尚未选择音频</span></div></div><div className="vc-player-center"><button type="button" disabled aria-label="暂无音频可播放"><Play size={16} fill="currentColor" /></button><span>0:00</span><input type="range" min="0" max="1" value="0" disabled aria-label="播放进度" /><span>--:--</span></div><div className="vc-player-right"><Volume2 size={16} /><input type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))} aria-label="音量" /><button type="button" onClick={() => setPlayerExpanded(value => !value)} aria-label="展开播放器"><Maximize2 size={16} /></button><button type="button" onClick={() => setPlayerOpen(false)} aria-label="关闭播放器"><X size={17} /></button></div>{playerExpanded && <div className="vc-player-expanded">当前没有可试听的样音。</div>}</div>}
  </div>;
}
