import { BellRing, X } from 'lucide-react';
import { formatDateTime } from '../lib/date';
import { PLATFORM_META } from '../lib/platforms';
import type { WatchedAcEvent } from '../types';

export default function RelationshipNotice({ events, timeZone, onDismiss }: { events: WatchedAcEvent[]; timeZone: string; onDismiss: (id: number) => void }) {
  const visible = events.filter((event) => !event.dismissed).slice(0, 4);
  if (!visible.length) return null;
  return <div className="relationship-notices" aria-live="polite">
    {visible.map((event) => {
      const label = event.nickname.trim() || event.account;
      const relation = event.relationship.trim() || '未备注';
      return <aside className="relationship-notice" role="alert" key={event.id}>
        <button className="relationship-notice-close" aria-label="关闭 AC 提醒" onClick={() => onDismiss(event.id)}><X size={15} /></button>
        <div className="relationship-notice-icon"><BellRing size={16} /></div>
        <div className="relationship-notice-copy">
          <small>{relation} · {PLATFORM_META[event.platform].name}</small>
          <strong>{label} 刚刚 AC 了</strong>
          <span>{event.problemName || event.problemId} · {formatDateTime(event.epochSecond, timeZone)}</span>
        </div>
      </aside>;
    })}
  </div>;
}

