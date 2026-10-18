import { useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { addressLabel } from '../../data/selectors';
import { LEAD_SOURCES, PRODUCT } from '../../lib/constants';
import { formatDate, formatDateShort, formatTime, toDateKey, todayKey } from '../../lib/dates';
import type { Appointment } from '../../lib/types';
import { go } from '../router';
import { Button, Empty, PageHeader, Segmented, cx } from '../kit';
import { Icon } from '../icons';
import { AppointmentSheet } from '../components/AppointmentSheet';

export function AppointmentsScreen() {
  useStoreVersion();
  const [view, setView] = useState<'upcoming' | 'past' | 'pending' | 'canceled'>('upcoming');
  const [newOpen, setNewOpen] = useState(false);
  const now = new Date().toISOString();
  const all = store.all('appointments');
  const lists: Record<typeof view, Appointment[]> = {
    upcoming: all.filter((a) => a.status === 'scheduled' && (a.start_time ?? '') >= now).sort((a, b) => a.start_time!.localeCompare(b.start_time!)),
    past: all.filter((a) => (a.status === 'scheduled' || a.status === 'completed') && (a.start_time ?? '') < now).sort((a, b) => b.start_time!.localeCompare(a.start_time!)),
    pending: all.filter((a) => a.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at)),
    canceled: all.filter((a) => a.status === 'canceled' && a.start_time).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  };
  const list = lists[view];
  const byDay = new Map<string, Appointment[]>();
  for (const a of list) {
    const k = a.start_time ? toDateKey(new Date(a.start_time)) : 'offen';
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  return (
    <div className="page">
      <PageHeader
        title="Termine"
        sub="Terminquelle ist Calendly – hier gespiegelt inkl. Kundendaten."
        actions={
          <Button icon="plus" onClick={() => setNewOpen(true)} title="Termin ohne D2D-Adresse (POS, Messe)">
            POS/Messe
          </Button>
        }
      />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'upcoming', label: `Kommend (${lists.upcoming.length})` },
          { value: 'past', label: 'Vergangen' },
          { value: 'pending', label: `In Buchung (${lists.pending.length})` },
          { value: 'canceled', label: 'Storniert' },
        ]}
      />
      {!list.length && <Empty icon="calendar" title="Keine Termine" />}
      {[...byDay.entries()].map(([day, items]) => (
        <section key={day} className="fu-group">
          <h2 className="group-title">{day === 'offen' ? 'Ohne Zeit' : day === todayKey() ? `Heute · ${formatDate(day)}` : formatDateShort(day)}</h2>
          {items.map((a) => (
            <ApptCard key={a.id} a={a} />
          ))}
        </section>
      ))}
      <AppointmentSheet key={String(newOpen)} addressId={null} open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function ApptCard({ a }: { a: Appointment }) {
  const addr = a.address_id ? store.get('addresses', a.address_id) : undefined;
  const l = addressLabel(addr);
  return (
    <div className={cx('card', 'appt-card', a.status === 'canceled' && 'card-muted')}>
      <div className="card-row">
        <div className="appt-time-big">{a.start_time ? formatTime(a.start_time) : '–'}</div>
        <div className="grow">
          <div className="strong">{a.customer_name}</div>
          <div className="small">{addr ? `${l.line1}, ${l.line2}` : a.address_text}</div>
          <div className="small muted">
            {PRODUCT[a.main_product_id]?.label}
            {a.product_ids.length ? ` + ${a.product_ids.map((p) => PRODUCT[p]?.label).join(', ')}` : ''} · {LEAD_SOURCES.find((s) => s.key === a.lead_source)?.label}
          </div>
          {a.note && <div className="small tl-quote">„{a.note}"</div>}
          {a.status === 'canceled' && a.cancel_reason && <div className="small text-danger">Storniert: {a.cancel_reason}</div>}
        </div>
      </div>
      <div className="card-actions">
        <a className="btn btn-default btn-sm" href={`tel:${a.phone.replace(/\s/g, '')}`}>
          <Icon name="phone" size={16} /> <span>{a.phone}</span>
        </a>
        {addr && (
          <Button size="sm" icon="pin" onClick={() => go(`strasse/${addr.street_id}`, { a: addr.id })}>
            Adresse
          </Button>
        )}
        {a.calendly_reschedule_url && (
          <a className="btn btn-ghost btn-sm" href={a.calendly_reschedule_url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={16} /> <span>Verschieben</span>
          </a>
        )}
        {a.calendly_cancel_url && (
          <a className="btn btn-ghost btn-sm" href={a.calendly_cancel_url} target="_blank" rel="noopener noreferrer">
            <Icon name="x" size={16} /> <span>Stornieren</span>
          </a>
        )}
      </div>
    </div>
  );
}
