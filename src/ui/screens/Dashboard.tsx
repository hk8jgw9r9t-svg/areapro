import { useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { addressLabel, appointmentsThisWeek, appointmentsToday, followupBuckets, townCounts } from '../../data/selectors';
import { computeKpis, emptyFilter, groupStats } from '../../lib/analytics';
import { PRODUCT, STATUS } from '../../lib/constants';
import { addDays, formatTime } from '../../lib/dates';
import { activeTownId, usePrefs } from '../prefs';
import { go } from '../router';
import { Button, Empty, PageHeader, Segmented, Stat } from '../kit';
import { Icon } from '../icons';
import { FollowupCard } from './Followups';

type Period = 'today' | '7' | '30' | 'all';

function periodFrom(p: Period): string | null {
  const d = new Date();
  if (p === 'today') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  if (p === '7') return addDays(d, -7).toISOString();
  if (p === '30') return addDays(d, -30).toISOString();
  return null;
}

export function DashboardScreen() {
  useStoreVersion();
  usePrefs();
  const [period, setPeriod] = useState<Period>('today');
  const townId = activeTownId();
  const town = store.get('towns', townId);
  if (!town)
    return (
      <div className="page">
        <PageHeader title="Willkommen bei AreaPro" sub="Dein D2D-Potenzialmanager" />
        <Empty icon="pin" title="Starte mit deinem ersten Ort">
          <p>Ort suchen (Name oder PLZ) → Adressen importieren → Straße für Straße qualifizieren.</p>
          <Button variant="primary" size="lg" icon="plus" onClick={() => go('import')}>
            Ort hinzufügen
          </Button>
        </Empty>
      </div>
    );
  const c = townCounts(town.id);
  const b = followupBuckets();
  const apToday = appointmentsToday();
  const apWeek = appointmentsThisWeek();
  const k = computeKpis({ ...emptyFilter, from: periodFrom(period) });
  const streets = groupStats({ ...emptyFilter, townId: town.id }, 'street');
  const notHomeStreets = [...streets].filter((s) => s.notHome > 0).sort((a, b2) => b2.notHome - a.notHome).slice(0, 6);
  const potStreets = streets.filter((s) => s.potentials > 0).slice(0, 6);
  const lastAddr = store
    .all('addresses')
    .filter((a) => a.town_id === town.id && a.last_activity_at)
    .sort((a, b2) => (b2.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''))[0];

  return (
    <div className="page">
      <PageHeader
        title={
          <button className="town-switch" onClick={() => go('orte')}>
            {town.name} <Icon name="down" size={18} />
          </button>
        }
        sub={new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
      />

      {lastAddr && (
        <button className="continue-card" onClick={() => go(`strasse/${lastAddr.street_id}`, { a: lastAddr.id })}>
          <Icon name="signpost" size={22} />
          <div className="grow">
            <div className="small muted">Weiterarbeiten</div>
            <div className="strong">{addressLabel(lastAddr).line1}</div>
          </div>
          <Icon name="arrowRight" />
        </button>
      )}

      {(b.overdue.length > 0 || b.today.length > 0) && (
        <button className="alert-card" onClick={() => go('wiedervorlagen')}>
          <Icon name="clock" size={22} />
          <span className="grow">
            <strong>{b.today.length} Wiedervorlage(n) heute fällig</strong>
            {b.overdue.length > 0 && <span> · {b.overdue.length} überfällig</span>}
          </span>
          <Icon name="chevronRight" />
        </button>
      )}

      <h2 className="section-h">Heute</h2>
      <div className="stats">
        <Stat label="Unbearbeitete Adressen" value={c.unprocessed} sub={`von ${c.total} in ${town.name}`} icon="circle" onClick={() => go('adressen')} />
        <Stat label="Wiedervorlagen heute" value={b.today.length} tone="#ca8a04" icon="clock" onClick={() => go('wiedervorlagen')} />
        <Stat label="Überfällig" value={b.overdue.length} tone={b.overdue.length ? '#dc2626' : undefined} icon="alert" onClick={() => go('wiedervorlagen')} />
        <Stat label="Termine heute" value={apToday.length} tone="#16a34a" icon="calendarCheck" onClick={() => go('termine')} />
        <Stat label="Termine diese Woche" value={apWeek.length} tone="#16a34a" icon="calendar" onClick={() => go('termine')} />
      </div>

      {apToday.length > 0 && (
        <div className="card">
          {apToday.map((a) => (
            <div key={a.id} className="appt-line">
              <strong>{formatTime(a.start_time!)}</strong> {a.customer_name} · {a.address_text} · {PRODUCT[a.main_product_id]?.label}
            </div>
          ))}
        </div>
      )}

      <div className="section-row">
        <h2 className="section-h">Statistik</h2>
        <Segmented
          size="sm"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'today', label: 'Heute' },
            { value: '7', label: '7 Tage' },
            { value: '30', label: '30 Tage' },
            { value: 'all', label: 'Gesamt' },
          ]}
        />
      </div>
      <div className="stats stats-compact">
        <Stat label="Besuchte Adressen" value={k.processed} />
        <Stat label="Nicht angetroffen" value={k.notHome} tone={STATUS.not_home.bg} />
        <Stat label="Angetroffen" value={k.contacted} tone={STATUS.contacted.bg} sub={`${k.contactRate.toFixed(0)} % Kontaktquote`} />
        <Stat label="Wiedervorlagen" value={k.followups} tone={STATUS.followup.accent} />
        <Stat label="Termine" value={k.appointments} tone={STATUS.appointment.bg} sub={`${k.appointmentsPer100.toFixed(1)} je 100`} />
        <Stat label="Kein Interesse" value={k.notInterested} tone={STATUS.not_interested.bg} />
        <Stat label="Kein Potenzial" value={k.noPotential} tone={STATUS.no_potential.bg} />
      </div>

      <h2 className="section-h">{town.name} gesamt</h2>
      <div className="stats stats-compact">
        <Stat label="Bearbeitet" value={c.processed} />
        <Stat label="Unbearbeitet" value={c.unprocessed} />
        <Stat label="Wiedervorlagen" value={c.followups} />
        <Stat label="Hohe Priorität" value={c.followupsHigh} tone="#dc2626" />
        <Stat label="Termine" value={c.byStatus.appointment ?? 0} />
        <Stat label="Nicht angetroffen" value={c.byStatus.not_home ?? 0} />
      </div>

      <h2 className="section-h">Planung morgen</h2>
      <div className="plan-grid">
        <div className="card">
          <div className="card-title">
            <Icon name="clock" size={16} /> Fällige Wiedervorlagen
          </div>
          {[...b.overdue, ...b.today].length === 0 && <div className="muted small">Keine fälligen Wiedervorlagen.</div>}
          <ul className="fu-list">
            {[...b.overdue, ...b.today].slice(0, 6).map((f) => (
              <FollowupCard key={f.id} f={f} compact />
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-title">
            <Icon name="doorClosed" size={16} /> Nicht angetroffen – nochmal hin
          </div>
          {notHomeStreets.length === 0 && <div className="muted small">Keine.</div>}
          {notHomeStreets.map((s) => (
            <button key={s.id} className="plan-row" onClick={() => go(`strasse/${s.id}`)}>
              <span className="grow">{s.label}</span>
              <span className="count count-orange">{s.notHome}</span>
            </button>
          ))}
        </div>
        <div className="card">
          <div className="card-title">
            <Icon name="flame" size={16} /> Straßen mit offenen Potenzialen
          </div>
          {potStreets.length === 0 && <div className="muted small">Noch keine Potenziale erfasst.</div>}
          {potStreets.map((s) => (
            <button key={s.id} className="plan-row" onClick={() => go(`strasse/${s.id}`)}>
              <span className="grow">{s.label}</span>
              <span className="small muted">{s.unprocessed} offen</span>
              <span className="count">{s.potentials}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
