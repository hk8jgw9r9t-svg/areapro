// Calendly API v2 – Server-Service (Token nur serverseitig).
// Priorität laut Vorgabe: 1. Direktbuchung (Scheduling API, kostenpflichtiger Tarif)
//                          2. eingebettete Buchung (scheduling_url + postMessage)
//                          3. Einmal-Link (scheduling_links) als Fallback
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

const API = 'https://api.calendly.com';

export class CalendlyError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.calendlyToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string; title?: string; details?: { message: string }[] };
  if (!res.ok) {
    const msg = body.message || body.title || `Calendly-Fehler ${res.status}`;
    const detail = body.details?.map((d) => d.message).join('; ');
    throw new CalendlyError(detail ? `${msg}: ${detail}` : msg, res.status);
  }
  return body as T;
}

interface Me {
  resource: { uri: string; current_organization: string; scheduling_url: string; email: string; timezone: string };
}
export interface EventType {
  uri: string;
  name: string;
  slug: string;
  active: boolean;
  duration: number;
  scheduling_url: string;
  locations?: { kind: string; location?: string }[] | null;
}

let meCache: Me['resource'] | null = null;
let etCache: { at: number; et: EventType } | null = null;

export async function getMe() {
  meCache ??= (await call<Me>('/users/me')).resource;
  return meCache;
}

/** Ereignistyp "Beratungstermin HEIM & HAUS" (per URI oder Name), 10 min gecacht. */
export async function getEventType(): Promise<EventType> {
  if (etCache && Date.now() - etCache.at < 600_000) return etCache.et;
  let et: EventType | undefined;
  if (env.calendlyEventTypeUri) {
    et = (await call<{ resource: EventType }>(env.calendlyEventTypeUri)).resource;
  } else {
    const me = await getMe();
    const list = await call<{ collection: EventType[] }>(`/event_types?user=${encodeURIComponent(me.uri)}&active=true&count=100`);
    const want = env.calendlyEventTypeName.toLowerCase();
    et = list.collection.find((e) => e.name.toLowerCase() === want) ?? list.collection.find((e) => e.name.toLowerCase().includes('beratung')) ?? list.collection[0];
  }
  if (!et) throw new CalendlyError('Kein aktiver Calendly-Ereignistyp gefunden. Bitte "Beratungstermin HEIM & HAUS" (90 Min) anlegen.', 404, 'no_event_type');
  etCache = { at: Date.now(), et };
  return et;
}

export async function availableTimes(from: Date, to: Date): Promise<{ start_time: string }[]> {
  const et = await getEventType();
  const start = new Date(Math.max(from.getTime(), Date.now() + 60_000));
  const out: { start_time: string }[] = [];
  // max. 31 Tage pro Anfrage → in 7-Tage-Blöcken abfragen
  for (let s = start; s < to; s = new Date(s.getTime() + 7 * 86400000)) {
    const e = new Date(Math.min(s.getTime() + 7 * 86400000, to.getTime()));
    const r = await call<{ collection: { status: string; start_time: string }[] }>(
      `/event_type_available_times?event_type=${encodeURIComponent(et.uri)}&start_time=${s.toISOString()}&end_time=${e.toISOString()}`,
    );
    out.push(...r.collection.filter((x) => x.status === 'available').map((x) => ({ start_time: x.start_time })));
  }
  return out;
}

export interface BookInput {
  appointmentId: string;
  start_time: string;
  name: string;
  email: string | null;
  phone: string;
  address: string;
  products: string;
  note: string | null;
  lead_source: string;
}

/** Direktbuchung über die Scheduling API (POST /invitees). */
export async function bookInvitee(i: BookInput) {
  const et = await getEventType();
  const email = i.email || env.calendlyFallbackEmail;
  if (!email) throw new CalendlyError('Calendly benötigt eine E-Mail-Adresse. Bitte E-Mail erfassen oder CALENDLY_FALLBACK_INVITEE_EMAIL setzen.', 422, 'email_required');
  const [first, ...rest] = i.name.trim().split(/\s+/);
  const loc = et.locations?.[0];
  const location =
    !loc ? undefined
    : loc.kind === 'physical' ? { kind: 'physical', location: loc.location ?? i.address }
    : loc.kind === 'ask_invitee' ? { kind: 'ask_invitee', location: i.address }
    : loc.kind === 'outbound_call' ? { kind: 'outbound_call', location: i.phone }
    : { kind: loc.kind };
  const body = {
    event_type: et.uri,
    start_time: new Date(i.start_time).toISOString(),
    invitee: { name: i.name, first_name: first, last_name: rest.join(' ') || first, email, timezone: env.calendlyTimezone },
    ...(location ? { location } : {}),
    questions_and_answers: [
      { question: 'Telefon', answer: i.phone, position: 0 },
      { question: 'Adresse', answer: i.address, position: 1 },
      { question: 'Produkte', answer: i.products, position: 2 },
      ...(i.note ? [{ question: 'Hinweis', answer: i.note, position: 3 }] : []),
    ],
    tracking: { utm_source: 'areapro', utm_medium: i.lead_source, utm_content: i.appointmentId },
  };
  try {
    const r = await call<{ resource: Record<string, unknown> }>('/invitees', { method: 'POST', body: JSON.stringify(body) });
    return normalizeInvitee(r.resource, et.duration);
  } catch (e) {
    const err = e as CalendlyError;
    if (err.status === 403 || err.status === 402) throw new CalendlyError('Die Scheduling API ist in diesem Calendly-Tarif nicht verfügbar.', 403, 'scheduling_api_unavailable');
    if (err.status === 400 && /questions/i.test(err.message)) {
      // Zusatzfragen stimmen nicht mit dem Ereignistyp überein → ohne Fragen erneut versuchen
      const { questions_and_answers: _q, ...rest2 } = body;
      const r = await call<{ resource: Record<string, unknown> }>('/invitees', { method: 'POST', body: JSON.stringify(rest2) });
      return normalizeInvitee(r.resource, et.duration);
    }
    throw err;
  }
}

/** Nach eingebetteter Buchung: Termin- und Teilnehmerdaten laden. */
export async function fetchBooking(eventUri: string, inviteeUri: string) {
  const ev = (await call<{ resource: { uri: string; start_time: string; end_time: string } }>(eventUri)).resource;
  let invitee: Record<string, unknown> = {};
  if (inviteeUri) invitee = (await call<{ resource: Record<string, unknown> }>(inviteeUri)).resource;
  return {
    start_time: ev.start_time,
    end_time: ev.end_time,
    event_uri: ev.uri,
    invitee_uri: (invitee.uri as string) ?? inviteeUri ?? null,
    cancel_url: (invitee.cancel_url as string) ?? null,
    reschedule_url: (invitee.reschedule_url as string) ?? null,
    tracking: (invitee.tracking as Record<string, string>) ?? {},
  };
}

async function normalizeInvitee(r: Record<string, unknown>, durationMin: number) {
  const eventUri = (r.event as string) ?? ((r.scheduled_event as { uri?: string })?.uri ?? null);
  let start = (r.start_time as string) ?? ((r.scheduled_event as { start_time?: string })?.start_time ?? null);
  let end = (r.end_time as string) ?? ((r.scheduled_event as { end_time?: string })?.end_time ?? null);
  if ((!start || !end) && eventUri) {
    const ev = (await call<{ resource: { start_time: string; end_time: string } }>(eventUri)).resource;
    start = ev.start_time;
    end = ev.end_time;
  }
  return {
    start_time: start!,
    end_time: end ?? new Date(new Date(start!).getTime() + durationMin * 60000).toISOString(),
    event_uri: eventUri,
    invitee_uri: (r.uri as string) ?? null,
    cancel_url: (r.cancel_url as string) ?? null,
    reschedule_url: (r.reschedule_url as string) ?? null,
  };
}

/** Einmal-Buchungslink (Fallback). */
export async function singleUseLink(): Promise<string> {
  const et = await getEventType();
  const r = await call<{ resource: { booking_url: string } }>('/scheduling_links', {
    method: 'POST',
    body: JSON.stringify({ max_event_count: 1, owner: et.uri, owner_type: 'EventType' }),
  });
  return r.resource.booking_url;
}

export async function listWebhooks(): Promise<{ callback_url: string; state: string; uri: string }[]> {
  const me = await getMe();
  const r = await call<{ collection: { callback_url: string; state: string; uri: string }[] }>(
    `/webhook_subscriptions?organization=${encodeURIComponent(me.current_organization)}&user=${encodeURIComponent(me.uri)}&scope=user`,
  );
  return r.collection;
}

export async function ensureWebhook(callbackUrl: string) {
  const existing = (await listWebhooks()).find((w) => w.callback_url === callbackUrl);
  if (existing?.state === 'active') return { status: 'active', message: 'Webhook ist bereits aktiv.' };
  const me = await getMe();
  await call('/webhook_subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      url: callbackUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: me.current_organization,
      user: me.uri,
      scope: 'user',
      ...(env.calendlySigningKey ? { signing_key: env.calendlySigningKey } : {}),
    }),
  });
  return { status: 'active', message: 'Calendly-Webhook registriert.' };
}

/** Signaturprüfung: Header "t=<unix>,v1=<hex>"; signiert ist "<t>.<raw body>" (HMAC-SHA256). */
export function verifySignature(header: string | null, rawBody: string, toleranceSec = 300): boolean {
  if (!env.calendlySigningKey) return false;
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', env.calendlySigningKey).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bookingMode(): 'api' | 'embed' | 'link' {
  if (env.calendlyBookingMode !== 'auto') return env.calendlyBookingMode;
  return 'api'; // automatischer Rückfall auf "embed", wenn der Tarif keine Scheduling API erlaubt
}
