import { useMemo, useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { addressesOf, openFollowupOf, streetCounts, streetsOf, tagsOf, townCounts } from '../../data/selectors';
import { addNumbers, addStreetWithNumbers } from '../../data/actions';
import { expandHouseNumberInput, parseHouseNumber, sideOf } from '../../lib/housenumber';
import { matchesSearch, normalizeStreetName } from '../../lib/text';
import { STATUS, STATUSES } from '../../lib/constants';
import { activeTownId, setPrefs, usePrefs } from '../prefs';
import { go, setQuery, useRoute } from '../router';
import { Button, Empty, PageHeader, SearchInput, Segmented, Sheet, cx, toast } from '../kit';
import { Icon } from '../icons';
import { AddressSheet } from '../components/AddressSheet';

// ---------------------------------------------------------------------
// Straßenliste des aktiven Ortes
// ---------------------------------------------------------------------
export function StreetsScreen() {
  useStoreVersion();
  usePrefs();
  const townId = activeTownId();
  const town = store.get('towns', townId);
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  if (!town)
    return (
      <div className="page">
        <PageHeader title="Adressen" />
        <Empty icon="pin" title="Noch kein Ort angelegt">
          <p>Füge zuerst einen Ort hinzu – Import aus OpenStreetMap, CSV/Excel oder manuell.</p>
          <Button variant="primary" size="lg" icon="plus" onClick={() => go('import')}>
            Ort hinzufügen
          </Button>
        </Empty>
      </div>
    );

  const streets = streetsOf(town.id);
  const c = townCounts(town.id);
  // "goethe 12" → direkter Sprung zur Adresse
  const m = q.match(/^(.*?)\s+(\d+\s*[a-z]?(?:\/\d+)?)$/i);
  const direct = m
    ? streets
        .filter((s) => matchesSearch(s.name, m[1]))
        .flatMap((s) => addressesOf(s.id).filter((a) => a.number_key === parseHouseNumber(m[2]).key))
        .slice(0, 5)
    : [];
  const list = streets.filter((s) => matchesSearch(s.name, m && direct.length ? m[1] : q));

  return (
    <div className="page">
      <PageHeader
        title={
          <button className="town-switch" onClick={() => go('orte')}>
            {town.name} <Icon name="down" size={18} />
          </button>
        }
        sub={`${town.postal_codes.join(', ')} · ${streets.length} Straßen · ${c.processed}/${c.total} bearbeitet`}
        actions={
          <Button icon="plus" onClick={() => setAddOpen(true)}>
            Straße
          </Button>
        }
      />
      <div className="progress">
        <div className="progress-bar" style={{ width: `${c.total ? (c.processed / c.total) * 100 : 0}%` }} />
      </div>
      <div className="sticky-search">
        <SearchInput value={q} onChange={setQ} placeholder="Straße suchen … (z. B. „Goe“ oder „Goethe 12“)" />
      </div>

      {direct.length > 0 && (
        <div className="direct-hits">
          {direct.map((a) => (
            <button key={a.id} className="direct-hit" onClick={() => go(`strasse/${a.street_id}`, { a: a.id })}>
              <Icon name="pin" />
              <span>
                {store.get('streets', a.street_id)?.name} {a.house_number}
              </span>
              <span className="tile-mini" style={{ background: STATUS[a.current_status].bg, color: STATUS[a.current_status].fg }}>
                <Icon name={STATUS[a.current_status].icon} size={14} />
              </span>
            </button>
          ))}
        </div>
      )}

      {list.length === 0 && (
        <Empty icon="signpost" title={q ? 'Keine Straße gefunden' : 'Noch keine Straßen'}>
          <Button icon="plus" onClick={() => setAddOpen(true)}>
            {q ? `„${normalizeStreetName(q)}“ anlegen` : 'Straße hinzufügen'}
          </Button>
        </Empty>
      )}
      <ul className="street-list">
        {list.map((s) => {
          const sc = streetCounts(s.id);
          const pct = sc.total ? (sc.done / sc.total) * 100 : 0;
          return (
            <li key={s.id}>
              <button className="street-row" onClick={() => go(`strasse/${s.id}`)}>
                <div className="street-main">
                  <div className="street-name">{s.name}</div>
                  <div className="street-meta">
                    {sc.done}/{sc.total} bearbeitet
                    {sc.potentials > 0 && (
                      <span className="pot-badge">
                        <Icon name="flame" size={12} /> {sc.potentials} Potenzial
                      </span>
                    )}
                  </div>
                  <div className="mini-progress">
                    <div style={{ width: `${pct}%` }} className={cx(pct === 100 && 'done')} />
                  </div>
                </div>
                <Icon name="chevronRight" />
              </button>
            </li>
          );
        })}
      </ul>
      <AddStreetSheet open={addOpen} onClose={() => setAddOpen(false)} townId={town.id} initialName={q && !list.length ? normalizeStreetName(q) : ''} />
    </div>
  );
}

function AddStreetSheet({ open, onClose, townId, initialName }: { open: boolean; onClose: () => void; townId: string; initialName: string }) {
  const town = store.get('towns', townId);
  const [name, setName] = useState(initialName);
  const [nums, setNums] = useState('');
  const [parity, setParity] = useState<'all' | 'even' | 'odd'>('all');
  const [plz, setPlz] = useState(town?.postal_codes[0] ?? '');
  const preview = expandHouseNumberInput(nums, parity);
  const save = () => {
    if (!name.trim()) return;
    const r = addStreetWithNumbers(townId, name, preview, plz || null);
    toast(`${r.street.name}: ${r.added} Hausnummern angelegt${r.skipped ? `, ${r.skipped} bereits vorhanden` : ''}`);
    onClose();
    go(`strasse/${r.street.id}`);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Straße / Neubaugebiet hinzufügen">
      <div className="stack">
        <label className="field">
          <span className="field-label">Straßenname</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Am Sonnenhang" autoCapitalize="words" />
        </label>
        <NumbersInput value={nums} onChange={setNums} parity={parity} onParity={setParity} preview={preview} />
        <label className="field">
          <span className="field-label">PLZ</span>
          <input className="input" inputMode="numeric" value={plz} onChange={(e) => setPlz(e.target.value)} />
        </label>
        <Button variant="primary" size="lg" icon="check" block onClick={save} disabled={!name.trim()}>
          {preview.length ? `Straße mit ${preview.length} Hausnummern anlegen` : 'Straße anlegen'}
        </Button>
      </div>
    </Sheet>
  );
}

function NumbersInput({ value, onChange, parity, onParity, preview }: { value: string; onChange: (v: string) => void; parity: 'all' | 'even' | 'odd'; onParity: (p: 'all' | 'even' | 'odd') => void; preview: string[] }) {
  return (
    <div className="field">
      <span className="field-label">Hausnummern</span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="z. B. 1-6  oder  2, 4, 12a, 14/1" autoCapitalize="off" autoCorrect="off" />
      <Segmented
        size="sm"
        value={parity}
        onChange={onParity}
        options={[
          { value: 'all', label: 'Bereich: alle' },
          { value: 'even', label: 'nur gerade' },
          { value: 'odd', label: 'nur ungerade' },
        ]}
      />
      {preview.length > 0 && (
        <div className="num-preview">
          {preview.slice(0, 60).map((n) => (
            <span key={n}>{n}</span>
          ))}
          {preview.length > 60 && <span>+{preview.length - 60}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Hausnummern einer Straße + Adress-Sheet
// ---------------------------------------------------------------------
export function StreetScreen({ streetId }: { streetId: string }) {
  useStoreVersion();
  const prefs = usePrefs();
  const route = useRoute();
  const street = store.get('streets', streetId);
  const openId = route.query.get('a');
  const [addOpen, setAddOpen] = useState(false);
  const [legend, setLegend] = useState(false);
  const [showExcluded, setShowExcluded] = useState(true);
  const all = addressesOf(streetId);
  const filtered = useMemo(
    () =>
      all.filter((a) => {
        if (!showExcluded && a.excluded) return false;
        if (prefs.numberFilter === 'all') return true;
        return sideOf(a) === prefs.numberFilter;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, prefs.numberFilter, showExcluded, store.version],
  );
  if (!street) return <Empty title="Straße nicht gefunden" />;
  const town = store.get('towns', street.town_id);
  const sc = streetCounts(streetId);

  const open = (id: string) => setQuery({ a: id }, !!openId);
  const close = () => setQuery({ a: null });

  return (
    <div className="page">
      <PageHeader
        back={() => go('adressen')}
        title={street.name}
        sub={`${town?.name ?? ''} · ${sc.done}/${sc.total} bearbeitet`}
        actions={
          <>
            <Button icon="plus" onClick={() => setAddOpen(true)} title="Hausnummern ergänzen">
              Nr.
            </Button>
          </>
        }
      />
      <div className="street-tools">
        <Segmented
          value={prefs.numberFilter}
          onChange={(v) => setPrefs({ numberFilter: v })}
          options={[
            { value: 'all', label: 'Alle' },
            { value: 'even', label: 'Gerade' },
            { value: 'odd', label: 'Ungerade' },
          ]}
        />
        <button className={cx('icon-btn', legend && 'icon-btn-active')} onClick={() => setLegend((l) => !l)} aria-label="Legende">
          <Icon name="list" />
        </button>
      </div>
      {legend && (
        <div className="legend">
          {STATUSES.map((s) => (
            <span key={s.key} className="legend-item">
              <span className="legend-swatch" style={{ background: s.bg, color: s.fg, borderColor: s.accent }}>
                <Icon name={s.icon} size={12} />
              </span>
              {s.label}
            </span>
          ))}
          <span className="legend-item">
            <span className="dot-prio" /> hohe Priorität
          </span>
          <span className="legend-item">
            <span className="dot-tag" /> Potenzial-Tag
          </span>
          <label className="legend-item">
            <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} /> ausgeschlossene zeigen
          </label>
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty icon="building" title="Keine Hausnummern">
          <Button icon="plus" onClick={() => setAddOpen(true)}>
            Hausnummern ergänzen
          </Button>
        </Empty>
      ) : (
        <div className="tiles">
          {filtered.map((a) => {
            const s = STATUS[a.current_status];
            const fu = openFollowupOf(a.id);
            const hasTags = tagsOf(a.id).length > 0;
            return (
              <button
                key={a.id}
                className={cx('tile', a.excluded && 'tile-excluded', openId === a.id && 'tile-open', a.current_status === 'unprocessed' && 'tile-new')}
                style={{ background: s.bg, color: s.fg, borderColor: s.accent }}
                onClick={() => open(a.id)}
                aria-label={`${street.name} ${a.house_number}: ${s.label}`}
              >
                <span className="tile-num">{a.house_number}</span>
                <span className="tile-icon">
                  <Icon name={s.icon} size={14} />
                </span>
                {fu?.priority === 'high' && <span className="dot-prio" aria-label="hohe Priorität" />}
                {hasTags && <span className="dot-tag" aria-label="Potenzial" />}
                {a.source_missing_at && <span className="tile-warn">!</span>}
              </button>
            );
          })}
        </div>
      )}

      <AddNumbersSheet open={addOpen} onClose={() => setAddOpen(false)} streetId={streetId} />

      <Sheet open={!!openId && !!store.get('addresses', openId)} onClose={close} wide labelledBy="addr-title">
        {openId && <AddressSheet addressId={openId} onClose={close} onOpen={open} />}
      </Sheet>
    </div>
  );
}

function AddNumbersSheet({ open, onClose, streetId }: { open: boolean; onClose: () => void; streetId: string }) {
  const [nums, setNums] = useState('');
  const [parity, setParity] = useState<'all' | 'even' | 'odd'>('all');
  const preview = expandHouseNumberInput(nums, parity);
  const save = () => {
    const r = addNumbers(streetId, preview);
    toast(`${r.added} Hausnummer(n) ergänzt${r.skipped ? ` · ${r.skipped} bereits vorhanden` : ''}`);
    setNums('');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Fehlende Hausnummern ergänzen">
      <div className="stack">
        <NumbersInput value={nums} onChange={setNums} parity={parity} onParity={setParity} preview={preview} />
        <Button variant="primary" size="lg" block icon="check" onClick={save} disabled={!preview.length}>
          {preview.length} Hausnummer(n) hinzufügen
        </Button>
      </div>
    </Sheet>
  );
}
