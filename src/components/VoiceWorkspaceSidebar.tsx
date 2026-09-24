import React from 'react';
import { AudioLines, ClipboardCheck, FileClock, History, LayoutDashboard, Settings2, SlidersHorizontal, UserRound } from 'lucide-react';
import './VoiceWorkspaceSidebar.css';

export type VoiceWorkspaceArea = '概览' | '声音来源' | '验证与发布';

type Props = {
  active: VoiceWorkspaceArea;
  name: string;
  owner: string;
  source: string;
  status?: string;
  createdAt?: string;
  isNew?: boolean;
  roleSummary?: boolean;
  avatar?: boolean;
  language?: string;
  verificationHint?: string;
  sourceHint?: string;
  onOverview?: () => void;
  onSource?: () => void;
};

const NAV = [
  { label: '概览', icon: LayoutDashboard },
  { label: '声音来源', icon: AudioLines },
  { label: '验证与发布', icon: ClipboardCheck },
  { label: '版本', icon: FileClock },
  { label: '使用记录', icon: History },
  { label: '设置', icon: Settings2 },
] as const;

export function VoiceWorkspaceSidebar({ active, name, owner, source, status = '草稿', createdAt = '今天 09:20', isNew = false, roleSummary = false, avatar = false, language, verificationHint, sourceHint, onOverview, onSource }: Props) {
  const values = roleSummary ? [
    ['角色名称', name || '未命名声音角色'], ['归属对象', owner || '未选择'],
    ['主要语言', language || '未选择'], ['来源', source || '未选择'], ['状态', status],
  ] : [
    ['角色名称', name || '未命名声音角色'], ['归属对象', owner || '未选择'],
    ['创建方式', source || '未选择'], ['状态', status], ['创建时间', createdAt],
  ];
  return <aside className="vws-sidebar" aria-label="声音角色工作台导航">
    <section className={`vws-summary ${avatar ? 'vws-summary--avatar' : ''}`}><div className="vws-summary-heading"><span className={avatar ? 'vws-avatar-mark' : 'vws-summary-mark'}>{avatar ? <UserRound size={25} strokeWidth={1.35} /> : <SlidersHorizontal size={17} />}</span><h2>{roleSummary ? '当前角色' : '当前草稿'}</h2><span className="vws-badge">{isNew ? '待创建' : status}</span></div><dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>{roleSummary && <div className="vws-summary-tags"><span>{source}</span><span>{status}</span></div>}</section>
    <div className="vws-nav-title">声音角色工作台</div>
    <nav>{NAV.map(({ label, icon: Icon }) => {
      const current = active === label;
      const hint = isNew ? label === '声音来源' ? '保存后可配置' : label === '验证与发布' ? '尚不可用' : label === '版本' ? '尚无版本' : label === '使用记录' ? '暂无' : undefined : label === '声音来源' ? sourceHint : label === '验证与发布' ? verificationHint || '尚不可用' : label === '版本' ? '尚无版本' : label === '使用记录' ? '暂无' : undefined;
      const click = label === '概览' ? onOverview : label === '声音来源' && !isNew ? onSource : undefined;
      return <button type="button" key={label} aria-current={current ? 'page' : undefined} className={current ? 'is-active' : ''} onClick={click} disabled={Boolean(hint && label !== '声音来源' && !current) || !click && !current}><Icon size={16} strokeWidth={1.7} /><span>{label}{hint && <small>{hint}</small>}</span>{current && <i />}</button>;
    })}</nav>
    <div className="vws-sidebar-note">统一工作台 · 来源决定中间工作区</div>
  </aside>;
}
