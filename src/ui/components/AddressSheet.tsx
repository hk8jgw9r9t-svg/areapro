import { useEffect, useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { addressLabel, addressesOf, appointmentsOf, notesOf, openFollowupOf, tagsOf } from '../../data/selectors';
import { addNote, completeFollowup, restoreAddress, setStatus, setTags } from '../../data/actions';
import { clearMissingFlag } from '../../import/pipeline';
import { EXCLUDE_REASONS, PRODUCT, STATUS, TAGS } from '../../lib/constants';
import { formatDate, formatDateTime, formatTime, relativeDay } from '../../lib/dates';
import { getNextSameSideAddress, getOppositeSideAddress, getPrevSameSideAddress, sideOf } from '../../lib/housenumber';
import type { Address, StatusKey } from '../../lib/types';
import { getPrefs, setPrefs, usePrefs } from '../prefs';
import { Button, Chip, NoteArea, cx, toast } from '../kit';
import { Icon } from '../icons';
import { PriorityPill, StatusPill } from './StatusBits';
import { FollowupPanel } from './FollowupPanel';
import { AppointmentSheet } from './AppointmentSheet';
import { Timeline } from './Timeline';

type Panel = null | 'followup' | 'more' | 'exclude' | 'contacted';

export function AddressSheet({ addressId, onClose, onOpen }: { addressId: string; onClose: () => void; onOpen: (id: string) => void }) {
  useStoreVersion();
  const prefs = usePrefs();
  const a = store.get('addresses', addressId);
  const [panel, setPanel] = useState<Panel>(null);
  const [apptOpen, setApptOpen] = useState(false);
  const [note, setNote] = useState('');
  const [justSaved, setJustSaved] = useState<StatusKey | null>(null);
  const [showHistory, setShowHistory] = useState(true);

  useEffect(() => {
    setPanel(null);
    setNote('');
    setJustSaved(null);
  }, [addressId]);

  if (!a) return null;
  const l = addressLabel(a);
  const siblings = addressesOf(a.street_id);
  const dir = prefs.walkDirection;
  const next = getNextSameSideAddress(siblings, a.id, { direction: dir });
  const prev = getPrevSameSideAddress(siblings, a.id, { direction: dir });
  const opposite = getOppositeSideAddress(siblings, a.id, { direction: dir });
  const tags = tagsOf(a.id);
  const fu = openFollowupOf(a.id);
  const appts = appointmentsOf(a.id).filter((x) => x.status !== 'canceled' || x.start_time);
  const side = sideOf(a);

  const goNext = () => {
    if (next) onOpen(next.id);
    else toast('Ende der Straßenseite', { action: opposite ? { label: 'Andere Seite', run: goOpposite } : undefined, tone: 'warn' });
  };
  const goOpposite = () => {
    if (!opposite) return;
    // Beim Seitenwechsel dreht sich die Laufrichtung (man läuft die andere Seite zurück)
    setPrefs({ walkDirection: (getPrefs().walkDirection * -1) as 1 | -1 });
    onOpen(opposite.id);
  };

  const quick = (status: StatusKey, extra: { excludedReason?: string } = {}) => {
    setStatus(a.id, { status, ...extra });
    setJustSaved(status);
    setPanel(status === 'contacted' ? 'contacted' : null);
    if (status === 'not_home' && prefs.autoNext && next) {
      toast(`Nicht angetroffen · weiter zu ${next.house_number}`);
      onOpen(next.id);
      return;
    }
    toast(`${STATUS[status].short} gespeichert`, next ? { action: { label: `Weiter → ${next.house_number}`, run: () => onOpen(next.id) } } : {});
  };

  const toggleTag = (t: string) => {
    const nextTags = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    setTags(a.id, nextTags);
  };

  const saveNote = () => {
    if (!note.trim()) return;
    addNote(a.id, note);
    setNote('');
    toast('Notiz gespeichert');
  };

  return (
    <div className="addr">
      {/* Kopf */}
      <div className="addr-head">
        <div>
          <div className="addr-title">{l.line1}</div>
          <div className="addr-sub">{l.line2}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Zur Hausnummernliste">
          <Icon name="grid" size={22} />
        </button>
      </div>
      <div className="addr-statusline">
        <StatusPill status={a.current_status} />
        {fu && (
          <span className="fu-inline">
            <Icon name="clock" size={14} /> {relativeDay(fu.due_date)} <PriorityPill priority={fu.priority} />
          </span>
        )}
        {a.last_activity_at && <span className="muted small">zuletzt {formatDateTime(a.last_activity_at)}</span>}
      </div>

      {a.excluded && (
        <div className="warn-box">
          <Icon name="ban" size={18} />
          <span>
            Aus Potenzial ausgeschlossen{a.excluded_reason ? `: ${a.excluded_reason}` : ''}. Die Adresse bleibt mit Verlauf erhalten.
          </span>
          <Button size="sm" icon="restore" onClick={() => (restoreAddress(a.id), toast('Adresse wiederhergestellt'))}>
            Wiederherstellen
          </Button>
        </div>
      )}
      {a.source_missing_at && (
        <div className="warn-box">
          <Icon name="alert" size={18} />
          <span>Bei der letzten Aktualisierung nicht mehr in der Importquelle gefunden – bitte vor Ort prüfen.</span>
          <Button size="sm" icon="check" onClick={() => clearMissingFlag(a.id)}>
            Geprüft
          </Button>
        </div>
      )}

      {/* Navigation in der Straße */}
      <div className="walk">
        <button className="walk-btn" disabled={!prev} onClick={() => prev && onOpen(prev.id)} aria-label="Vorherige Adresse gleiche Seite">
          <Icon name="chevronLeft" size={22} />
          <span>{prev ? prev.house_number : '–'}</span>
        </button>
        <button className="walk-btn walk-mid" disabled={!opposite} onClick={goOpposite} aria-label="Andere Straßenseite">
          <Icon name="swap" size={20} />
          <span>Andere Seite{opposite ? ` · ${opposite.house_number}` : ''}</span>
        </button>
        <button className={cx('walk-btn walk-next', justSaved && next && 'pulse')} disabled={!next} onClick={goNext} aria-label="Nächste Adresse gleiche Seite">
          <span>{next ? `Nächste ${next.house_number}` : 'Ende'}</span>
          <Icon name="chevronRight" size={22} />
        </button>
      </div>
      <div className="walk-info">
        {side === 'even' ? 'Gerade Seite' : side === 'odd' ? 'Ungerade Seite' : 'Sondernummer'} ·{' '}
        <button className="link-btn" onClick={() => setPrefs({ walkDirection: (dir * -1) as 1 | -1 })}>
          Laufrichtung {dir === 1 ? 'aufsteigend ↑' : 'absteigend ↓'}
        </button>
      </div>

      {/* Schnellqualifizierung */}
      {panel === null || panel === 'contacted' ? (
        <div className="quick-grid">
          <QuickBtn status="not_home" label="Nicht angetroffen" onClick={() => quick('not_home')} active={a.current_status === 'not_home'} />
          <QuickBtn status="contacted" label="Angetroffen" onClick={() => quick('contacted')} active={a.current_status === 'contacted'} />
          <QuickBtn status="followup" label="Wiedervorlage" onClick={() => setPanel('followup')} active={a.current_status === 'followup'} />
          <QuickBtn status="appointment" label="Termin" onClick={() => setApptOpen(true)} active={a.current_status === 'appointment'} />
          <QuickBtn status="not_interested" label="Kein Interesse" onClick={() => quick('not_interested')} active={a.current_status === 'not_interested'} />
          <button className="quick quick-more" onClick={() => setPanel('more')}>
            <Icon name="more" size={26} />
            <span>Mehr</span>
          </button>
        </div>
      ) : null}

      {panel === 'contacted' && <div className="hint-ok">Angetroffen gespeichert – bei Bedarf Potenzial-Tags oder Notiz ergänzen.</div>}

      {panel === 'followup' && (
        <FollowupPanel
          addressId={a.id}
          onCancel={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            setJustSaved('followup');
            toast('Wiedervorlage gespeichert', next ? { action: { label: `Weiter → ${next.house_number}`, run: () => onOpen(next.id) } } : {});
          }}
        />
      )}

      {panel === 'more' && (
        <div className="panel">
          <div className="panel-title">Weitere Status</div>
          <div className="quick-grid">
            <QuickBtn status="existing_customer" label="Bestandskunde / bereits erneuert" onClick={() => quick('existing_customer')} active={a.current_status === 'existing_customer'} />
            <QuickBtn status="no_potential" label="Kein Potenzial / ausschließen" onClick={() => setPanel('exclude')} active={a.current_status === 'no_potential'} />
            <QuickBtn status="unprocessed" label="Zurück auf unbearbeitet" onClick={() => quick('unprocessed')} active={false} />
          </div>
          <Button variant="ghost" block onClick={() => setPanel(null)}>
            Abbrechen
          </Button>
        </div>
      )}

      {panel === 'exclude' && (
        <div className="panel">
          <div className="panel-title">
            <Icon name="ban" /> Adresse aus Potenzial ausschließen
          </div>
          <div className="muted small">Nicht gelöscht – jederzeit wiederherstellbar. Grund wählen:</div>
          <div className="chip-wrap">
            {EXCLUDE_REASONS.map((r) => (
              <Chip key={r} onClick={() => quick('no_potential', { excludedReason: r })}>
                {r}
              </Chip>
            ))}
          </div>
          <Button variant="ghost" block onClick={() => setPanel(null)}>
            Abbrechen
          </Button>
        </div>
      )}

      {justSaved && next && panel === null && (
        <Button variant="primary" size="xl" block icon="arrowRight" onClick={() => onOpen(next.id)} className="next-cta">
          Nächste Adresse: {l.street?.name} {next.house_number}
        </Button>
      )}

      {/* Offene Wiedervorlage & Termine */}
      {fu && (
        <div className="card card-fu">
          <div className="card-row">
            <Icon name="clock" />
            <div className="grow">
              <div>
                <strong>Wiedervorlage</strong> · fällig {formatDate(fu.due_date)}
                {relativeDay(fu.due_date) !== formatDate(fu.due_date) ? ` (${relativeDay(fu.due_date)})` : ''}
                {fu.period_label && fu.preset !== 'date' ? ` · ${fu.period_label}` : ''}
              </div>
              {fu.note && <div className="muted small">{fu.note}</div>}
            </div>
            <PriorityPill priority={fu.priority} />
          </div>
          <div className="card-actions">
            <Button size="sm" icon="check" onClick={() => (completeFollowup(fu.id), toast('Wiedervorlage erledigt'))}>
              Erledigt
            </Button>
            <Button size="sm" icon="calendarClock" onClick={() => setPanel('followup')}>
              Neu terminieren
            </Button>
          </div>
        </div>
      )}
      {appts.map((ap) => (
        <div key={ap.id} className={cx('card', 'card-appt', ap.status === 'canceled' && 'card-muted')}>
          <div className="card-row">
            <Icon name="calendarCheck" />
            <div className="grow">
              <div>
                <strong>{ap.status === 'pending' ? 'Termin in Buchung' : ap.status === 'canceled' ? 'Termin storniert' : 'Beratungstermin'}</strong>
                {ap.start_time && (
                  <>
                    {' '}
                    · {formatDate(ap.start_time)} {formatTime(ap.start_time)} Uhr
                  </>
                )}
              </div>
              <div className="small">
                {ap.customer_name} ·{' '}
                <a href={`tel:${ap.phone.replace(/\s/g, '')}`} className="link">
                  {ap.phone}
                </a>
              </div>
              <div className="small muted">
                {PRODUCT[ap.main_product_id]?.label}
                {ap.product_ids.length ? ` + ${ap.product_ids.map((p) => PRODUCT[p]?.label).join(', ')}` : ''}
              </div>
              {ap.note && <div className="small tl-quote">„{ap.note}"</div>}
            </div>
          </div>
        </div>
      ))}

      {/* Potenzial-Tags */}
      <section className="addr-section">
        <div className="section-title">
          <Icon name="tag" size={16} /> Potenzial
        </div>
        <div className="chip-wrap">
          {TAGS.map((t) => (
            <Chip key={t.id} active={tags.includes(t.id)} onClick={() => toggleTag(t.id)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </section>

      {/* Notiz */}
      <section className="addr-section">
        <div className="section-title">
          <Icon name="note" size={16} /> Notiz
        </div>
        <NoteArea value={note} onChange={setNote} />
        <div className="note-actions">
          <span className="muted small">Bitte keine unnötigen sensiblen Personendaten notieren.</span>
          <Button variant="primary" icon="check" onClick={saveNote} disabled={!note.trim()}>
            Notiz speichern
          </Button>
        </div>
        {notesOf(a.id).length > 0 && <div className="muted small">{notesOf(a.id).length} Notiz(en) im Verlauf</div>}
      </section>

      {/* Verlauf */}
      <section className="addr-section">
        <button className="section-title section-toggle" onClick={() => setShowHistory((s) => !s)}>
          <Icon name="history" size={16} /> Verlauf <Icon name={showHistory ? 'up' : 'down'} size={14} />
        </button>
        {showHistory && <Timeline addressId={a.id} />}
      </section>

      <AppointmentSheet
        key={`${a.id}-${apptOpen}`}
        addressId={a.id}
        open={apptOpen}
        onClose={() => setApptOpen(false)}
        onNext={
          next
            ? () => {
                setApptOpen(false);
                onOpen(next.id);
              }
            : undefined
        }
      />
    </div>
  );
}

function QuickBtn({ status, label, onClick, active }: { status: StatusKey; label: string; onClick: () => void; active: boolean }) {
  const s = STATUS[status];
  return (
    <button className={cx('quick', active && 'quick-active')} onClick={onClick} style={{ '--q-bg': s.bg, '--q-fg': s.fg, '--q-accent': s.accent } as React.CSSProperties}>
      <Icon name={s.icon} size={26} />
      <span>{label}</span>
      {active && <span className="quick-check" aria-label="aktueller Status"><Icon name="check" size={14} /></span>}
    </button>
  );
}

export type { Address };
