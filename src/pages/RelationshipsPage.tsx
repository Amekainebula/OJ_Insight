import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Pencil, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import PlatformIcon from '../components/PlatformIcon';
import { formatDateTime } from '../lib/date';
import { PLATFORM_META, PLATFORM_ORDER } from '../lib/platforms';
import { api } from '../services/api';
import type { Platform, WatchedAcEvent, WatchedBindingInput, WatchedPerson } from '../types';

interface Props {
  people: WatchedPerson[];
  events: WatchedAcEvent[];
  timeZone: string;
  syncing: boolean;
  autoCheck: boolean;
  onAutoCheck: (value: boolean) => void;
  onSync: () => Promise<void>;
  onSyncPerson: (id: number) => Promise<void>;
  onSave: (nickname: string, relationship: string, bindings: WatchedBindingInput[]) => Promise<void>;
  onEdit: (personId: number, nickname: string, relationship: string, secret: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
  notify: (message: string) => void;
}

type BindingDraft = Record<Platform, { selected: boolean; account: string; secret: string }>;

function emptyBindings(): BindingDraft {
  return Object.fromEntries(PLATFORM_ORDER.map((platform, index) => [platform, { selected: index === 0, account: '', secret: '' }])) as BindingDraft;
}

const emptyDraft = () => ({ nickname: '', relationship: '', bindings: emptyBindings() });

function personLabel(person: WatchedPerson) {
  return person.nickname.trim() || person.account;
}

function groupWatchedPeople(people: WatchedPerson[]) {
  const groups = new Map<string, { key: string; label: string; people: WatchedPerson[] }>();
  for (const person of people) {
    const nickname = person.nickname.trim();
    const key = nickname
      ? `nickname:${nickname.toLocaleLowerCase()}`
      : `account:${person.platform}:${person.account.toLocaleLowerCase()}`;
    const group = groups.get(key) || { key, label: personLabel(person), people: [] };
    group.people.push(person);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function statusLabel(person: WatchedPerson) {
  if (person.status === 'checking') return '检查中';
  if (person.status === 'ok') return person.message || '检查成功';
  if (person.status === 'warning') return person.message || '部分可用';
  if (person.status === 'error') return person.message || '检查失败';
  return person.initialized ? person.message || '尚未检查' : '首次检查会建立历史基线';
}

export default function RelationshipsPage({ people, events, timeZone, syncing, autoCheck, onAutoCheck, onSync, onSyncPerson, onSave, onEdit, onDelete, onDismiss, notify }: Props) {
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<WatchedPerson | null>(null);
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(() => new Set());
  const selectedCount = PLATFORM_ORDER.filter((platform) => draft.bindings[platform].selected).length;
  const peopleGroups = groupWatchedPeople(people);

  useEffect(() => {
    if (!addOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAddOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [addOpen]);

  const updateDraft = (key: 'nickname' | 'relationship', value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const updateBinding = (platform: Platform, patch: Partial<BindingDraft[Platform]>) => setDraft((current) => ({
    ...current,
    bindings: { ...current.bindings, [platform]: { ...current.bindings[platform], ...patch } },
  }));
  const openAdd = () => {
    setEditingPerson(null);
    setDraft(emptyDraft());
    setAddOpen(true);
  };
  const openEdit = (person: WatchedPerson) => {
    setEditingPerson(person);
    setDraft({
      nickname: person.nickname,
      relationship: person.relationship,
      bindings: Object.fromEntries(PLATFORM_ORDER.map((platform) => [platform, {
        selected: platform === person.platform,
        account: platform === person.platform ? person.account : '',
        secret: platform === person.platform ? person.secret : '',
      }])) as BindingDraft,
    });
    setAddOpen(true);
  };
  const togglePerson = (key: string) => setExpandedPeople((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.nickname.trim()) { notify('称号为必填项'); return; }
    if (editingPerson) {
      setSaving(true);
      try {
        await onEdit(editingPerson.id, draft.nickname, draft.relationship, draft.bindings[editingPerson.platform].secret);
        setAddOpen(false);
        setEditingPerson(null);
      } catch (error) {
        notify(String(error));
      } finally {
        setSaving(false);
      }
      return;
    }
    const bindings = PLATFORM_ORDER
      .filter((platform) => draft.bindings[platform].selected)
      .map((platform) => ({ platform, account: draft.bindings[platform].account.trim(), secret: draft.bindings[platform].secret.trim() }));
    if (!bindings.length) { notify('请至少选择一个平台'); return; }
    const missing = bindings.find((binding) => !binding.account);
    if (missing) { notify(`请填写 ${PLATFORM_META[missing.platform].name} 账号`); return; }
    const duplicate = bindings.find((binding) => people.some((person) => person.platform === binding.platform && person.account.trim().toLocaleLowerCase() === binding.account.toLocaleLowerCase()));
    if (duplicate) { notify(`该用户已经被添加了：${PLATFORM_META[duplicate.platform].name} · ${duplicate.account}`); return; }
    setSaving(true);
    try {
      await onSave(draft.nickname, draft.relationship, bindings);
      setDraft(emptyDraft());
      setAddOpen(false);
    } catch (error) {
      notify(String(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (person: WatchedPerson) => {
    if (!confirm(`移除 ${PLATFORM_META[person.platform].name} 账号 ${person.account}？这会同时删除该账号的本地提交缓存和提醒记录。`)) return;
    try { await onDelete(person.id); } catch (error) { notify(String(error)); }
  };

  return <>
    <header className="topbar relationships-head">
      <div><small>PEOPLE TO WATCH</small><h1>关注</h1><p>关注队友、学弟等公开账号；发现新的 AC 后弹出可关闭提醒。</p></div>
      <div className="relationships-actions">
        <label className="relationship-auto"><span>自动检查</span><button type="button" role="switch" aria-checked={autoCheck} aria-label="自动检查关注账号" className={`switch ${autoCheck ? 'active' : ''}`} onClick={() => onAutoCheck(!autoCheck)}><i /></button></label>
        <button className="relationship-add-trigger" onClick={openAdd}><Plus size={16} />添加关注</button>
        <button className="primary" onClick={() => void onSync()} disabled={syncing || !people.length}><RefreshCw size={16} className={syncing ? 'spin' : ''} />{syncing ? '检查中' : '检查全部'}</button>
      </div>
    </header>

    <section className="settings-intro relationship-intro"><strong><BellRing size={15} />提醒规则</strong><span>第一次检查只建立历史基线，不会把旧题全部弹出；以后每次只提醒新发现的 AC。自动检查打开时，应用启动后和每 10 分钟检查一次。</span></section>

    <div className="relationships-layout">
      <section className="panel relationship-people-card">
        <div className="panel-head"><div><small>WATCH LIST</small><h2>关注列表</h2><p>{people.length ? `共 ${peopleGroups.length} 人 · ${people.length} 个平台账号；相同称呼的跨平台账号会合并显示。` : '还没有添加关注账号。'}</p></div></div>
        <div className="relationship-list">
          {peopleGroups.map((group) => {
            const expandable = group.people.length > 1;
            const expanded = !expandable || expandedPeople.has(group.key);
            const heading = <>
              <span className="relationship-person-heading-main"><Users size={18} /><span><strong>{group.label}</strong><small>{group.people.length} 个平台账号</small></span></span>
              <span className="relationship-person-heading-side">{group.people[0].relationship.trim() && <small>{group.people[0].relationship.trim()}</small>}{expandable && (expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}</span>
            </>;
            return <article className={`relationship-person-group ${expandable && !expanded ? 'collapsed' : ''}`} key={group.key}>
            {expandable
              ? <button type="button" className="relationship-person-heading" aria-expanded={expanded} onClick={() => togglePerson(group.key)}>{heading}</button>
              : <div className="relationship-person-heading static">{heading}</div>}
            {expanded && <div className="relationship-account-list">{group.people.map((person) => <div className="relationship-account-row" key={person.id}>
              <PlatformIcon platform={person.platform} />
              <div className="relationship-account-main"><strong>{PLATFORM_META[person.platform].name}</strong><span>{person.account}</span><small className={`relationship-status ${person.status}`}>{person.status === 'ok' ? <CheckCircle2 size={13} /> : person.status === 'error' || person.status === 'warning' ? <AlertTriangle size={13} /> : null}{statusLabel(person)}</small></div>
              <div className="relationship-person-meta"><small>上次检查</small><span>{formatDateTime(person.lastSuccess, timeZone)}</span></div>
              <div className="source-actions relationship-person-actions"><button onClick={() => void onSyncPerson(person.id)} disabled={syncing}><RefreshCw size={13} className={syncing ? 'spin' : ''} />检查</button><button onClick={() => openEdit(person)} disabled={syncing}><Pencil size={13} />编辑</button><button className="danger-ghost" onClick={() => void remove(person)} disabled={syncing}><Trash2 size={13} />移除</button></div>
            </div>)}</div>}
          </article>;
          })}
          {!people.length && <div className="empty relationship-empty"><Users size={20} /><span>添加一个账号后，第一次检查会先建立历史基线。</span></div>}
        </div>
      </section>
    </div>

    {addOpen && <div className="relationship-add-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
      <section className="relationship-add-dialog" role="dialog" aria-modal="true" aria-labelledby="relationship-add-title">
        <header className="relationship-add-dialog-head"><div><small>{editingPerson ? 'EDIT PERSON' : 'ADD PERSON'}</small><h2 id="relationship-add-title">{editingPerson ? '编辑关注' : '添加关注'}</h2></div><button className="icon-btn" aria-label="关闭添加关注" onClick={() => { setAddOpen(false); setEditingPerson(null); }}><X size={17} /></button></header>
        <form className="relationship-form" onSubmit={submit}>
          <label><span>称呼（必填）</span><input autoFocus required value={draft.nickname} onChange={(event) => updateDraft('nickname', event.target.value)} /></label>
          <label><span>备注（选填）</span><input value={draft.relationship} onChange={(event) => updateDraft('relationship', event.target.value)} /></label>
          <fieldset className="relationship-platforms">
            <legend>绑定平台</legend>
            {editingPerson ? <div className="relationship-platform-binding selected">
              <label className="relationship-platform-toggle relationship-platform-readonly"><PlatformIcon platform={editingPerson.platform} /><strong>{PLATFORM_META[editingPerson.platform].name}</strong><span>{editingPerson.account}</span></label>
              {PLATFORM_META[editingPerson.platform].secretHint && <div className="relationship-platform-fields"><label><span>Cookie / 凭据（可选）</span><input type="password" autoComplete="off" value={draft.bindings[editingPerson.platform].secret} onChange={(event) => updateBinding(editingPerson.platform, { secret: event.target.value })} placeholder={PLATFORM_META[editingPerson.platform].secretHint} /></label></div>}
            </div> : PLATFORM_ORDER.map((platform) => {
              const binding = draft.bindings[platform];
              const meta = PLATFORM_META[platform];
              return <div className={`relationship-platform-binding ${binding.selected ? 'selected' : ''}`} key={platform}>
                <label className="relationship-platform-toggle"><input type="checkbox" checked={binding.selected} onChange={(event) => updateBinding(platform, { selected: event.target.checked })} /><span className="relationship-check-indicator" aria-hidden="true" /><PlatformIcon platform={platform} /><strong>{meta.name}</strong></label>
                {binding.selected && <div className="relationship-platform-fields">
                  <label><span>账号 ID</span><input required value={binding.account} onChange={(event) => updateBinding(platform, { account: event.target.value })} placeholder={meta.accountHint} /></label>
                  {meta.secretHint && <label><span>Cookie / 凭据（可选）</span><input type="password" autoComplete="off" value={binding.secret} onChange={(event) => updateBinding(platform, { secret: event.target.value })} placeholder={meta.secretHint} /></label>}
                </div>}
              </div>;
            })}
          </fieldset>
          <footer className="relationship-add-dialog-actions"><button type="button" className="relationship-cancel" onClick={() => { setAddOpen(false); setEditingPerson(null); }}>取消</button><button className="primary relationship-save" type="submit" disabled={saving || syncing || (!editingPerson && !selectedCount)}>{editingPerson ? <Pencil size={15} /> : <Plus size={15} />}{saving ? '保存中' : editingPerson ? '保存修改' : `保存 ${selectedCount} 个平台`}</button></footer>
        </form>
      </section>
    </div>}

    <section className="panel relationship-events-card">
      <div className="panel-head"><div><small>AC ACTIVITY</small><h2>最近 AC 提醒</h2></div><span className="relationship-event-count">{events.length} 条</span></div>
      <div className="relationship-event-list">
        {events.map((event) => <article className={`relationship-event-row ${event.dismissed ? 'dismissed' : ''}`} key={event.id}>
          <PlatformIcon platform={event.platform} />
          <div><strong>{event.nickname.trim() || event.account}{event.relationship.trim() && <> <em>{event.relationship.trim()}</em></>}</strong><span>AC 了 {event.problemName || event.problemId}</span><small>{event.account} · {formatDateTime(event.epochSecond, timeZone)}</small></div>
          {event.dismissed
            ? <div className="source-actions relationship-event-actions"><button disabled={!event.problemUrl} title={event.problemUrl ? '打开对应题目' : '没有题目链接'} onClick={() => event.problemUrl && void api.openExternal(event.problemUrl).catch((error) => notify(`打开题目失败：${String(error)}`))}><ExternalLink size={14} />题目跳转</button></div>
            : <button className="icon-btn" aria-label="关闭提醒" onClick={() => void onDismiss(event.id)}><X size={14} /></button>}
        </article>)}
        {!events.length && <div className="empty relationship-empty"><BellRing size={20} /><span>暂时没有新的 AC 记录。</span></div>}
      </div>
    </section>
  </>;
}
