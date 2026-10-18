import { store, useStoreVersion } from '../../data/store';
import { townCounts, towns } from '../../data/selectors';
import { activeTownId, setPrefs, usePrefs } from '../prefs';
import { go } from '../router';
import { Button, Empty, PageHeader, cx, toast } from '../kit';
import { Icon } from '../icons';
import { formatDate } from '../../lib/dates';

export function TownsScreen() {
  useStoreVersion();
  usePrefs();
  const list = towns();
  const active = activeTownId();
  return (
    <div className="page">
      <PageHeader
        title="Gebiete"
        sub="Aktiver Ort wird im Arbeitsmodus angezeigt. Alle Daten bleiben erhalten."
        actions={
          <Button variant="primary" icon="plus" onClick={() => go('import')}>
            Ort hinzufügen
          </Button>
        }
      />
      {list.length === 0 && (
        <Empty icon="pin" title="Noch keine Orte">
          <p>Suche einen Ort nach Name oder PLZ und importiere die Adressen erst nach deiner Bestätigung.</p>
          <Button variant="primary" size="lg" icon="plus" onClick={() => go('import')}>
            Ort hinzufügen
          </Button>
        </Empty>
      )}
      <div className="town-grid">
        {list.map((t) => {
          const c = townCounts(t.id);
          const last = store
            .all('imports')
            .filter((i) => i.town_id === t.id)
            .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
          const isActive = t.id === active;
          return (
            <div key={t.id} className={cx('town-card', isActive && 'town-active')}>
              <button
                className="town-main"
                onClick={() => {
                  setPrefs({ activeTownId: t.id });
                  if (!isActive) toast(`Aktiver Ort: ${t.name}`);
                  go('adressen');
                }}
              >
                <div className="town-name">
                  {t.name} {isActive && <span className="badge badge-active">aktiv</span>}
                </div>
                <div className="town-meta">{t.postal_codes.join(', ') || '–'}</div>
                <div className="town-stats">
                  <span>
                    <strong>{c.processed}</strong> bearbeitet
                  </span>
                  <span>
                    <strong>{c.unprocessed}</strong> offen
                  </span>
                  <span>
                    <strong>{c.followups}</strong> WV
                  </span>
                </div>
                <div className="mini-progress">
                  <div style={{ width: `${c.total ? (c.processed / c.total) * 100 : 0}%` }} />
                </div>
              </button>
              <div className="town-actions">
                {t.osm_relation_id && (
                  <Button size="sm" icon="refresh" onClick={() => go('import', { town: t.id, mode: 'refresh' })}>
                    Adressbestand aktualisieren
                  </Button>
                )}
                <Button size="sm" icon="upload" onClick={() => go('import', { town: t.id, tab: 'file' })}>
                  CSV/Excel
                </Button>
                {c.missingInSource > 0 && (
                  <span className="warn-inline">
                    <Icon name="alert" size={14} /> {c.missingInSource} prüfen
                  </span>
                )}
              </div>
              {last && <div className="town-foot">Letzter Import: {formatDate(last.occurred_at)} ({last.source})</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
