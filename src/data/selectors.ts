// Abgeleitete Sichten (memoisiert pro Store-Version).
import { memo, store } from './store';
import type { Address, Appointment, Followup, HistoryEntry, Note, Street, Town } from '../lib/types';
import { sortByHouseNumber } from '../lib/housenumber';
import { TAG } from '../lib/constants';
import { endOfWeek, startOfWeek, toDateKey, todayKey } from '../lib/dates';

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export const towns = memo(() =>
  store
    .all('towns')
    .filter((t) => !t.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name, 'de')),
);

const streetsByTown = memo(() => groupBy(store.all('streets').filter((s) => !s.archived_at), (s) => s.town_id));
export function streetsOf(townId: string | null): Street[] {
  if (!townId) return [];
  return [...(streetsByTown().get(townId) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

const addressesByStreet = memo(() => {
  const m = groupBy(store.all('addresses'), (a) => a.street_id);
  for (const [k, v] of m) m.set(k, sortByHouseNumber(v));
  return m;
});
export function addressesOf(streetId: string | null): Address[] {
  if (!streetId) return [];
  return addressesByStreet().get(streetId) ?? [];
}

const addressesByTown = memo(() => groupBy(store.all('addresses'), (a) => a.town_id));
export function addressesOfTown(townId: string | null): Address[] {
  if (!townId) return [];
  return addressesByTown().get(townId) ?? [];
}

const tagsByAddress = memo(() => {
  const m = new Map<string, string[]>();
  for (const t of store.all('address_potential_tags')) {
    if (t.removed_at) continue;
    const arr = m.get(t.address_id);
    if (arr) arr.push(t.tag_id);
    else m.set(t.address_id, [t.tag_id]);
  }
  return m;
});
export function tagsOf(addressId: string): string[] {
  return tagsByAddress().get(addressId) ?? [];
}

const historyByAddress = memo(() => {
  const m = groupBy(store.all('address_status_history'), (h) => h.address_id);
  for (const [k, v] of m) m.set(k, v.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)));
  return m;
});
export function historyOf(addressId: string): HistoryEntry[] {
  return historyByAddress().get(addressId) ?? [];
}

const notesByAddress = memo(() => groupBy(store.all('notes'), (n) => n.address_id));
export function notesOf(addressId: string): Note[] {
  return [...(notesByAddress().get(addressId) ?? [])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

const followupsOpenByAddress = memo(() => {
  const m = new Map<string, Followup>();
  for (const f of store.all('followups')) {
    if (f.status !== 'open') continue;
    const prev = m.get(f.address_id);
    if (!prev || prev.occurred_at < f.occurred_at) m.set(f.address_id, f);
  }
  return m;
});
export function openFollowupOf(addressId: string): Followup | undefined {
  return followupsOpenByAddress().get(addressId);
}
export const openFollowups = memo(() => [...followupsOpenByAddress().values()].sort((a, b) => a.due_date.localeCompare(b.due_date)));

const apptsByAddress = memo(() => groupBy(store.all('appointments'), (a) => a.address_id ?? '-'));
export function appointmentsOf(addressId: string): Appointment[] {
  return [...(apptsByAddress().get(addressId) ?? [])].sort((a, b) => (b.start_time ?? b.created_at).localeCompare(a.start_time ?? a.created_at));
}
export const scheduledAppointments = memo(() =>
  store
    .all('appointments')
    .filter((a) => a.status === 'scheduled' && a.start_time)
    .sort((a, b) => (a.start_time as string).localeCompare(b.start_time as string)),
);

export function addressLabel(a: Address | undefined): { line1: string; line2: string; street: Street | undefined; town: Town | undefined } {
  if (!a) return { line1: '–', line2: '', street: undefined, town: undefined };
  const street = store.get('streets', a.street_id);
  const town = store.get('towns', a.town_id);
  return {
    line1: `${street?.name ?? '?'} ${a.house_number}`,
    line2: `${a.postal_code ?? town?.postal_codes[0] ?? ''} ${town?.name ?? ''}`.trim(),
    street,
    town,
  };
}

/** Produkte, für die eine Adresse Potenzial zeigt (Tags → Produkt + Termine + Interessen). */
export function productsOfAddress(addressId: string): string[] {
  const s = new Set<string>();
  for (const t of tagsOf(addressId)) {
    const p = TAG[t]?.product_id;
    if (p) s.add(p);
  }
  for (const ap of store.all('address_products')) if (ap.address_id === addressId && !ap.removed_at) s.add(ap.product_id);
  for (const a of appointmentsOf(addressId)) {
    s.add(a.main_product_id);
    a.product_ids.forEach((p) => s.add(p));
  }
  return [...s];
}

export interface FollowupBuckets {
  overdue: Followup[];
  today: Followup[];
  week: Followup[];
  upcoming: Followup[];
  high: Followup[];
}
export const followupBuckets = memo((): FollowupBuckets => {
  const t = todayKey();
  const weekEnd = toDateKey(endOfWeek(new Date()));
  const all = openFollowups();
  return {
    overdue: all.filter((f) => f.due_date < t),
    today: all.filter((f) => f.due_date === t),
    week: all.filter((f) => f.due_date >= t && f.due_date <= weekEnd),
    upcoming: all.filter((f) => f.due_date > weekEnd),
    high: all.filter((f) => f.priority === 'high'),
  };
});

export function appointmentsInRange(from: Date, to: Date): Appointment[] {
  const a = from.toISOString();
  const b = to.toISOString();
  return scheduledAppointments().filter((x) => (x.start_time as string) >= a && (x.start_time as string) <= b);
}
export function appointmentsToday(): Appointment[] {
  const d = new Date();
  return appointmentsInRange(new Date(d.getFullYear(), d.getMonth(), d.getDate()), new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59));
}
export function appointmentsThisWeek(): Appointment[] {
  const s = startOfWeek(new Date());
  const e = endOfWeek(new Date());
  return appointmentsInRange(s, new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59));
}

export function townCounts(townId: string | null) {
  const list = addressesOfTown(townId);
  const c = { total: list.length, processed: 0, unprocessed: 0, excluded: 0, byStatus: {} as Record<string, number>, followups: 0, followupsHigh: 0, missingInSource: 0 };
  for (const a of list) {
    c.byStatus[a.current_status] = (c.byStatus[a.current_status] ?? 0) + 1;
    if (a.excluded) c.excluded++;
    if (a.current_status === 'unprocessed') c.unprocessed++;
    else c.processed++;
    if (a.source_missing_at) c.missingInSource++;
    const f = openFollowupOf(a.id);
    if (f) {
      c.followups++;
      if (f.priority === 'high') c.followupsHigh++;
    }
  }
  return c;
}

export function streetCounts(streetId: string) {
  const list = addressesOf(streetId);
  let done = 0;
  let potentials = 0;
  for (const a of list) {
    if (a.current_status !== 'unprocessed') done++;
    if (tagsOf(a.id).length || openFollowupOf(a.id)) potentials++;
  }
  return { total: list.length, done, potentials };
}
