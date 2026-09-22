import { AlertTriangle, BellRing, CheckCircle2, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatDateTime } from '../lib/date';
import { PLATFORM_META, PLATFORM_ORDER } from '../lib/platforms';
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
  onDelete: (id: number) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
  notify: (message: string) => void;
}

type BindingDraft = Record<Platform, { selected: boolean; account: string; secret: string }>;

function emptyBindings(): BindingDraft {
  return Object.fromEntries(PLATFORM_ORDER.map((platform, index) => [platform, { selected: index === 0, account: '', secret: '' }])) as BindingDraft;
}

const emptyDraft = () => ({ nickname: '', relationship: '队友', bindings: emptyBindings() });

function personLabel(person: WatchedPerson) {
  return person.nickname.trim() || person.account;
}

function statusLabel(person: WatchedPerson) {
  if (person.status === 'checking') return '检查中';
  if (person.status === 'ok') return person.message || '检查成功';
  if (person.status === 'warning') return person.message || '部分可用';
  if (person.status === 'error') return person.message || '检查失败';
  return person.initialized ? person.message || '尚未检查' : '首次检查会建立历史基线';
}

export default function RelationshipsPage({ people, events, timeZone, syncing, autoCheck, onAutoCheck, onSync, onSyncPerson, onSave, onDelete, onDismiss, notify }: Props) {
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const selectedCount = PLATFORM_ORDER.filter((platform) => draft.bindings[platform].selected).length;
  const peopleCount = new Set(people.map((person) => `${person.nickname.trim() || person.account}\u0000${person.relationship.trim()}`)).size;

  const updateDraft = (key: 'nickname' | 'relationship', value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const updateBinding = (platform: Platform, patch: Partial<BindingDraft[Platform]>) => setDraft((current) => ({
    ...current,
    bindings: { ...current.bindings, [platform]: { ...current.bindings[platform], ...patch } },
  }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const bindings = PLATFORM_ORDER
      .filter((platform) => draft.bindings[platform].selected)
      .map((platform) => ({ platform, account: draft.bindings[platform].account.trim(), secret: draft.bindings[platform].secret.trim() }));
    if (!bindings.length) { notify('请至少选择一个平台'); return; }
    const missing = bindings.find((binding) => !binding.account);
    if (missing) { notify(`请填写 ${PLATFORM_META[missing.platform].name} 账号`); return; }
    setSaving(true);
    try {
      await onSave(draft.nickname, draft.relationship, bindings);
      setDraft(emptyDraft());
    } catch (error) {
      notify(String(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (person: WatchedPerson) => {
    if (!confirm(`移除 ${personLabel(person)}？这会同时删除该关系人的本地提交缓存和提醒记录。`)) return;
    try { await onDelete(person.id); } catch (error) { notify(String(error)); }
  };

  return <>
    <header className="topbar relationships-head">
      <div><small>PEOPLE TO WATCH</small><h1>关系人</h1><p>关注队友、学弟等公开账号；发现新的 AC 后弹出可关闭提醒。</p></div>
      <div className="relationships-actions">
        <label className="relationship-auto"><span>自动检查</span><button type="button" role="switch" aria-checked={autoCheck} aria-label="自动检查关系人" className={`switch ${autoCheck ? 'active' : ''}`} onClick={() => onAutoCheck(!autoCheck)}><i /></button></label>
        <button className="primary" onClick={() => void onSync()} disabled={syncing || !people.length}><RefreshCw size={16} className={syncing ? 'spin' : ''} />{syncing ? '检查中' : '检查全部'}</button>
      </div>
    </header>

    <section className="settings-intro relationship-intro"><strong><BellRing size={15} />提醒规则</strong><span>第一次检查只建立历史基线，不会把旧题全部弹出；以后每次只提醒新发现的 AC。自动检查打开时，应用启动后和每 10 分钟检查一次。</span></section>

    <div className="relationships-layout">
      <section className="panel relationship-add-card">
        <div className="panel-head"><div><small>ADD PERSON</small><h2>添加关系人</h2><p>一次可绑定多个平台，账号只用于读取公开提交记录。</p></div><Users size={18} /></div>
        <form className="relationship-form" onSubmit={submit}>
          <label><span>称呼</span><input value={draft.nickname} onChange={(event) => updateDraft('nickname', event.target.value)} placeholder="例如：小明" /></label>
          <label><span>关系标签</span><input value={draft.relationship} onChange={(event) => updateDraft('relationship', event.target.value)} placeholder="例如：队友、学弟" /></label>
          <fieldset className="relationship-platforms">
            <legend>绑定平台</legend>
            {PLATFORM_ORDER.map((platform) => {
              const binding = draft.bindings[platform];
              const meta = PLATFORM_META[platform];
              return <div className={`relationship-platform-binding ${binding.selected ? 'selected' : ''}`} key={platform}>
                <label className="relationship-platform-toggle"><input type="checkbox" checked={binding.selected} onChange={(event) => updateBinding(platform, { selected: event.target.checked })} /><span className="platform-monogram" style={{ color: meta.accent }}>{meta.short}</span><strong>{meta.name}</strong></label>
                {binding.selected && <div className="relationship-platform-fields">
                  <label><span>账号 ID</span><input required value={binding.account} onChange={(event) => updateBinding(platform, { account: event.target.value })} placeholder={meta.accountHint} /></label>
                  {meta.secretHint && <label><span>Cookie / 凭据（可选）</span><input type="password" autoComplete="off" value={binding.secret} onChange={(event) => updateBinding(platform, { secret: event.target.value })} placeholder={meta.secretHint} /></label>}
                </div>}
              </div>;
            })}
          </fieldset>
          <button className="primary relationship-save" type="submit" disabled={saving || syncing || !selectedCount}><Plus size={15} />{saving ? '保存中' : `保存 ${selectedCount} 个平台`}</button>
        </form>
      </section>

      <section className="panel relationship-people-card">
        <div className="panel-head"><div><small>WATCH LIST</small><h2>已添加的人</h2><p>{people.length ? `共 ${peopleCount} 人 · ${people.length} 个平台账号；每个平台独立保存检查进度。` : '还没有添加关系人。'}</p></div></div>
        <div className="relationship-list">
          {people.map((person) => <article className="relationship-person" key={person.id}>
            <span className="platform-monogram" style={{ color: PLATFORM_META[person.platform].accent }}>{PLATFORM_META[person.platform].short}</span>
            <div className="relationship-person-main"><strong>{personLabel(person)}</strong><span>{person.relationship || '关系人'} · {person.account}</span><small className={`relationship-status ${person.status}`}>{person.status === 'ok' ? <CheckCircle2 size={13} /> : person.status === 'error' || person.status === 'warning' ? <AlertTriangle size={13} /> : null}{statusLabel(person)}</small></div>
            <div className="relationship-person-meta"><small>上次检查</small><span>{formatDateTime(person.lastSuccess, timeZone)}</span></div>
            <div className="source-actions relationship-person-actions"><button onClick={() => void onSyncPerson(person.id)} disabled={syncing}><RefreshCw size={13} className={syncing ? 'spin' : ''} />检查</button><button className="danger-ghost" onClick={() => void remove(person)} disabled={syncing}><Trash2 size={13} />移除</button></div>
          </article>)}
          {!people.length && <div className="empty relationship-empty"><Users size={20} /><span>添加一个账号后，第一次检查会先建立历史基线。</span></div>}
        </div>
      </section>
    </div>

    <section className="panel relationship-events-card">
      <div className="panel-head"><div><small>AC ACTIVITY</small><h2>最近 AC 提醒</h2><p>关闭的提醒仍会保留在这里，方便回看。</p></div><span className="relationship-event-count">{events.length} 条</span></div>
      <div className="relationship-event-list">
        {events.map((event) => <article className={`relationship-event-row ${event.dismissed ? 'dismissed' : ''}`} key={event.id}>
          <span className="platform-monogram" style={{ color: PLATFORM_META[event.platform].accent }}>{PLATFORM_META[event.platform].short}</span>
          <div><strong>{event.nickname.trim() || event.account} <em>{event.relationship || '关系人'}</em></strong><span>AC 了 {event.problemName || event.problemId}</span><small>{event.account} · {formatDateTime(event.epochSecond, timeZone)}</small></div>
          {event.dismissed ? <small className="relationship-dismissed">已关闭</small> : <button className="icon-btn" aria-label="关闭提醒" onClick={() => void onDismiss(event.id)}><X size={14} /></button>}
        </article>)}
        {!events.length && <div className="empty relationship-empty"><BellRing size={20} /><span>暂时没有新的 AC 记录。</span></div>}
      </div>
    </section>
  </>;
}
