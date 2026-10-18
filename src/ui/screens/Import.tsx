import { useEffect, useRef, useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { towns } from '../../data/selectors';
import { createTown } from '../../data/actions';
import { fetchOsmAddresses, searchPlaces, type PlaceResult } from '../../import/osm';
import { detectColumns, parseCsv, parseXlsx, rowsToRaw, type ColumnMap } from '../../import/files';
import { applyImportPlan, buildImportPlan, type ImportPlan } from '../../import/pipeline';
import { setPrefs } from '../prefs';
import { go, useRoute } from '../router';
import { Button, Chip, Field, PageHeader, SearchInput, Segmented, cx, toast } from '../kit';
import { Icon } from '../icons';

type Tab = 'osm' | 'file' | 'manual';

export function ImportScreen() {
  useStoreVersion();
  const route = useRoute();
  const townParam = route.query.get('town');
  const refresh = route.query.get('mode') === 'refresh';
  const [tab, setTab] = useState<Tab>((route.query.get('tab') as Tab) || 'osm');
  const town = townParam ? store.get('towns', townParam) ?? null : null;
  return (
    <div className="page">
      <PageHeader back={() => go('orte')} title={refresh && town ? `${town.name}: Adressbestand aktualisieren` : 'Ort hinzufügen / importieren'} sub="Adressen werden erst nach deiner Bestätigung gespeichert." />
      {!refresh && (
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'osm', label: 'OpenStreetMap' },
            { value: 'file', label: 'CSV / Excel' },
            { value: 'manual', label: 'Manuell' },
          ]}
        />
      )}
      {(tab === 'osm' || refresh) && <OsmImport refreshTown={refresh ? town : null} />}
      {tab === 'file' && !refresh && <FileImport presetTownId={town?.id ?? null} />}
      {tab === 'manual' && !refresh && <ManualTown />}
    </div>
  );
}

// ---------------------------------------------------------------------
function OsmImport({ refreshTown }: { refreshTown: ReturnType<typeof store.get<'towns'>> | null }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<PlaceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Aktualisierung: direkt mit vorhandener OSM-Relation laden
  useEffect(() => {
    if (!refreshTown?.osm_relation_id) return;
    setPicked({ name: refreshTown.name, displayName: refreshTown.name, postalCodes: refreshTown.postal_codes, state: refreshTown.state, county: null, osmType: 'relation', osmId: refreshTown.osm_relation_id, kind: '' });
  }, [refreshTown]);

  const search = async () => {
    if (!q.trim()) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      setResults(await searchPlaces(q, abort.current.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`${(e as Error).message}. Alternativ: CSV/Excel-Import oder manuell anlegen.`);
    } finally {
      setSearching(false);
    }
  };

  const load = async () => {
    if (!picked) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchOsmAddresses(picked.osmId);
      const existing = refreshTown ?? store.all('towns').find((t) => t.osm_relation_id === picked.osmId) ?? null;
      setPlan(
        buildImportPlan(raw, 'osm', { town: existing, name: picked.name, postal_codes: picked.postalCodes, state: picked.state, osm_relation_id: picked.osmId }, { compareMissing: !!existing }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (plan) return <PlanPreview plan={plan} mode={plan.town ? 'refresh' : 'initial'} onCancel={() => setPlan(null)} />;

  return (
    <div className="stack">
      {!refreshTown && (
        <>
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <SearchInput value={q} onChange={setQ} placeholder="Ortsname oder PLZ, z. B. Kürnbach oder 75057" autoFocus />
            <Button type="submit" variant="primary" size="lg" icon="search" disabled={searching}>
              Suchen
            </Button>
          </form>
          {searching && <div className="loading">Suche in OpenStreetMap …</div>}
          {results && results.length === 0 && <div className="empty-inline">Kein Ort gefunden. Tipp: Ortsname statt Ortsteil versuchen oder CSV/manuell anlegen.</div>}
          {results && results.length > 0 && !picked && (
            <ul className="result-list">
              {results.map((r) => (
                <li key={r.osmId}>
                  <button className="result-row" onClick={() => setPicked(r)}>
                    <Icon name="pin" />
                    <div className="grow">
                      <div className="strong">{r.name}</div>
                      <div className="muted small">{r.displayName}</div>
                    </div>
                    <Icon name="chevronRight" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {picked && (
        <div className="confirm-card">
          <div className="confirm-title">
            <Icon name="pin" /> {refreshTown ? 'Bestand mit OpenStreetMap vergleichen?' : 'Ort importieren?'}
          </div>
          <div className="confirm-name">{picked.name}</div>
          <div className="muted">{picked.displayName}</div>
          <p className="small">Es werden alle Adressen mit Straße und Hausnummer innerhalb der Gemeindegrenze geladen. Danach siehst du eine Übersicht und entscheidest, ob gespeichert wird. Vorhandene Qualifizierungen werden nie verändert.</p>
          <div className="panel-actions">
            {!refreshTown && (
              <Button variant="ghost" size="lg" onClick={() => setPicked(null)}>
                Anderer Ort
              </Button>
            )}
            <Button variant="primary" size="lg" icon="download" onClick={load} disabled={loading}>
              {loading ? 'Lade Adressen …' : 'Adressen laden'}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div className="error-box">
          <Icon name="alert" size={18} /> {error}
        </div>
      )}
    </div>
  );
}

function PlanPreview({ plan, mode, onCancel }: { plan: ImportPlan; mode: 'initial' | 'refresh' | 'append'; onCancel: () => void }) {
  const s = plan.stats;
  const confirm = () => {
    const t = applyImportPlan(plan, mode);
    setPrefs({ activeTownId: t.id });
    toast(`${t.name}: ${s.newAddresses} Adressen in ${s.newStreets ? `${s.newStreets} neuen ` : ''}Straßen gespeichert`);
    go('adressen');
  };
  const stat = (label: string, v: number, tone?: string) => (
    <div className="pv-stat" style={tone ? { color: tone } : undefined}>
      <div className="pv-val">{v.toLocaleString('de-DE')}</div>
      <div className="pv-label">{label}</div>
    </div>
  );
  return (
    <div className="confirm-card">
      <div className="confirm-title">
        <Icon name="list" /> Importübersicht
      </div>
      <div className="confirm-name">Ort: {plan.town?.name ?? plan.townDraft.name}</div>
      <div className="pv-grid">
        {stat('Gefundene Straßen', s.streetsFound)}
        {stat('Gefundene Adressen', s.addressesFound)}
        {stat('Adressen ohne Straße', s.withoutStreet, s.withoutStreet ? '#b45309' : undefined)}
        {stat('mögliche Dubletten', s.duplicates, s.duplicates ? '#b45309' : undefined)}
        {mode !== 'initial' && stat('bereits vorhanden', s.alreadyPresent)}
        {stat('werden neu angelegt', s.newAddresses, '#0f766e')}
        {mode === 'refresh' && stat('in Quelle verschwunden → prüfen', s.missingInSource, s.missingInSource ? '#b91c1c' : undefined)}
        {s.invalidNumber > 0 && stat('ungültige Nummern', s.invalidNumber)}
      </div>
      {s.foreignCity > 0 && <div className="muted small">Hinweis: {s.foreignCity} Adressen tragen einen anderen Ortsnamen (z. B. Ortsteil) – sie liegen innerhalb der Gemeindegrenze und werden übernommen.</div>}
      {plan.samplesWithoutStreet.length > 0 && <div className="muted small">Ohne Straße (nicht übernommen): {plan.samplesWithoutStreet.join(', ')} …</div>}
      {plan.streets.length > 0 && (
        <details className="pv-details">
          <summary>Straßen anzeigen ({plan.streets.length})</summary>
          <div className="pv-streets">
            {plan.streets.map((st) => (
              <span key={st.key} className={cx('pv-street', !st.existingId && 'pv-new')}>
                {st.name} <small>{st.count}</small>
              </span>
            ))}
          </div>
        </details>
      )}
      {plan.missing.length > 0 && (
        <details className="pv-details">
          <summary>In der Quelle nicht mehr vorhanden ({plan.missing.length}) – werden nur markiert, nicht gelöscht</summary>
          <div className="pv-streets">
            {plan.missing.map((m) => (
              <span key={m.addressId} className="pv-street">
                {m.label}
              </span>
            ))}
          </div>
        </details>
      )}
      <div className="panel-actions">
        <Button variant="ghost" size="lg" onClick={onCancel} icon="x">
          Import abbrechen
        </Button>
        <Button variant="primary" size="lg" icon="check" onClick={confirm} disabled={!s.newAddresses && !s.missingInSource && mode !== 'initial'}>
          Import bestätigen
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
function FileImport({ presetTownId }: { presetTownId: string | null }) {
  const all = towns();
  const [townId, setTownId] = useState<string | 'new'>(presetTownId ?? all[0]?.id ?? 'new');
  const [newName, setNewName] = useState('');
  const [newPlz, setNewPlz] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (f: File) => {
    setError(null);
    setFileName(f.name);
    try {
      const r = /\.xlsx$/i.test(f.name) ? await parseXlsx(await f.arrayBuffer()) : parseCsv(await f.text());
      if (r.length < 2) throw new Error('Datei enthält keine Datenzeilen.');
      setRows(r);
      setMap(detectColumns(r[0]));
    } catch (e) {
      setError(`Datei konnte nicht gelesen werden: ${(e as Error).message}`);
    }
  };

  const build = () => {
    if (!rows || !map) return;
    const town = townId === 'new' ? null : store.get('towns', townId) ?? null;
    const name = town?.name ?? newName.trim();
    if (!name) return setError('Bitte Ortsname angeben.');
    const raw = rowsToRaw(rows, map).map((r) => ({ ...r, postalCode: r.postalCode || newPlz || town?.postal_codes[0] || '' }));
    setPlan(buildImportPlan(raw, /\.xlsx$/i.test(fileName) ? 'xlsx' : 'csv', { town, name, postal_codes: town?.postal_codes ?? (newPlz ? [newPlz] : []) }));
  };

  if (plan) return <PlanPreview plan={plan} mode={plan.town ? 'append' : 'initial'} onCancel={() => setPlan(null)} />;

  const header = rows?.[0] ?? [];
  const colSelect = (k: keyof ColumnMap, label: string) => (
    <div className="map-row">
      <span className="map-label">{label}</span>
      <div className="chip-wrap">
        <Chip active={map?.[k] === -1} onClick={() => setMap((m) => ({ ...m!, [k]: -1 }))}>
          –
        </Chip>
        {header.map((h, i) => (
          <Chip key={i} active={map?.[k] === i} onClick={() => setMap((m) => ({ ...m!, [k]: i }))}>
            {h || `Spalte ${i + 1}`}
          </Chip>
        ))}
      </div>
    </div>
  );

  return (
    <div className="stack">
      <div className="label">Zielort</div>
      <div className="chip-wrap">
        {all.map((t) => (
          <Chip key={t.id} active={townId === t.id} onClick={() => setTownId(t.id)}>
            {t.name}
          </Chip>
        ))}
        <Chip active={townId === 'new'} onClick={() => setTownId('new')} icon="plus">
          Neuer Ort
        </Chip>
      </div>
      {townId === 'new' && (
        <div className="form-grid">
          <Field label="Ortsname" required>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Field label="PLZ">
            <input className="input" inputMode="numeric" value={newPlz} onChange={(e) => setNewPlz(e.target.value)} />
          </Field>
        </div>
      )}
      <label className="file-drop">
        <Icon name="upload" size={28} />
        <span>{fileName || 'CSV- oder Excel-Datei (.csv, .xlsx) auswählen'}</span>
        <small>Spalten z. B.: Straße; Hausnummer; PLZ; Ort – oder eine Spalte „Adresse“</small>
        <input type="file" accept=".csv,.txt,.xlsx,text/csv" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} hidden />
      </label>
      {rows && map && (
        <div className="confirm-card">
          <div className="confirm-title">Spaltenzuordnung ({rows.length - 1} Zeilen)</div>
          {colSelect('street', 'Straße')}
          {colSelect('number', 'Hausnummer')}
          {colSelect('postal', 'PLZ')}
          {colSelect('city', 'Ort')}
          {colSelect('combined', 'Adresse (kombiniert)')}
          <Button variant="primary" size="lg" icon="arrowRight" onClick={build} block>
            Vorschau erstellen
          </Button>
        </div>
      )}
      {error && (
        <div className="error-box">
          <Icon name="alert" size={18} /> {error}
        </div>
      )}
    </div>
  );
}

function ManualTown() {
  const [name, setName] = useState('');
  const [plz, setPlz] = useState('');
  const save = () => {
    if (!name.trim()) return;
    const t = createTown(name, plz.split(/[,\s]+/).filter(Boolean));
    setPrefs({ activeTownId: t.id });
    toast(`${t.name} angelegt – jetzt Straßen hinzufügen`);
    go('adressen');
  };
  return (
    <div className="stack">
      <p className="muted">Ort ohne Import anlegen und Straßen/Hausnummern selbst erfassen (z. B. Neubaugebiet).</p>
      <div className="form-grid">
        <Field label="Ortsname" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Oberderdingen" />
        </Field>
        <Field label="PLZ" hint="mehrere mit Komma">
          <input className="input" inputMode="numeric" value={plz} onChange={(e) => setPlz(e.target.value)} placeholder="75038" />
        </Field>
      </div>
      <Button variant="primary" size="lg" icon="check" onClick={save} disabled={!name.trim()} block>
        Ort anlegen
      </Button>
    </div>
  );
}
