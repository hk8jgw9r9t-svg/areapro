import { useEffect, useMemo, useRef, useState } from 'react';
import { APPOINTMENT_DURATION_MIN, APPOINTMENT_TITLE, LEAD_SOURCES, PRODUCTS, PRODUCT, TAG } from '../../lib/constants';
import type { LeadSource } from '../../lib/types';
import { addressLabel, tagsOf } from '../../data/selectors';
import { store } from '../../data/store';
import { cancelAppointmentDraft, confirmAppointment, createAppointmentDraft } from '../../data/actions';
import { ApiError, bookSlot, confirmEmbedBooking, createSingleUseLink, fetchSlots, getServerConfig, type ServerConfig, type Slot } from '../../integrations/api';
import { formatDate, formatDateShort, formatTime, toDateKey } from '../../lib/dates';
import { Button, Chip, Field, NoteArea, Sheet, cx, toast } from '../kit';
import { Icon } from '../icons';

type Step = 'form' | 'slots' | 'embed' | 'link' | 'done';

export function AppointmentSheet({ addressId, open, onClose, onNext }: { addressId: string | null; open: boolean; onClose: () => void; onNext?: () => void }) {
  const address = addressId ? store.get('addresses', addressId) : undefined;
  const label = addressLabel(address);
  const suggested = useMemo(() => (addressId ? [...new Set(tagsOf(addressId).map((t) => TAG[t]?.product_id).filter(Boolean))] as string[] : []), [addressId]);

  const [step, setStep] = useState<Step>('form');
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [mode, setMode] = useState<ServerConfig['calendly']['mode']>('mock');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addrText, setAddrText] = useState(address ? `${label.line1}, ${label.line2}` : '');
  const [main, setMain] = useState<string | null>(suggested[0] ?? null);
  const [more, setMore] = useState<string[]>(suggested.slice(1));
  const [source, setSource] = useState<LeadSource>(addressId ? 'd2d' : 'pos');
  const [note, setNote] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ start: string } | null>(null);
  const bookedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    void getServerConfig().then((c) => {
      setCfg(c);
      setMode(c.calendly.mode);
    });
  }, [open]);

  const valid = name.trim().length > 1 && phone.replace(/\D/g, '').length >= 6 && addrText.trim().length > 4 && !!main;

  const close = () => {
    if (draftId && !bookedRef.current && step !== 'link') cancelAppointmentDraft(draftId);
    onClose();
  };

  const startBooking = async () => {
    if (!valid || !main) return;
    setError(null);
    const id = draftId ?? createAppointmentDraft({ addressId, customer_name: name, phone, email, address_text: addrText, main_product_id: main, product_ids: more, note, lead_source: source }, mode);
    setDraftId(id);
    if (mode === 'embed') return setStep('embed');
    if (mode === 'link') {
      setStep('link');
      return;
    }
    setStep('slots');
    setBusy(true);
    try {
      const s = await fetchSlots(mode);
      setSlots(s);
      setDay(s[0] ? toDateKey(new Date(s[0].start_time)) : null);
    } catch (e) {
      setError((e as Error).message);
      if (cfg?.calendly.schedulingUrl) {
        setMode('embed');
        setStep('embed');
      }
    } finally {
      setBusy(false);
    }
  };

  const book = async () => {
    if (!slot || !draftId || !main) return;
    setBusy(true);
    setError(null);
    try {
      const r = await bookSlot(mode, {
        appointmentId: draftId,
        start_time: slot,
        name,
        email: email || null,
        phone,
        address: addrText,
        products: [main, ...more].map((p) => PRODUCT[p]?.label).join(', '),
        note: note || null,
        lead_source: source,
      });
      finish(r);
    } catch (e) {
      const err = e as ApiError;
      // Tarif ohne Scheduling API → automatisch auf eingebettete Buchung wechseln
      if (err.code === 'scheduling_api_unavailable' && cfg?.calendly.schedulingUrl) {
        toast('Direktbuchung im Tarif nicht verfügbar – eingebettete Calendly-Buchung', { tone: 'warn' });
        setMode('embed');
        setStep('embed');
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = (r: { start_time: string; end_time: string; event_uri?: string | null; invitee_uri?: string | null; cancel_url?: string | null; reschedule_url?: string | null }) => {
    if (!draftId) return;
    bookedRef.current = true;
    confirmAppointment(draftId, r);
    setResult({ start: r.start_time });
    setStep('done');
  };

  // Calendly-Embed: Ereignis "event_scheduled" per postMessage
  useEffect(() => {
    if (step !== 'embed' || !draftId) return;
    const onMsg = async (e: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*calendly\.com$/.test(e.origin)) return;
      const d = e.data as { event?: string; payload?: { event?: { uri: string }; invitee?: { uri: string } } };
      if (d?.event !== 'calendly.event_scheduled' || !d.payload?.event?.uri) return;
      setBusy(true);
      try {
        const r = await confirmEmbedBooking(draftId, d.payload.event.uri, d.payload.invitee?.uri ?? '');
        finish(r);
      } catch (err) {
        setError(`Termin gebucht, Details werden per Webhook nachgeladen (${(err as Error).message}).`);
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, draftId]);

  const embedUrl = useMemo(() => {
    const base = cfg?.calendly.schedulingUrl;
    if (!base || !draftId) return null;
    const u = new URL(base);
    u.searchParams.set('name', name);
    if (email || cfg?.calendly.fallbackEmail) u.searchParams.set('email', email || cfg!.calendly.fallbackEmail!);
    // Reihenfolge der Calendly-Zusatzfragen: 1 Telefon, 2 Adresse, 3 Produkte, 4 Hinweis
    u.searchParams.set('a1', phone);
    u.searchParams.set('a2', addrText);
    u.searchParams.set('a3', [main, ...more].filter(Boolean).map((p) => PRODUCT[p!]?.label).join(', '));
    if (note) u.searchParams.set('a4', note);
    u.searchParams.set('utm_source', 'areapro');
    u.searchParams.set('utm_medium', source);
    u.searchParams.set('utm_content', draftId);
    u.searchParams.set('embed_domain', location.host);
    u.searchParams.set('embed_type', 'Inline');
    u.searchParams.set('hide_gdpr_banner', '1');
    return u.toString();
  }, [cfg, draftId, name, email, phone, addrText, main, more, note, source]);

  const openLink = async () => {
    setBusy(true);
    try {
      const { url } = await createSingleUseLink();
      const u = new URL(url);
      u.searchParams.set('name', name);
      if (email) u.searchParams.set('email', email);
      u.searchParams.set('a1', phone);
      u.searchParams.set('a2', addrText);
      u.searchParams.set('utm_content', draftId ?? '');
      window.open(u.toString(), '_blank', 'noopener');
      toast('Calendly geöffnet – Termin wird per Webhook übernommen');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const k = toDateKey(new Date(s.start_time));
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [slots]);

  const modeLabel = { api: 'Calendly · Direktbuchung', embed: 'Calendly · eingebettet', link: 'Calendly · Einmal-Link', mock: 'Demo-Buchung (Calendly nicht verbunden)' }[mode];

  return (
    <Sheet open={open} onClose={close} wide title={<span><Icon name="calendarCheck" /> Beratungstermin vereinbaren</span>}>
      <div className="appt-sub">
        {APPOINTMENT_TITLE} · {APPOINTMENT_DURATION_MIN} Min · <span className={cx('mode-tag', mode === 'mock' && 'mode-mock')}>{modeLabel}</span>
      </div>

      {step === 'form' && (
        <div className="form-grid">
          <Field label="Kundenname" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoCapitalize="words" placeholder="Vor- und Nachname" />
          </Field>
          <Field label="Telefonnummer" required>
            <input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0151 …" />
          </Field>
          <Field label="Adresse" required hint={address ? 'aus geöffneter Adresse übernommen' : undefined}>
            <input className="input" value={addrText} onChange={(e) => setAddrText(e.target.value)} />
          </Field>
          <Field label="E-Mail (optional)">
            <input className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="off" placeholder="für Terminbestätigung" />
          </Field>

          <div className="span-2">
            <div className="label">
              Hauptprodukt <span className="req">*</span>
            </div>
            <div className="chip-wrap">
              {PRODUCTS.map((p) => (
                <Chip
                  key={p.id}
                  active={main === p.id}
                  color="#0f766e"
                  onClick={() => {
                    setMain(p.id);
                    setMore((m) => m.filter((x) => x !== p.id));
                  }}
                >
                  {p.label}
                  {suggested.includes(p.id) && main !== p.id ? ' ★' : ''}
                </Chip>
              ))}
            </div>
          </div>
          <div className="span-2">
            <div className="label">Weitere Produkte</div>
            <div className="chip-wrap">
              {PRODUCTS.filter((p) => p.id !== main).map((p) => (
                <Chip key={p.id} active={more.includes(p.id)} onClick={() => setMore((m) => (m.includes(p.id) ? m.filter((x) => x !== p.id) : [...m, p.id]))}>
                  {p.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="span-2">
            <div className="label">Leadquelle / Herkunft</div>
            <div className="chip-wrap">
              {LEAD_SOURCES.map((l) => (
                <Chip key={l.key} active={source === l.key} onClick={() => setSource(l.key)}>
                  {l.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="span-2">
            <div className="label">Wichtige Terminnotiz</div>
            <NoteArea value={note} onChange={setNote} placeholder="z. B. „Bitte beide Eigentümer beim Termin.“" />
          </div>
          <div className="span-2 panel-actions">
            <Button variant="ghost" size="lg" onClick={close}>
              Abbrechen
            </Button>
            <Button variant="success" size="lg" icon="calendar" disabled={!valid} onClick={startBooking}>
              Weiter: Termin wählen
            </Button>
          </div>
          {!valid && <div className="span-2 muted small">Pflichtfelder: Name, Telefon, Adresse, Hauptprodukt.</div>}
        </div>
      )}

      {step === 'slots' && (
        <div>
          {busy && !slots && <div className="loading">Verfügbare Zeiten werden geladen …</div>}
          {slots && !slots.length && <div className="empty-inline">Keine freien Zeiten in den nächsten 14 Tagen.</div>}
          {slots && slots.length > 0 && (
            <>
              <div className="day-scroller">
                {[...days.keys()].map((d) => (
                  <button key={d} className={cx('day-btn', day === d && 'day-active')} onClick={() => (setDay(d), setSlot(null))}>
                    <span>{formatDateShort(d)}</span>
                    <small>{days.get(d)!.length} frei</small>
                  </button>
                ))}
              </div>
              <div className="slot-grid">
                {(days.get(day ?? '') ?? []).map((s) => (
                  <button key={s.start_time} className={cx('slot-btn', slot === s.start_time && 'slot-active')} onClick={() => setSlot(s.start_time)}>
                    {formatTime(s.start_time)}
                    <small>– {formatTime(new Date(new Date(s.start_time).getTime() + APPOINTMENT_DURATION_MIN * 60000))}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="panel-actions">
            <Button variant="ghost" size="lg" onClick={() => setStep('form')} icon="chevronLeft">
              Zurück
            </Button>
            <Button variant="success" size="lg" icon="check" disabled={!slot || busy} onClick={book}>
              {busy ? 'Bucht …' : slot ? `Buchen: ${formatDateShort(slot)} ${formatTime(slot)}` : 'Zeit wählen'}
            </Button>
          </div>
        </div>
      )}

      {step === 'embed' && (
        <div>
          {embedUrl ? <iframe className="calendly-frame" src={embedUrl} title="Calendly-Terminbuchung" /> : <div className="empty-inline">Calendly-Buchungslink ist nicht konfiguriert.</div>}
          <div className="panel-actions">
            <Button variant="ghost" onClick={() => setStep('form')} icon="chevronLeft">
              Zurück
            </Button>
          </div>
        </div>
      )}

      {step === 'link' && (
        <div className="stack">
          <p>Für diesen Calendly-Tarif wird ein einmaliger Buchungslink geöffnet. Nach der Buchung übernimmt der Webhook den Termin automatisch in die Adresse.</p>
          <Button variant="success" size="xl" icon="external" onClick={openLink} disabled={busy} block>
            Calendly-Buchung öffnen
          </Button>
          <Button variant="ghost" onClick={onClose} block>
            Fertig
          </Button>
        </div>
      )}

      {step === 'done' && result && (
        <div className="done-box">
          <div className="done-icon">
            <Icon name="calendarCheck" size={36} />
          </div>
          <div className="done-title">Termin vereinbart</div>
          <div className="done-when">
            {formatDate(result.start)} · {formatTime(result.start)} Uhr
          </div>
          <div className="muted">
            {name} · {PRODUCT[main!]?.label}
            {more.length ? ` + ${more.map((p) => PRODUCT[p]?.label).join(', ')}` : ''}
          </div>
          <div className="panel-actions">
            <Button variant="ghost" size="lg" onClick={onClose}>
              Schließen
            </Button>
            {onNext && (
              <Button variant="primary" size="lg" icon="arrowRight" onClick={onNext}>
                Nächste Adresse
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="error-box">
          <Icon name="alert" size={18} /> {error}
        </div>
      )}
    </Sheet>
  );
}
