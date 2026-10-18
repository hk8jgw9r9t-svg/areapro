// Auswertungen & Vertriebskennzahlen (clientseitig auf dem lokalen Datenbestand).
import { store } from '../data/store';
import { tagsOf, openFollowupOf, productsOfAddress, appointmentsOf } from '../data/selectors';
import { CONTACT_STATUSES, PRODUCT } from './constants';
import type { Address, HistoryEntry, Priority, StatusKey } from './types';

export interface AnalyticsFilter {
  from: string | null; // ISO
  to: string | null; // ISO
  townId: string | null;
  streetId: string | null;
  status: StatusKey | null;
  productId: string | null;
  tagId: string | null;
  priority: Priority | null;
  userId: string | null;
}

export const emptyFilter: AnalyticsFilter = { from: null, to: null, townId: null, streetId: null, status: null, productId: null, tagId: null, priority: null, userId: null };

function addressMatches(a: Address, f: AnalyticsFilter): boolean {
  if (f.townId && a.town_id !== f.townId) return false;
  if (f.streetId && a.street_id !== f.streetId) return false;
  if (f.status && a.current_status !== f.status) return false;
  if (f.tagId && !tagsOf(a.id).includes(f.tagId)) return false;
  if (f.priority) {
    const fu = openFollowupOf(a.id);
    if (!fu || fu.priority !== f.priority) return false;
  }
  if (f.productId && !productsOfAddress(a.id).includes(f.productId)) return false;
  return true;
}

export function filterAddresses(f: AnalyticsFilter): Address[] {
  return store.all('addresses').filter((a) => addressMatches(a, f));
}

export interface Kpis {
  processed: number; // Adressen mit Statusaktivität im Zeitraum
  notHome: number;
  contacted: number;
  followups: number;
  appointments: number;
  notInterested: number;
  noPotential: number;
  existing: number;
  contactRate: number;
  notHomeRate: number;
  followupRate: number;
  appointmentRate: number;
  appointmentsPer100: number;
  activities: number;
}

/** Kennzahlen basieren auf dem Verlauf im Zeitraum: je Adresse zählt der letzte Status im Zeitraum. */
export function computeKpis(f: AnalyticsFilter): Kpis {
  const addrIds = new Set(filterAddresses({ ...f, status: null }).map((a) => a.id));
  const lastInPeriod = new Map<string, HistoryEntry>();
  const contactedAny = new Set<string>();
  let activities = 0;
  for (const h of store.all('address_status_history')) {
    if (!h.status || !addrIds.has(h.address_id)) continue;
    if (f.from && h.occurred_at < f.from) continue;
    if (f.to && h.occurred_at > f.to) continue;
    if (f.userId && h.user_id !== f.userId) continue;
    activities++;
    const prev = lastInPeriod.get(h.address_id);
    if (!prev || prev.occurred_at < h.occurred_at) lastInPeriod.set(h.address_id, h);
    if (CONTACT_STATUSES.includes(h.status) || (h.status === 'followup' && h.changes?.contacted === true)) contactedAny.add(h.address_id);
  }
  const list = [...lastInPeriod.values()].filter((h) => !f.status || h.status === f.status);
  const count = (s: StatusKey) => list.filter((h) => h.status === s).length;
  const processed = list.length;
  const appts = count('appointment');
  const contacted = list.filter((h) => contactedAny.has(h.address_id)).length;
  const pct = (n: number) => (processed ? (n / processed) * 100 : 0);
  return {
    processed,
    notHome: count('not_home'),
    contacted,
    followups: count('followup'),
    appointments: appts,
    notInterested: count('not_interested'),
    noPotential: count('no_potential'),
    existing: count('existing_customer'),
    contactRate: pct(contacted),
    notHomeRate: pct(count('not_home')),
    followupRate: pct(count('followup')),
    appointmentRate: pct(appts),
    appointmentsPer100: processed ? (appts / processed) * 100 : 0,
    activities,
  };
}

export interface GroupRow {
  id: string;
  label: string;
  total: number;
  processed: number;
  unprocessed: number;
  potentials: number;
  followups: number;
  appointments: number;
  notHome: number;
}

/** Potenziale je Straße bzw. Ort (aktueller Bestand). Potenzial = Tag, offene WV oder Termin. */
export function groupStats(f: AnalyticsFilter, by: 'street' | 'town'): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const a of filterAddresses(f)) {
    const key = by === 'street' ? a.street_id : a.town_id;
    let r = m.get(key);
    if (!r) {
      const label = by === 'street' ? `${store.get('streets', a.street_id)?.name ?? '?'}` : store.get('towns', a.town_id)?.name ?? '?';
      r = { id: key, label, total: 0, processed: 0, unprocessed: 0, potentials: 0, followups: 0, appointments: 0, notHome: 0 };
      m.set(key, r);
    }
    r.total++;
    if (a.current_status === 'unprocessed') r.unprocessed++;
    else r.processed++;
    if (a.current_status === 'not_home') r.notHome++;
    if (a.current_status === 'appointment') r.appointments++;
    const fu = openFollowupOf(a.id);
    if (fu) r.followups++;
    if (tagsOf(a.id).length || fu || a.current_status === 'appointment') r.potentials++;
  }
  return [...m.values()].sort((x, y) => y.potentials - x.potentials || x.label.localeCompare(y.label, 'de'));
}

/** Produkte mit höchstem Interesse (Tags → Produkt, Terminprodukte doppelt gewichtet als eigene Spalte). */
export function productInterest(f: AnalyticsFilter) {
  const m = new Map<string, { id: string; label: string; addresses: number; appointments: number }>();
  for (const a of filterAddresses(f)) {
    for (const p of productsOfAddress(a.id)) {
      const r = m.get(p) ?? { id: p, label: PRODUCT[p]?.label ?? p, addresses: 0, appointments: 0 };
      r.addresses++;
      m.set(p, r);
    }
    for (const ap of appointmentsOf(a.id)) {
      if (ap.status !== 'scheduled' && ap.status !== 'completed') continue;
      for (const p of [ap.main_product_id, ...ap.product_ids]) {
        const r = m.get(p) ?? { id: p, label: PRODUCT[p]?.label ?? p, addresses: 0, appointments: 0 };
        r.appointments++;
        m.set(p, r);
      }
    }
  }
  return [...m.values()].sort((a, b) => b.addresses + b.appointments * 2 - (a.addresses + a.appointments * 2));
}

/** Aktivität pro Tag (für Verlaufsdiagramm). */
export function activityByDay(f: AnalyticsFilter): { day: string; count: number; appointments: number }[] {
  const addrIds = new Set(filterAddresses({ ...f, status: null }).map((a) => a.id));
  const m = new Map<string, { day: string; count: number; appointments: number }>();
  for (const h of store.all('address_status_history')) {
    if (!h.status || !addrIds.has(h.address_id)) continue;
    if (f.from && h.occurred_at < f.from) continue;
    if (f.to && h.occurred_at > f.to) continue;
    const d = new Date(h.occurred_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = m.get(key) ?? { day: key, count: 0, appointments: 0 };
    r.count++;
    if (h.status === 'appointment') r.appointments++;
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}
