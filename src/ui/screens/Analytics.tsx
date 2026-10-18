import { useState, type ReactNode } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { addressLabel, openFollowupOf, streetsOf, tagsOf, towns } from '../../data/selectors';
import { activityByDay, computeKpis, emptyFilter, filterAddresses, groupStats, productInterest, type AnalyticsFilter } from '../../lib/analytics';
import { PRIORITIES, PRODUCTS, STATUSES, STATUS, TAGS, PRIORITY } from '../../lib/constants';
import { addDays, formatDate, formatDateShort, toDateKey } from '../../lib/dates';
import { buildExportRows, downloadFile, toCsv } from '../../lib/export';
import { go } from '../router';
import { Button, Chip, PageHeader, Sheet, Stat } from '../kit';
import { Icon } from '../icons';
import { StatusPill, TagList } from '../components/StatusBits';

type PeriodKey = 'today' | '7' | '30' | '90' | 'year' | 'all' | 'custom';

function periodRange(p: PeriodKey, custom: { from: string; to: string }): { from: string | null; to: string | null } {
  const d = new Date();
  const sod = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (p) {
    case 'today':
      return { from: sod.toISOString(), to: null };
    case '7':
      return { from: addDays(sod, -6).toISOString(), to: null };
    case '30':
      return { from: addDays(sod, -29).toISOString(), to: null };
    case '90':
      return { from: addDays(sod, -89).toISOString(), to: null };
    case 'year':
      return { from: new Date(d.getFullYear(), 0, 1).toISOString(), to: null };
    case 'custom':
      return {
        from: custom.from ? new Date(`${custom.from}T00:00:00`).toISOString() : null,
        to: custom.to ? new Date(`${custom.to}T23:59:59`).toISOString() : null,
      };
    default:
      return { from: null, to: null };
  }
}

/** Filter ohne kleine Dropdowns: Knopf → Auswahlliste im Sheet. */
function Picker<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: ReactNode }[]; onChange: (v: T | null) => void }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <>
      <button className={`picker ${value ? 'picker-set' : ''}`} onClick={() => setOpen(true)}>
        <span className="picker-label">{label}</span>
        <span className="picker-value">{cur ? cur.label : 'Alle'}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="pick-list">
          <button className={`pick-item ${!value ? 'pick-active' : ''}`} onClick={() => (onChange(null), setOpen(false))}>
            Alle
          </button>
          {options.map((o) => (
            <button key={o.value} className={`pick-item ${o.value === value ? 'pick-active' : ''}`} onClick={() => (onChange(o.value), setOpen(false))}>
              {o.label}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

export function AnalyticsScreen() {
  useStoreVersion();
  const [period, setPeriod] = useState<PeriodKey>('30');
  const [custom, setCustom] = useState({ from: toDateKey(addDays(new Date(), -30)), to: toDateKey(new Date()) });
  const [f, setF] = useState<Omit<AnalyticsFilter, 'from' | 'to'>>({ ...emptyFilter });
  const [listOpen, setListOpen] = useState(false);
  const range = periodRange(period, custom);
  const filter: AnalyticsFilter = { ...f, ...range };
  const k = computeKpis(filter);
  const streetRows = groupStats(filter, 'street').slice(0, 15);
  const townRows = groupStats(filter, 'town');
  const prod = productInterest(filter);
  const days = activityByDay(filter).slice(-31);
  const maxDay = Math.max(1, ...days.map((d) => d.count));
  const maxProd = Math.max(1, ...prod.map((p) => p.addresses + p.appointments));
  const addrs = filterAddresses(filter);
  const users = [...new Set(store.all('address_status_history').map((h) => h.user_id).filter(Boolean))] as string[];
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const exportCsv = (personal: boolean) => {
    const rows = buildExportRows(addrs, personal);
    downloadFile(`areapro-auswertung-${toDateKey(new Date())}.csv`, toCsv(rows));
  };

  return (
    <div className="page page-wide">
      <PageHeader
        title="Auswertung"
        sub={`${addrs.length} Adressen im Filter · ${k.activities} Aktivitäten im Zeitraum`}
        actions={
          <>
            <Button icon="list" onClick={() => setListOpen(true)}>
              Adressliste
            </Button>
            <Button icon="download" onClick={() => exportCsv(false)}>
              CSV
            </Button>
          </>
        }
      />
      <div className="chip-wrap">
        {(
          [
            ['today', 'Heute'],
            ['7', '7 Tage'],
            ['30', '30 Tage'],
            ['90', '90 Tage'],
            ['year', 'Dieses Jahr'],
            ['all', 'Gesamt'],
            ['custom', 'Zeitraum …'],
          ] as [PeriodKey, string][]
        ).map(([p, l]) => (
          <Chip key={p} active={period === p} onClick={() => setPeriod(p)}>
            {l}
          </Chip>
        ))}
      </div>
      {period === 'custom' && (
        <div className="date-row">
          <input type="date" className="date-input" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span>bis</span>
          <input type="date" className="date-input" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}
      <div className="picker-row">
        <Picker label="Ort" value={f.townId} options={towns().map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => set({ townId: v, streetId: null })} />
        <Picker label="Straße" value={f.streetId} options={streetsOf(f.townId).map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => set({ streetId: v })} />
        <Picker label="Status" value={f.status} options={STATUSES.map((s) => ({ value: s.key, label: s.label }))} onChange={(v) => set({ status: v })} />
        <Picker label="Produkt" value={f.productId} options={PRODUCTS.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => set({ productId: v })} />
        <Picker label="Potenzial-Tag" value={f.tagId} options={TAGS.map((t) => ({ value: t.id, label: t.label }))} onChange={(v) => set({ tagId: v })} />
        <Picker label="WV-Priorität" value={f.priority} options={PRIORITIES.map((p) => ({ value: p.key, label: p.label }))} onChange={(v) => set({ priority: v })} />
        <Picker label="Bearbeiter" value={f.userId} options={users.map((u) => ({ value: u, label: u === store.user?.id ? store.user?.display_name || 'Ich' : `Teammitglied ${u.slice(0, 4)}` }))} onChange={(v) => set({ userId: v })} />
        {Object.values(f).some(Boolean) && (
          <Button size="sm" variant="ghost" icon="x" onClick={() => setF({ ...emptyFilter })}>
            Filter zurücksetzen
          </Button>
        )}
      </div>

      <div className="stats">
        <Stat label="Bearbeitete Adressen" value={k.processed} />
        <Stat label="Kontaktquote" value={`${k.contactRate.toFixed(0)} %`} sub={`${k.contacted} gesprochen`} tone={STATUS.contacted.bg} />
        <Stat label="Nicht-angetroffen-Quote" value={`${k.notHomeRate.toFixed(0)} %`} sub={`${k.notHome} Adressen`} tone={STATUS.not_home.bg} />
        <Stat label="Wiedervorlagequote" value={`${k.followupRate.toFixed(0)} %`} sub={`${k.followups} Adressen`} tone={STATUS.followup.accent} />
        <Stat label="Terminquote" value={`${k.appointmentRate.toFixed(1)} %`} sub={`${k.appointments} Termine`} tone={STATUS.appointment.bg} />
        <Stat label="Termine je 100 Adressen" value={k.appointmentsPer100.toFixed(1)} tone={STATUS.appointment.bg} />
        <Stat label="Kein Interesse" value={k.notInterested} tone={STATUS.not_interested.bg} />
        <Stat label="Kein Potenzial" value={k.noPotential} tone={STATUS.no_potential.bg} />
      </div>

      <div className="an-grid">
        <div className="card">
          <div className="card-title">Aktivität pro Tag</div>
          {days.length === 0 ? (
            <div className="muted small">Keine Aktivität im Zeitraum.</div>
          ) : (
            <div className="bars" role="img" aria-label="Aktivitäten pro Tag">
              {days.map((d) => (
                <div key={d.day} className="bar-col" title={`${formatDate(d.day)}: ${d.count} Qualifizierungen, ${d.appointments} Termine`}>
                  <div className="bar-val">{d.count}</div>
                  <div className="bar" style={{ height: `${(d.count / maxDay) * 100}%` }}>
                    {d.appointments > 0 && <div className="bar-appt" style={{ height: `${(d.appointments / d.count) * 100}%` }} />}
                  </div>
                  <div className="bar-label">{formatDateShort(d.day).replace(/^\w+\.,?\s*/, '')}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Produkte mit höchstem Interesse</div>
          {prod.length === 0 && <div className="muted small">Noch keine Produktinteressen (Tags/Termine).</div>}
          {prod.map((p) => (
            <div key={p.id} className="hbar-row">
              <span className="hbar-label">{p.label}</span>
              <span className="hbar">
                <span className="hbar-fill" style={{ width: `${(p.addresses / maxProd) * 100}%` }} />
                <span className="hbar-fill hbar-appt" style={{ width: `${(p.appointments / maxProd) * 100}%` }} />
              </span>
              <span className="hbar-num">
                {p.addresses}
                {p.appointments ? ` · ${p.appointments} T` : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="card span-2">
          <div className="card-title">Potenziale pro Straße</div>
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Straße</th>
                <th>Adressen</th>
                <th>Bearbeitet</th>
                <th>Offen</th>
                <th>Nicht da</th>
                <th>WV</th>
                <th>Termine</th>
                <th>Potenziale</th>
              </tr>
            </thead>
            <tbody>
              {streetRows.map((r) => (
                <tr key={r.id} onClick={() => go(`strasse/${r.id}`)} className="row-click">
                  <td>{r.label}</td>
                  <td>{r.total}</td>
                  <td>{r.processed}</td>
                  <td>{r.unprocessed}</td>
                  <td>{r.notHome}</td>
                  <td>{r.followups}</td>
                  <td>{r.appointments}</td>
                  <td>
                    <strong>{r.potentials}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>

        <div className="card span-2">
          <div className="card-title">Potenziale pro Ort</div>
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Ort</th>
                <th>Adressen</th>
                <th>Bearbeitet</th>
                <th>Fortschritt</th>
                <th>WV</th>
                <th>Termine</th>
                <th>Potenziale</th>
              </tr>
            </thead>
            <tbody>
              {townRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>{r.total}</td>
                  <td>{r.processed}</td>
                  <td>{r.total ? ((r.processed / r.total) * 100).toFixed(0) : 0} %</td>
                  <td>{r.followups}</td>
                  <td>{r.appointments}</td>
                  <td>
                    <strong>{r.potentials}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} wide title={`Adressliste (${addrs.length})`}>
        <div className="panel-actions">
          <Button icon="download" onClick={() => exportCsv(false)}>
            CSV ohne Kundendaten
          </Button>
          <Button icon="download" variant="ghost" onClick={() => confirm('Export enthält Namen und Telefonnummern. Nur bewusst und datenschutzkonform verwenden. Fortfahren?') && exportCsv(true)}>
            mit Kundendaten
          </Button>
        </div>
        <div className="table-wrap"><table className="table">
          <thead>
            <tr>
              <th>Adresse</th>
              <th>Status</th>
              <th>Tags</th>
              <th>WV</th>
            </tr>
          </thead>
          <tbody>
            {addrs.slice(0, 500).map((a) => {
              const fu = openFollowupOf(a.id);
              return (
                <tr key={a.id} className="row-click" onClick={() => go(`strasse/${a.street_id}`, { a: a.id })}>
                  <td>
                    {addressLabel(a).line1}
                    <div className="muted small">{addressLabel(a).town?.name}</div>
                  </td>
                  <td>
                    <StatusPill status={a.current_status} size="sm" />
                  </td>
                  <td>
                    <TagList tags={tagsOf(a.id)} max={2} />
                  </td>
                  <td>{fu ? `${formatDate(fu.due_date)} · ${PRIORITY[fu.priority].label}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {addrs.length > 500 && <div className="muted small">Erste 500 von {addrs.length} – vollständige Liste über CSV-Export.</div>}
      </Sheet>
      <div className="muted small foot-note">
        <Icon name="alert" size={14} /> Quoten beziehen sich auf Adressen mit Statusaktivität im Zeitraum (letzter Status je Adresse). Kontakt = Angetroffen, Termin, Kein Interesse, Bestandskunde oder Wiedervorlage mit „Kunde gesprochen“.
      </div>
    </div>
  );
}
