import React, { useState } from 'react';
import { ArrowLeft, AudioLines, Check, CircleHelp, FileInput, Headphones, Maximize2, Play, Save, UserRound, Volume2, X } from 'lucide-react';
import { VoiceWorkspaceSidebar } from './VoiceWorkspaceSidebar';
import './VoiceIdentityCreateView.css';
import './VoiceIdentityWorkbenchEntry.css';

type SavedIdentity = { id: string; name: string; ownerName: string; source: string; language: string; description: string; sourceNote?: string; createdAt?: string };
type SourceInfo = { title: string; description: string; section: string; prompt: string; guidance: string[]; icon: typeof AudioLines };
const SOURCE_CONTENT: Record<string, SourceInfo> = {
  'AI 原创设计': { title: '声音来源｜AI 原创设计', description: '定义声音 Brief、统一参考文本和多方向设计。', section: '声音设计', prompt: '记录声音身份的设计要求…', guidance: ['声音 Brief', '统一参考文本', '设计方向'], icon: AudioLines },
  '授权真人克隆': { title: '声音来源｜授权与声音样本', description: '确认真人声音授权与样本要求，建立可复用的克隆声音版本。', section: '授权与样本准备', prompt: '记录授权对象、使用范围及参考声音的准备情况…', guidance: ['确认授权范围', '准备参考录音', '建立克隆版本'], icon: UserRound },
  'Provider 预置音色': { title: '声音来源｜预置音色选择', description: '从 Provider 音色目录选择适合当前角色的声音，并核对许可范围。', section: '音色选择要求', prompt: '记录目标音色、Provider 和使用许可要求…', guidance: ['浏览音色目录', '试听并选择', '核对 Provider 许可'], icon: Headphones },
  '导入已有 Voice Profile': { title: '声音来源｜导入与兼容性校验', description: '整理已有 Voice Profile 资产，校验格式、参考资料与使用范围。', section: '导入准备', prompt: '记录原始 Profile 来源、参考资料和兼容性要求…', guidance: ['整理现有资产', '导入 Profile', '检查兼容性'], icon: FileInput },
};

function getDraft(id: string): SavedIdentity | undefined {
  try { return (JSON.parse(window.localStorage.getItem('voice-studio-identity-drafts') || '[]') as SavedIdentity[]).find(item => item.id === id); }
  catch { return undefined; }
}

export function VoiceIdentityWorkbenchEntry({ id, onBack, onCenter }: { id: string; onBack: () => void; onCenter: () => void }) {
  const [draft] = useState(() => getDraft(id));
  const source = draft?.source === '预置音色' ? 'Provider 预置音色' : draft?.source || 'AI 原创设计';
  const content = SOURCE_CONTENT[source] || SOURCE_CONTENT['AI 原创设计'];
  const Icon = content.icon;
  const [note, setNote] = useState(draft?.sourceNote || '');
  const [feedback, setFeedback] = useState('');
  const [playerOpen, setPlayerOpen] = useState(true);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [volume, setVolume] = useState(80);
  const saveNote = () => {
    try {
      const drafts = JSON.parse(window.localStorage.getItem('voice-studio-identity-drafts') || '[]') as SavedIdentity[];
      window.localStorage.setItem('voice-studio-identity-drafts', JSON.stringify(drafts.map(item => item.id === id ? { ...item, sourceNote: note, updatedAt: new Date().toISOString() } : item)));
      setFeedback('来源工作区内容已保存。');
    } catch { setFeedback('保存失败，请检查浏览器存储空间。'); }
  };

  return <div className="voice-create-page vwe-page">
    <VoiceWorkspaceSidebar active="声音来源" name={draft?.name || ''} owner={draft?.ownerName || ''} source={source} createdAt={draft?.createdAt ? '今天 ' + new Date(draft.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '今天 09:20'} onOverview={onBack} onSource={() => undefined} />
    <main className="vc-workspace"><div className="vc-content"><button type="button" className="vwe-back" onClick={onCenter}><ArrowLeft size={14} />返回声音角色中心</button><header className="vc-page-header"><div><h1>{content.title}</h1><p>{content.description}</p></div><div className="vc-header-actions"><button type="button" onClick={saveNote}><Save size={14} />保存草稿</button></div></header><div className="vc-info-strip"><CircleHelp size={15} /><span>{draft?.name || '当前声音角色'}已创建为草稿。四种声音来源共享同一套工作台框架，此处配置当前来源。</span></div>{feedback && <div className="vc-feedback" role="status">{feedback}<button type="button" onClick={() => setFeedback('')} aria-label="关闭提示"><X size={14} /></button></div>}
      <div className="vwe-columns"><section className="vc-panel"><div className="vc-panel-heading"><div><h2>{content.section}</h2><p>{draft?.description || '在来源工作区继续完善声音角色。'}</p></div><Icon size={18} /></div><label className="vc-field"><span>工作区备注</span><textarea rows={6} value={note} onChange={event => setNote(event.target.value)} placeholder={content.prompt} /></label><div className="vwe-card-foot"><button type="button" onClick={saveNote}><Save size={14} />保存当前内容</button></div></section><section className="vc-panel"><div className="vc-panel-heading"><div><h2>本来源工作区</h2><p>当前来源需要继续完成的资料和配置。</p></div></div><div className="vwe-source-name"><Icon size={19} />{source}</div><ul>{content.guidance.map(item => <li key={item}><Check size={14} />{item}</li>)}</ul><div className="vc-check-note">验证与发布将根据“{source}”自动切换所需策略。</div></section></div>
    </div></main>
    {playerOpen && <div className="vc-player" role="region" aria-label="全局音频播放器"><div className="vc-player-left"><span className="vc-player-icon"><AudioLines size={17} /></span><div><strong>未选择样音</strong><span>尚未选择音频</span></div></div><div className="vc-player-center"><button type="button" disabled aria-label="暂无音频可播放"><Play size={16} fill="currentColor" /></button><span>0:00</span><input type="range" min="0" max="1" value="0" disabled aria-label="播放进度" /><span>--:--</span></div><div className="vc-player-right"><Volume2 size={16} /><input type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))} aria-label="音量" /><button type="button" onClick={() => setPlayerExpanded(value => !value)} aria-label="展开播放器"><Maximize2 size={16} /></button><button type="button" onClick={() => setPlayerOpen(false)} aria-label="关闭播放器"><X size={17} /></button></div>{playerExpanded && <div className="vc-player-expanded">当前没有可试听的样音。</div>}</div>}
  </div>;
}
