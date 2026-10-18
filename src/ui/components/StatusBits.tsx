import { STATUS, PRIORITY, TAG } from '../../lib/constants';
import type { Priority, StatusKey } from '../../lib/types';
import { Icon } from '../icons';

export function StatusPill({ status, size = 'md' }: { status: StatusKey; size?: 'sm' | 'md' }) {
  const s = STATUS[status];
  return (
    <span className={`status-pill status-pill-${size}`} style={{ background: s.bg, color: s.fg, borderColor: s.accent }}>
      <Icon name={s.icon} size={size === 'sm' ? 13 : 15} />
      {size === 'sm' ? s.short : s.label}
    </span>
  );
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const p = PRIORITY[priority];
  return (
    <span className="prio-pill" style={{ color: p.color, borderColor: p.color }}>
      {priority === 'high' && <Icon name="flame" size={13} />}
      {p.label}
    </span>
  );
}

export function TagList({ tags, max = 99 }: { tags: string[]; max?: number }) {
  if (!tags.length) return null;
  return (
    <span className="tag-list">
      {tags.slice(0, max).map((t) => (
        <span key={t} className="tag-mini">
          {TAG[t]?.label ?? t}
        </span>
      ))}
      {tags.length > max && <span className="tag-mini">+{tags.length - max}</span>}
    </span>
  );
}

export function SyncDot({ state, pending }: { state: string; pending: number }) {
  const map: Record<string, { label: string; cls: string; icon: string }> = {
    local: { label: 'Lokal (Demo)', cls: 'sync-local', icon: 'cloud' },
    synced: { label: 'Synchronisiert', cls: 'sync-ok', icon: 'cloud' },
    syncing: { label: 'Synchronisiere …', cls: 'sync-busy', icon: 'refresh' },
    pending: { label: `${pending} ausstehend`, cls: 'sync-pending', icon: 'refresh' },
    offline: { label: `Offline · ${pending} gespeichert`, cls: 'sync-offline', icon: 'offline' },
    error: { label: 'Sync-Fehler', cls: 'sync-error', icon: 'alert' },
  };
  const m = map[state] ?? map.local;
  return (
    <span className={`sync ${m.cls}`} title={m.label}>
      <Icon name={m.icon} size={15} />
      <span className="sync-label">{m.label}</span>
    </span>
  );
}
