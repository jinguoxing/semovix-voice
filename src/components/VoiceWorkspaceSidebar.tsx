import React from 'react';
import { AudioLines, ClipboardCheck, FileClock, History, LayoutDashboard, Settings2, SlidersHorizontal } from 'lucide-react';
import './VoiceWorkspaceSidebar.css';

export type VoiceWorkspaceArea = '概览' | '声音来源';

type Props = {
  active: VoiceWorkspaceArea;
  name: string;
  owner: string;
  source: string;
  status?: string;
  createdAt?: string;
  isNew?: boolean;
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

export function VoiceWorkspaceSidebar({ active, name, owner, source, status = '草稿', createdAt = '今天 09:20', isNew = false, onOverview, onSource }: Props) {
  const values = [
    ['角色名称', name || '未命名声音角色'],
    ['归属对象', owner || '未选择'],
    ['创建方式', source || '未选择'],
    ['状态', status],
    ['创建时间', createdAt],
  ];
  return <aside className="vws-sidebar" aria-label="声音角色工作台导航">
    <section className="vws-summary"><div className="vws-summary-heading"><span className="vws-summary-mark"><SlidersHorizontal size={17} /></span><h2>当前草稿</h2><span className="vws-badge">{isNew ? '待创建' : '草稿'}</span></div><dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></section>
    <div className="vws-nav-title">声音角色工作台</div>
    <nav>{NAV.map(({ label, icon: Icon }) => {
      const current = active === label;
      const hint = isNew ? label === '声音来源' ? '保存后可配置' : label === '验证与发布' ? '尚不可用' : label === '版本' ? '尚无版本' : label === '使用记录' ? '暂无' : undefined : label === '验证与发布' ? '尚不可用' : label === '版本' ? '尚无版本' : label === '使用记录' ? '暂无' : undefined;
      const click = label === '概览' ? onOverview : label === '声音来源' && !isNew ? onSource : undefined;
      return <button type="button" key={label} aria-current={current ? 'page' : undefined} className={current ? 'is-active' : ''} onClick={click} disabled={Boolean(hint) || !click && !current}><Icon size={16} strokeWidth={1.7} /><span>{label}{hint && <small>{hint}</small>}</span>{current && <i />}</button>;
    })}</nav>
    <div className="vws-sidebar-note">统一工作台 · 来源决定中间工作区</div>
  </aside>;
}
