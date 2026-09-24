import React, { useState } from 'react';
import {
  ArrowLeft, AudioLines, CalendarDays, Check, CheckCircle2, ChevronDown,
  CircleHelp, FileCheck2, FileText, Headphones, Maximize2, Mic, Pause,
  Play, RefreshCw, Save, ShieldCheck, Upload, UserRound, Volume2, X,
} from 'lucide-react';
import { VoiceWorkspaceSidebar } from './VoiceWorkspaceSidebar';
import './VoiceIdentityHumanCloneView.css';

type CloneIdentity = {
  name: string;
  owner: string;
  language: string;
  source: string;
};

const DEFAULT_REFERENCE = `在复杂的技术世界里，我们真正需要的，
不只是更多参数，
而是更清晰的判断路径。

接下来，我会用最直接的方式，
把这套能力讲清楚。`;

const CLONE_TEST_TEXT = `当企业人工智能开始参与真实业务，
它需要的不只是一个答案，
还需要上下文、证据与可控执行。`;

function readIdentity(id: string): CloneIdentity {
  try {
    const saved = JSON.parse(window.localStorage.getItem('voice-studio-identity-drafts') || '[]') as Array<{ id: string; name?: string; ownerName?: string; language?: string; source?: string }>;
    const identity = saved.find(item => item.id === id);
    if (identity) return {
      name: identity.name || '未命名声音角色',
      owner: identity.ownerName || '待指定',
      language: identity.language || '中文（普通话）',
      source: identity.source || '授权真人克隆',
    };
  } catch { /* use the current demo identity */ }
  return id === 'xiaofei'
    ? { name: '小飞哥技术解读', owner: '小飞哥系列', language: '中文（普通话）', source: '授权真人克隆' }
    : { name: '授权真人克隆角色', owner: '待指定', language: '中文（普通话）', source: '授权真人克隆' };
}

function readReferenceText(id: string) {
  try {
    const saved = JSON.parse(window.localStorage.getItem('voice-studio-human-clone-drafts') || '{}') as Record<string, { referenceText?: string }>;
    return saved[id]?.referenceText || DEFAULT_REFERENCE;
  } catch { return DEFAULT_REFERENCE; }
}

function Waveform({ dense = false }: { dense?: boolean }) {
  const values = dense ? [10, 18, 29, 16, 38, 24, 42, 31, 13, 24, 35, 18, 29, 43, 23, 15, 32, 20, 37, 17, 30, 11, 25, 34, 19, 39, 22, 14, 28, 35, 17, 24, 10] : [15, 24, 36, 26, 42, 31, 48, 35, 17, 29, 39, 21, 32, 50, 29, 18, 38, 24, 43, 21, 34, 14, 29, 40, 22, 46, 27, 17, 33, 41, 20, 28, 12];
  return <span className={`vch-wave ${dense ? 'is-dense' : ''}`} aria-hidden="true">{values.map((height, index) => <i key={index} style={{ height }} />)}</span>;
}

function FieldList({ children }: { children: React.ReactNode }) {
  return <dl className="vch-field-list">{children}</dl>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function StatusLine({ label, value, tone = 'pass' }: { label: string; value: string; tone?: 'pass' | 'neutral' }) {
  return <div className="vch-status-line"><span>{label}</span><b className={tone === 'neutral' ? 'is-neutral' : ''}>{tone === 'pass' && <Check size={12} />}{value}</b></div>;
}

export function VoiceIdentityHumanCloneView({ id, onCenter, onOverview }: { id: string; onCenter: () => void; onOverview: () => void }) {
  const [identity] = useState(() => readIdentity(id));
  const [referenceText, setReferenceText] = useState(() => readReferenceText(id));
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(true);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(76);

  const notify = (text: string) => {
    setMessage(text);
    setSaved(false);
  };

  const saveDraft = () => {
    try {
      const storageKey = 'voice-studio-human-clone-drafts';
      const current = JSON.parse(window.localStorage.getItem(storageKey) || '{}') as Record<string, { referenceText: string; updatedAt: string }>;
      window.localStorage.setItem(storageKey, JSON.stringify({ ...current, [id]: { referenceText, updatedAt: new Date().toISOString() } }));
      setSaved(true);
      setMessage('授权真人克隆来源配置已保存。');
    } catch {
      notify('草稿保存失败，请检查浏览器存储空间。');
    }
  };

  return <div className="voice-human-clone-page">
    <VoiceWorkspaceSidebar
      active="声音来源"
      name={identity.name}
      owner={identity.owner}
      source={identity.source}
      language={identity.language}
      roleSummary
      avatar
      verificationHint="克隆样音生成后可进入"
      onOverview={onOverview}
      onSource={() => undefined}
    />

    <main className="vch-workspace">
      <div className="vch-content">
        <div className="vch-topline">
          <button type="button" onClick={onCenter}><ArrowLeft size={14} />返回声音角色中心</button>
          <span>声音角色工作台 / 声音来源 / 授权真人克隆</span>
        </div>

        <header className="vch-header">
          <div>
            <div className="vch-title-row"><h1>声音来源｜授权真人克隆</h1><span className="vch-draft-badge">草稿</span></div>
            <p>归档声音授权，采集高质量参考样本，并生成可进入后续验证的首次克隆样音。</p>
          </div>
          <div className="vch-header-actions">
            <button type="button" className="vch-secondary" onClick={saveDraft}><Save size={15} />保存草稿</button>
            <button type="button" className="vch-quiet" onClick={onCenter}>取消</button>
            <button type="button" className="vch-primary" onClick={() => notify('克隆样音任务已准备就绪，确认后将使用当前参考样本生成。')}><AudioLines size={16} />生成克隆样音</button>
          </div>
        </header>

        <div className="vch-source-banner">
          <div><span>当前来源</span><strong><UserRound size={15} />授权真人克隆</strong><p>适用于已获得明确授权的讲师、主持人、配音员、代言人或其他声音主体。</p></div>
          <div className="vch-source-status"><span>授权资料</span><strong><FileCheck2 size={13} />已归档</strong><small>有效期至 2028-08-31</small></div>
        </div>

        {message && <div className="vch-feedback" role="status"><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="关闭提示"><X size={14} /></button></div>}
        {saved && <div className="vch-saved-note"><Check size={13} />来源配置草稿已保存</div>}

        <div className="vch-columns">
          <div className="vch-left-column">
            <section className="vch-panel vch-auth-panel">
              <div className="vch-panel-heading"><div><h2>声音主体与授权</h2><p>声音主体、参考样本和授权材料均会被记录，用于后续使用边界追溯。</p></div><span className="vch-good"><CheckCircle2 size={13} />授权资料已归档</span></div>
              <div className="vch-auth-grid">
                <div>
                  <h3>声音主体</h3>
                  <FieldList>
                    <Field label="声音主体类型" value="个人 / 讲师" />
                    <Field label="声音主体名称" value="授权讲师 A" />
                    <Field label="与归属对象关系" value="栏目主持人" />
                    <Field label="授权确认方式" value="书面授权文件" />
                    <Field label="人工确认人" value="内容负责人" />
                    <Field label="确认时间" value="2026-09-01 14:32" />
                  </FieldList>
                </div>
                <div className="vch-permissions">
                  <h3>授权范围</h3>
                  <div className="vch-file-row"><FileText size={17} /><div><strong>Voice_Authorization_2026.pdf</strong><span>已归档 · 授权文件</span></div><button type="button" onClick={() => notify('授权文件预览已准备。')}>查看</button><button type="button" onClick={() => notify('可替换已归档的授权文件。')}>替换</button></div>
                  <div className="vch-date-row"><span>授权有效期</span><b><CalendarDays size={12} />2026-09-01</b><i>至</i><b>2028-08-31</b></div>
                  <div className="vch-tag-section"><span>允许用途</span><div>{['技术解读视频', '品牌内容', '公开课程', '内部培训'].map(item => <em key={item} className="is-allowed">{item}</em>)}</div></div>
                  <div className="vch-tag-section"><span>禁止用途</span><div>{['冒充本人实时对话', '第三方广告代言', '未经批准的客户项目', '二次转授权'].map(item => <em key={item} className="is-forbidden">{item}</em>)}</div></div>
                  <div className="vch-boundary-row"><span>跨语言生成 <b>不允许</b></span><span>第三方项目使用 <b>需单独确认</b></span></div>
                </div>
              </div>
              <div className="vch-legal-note"><CircleHelp size={13} />授权资料和人工确认记录用于控制系统内使用边界，不代表系统自动作出法律有效性判断。</div>
            </section>

            <section className="vch-panel vch-audio-panel">
              <div className="vch-panel-heading"><div><h2>参考音频</h2><p>上传或录制无背景音乐、无明显混响、单一说话人的清晰声音样本。</p></div><div className="vch-panel-actions"><button type="button" onClick={() => notify('音频上传入口已准备。')}><Upload size={13} />上传音频</button><button type="button" onClick={() => notify('现场录制入口已准备。')}><Mic size={13} />现场录制</button></div></div>
              <div className="vch-primary-sample">
                <div className="vch-sample-head"><div><strong>speaker_A_reference_01.wav</strong><span className="vch-primary-chip">主参考样本</span></div><span>00:32.8 · WAV · 48 kHz · Mono</span></div>
                <div className="vch-waveform-line"><button type="button" aria-label={isPlaying ? '暂停参考音频' : '播放参考音频'} onClick={() => setIsPlaying(value => !value)}>{isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button><Waveform /><span>组织内部录制</span></div>
                <div className="vch-sample-actions"><button type="button" onClick={() => setIsPlaying(value => !value)}>{isPlaying ? '暂停' : '播放'}</button><button type="button" onClick={() => notify('已重新检查主参考样本。')}><RefreshCw size={12} />重新检测</button><button type="button" onClick={() => notify('如需更换，请先选择其他主参考音频。')}>取消主参考</button></div>
              </div>
              <div className="vch-secondary-sample"><AudioLines size={15} /><strong>speaker_A_reference_02.wav</strong><span>00:27.1 · WAV · 48 kHz · Mono</span><b>可用</b><button type="button" onClick={() => setIsPlaying(value => !value)}>试听</button><button type="button" onClick={() => notify('已设为主参考音频。')}>设为主参考</button><button type="button" onClick={() => notify('参考音频已移入待删除列表。')}>删除</button></div>
              <div className="vch-audio-summary"><span>有效样本：<b>2 段</b></span><span>总有效时长：<b>59.9 秒</b></span><strong><CheckCircle2 size={13} />满足当前样本要求</strong></div>
            </section>

            <section className="vch-panel vch-text-panel">
              <div className="vch-panel-heading"><div><h2>参考文本</h2><p>参考文本必须与主参考音频逐字对应，用于建立稳定的声音克隆条件。</p></div><span className="vch-good"><CheckCircle2 size={13} />参考文本可用</span></div>
              <textarea aria-label="参考文本" maxLength={500} value={referenceText} onChange={event => { setReferenceText(event.target.value); setSaved(false); }} />
              <div className="vch-text-count"><span>与主参考音频对齐</span><span>{referenceText.length} / 500</span></div>
              <div className="vch-text-status"><span>自动转录：<b>已完成</b></span><span>文本匹配度：<b>98%</b></span><span>疑似差异：<b>1 处标点差异</b></span><div><button type="button" onClick={() => notify('已重新发起参考文本转录。')}>重新转录</button><button type="button" onClick={() => notify('当前仅存在 1 处标点差异。')}>查看差异</button><button type="button" onClick={() => notify('已采用自动转录结果。')}>采用转录结果</button></div></div>
            </section>
          </div>

          <div className="vch-right-column">
            <section className="vch-panel vch-quality-panel">
              <div className="vch-panel-heading"><div><h2>样本质量</h2><p>参考样本是否适合生成首次克隆样音。</p></div><span className="vch-ready"><CheckCircle2 size={13} />可生成克隆样音</span></div>
              <div className="vch-status-list">
                <StatusLine label="有效时长" value="59.9 秒 · 通过" /><StatusLine label="单一说话人" value="已确认 · 通过" />
                <StatusLine label="背景音乐" value="未检测到 · 通过" /><StatusLine label="环境噪声" value="低 · 通过" />
                <StatusLine label="明显混响" value="未检测到 · 通过" /><StatusLine label="削波" value="0 处 · 通过" />
                <StatusLine label="长静音" value="1.2 秒 · 通过" /><StatusLine label="文本匹配" value="98% · 通过" />
                <StatusLine label="语言" value="中文普通话 · 通过" />
              </div>
              <button type="button" className="vch-report-button" onClick={() => notify('完整样本检测报告已准备。')}><ShieldCheck size={13} />查看完整检测报告</button>
              <p className="vch-panel-footnote">当前检测只判断参考样本是否适合生成克隆样音，不代表正式声音版本已通过验证。</p>
            </section>

            <section className="vch-panel vch-settings-panel">
              <div className="vch-panel-heading"><div><h2>克隆样音设置</h2><p>仅保留首次样音生成所需的业务设置。</p></div></div>
              <FieldList>
                <Field label="克隆模型" value={<span className="vch-model">Qwen3-TTS-12Hz-1.7B-Base <em><Check size={11} />已就绪</em></span>} />
                <Field label="主参考音频" value="speaker_A_reference_01.wav" />
                <Field label="参考文本" value="已绑定" />
                <Field label="生成语言" value="中文（普通话）" />
                <Field label="表达方式" value="保留原始表达特征" />
                <div className="vch-test-text"><dt>测试文本</dt><dd><textarea aria-label="克隆样音测试文本" defaultValue={CLONE_TEST_TEXT} /></dd></div>
                <Field label="输出格式" value="WAV" />
                <Field label="生成位置" value="本地 Worker" />
              </FieldList>
              <p className="vch-panel-footnote">本次仅生成首次克隆样音，不会创建或发布正式 Voice Profile。</p>
            </section>

            <section className="vch-panel vch-ready-panel">
              <div className="vch-panel-heading"><div><h2>来源准备检查</h2><p>生成前确认所需记录已完整。</p></div><span className="vch-ready"><CheckCircle2 size={13} />可以生成克隆样音</span></div>
              <div className="vch-status-list vch-ready-list">
                <StatusLine label="角色基础信息" value="已完成" /><StatusLine label="声音来源类型" value="授权真人克隆" />
                <StatusLine label="声音主体" value="已填写" /><StatusLine label="授权资料" value="已归档" />
                <StatusLine label="授权有效期" value="有效" /><StatusLine label="允许与禁止用途" value="已配置" />
                <StatusLine label="主参考音频" value="已选择" /><StatusLine label="样本质量" value="已通过" />
                <StatusLine label="参考文本" value="已匹配" /><StatusLine label="Base 模型" value="已就绪" />
              </div>
              <p className="vch-check-note"><CircleHelp size={13} />生成成功后会保存克隆样音、参考音频与文本快照、模型记录、授权范围快照、文件 Hash 与生成记录。</p>
            </section>

            <aside className="vch-next-card"><strong>下一步</strong><p>克隆样音生成后，可进入“验证与发布”工作区，继续检查声音身份相似度、长文本稳定性、英文与数字发音、重复生成一致性、授权有效性和正式版本冻结。</p></aside>
          </div>
        </div>
      </div>
    </main>

    <div className="vch-actionbar"><button type="button" className="vch-quiet" onClick={onCenter}>取消</button><div><button type="button" className="vch-secondary" onClick={saveDraft}><Save size={14} />保存草稿</button><button type="button" className="vch-primary" onClick={() => notify('克隆样音任务已准备就绪，确认后将使用当前参考样本生成。')}><AudioLines size={15} />生成克隆样音</button></div></div>

    {playerOpen && <div className="vch-player" role="region" aria-label="参考音频播放器">
      <div className="vch-player-identity"><span className="vch-player-mark"><UserRound size={17} /></span><div><strong>授权讲师 A</strong><span>主参考样本 · speaker_A_reference_01.wav</span></div></div>
      <div className="vch-player-controls"><button type="button" onClick={() => setIsPlaying(value => !value)} aria-label={isPlaying ? '暂停参考音频' : '播放参考音频'}>{isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><span>0:00</span><input type="range" min="0" max="33" value="0" aria-label="参考音频播放进度" readOnly /><span>0:33</span></div>
      <div className="vch-player-tail"><button type="button" className="vch-speed">1×</button><Volume2 size={16} /><input type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))} aria-label="音量" /><button type="button" aria-label="展开播放器" onClick={() => setPlayerExpanded(value => !value)}><Maximize2 size={16} /></button><button type="button" aria-label="关闭播放器" onClick={() => setPlayerOpen(false)}><X size={17} /></button></div>
      {playerExpanded && <div className="vch-player-expanded">speaker_A_reference_01.wav · 32.8 秒 · WAV · 48 kHz · Mono</div>}
    </div>}
  </div>;
}
