import { useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { addressLabel, openFollowups, scheduledAppointments } from '../../data/selectors';
import { addDays, formatDate, formatMonth, formatTime, startOfWeek, toDateKey, todayKey } from '../../lib/dates';
import { PRODUCT } from '../../lib/constants';
import { go } from '../router';
import { Button, PageHeader, cx } from '../kit';
import { Icon } from '../icons';
import { FollowupCard } from './Followups';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Interne Kalenderansicht: Wiedervorlagen (gelb) und Calendly-Termine (grün, nur Spiegel). */
export function CalendarScreen() {
  useStoreVersion();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [sel, setSel] = useState(todayKey());
  const fus = openFollowups();
  const appts = scheduledAppointments();
  const fuBy = new Map<string, number>();
  fus.forEach((f) => fuBy.set(f.due_date, (fuBy.get(f.due_date) ?? 0) + 1));
  const apBy = new Map<string, number>();
  appts.forEach((a) => {
    const k = toDateKey(new Date(a.start_time!));
    apBy.set(k, (apBy.get(k) ?? 0) + 1);
  });
  const start = startOfWeek(month);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const t = todayKey();
  const overdue = fus.filter((f) => f.due_date < t).length;
  const dayFus = fus.filter((f) => (sel === t ? f.due_date <= t : f.due_date === sel));
  const dayAppts = appts.filter((a) => toDateKey(new Date(a.start_time!)) === sel);

  return (
    <div className="page cal-page">
      <PageHeader title="Kalender" sub="Wiedervorlagen & Termine (Termine kommen aus Calendly)" />
      <div className="cal-layout">
        <div className="cal">
          <div className="cal-head">
            <button className="icon-btn" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} aria-label="Vorheriger Monat">
              <Icon name="chevronLeft" />
            </button>
            <div className="cal-title">{formatMonth(month)}</div>
            <button className="icon-btn" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} aria-label="Nächster Monat">
              <Icon name="chevronRight" />
            </button>
          </div>
          <div className="cal-grid">
            {WD.map((w) => (
              <div key={w} className="cal-wd">
                {w}
              </div>
            ))}
            {cells.map((d) => {
              const k = toDateKey(d);
              const inMonth = d.getMonth() === month.getMonth();
              const nf = fuBy.get(k) ?? 0;
              const na = apBy.get(k) ?? 0;
              return (
                <button key={k} className={cx('cal-cell', !inMonth && 'cal-out', k === t && 'cal-today', k === sel && 'cal-sel')} onClick={() => setSel(k)}>
                  <span className="cal-day">{d.getDate()}</span>
                  <span className="cal-marks">
                    {nf > 0 && <span className="cal-fu">{nf}</span>}
                    {na > 0 && <span className="cal-ap">{na}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="cal-legend">
            <span>
              <span className="cal-fu">n</span> Wiedervorlagen
            </span>
            <span>
              <span className="cal-ap">n</span> Termine
            </span>
            {overdue > 0 && (
              <button className="link-btn text-danger" onClick={() => setSel(t)}>
                {overdue} überfällig (bei „heute“)
              </button>
            )}
          </div>
        </div>
        <div className="cal-day-list">
          <h2 className="group-title">{sel === t ? 'Heute fällig (inkl. überfällig)' : formatDate(sel)}</h2>
          {dayAppts.map((a) => {
            const l = a.address_id ? addressLabel(store.get('addresses', a.address_id)) : null;
            return (
              <button key={a.id} className="appt-row" onClick={() => a.address_id && go(`strasse/${store.get('addresses', a.address_id)?.street_id}`, { a: a.address_id })}>
                <span className="appt-time">{formatTime(a.start_time!)}</span>
                <span className="grow">
                  <strong>{a.customer_name}</strong>
                  <span className="muted small"> · {l ? l.line1 : a.address_text}</span>
                  <div className="small">{PRODUCT[a.main_product_id]?.label}</div>
                </span>
              </button>
            );
          })}
          <ul className="fu-list">
            {dayFus.map((f) => (
              <FollowupCard key={f.id} f={f} compact />
            ))}
          </ul>
          {!dayAppts.length && !dayFus.length && <div className="muted">Keine Einträge.</div>}
          <Button size="sm" icon="link" variant="ghost" onClick={() => go('einstellungen')}>
            Kalender-Abo (iPhone/Mac/Google) einrichten
          </Button>
        </div>
      </div>
    </div>
  );
}
