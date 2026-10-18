import { store } from '../../data/store';
import { historyOf } from '../../data/selectors';
import { PRIORITY, PRODUCT, TAG, STATUS } from '../../lib/constants';
import { formatDate, formatDateTime, formatTime } from '../../lib/dates';
import type { HistoryEntry } from '../../lib/types';
import { Icon } from '../icons';
import { StatusPill } from './StatusBits';

function who(userId: string | null) {
  if (!userId) return 'System';
  if (userId === store.user?.id) return store.user?.display_name || 'Ich';
  return 'Teammitglied';
}

function Entry({ h }: { h: HistoryEntry }) {
  const c = h.changes as Record<string, unknown>;
  const appt = h.appointment_id ? store.get('appointments', h.appointment_id) : undefined;
  const fu = h.followup_id ? store.get('followups', h.followup_id) : undefined;
  const note = h.note_id ? store.get('notes', h.note_id)?.body ?? (c.note as string) : (c.note as string | undefined);
  let title: React.ReactNode = null;
  switch (h.kind) {
    case 'note':
      title = (
        <span className="tl-kind">
          <Icon name="note" size={15} /> Notiz
        </span>
      );
      break;
    case 'tags':
      title = (
        <span className="tl-kind">
          <Icon name="tag" size={15} /> Potenzial-Tags
        </span>
      );
      break;
    case 'restore':
      title = (
        <span className="tl-kind">
          <Icon name="restore" size={15} /> Wiederhergestellt
        </span>
      );
      break;
    case 'import':
      title = (
        <span className="tl-kind tl-warn">
          <Icon name="alert" size={15} /> In Importquelle nicht mehr vorhanden – bitte prüfen
        </span>
      );
      break;
    case 'system':
      title = (
        <span className="tl-kind">
          <Icon name="check" size={15} /> {c.followup ? 'Wiedervorlage erledigt' : (c.text as string) ?? 'System'}
        </span>
      );
      break;
    default:
      title = h.status ? <StatusPill status={h.status} size="sm" /> : null;
  }
  return (
    <li className="tl-item">
      <div className="tl-dot" style={{ background: h.status ? STATUS[h.status].bg : '#94a3b8', borderColor: h.status ? STATUS[h.status].accent : '#94a3b8' }} />
      <div className="tl-main">
        <div className="tl-meta">
          {formatDateTime(h.occurred_at)} · {who(h.user_id)}
        </div>
        <div className="tl-title">{title}</div>
        {h.kind === 'exclude' && typeof c.reason === 'string' && <div className="tl-text">Grund: {c.reason}</div>}
        {h.kind === 'followup' && (
          <div className="tl-text">
            {fu ? PRIORITY[fu.priority].label : PRIORITY[(c.priority as 'high') ?? 'medium']?.label} · fällig {formatDate((fu?.due_date ?? c.due_date) as string)}
            {(fu?.period_label ?? c.period) && fu?.preset !== 'date' ? ` (${fu?.period_label ?? c.period})` : ''}
            {c.contacted ? ' · Kunde gesprochen' : ''}
            {fu && fu.status !== 'open' && <span className="tl-muted"> · {fu.status === 'done' ? 'erledigt' : 'ersetzt'}</span>}
          </div>
        )}
        {h.kind === 'appointment' && (
          <div className="tl-text">
            {appt?.start_time || c.start_time ? (
              <>
                <strong>
                  {formatDate((appt?.start_time ?? c.start_time) as string)} · {formatTime((appt?.start_time ?? c.start_time) as string)} Uhr
                </strong>
                {appt && (
                  <>
                    {' '}
                    · {PRODUCT[appt.main_product_id]?.label}
                    {appt.product_ids.length ? ` + ${appt.product_ids.map((p) => PRODUCT[p]?.label).join(', ')}` : ''}
                    {appt.status === 'canceled' && <span className="tl-warn"> · storniert</span>}
                  </>
                )}
              </>
            ) : (
              (c.text as string) ?? 'Termin'
            )}
            {appt?.note && <div className="tl-quote">„{appt.note}"</div>}
          </div>
        )}
        {(h.tags_added.length > 0 || h.tags_removed.length > 0) && (
          <div className="tl-tags">
            {h.tags_added.map((t) => (
              <span key={t} className="tag-mini tag-add">
                + {TAG[t]?.label ?? t}
              </span>
            ))}
            {h.tags_removed.map((t) => (
              <span key={t} className="tag-mini tag-rem">
                − {TAG[t]?.label ?? t}
              </span>
            ))}
          </div>
        )}
        {note && <div className="tl-quote">{note}</div>}
      </div>
    </li>
  );
}

export function Timeline({ addressId }: { addressId: string }) {
  const list = historyOf(addressId);
  if (!list.length) return <div className="muted small">Noch keine Aktivitäten.</div>;
  return (
    <ol className="timeline">
      {list.map((h) => (
        <Entry key={h.id} h={h} />
      ))}
    </ol>
  );
}
