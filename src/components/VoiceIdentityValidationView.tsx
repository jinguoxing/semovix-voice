import React, { useState } from 'react';
import {
  ArrowLeft, AudioLines, Check, CheckCircle2, CircleHelp, Download,
  LockKeyhole, Maximize2, Pause, Play, RefreshCw, Repeat2,
  Save, ShieldCheck, Volume2, X,
} from 'lucide-react';
import { VoiceWorkspaceSidebar } from './VoiceWorkspaceSidebar';
import './VoiceIdentityValidationView.css';

type Candidate = { id: number; status: '全部通过' | '通过' | '需关注'; attention: number; duration: string; summary: string };
type ValidationTask = { id: number; name: string; score: Record<number, number> };

const CANDIDATES: Candidate[] = [
  { id: 2, status: '全部通过', attention: 0, duration: '0:10', summary: '声音身份稳定，英文缩写与句尾表现均衡，适合持续性的产品和技术讲解。' },
  { id: 7, status: '通过', attention: 1, duration: '0:10', summary: '表达更自然、亲和，但英文缩写存在一次明显弱读。' },
  { id: 11, status: '需关注', attention: 2, duration: '0:10', summary: '权威感较强，长文本句尾偏硬，连续收听舒适度较低。' },
];

const TASKS: ValidationTask[] = [
  { id: 1, name: '产品与业务概念', score: { 2: 94, 7: 90, 11: 88 } },
  { id: 2, name: '英文与缩写', score: { 2: 92, 7: 84, 11: 91 } },
  { id: 3, name: '数字与日期', score: { 2: 90, 7: 88, 11: 86 } },
  { id: 4, name: '长逻辑句', score: { 2: 89, 7: 92, 11: 82 } },
  { id: 5, name: '角色口号', score: { 2: 95, 7: 91, 11: 87 } },
  { id: 6, name: '重复生成一致性', score: { 2: 94, 7: 91, 11: 87 } },
];

const TEST_TEXT = '犀诺会结合 D R K N、D K N、S Q L 和 Agent Runtime，\n给出可验证的分析结果。';
const PROFILE_BOUNDARIES = {
  allowed: ['产品介绍', '技术科普', '品牌传播', '客户演示', '内部培训'],
  forbidden: ['冒充真人实时交流', '误导性内容', '违法违规内容', '未经批准的第三方项目'],
};

function formatCandidate(id: number) { return `#${String(id).padStart(3, '0')}`; }
function Wave({ seed, dense = false }: { seed: number; dense?: boolean }) {
  const bars = Array.from({ length: dense ? 22 : 42 }, (_, index) => 9 + ((seed * 13 + index * 7 + (index % 4) * 9) % (dense ? 15 : 27)));
  return <span className={`vv-wave ${dense ? 'is-dense' : ''}`} aria-hidden="true">{bars.map((height, index) => <i key={index} style={{ height }} />)}</span>;
}
function CheckRow({ label, value }: { label: string; value: string }) { return <div className="vv-check-row"><span>{label}</span><b><Check size={12} />{value}</b></div>; }

export function VoiceIdentityValidationView({ id, batchId, onBack }: { id: string; batchId: string; onBack: () => void }) {
  const roleName = id === 'semovix' ? 'Semovix 官方讲解员' : '当前声音角色';
  const ownerName = id === 'semovix' ? 'Semovix' : '当前归属对象';
  const [candidateId, setCandidateId] = useState(2);
  const [taskId, setTaskId] = useState(2);
  const [publishCandidateId, setPublishCandidateId] = useState(2);
  const [profileName, setProfileName] = useState('官方讲解员 V1');
  const [profileVersion, setProfileVersion] = useState('V1.0');
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(false);
  const [volume, setVolume] = useState(78);
  const [playerOpen, setPlayerOpen] = useState(true);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);

  const selectedCandidate = CANDIDATES.find(candidate => candidate.id === candidateId) || CANDIDATES[0];
  const publishCandidate = CANDIDATES.find(candidate => candidate.id === publishCandidateId) || CANDIDATES[0];
  const selectedTask = TASKS.find(task => task.id === taskId) || TASKS[1];
  const notify = (text: string) => { setMessage(text); setSaved(false); };

  const saveValidation = async () => {
    try {
      const payload = { identityId: id, candidateId: publishCandidateId, profileName, profileVersion };
      window.localStorage.setItem(`voice-studio-validation:${id}:${batchId}`, JSON.stringify({ ...payload, taskId, updatedAt: new Date().toISOString() }));
      setSaving(true);
      const response = await fetch(`/api/voice-design/batches/${encodeURIComponent(batchId)}/validation`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '验证结果保存失败');
      setSaved(true);
      setMessage('验证结果与发布配置已保存。');
      return true;
    } catch (error) { notify(error instanceof Error ? error.message : '保存失败，请检查浏览器存储空间。'); }
    finally { setSaving(false); }
    return false;
  };

  const freezeProfile = async () => {
    if (confirmationText !== `发布 ${profileVersion}`) return;
    setPublishing(true);
    try {
      if (!await saveValidation()) return;
      const response = await fetch(`/api/voice-identities/${encodeURIComponent(id)}/voice-profiles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, candidateId: publishCandidateId, profileName, profileVersion, usageBoundaries: PROFILE_BOUNDARIES }),
      });
      const result = await response.json() as { error?: string; profile?: { frozenAt?: string } };
      if (!response.ok) throw new Error(result.error || 'Voice Profile 冻结失败');
      setPublishedAt(result.profile?.frozenAt || new Date().toISOString());
      setConfirmationOpen(false);
      setConfirmationText('');
      setMessage(`Voice Profile ${profileVersion} 已冻结并发布，Manifest 与 SHA-256 校验记录已归档。`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Voice Profile 冻结失败'); }
    finally { setPublishing(false); }
  };

  return <div className="voice-validation-page">
    <VoiceWorkspaceSidebar active="验证与发布" name={roleName} owner={ownerName} source="AI 原创设计" status={publishedAt ? '已发布' : '待冻结'} language="中文（普通话）" roleSummary sourceHint="已完成" verificationHint="全部测试完成" onOverview={onBack} onSource={onBack} />

    <main className="vv-workspace">
      <div className="vv-content">
        <div className="vv-topline"><button type="button" onClick={onBack}><ArrowLeft size={14} />返回声音来源</button><span>声音角色工作台 / 验证与发布</span></div>
        <header className="vv-header"><div><div className="vv-title-row"><h1>验证与发布</h1><span className="vv-freeze-badge">{publishedAt ? '已发布' : '待冻结'}</span></div><p>根据声音来源执行对应验证策略，检查声音稳定性与使用边界，并冻结发布正式 Voice Profile。</p><div className="vv-title-tags"><span>声音来源：<b>AI 原创设计</b></span><span>验证策略：<b>入围候选稳定性验证</b></span><span>设计批次：<b>Batch {batchId}</b></span></div><div className="vv-stats"><span>入围候选 <b>3 条</b></span><span>测试场景 <b>5 组</b></span><span>重复生成 <b>3 次 / 候选</b></span><span>测试模型 <b>Qwen3-TTS Base</b></span><span>测试状态 <b>全部完成</b></span></div></div><div className="vv-header-actions"><button type="button" className="vv-secondary" onClick={() => notify('当前没有异常项需要重新运行。')}><RefreshCw size={14} />重新运行异常项</button><button type="button" className="vv-secondary" onClick={() => void saveValidation()} disabled={saving || Boolean(publishedAt)}><Save size={14} />{saving ? '正在保存' : '保存验证结果'}</button><button type="button" className="vv-primary" onClick={() => setConfirmationOpen(true)} disabled={publishing || Boolean(publishedAt)}><LockKeyhole size={15} />{publishedAt ? `已发布 ${profileVersion}` : `冻结并发布 ${profileVersion}`}</button></div></header>
        <div className="vv-strategy-strip"><div><CircleHelp size={15} /><span><strong>验证内容由声音来源自动配置</strong>当前声音来源为“AI 原创设计”，因此本次验证将比较入围候选在 Base Clone、多场景发音和重复生成中的稳定性。</span></div><button type="button" onClick={() => notify('当前验证规则：入围候选稳定性验证。')}>查看验证规则</button></div>
        {message && <div className="vv-feedback" role="status"><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="关闭提示"><X size={14} /></button></div>}
        {saved && <div className="vv-saved-note"><Check size={13} />验证结果已保存</div>}

        <section className="vv-candidate-switch" aria-label="入围候选切换">{CANDIDATES.map(candidate => <button type="button" key={candidate.id} className={candidate.id === candidateId ? 'is-selected' : ''} onClick={() => { setCandidateId(candidate.id); setPlaying(false); }}><div><strong>候选 {formatCandidate(candidate.id)}</strong><span className={`vv-candidate-status vv-candidate-status--${candidate.status === '全部通过' ? 'pass' : candidate.status === '需关注' ? 'watch' : 'clear'}`}>{candidate.status}</span></div><Wave seed={candidate.id} dense /><div><span>需关注项 {candidate.attention}</span>{candidate.id === publishCandidateId && <b>当前拟发布</b>}</div></button>)}</section>

        <div className="vv-main-columns">
          <aside className="vv-task-column"><div className="vv-column-heading"><h2>验证任务</h2><span>6 项</span></div><div className="vv-task-list">{TASKS.map(task => <button type="button" key={task.id} className={task.id === taskId ? 'is-selected' : ''} onClick={() => { setTaskId(task.id); setPlaying(false); }}><span>任务 {String(task.id).padStart(2, '0')}</span><strong>{task.name}</strong><div><em>通过</em><b>{task.score[candidateId]}</b></div></button>)}</div><div className="vv-task-note"><CheckCircle2 size={13} />5 组内容测试与 1 组重复生成一致性均已完成。</div></aside>

          <section className="vv-evidence-column">
            <section className="vv-panel vv-original-panel"><div className="vv-panel-heading"><div><h2>{selectedTask.name}</h2><p>检查中英文切换、字母缩写和专业术语的发音准确性与稳定性。</p></div><span>当前测试原文</span></div><pre>{TEST_TEXT}</pre><div className="vv-preprocess"><span><b>Xino</b>犀诺</span><span><b>DRKN</b>D R K N</span><span><b>DKN</b>D K N</span><span><b>SQL</b>S Q L</span><span><b>Agent Runtime</b>保留英文表达</span></div></section>

            <section className="vv-panel vv-audio-panel"><div className="vv-panel-heading"><div><h2>生成音频</h2><p>候选 {formatCandidate(candidateId)} · Test {String(taskId).padStart(2, '0')} · Abbreviation</p></div><span>Run 01</span></div><div className="vv-audio-row"><button type="button" onClick={() => setPlaying(value => !value)} aria-label={playing ? '暂停测试音频' : '播放测试音频'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><Wave seed={candidateId + taskId} /><span>0:00</span><span>0:09.8</span></div><div className="vv-audio-meta"><span>采样率 <b>24 kHz</b></span><span>模型 <b>Qwen3-TTS-12Hz-1.7B-Base</b></span><span>生成运行 <b>Run 01</b></span><div><button type="button" className={looping ? 'is-active' : ''} onClick={() => setLooping(value => !value)}><Repeat2 size={12} />循环</button><button type="button" onClick={() => notify('测试音频下载已准备。')}><Download size={12} />下载测试音频</button><button type="button" onClick={() => notify('已重新生成当前候选的当前测试项。')}><RefreshCw size={12} />重新生成本项</button></div></div></section>

            <section className="vv-panel vv-listen-panel"><div className="vv-panel-heading"><div><h2>回听结果</h2><p>ASR 一致性用于辅助检查，最终发布仍由人工试听与整体稳定性结果共同决定。</p></div><span className="vv-good"><CheckCircle2 size={13} />通过</span></div><div className="vv-asr-text">犀诺会结合 D R K N、D K N、S Q L 和 Agent Runtime，给出可验证的分析结果。</div><div className="vv-listen-results"><span>文本一致性 <b>100%</b></span><span>术语命中 <b>5 / 5</b></span><span>漏读 <b>0</b></span><span>重复 <b>0</b></span><span>明显错读 <b>0</b></span><span>异常停顿 <b>0</b></span></div></section>

            <section className="vv-panel vv-repeat-panel"><div className="vv-panel-heading"><div><h2>重复生成一致性</h2><p>同一测试文本生成三次，不会同时播放多个音频。</p></div><span className="vv-good"><CheckCircle2 size={13} />一致性通过</span></div><div className="vv-runs"><div><strong>Run 01</strong><Wave seed={21} dense /><span>9.8 秒</span><b>基准</b></div><div><strong>Run 02</strong><Wave seed={22} dense /><span>9.9 秒</span><em>音色相似度 96% · 语速偏差 +1.2%</em><b>通过</b></div><div><strong>Run 03</strong><Wave seed={23} dense /><span>9.7 秒</span><em>音色相似度 95% · 语速偏差 -0.8%</em><b>通过</b></div></div></section>

            <section className="vv-panel vv-comparison-panel"><div className="vv-panel-heading"><div><h2>候选比较</h2><p>统一验证指标的横向对照，不计算或显示候选排名。</p></div></div><div className="vv-table-wrap"><table><thead><tr><th>指标</th><th>候选 #002</th><th>候选 #007</th><th>候选 #011</th></tr></thead><tbody>{[['身份一致性', '94', '90', '88'], ['发音准确性', '92', '84', '91'], ['节奏自然度', '91', '94', '86'], ['长听舒适度', '90', '93', '80'], ['句尾稳定性', '95', '88', '84'], ['重复生成一致性', '94', '91', '87']].map(row => <tr key={row[0]}><th>{row[0]}</th>{row.slice(1).map((value, index) => <td key={index} className={Number(value) >= 90 ? 'is-high' : Number(value) >= 85 ? 'is-mid' : 'is-watch'}>{value}</td>)}</tr>)}<tr><th>需关注项</th><td>0</td><td className="is-watch">1</td><td className="is-watch">2</td></tr></tbody></table></div></section>

            <section className="vv-panel vv-summary-panel"><div className="vv-panel-heading"><div><h2>差异摘要</h2><p>AI 仅归纳验证差异，用于辅助人工判断。</p></div></div><div>{CANDIDATES.map(candidate => <article key={candidate.id}><strong>候选 {formatCandidate(candidate.id)}</strong><p>{candidate.summary}</p></article>)}</div><p className="vv-summary-foot"><CircleHelp size={12} />以上内容不会自动改变最终拟发布候选。</p></section>
          </section>

          <aside className="vv-decision-column">
            <section className="vv-panel vv-choice-panel"><div className="vv-panel-heading"><div><h2>最终声音选择</h2><p>选择一个候选作为正式 Voice Profile 的参考声音身份。</p></div></div><div className="vv-choice-list">{CANDIDATES.map(candidate => <label key={candidate.id}><input type="radio" name="publish-candidate" value={candidate.id} checked={publishCandidateId === candidate.id} onChange={() => setPublishCandidateId(candidate.id)} /><span><b>候选 {formatCandidate(candidate.id)}</b><small>{candidate.status}{candidate.attention ? ` · 需关注 ${candidate.attention} 项` : ''}</small></span>{publishCandidateId === candidate.id && <CheckCircle2 size={15} />}</label>)}</div><div className="vv-choice-current"><span>当前拟发布</span><strong>候选 {formatCandidate(publishCandidateId)}</strong><div><em>身份稳定</em><em>术语清晰</em><em>长听舒适</em><em>重复生成一致</em></div></div></section>

            <section className="vv-panel vv-profile-panel"><div className="vv-panel-heading"><div><h2>Voice Profile</h2><p>冻结后形成不可变的正式版本。</p></div><span className="vv-freeze-badge">{publishedAt ? '已发布' : '待冻结'}</span></div><label><span>Profile 名称</span><input value={profileName} disabled={Boolean(publishedAt)} onChange={event => setProfileName(event.target.value)} /></label><label><span>版本号</span><input value={profileVersion} disabled={Boolean(publishedAt)} onChange={event => setProfileVersion(event.target.value)} /></label><dl><div><dt>生产模型</dt><dd>Qwen3-TTS-12Hz-1.7B-Base</dd></div><div><dt>参考声音</dt><dd>候选 {formatCandidate(publishCandidateId)}</dd></div><div><dt>主要语言</dt><dd>中文（普通话）</dd></div><div><dt>默认表达</dt><dd>专业、可信、克制</dd></div><div><dt>默认语速</dt><dd>中等偏慢</dd></div><div><dt>可见范围</dt><dd>组织内可见</dd></div><div><dt>资产等级</dt><dd>核心声音资产</dd></div></dl></section>

            <section className="vv-panel vv-boundary-panel"><div className="vv-panel-heading"><div><h2>使用边界</h2><p>发布时会写入 Manifest 与使用记录。</p></div></div><div className="vv-boundary-tags"><span>允许用途</span><div>{PROFILE_BOUNDARIES.allowed.map(item => <em key={item} className="is-allowed">{item}</em>)}</div></div><div className="vv-boundary-tags"><span>禁止用途</span><div>{PROFILE_BOUNDARIES.forbidden.map(item => <em key={item} className="is-forbidden">{item}</em>)}</div></div><div className="vv-license-note"><ShieldCheck size={13} /><span>无需真人声音授权<br />模型与素材许可已归档</span></div></section>

            <section className="vv-panel vv-check-panel"><div className="vv-panel-heading"><div><h2>发布检查</h2><p>发布前完整性检查。</p></div><span className="vv-good"><CheckCircle2 size={13} />可以冻结发布</span></div><div className="vv-check-list"><CheckRow label="角色基础信息" value="已完成" /><CheckRow label="声音来源配置" value="已完成" /><CheckRow label="候选匿名评审" value="已完成" /><CheckRow label="入围候选" value="3 条" /><CheckRow label="验证任务" value="全部完成" /><CheckRow label="阻断风险" value="0" /><CheckRow label="拟发布候选" value={formatCandidate(publishCandidateId)} /><CheckRow label="生产模型" value="已就绪" /><CheckRow label="参考音频" value="已归档" /><CheckRow label="参考文本" value="已归档" /><CheckRow label="测试报告" value="已生成" /><CheckRow label="使用边界" value="已配置" /><div className="vv-hash-row"><span>文件 Hash</span><b>待发布时生成</b></div></div></section>

            <aside className="vv-freeze-note"><LockKeyhole size={14} /><div><strong>冻结后不可原地修改</strong><p>发布后将创建不可变的 Voice Profile {profileVersion}。后续调整声音、参考音频、生产模型或默认表达时，必须创建新的版本。</p><span>将生成：正式参考音频、精确参考文本、模型版本记录、验证报告、Manifest 和 SHA-256 校验文件。</span></div></aside>
            <div className="vv-decision-actions"><button type="button" className="vv-quiet" onClick={onBack}>返回声音来源</button><button type="button" className="vv-secondary" onClick={() => void saveValidation()} disabled={saving || Boolean(publishedAt)}><Save size={13} />保存验证结果</button><button type="button" className="vv-primary" onClick={() => setConfirmationOpen(true)} disabled={publishing || Boolean(publishedAt)}><LockKeyhole size={14} />{publishedAt ? `已发布 ${profileVersion}` : `冻结并发布 ${profileVersion}`}</button></div>
          </aside>
        </div>
      </div>
    </main>

    {playerOpen && <div className="vv-player" role="region" aria-label="验证测试音频播放器"><div className="vv-player-identity"><span className="vv-player-mark"><AudioLines size={17} /></span><div><strong>候选 {formatCandidate(candidateId)}</strong><span>{selectedTask.name}测试</span></div></div><div className="vv-player-controls"><button type="button" onClick={() => setPlaying(value => !value)} aria-label={playing ? '暂停测试音频' : '播放测试音频'}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><span>0:00</span><input type="range" min="0" max="10" value="0" readOnly aria-label="播放进度" /><span>0:10</span></div><div className="vv-player-tail"><button type="button" className="vv-speed">1×</button><Volume2 size={16} /><input type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))} aria-label="音量" /><button type="button" onClick={() => setPlayerExpanded(value => !value)} aria-label="展开播放器"><Maximize2 size={16} /></button><button type="button" onClick={() => setPlayerOpen(false)} aria-label="关闭播放器"><X size={17} /></button></div>{playerExpanded && <div className="vv-player-expanded">候选 {formatCandidate(candidateId)} · {selectedTask.name} · 验证测试音频</div>}</div>}

    {confirmationOpen && <div className="vv-overlay" role="presentation"><section className="vv-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-dialog-title"><div className="vv-dialog-head"><div><h2 id="publish-dialog-title">确认冻结并发布</h2><p>此操作会创建不可变的 Voice Profile 版本。</p></div><button type="button" onClick={() => setConfirmationOpen(false)} aria-label="关闭确认弹窗"><X size={16} /></button></div><dl><div><dt>声音角色</dt><dd>{roleName}</dd></div><div><dt>声音来源</dt><dd>AI 原创设计</dd></div><div><dt>验证策略</dt><dd>入围候选稳定性验证</dd></div><div><dt>拟发布候选</dt><dd>{formatCandidate(publishCandidateId)}</dd></div><div><dt>版本</dt><dd>{profileVersion}</dd></div></dl><div className="vv-dialog-warning"><LockKeyhole size={14} /><span>冻结后不可原地修改。若需要调整声音或模型，请创建新的版本。</span></div><label className="vv-confirm-input"><span>确认输入 <b>发布 {profileVersion}</b></span><input value={confirmationText} onChange={event => setConfirmationText(event.target.value)} placeholder={`输入 发布 ${profileVersion}`} /></label><div className="vv-dialog-actions"><button type="button" onClick={() => setConfirmationOpen(false)}>取消</button><button type="button" disabled={confirmationText !== `发布 ${profileVersion}` || publishing} onClick={() => void freezeProfile()}>{publishing ? '正在冻结…' : '确认冻结发布'}</button></div></section></div>}
  </div>;
}
