import { BellRing, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDateTime } from '../lib/date';
import { PLATFORM_META } from '../lib/platforms';
import { api } from '../services/api';
import type { WatchedAcEvent } from '../types';

function RelationshipNoticeItem({ event, timeZone, onDismiss }: { event: WatchedAcEvent; timeZone: string; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setLeaving(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  const label = event.nickname.trim() || event.account;
  const relation = event.relationship.trim();
  if (gone || event.dismissed) return null;

  return <aside className={`relationship-notice ${leaving ? 'leaving' : ''}`} onAnimationEnd={(animation) => {
    if (leaving && animation.target === animation.currentTarget) {
      setGone(true);
      onDismiss(event.id);
    }
  }}>
    <button
      className="relationship-notice-open"
      type="button"
      disabled={!event.problemUrl}
      aria-label={`打开 ${PLATFORM_META[event.platform].name} 题目 ${event.problemName || event.problemId}`}
      title="点击打开题目"
      onClick={() => { if (event.problemUrl) void api.openExternal(event.problemUrl); }}
    >
      <span className="relationship-notice-icon"><BellRing size={16} /></span>
      <span className="relationship-notice-copy">
        <small>{relation ? `${relation} · ` : ''}{PLATFORM_META[event.platform].name}</small>
        <strong>{label} 刚刚 AC 了</strong>
        <span>{event.problemName || event.problemId} · {formatDateTime(event.epochSecond, timeZone)}</span>
      </span>
    </button>
    <button className="relationship-notice-close" aria-label="关闭 AC 提醒" onClick={() => onDismiss(event.id)}><X size={15} /></button>
  </aside>;
}

export default function RelationshipNotice({ events, timeZone, onDismiss }: { events: WatchedAcEvent[]; timeZone: string; onDismiss: (id: number) => void }) {
  const visible = events.filter((event) => !event.dismissed).slice(0, 4);
  if (!visible.length) return null;
  return <div className="relationship-notices" aria-live="polite">
    {visible.map((event) => <RelationshipNoticeItem key={event.id} event={event} timeZone={timeZone} onDismiss={onDismiss} />)}
  </div>;
}

