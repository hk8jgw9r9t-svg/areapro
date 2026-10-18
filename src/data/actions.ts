// Fachliche Aktionen. Jede Aktion erzeugt genau eine Op (atomar, idempotent, nur Upserts).
// Verlauf & Notizen werden ausschließlich angehängt – nie überschrieben.

import { store } from './store';
import { openFollowupOf, tagsOf, historyOf, addressesOf } from './selectors';
import { uid, nowIso } from '../lib/id';
import { parseHouseNumber } from '../lib/housenumber';
import { normalizeStreetName, streetKey } from '../lib/text';
import { CLOSING_STATUSES } from '../lib/constants';
import type {
  Address,
  Appointment,
  Followup,
  HistoryEntry,
  LeadSource,
  Op,
  Priority,
  StatusKey,
  Street,
  Tables,
  Town,
  AddressTag,
} from '../lib/types';
import type { FollowupPeriod } from '../lib/dates';

function ctx() {
  const u = store.user;
  if (!u) throw new Error('Nicht angemeldet');
  return { uid: u.id, team: u.team_id };
}

function owned(ts = nowIso()) {
  const { uid: id, team } = ctx();
  return { owner_user_id: id, team_id: team, created_at: ts, updated_at: ts };
}

function commit(label: string, upserts: Op['upserts']) {
  store.apply({ op_id: uid(), ts: nowIso(), label, upserts });
}

function historyRow(addressId: string, kind: HistoryEntry['kind'], ts: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: uid(),
    address_id: addressId,
    kind,
    status: null,
    previous_status: null,
    note_id: null,
    tags_added: [],
    tags_removed: [],
    changes: {},
    followup_id: null,
    appointment_id: null,
    occurred_at: ts,
    user_id: ctx().uid,
    ...owned(ts),
    ...extra,
  };
}

function addressPatch(a: Address, ts: string, patch: Partial<Address>): Address {
  return { ...a, ...patch, last_activity_at: ts, last_activity_by: ctx().uid, updated_by: ctx().uid, updated_at: ts };
}

function closeOpenFollowup(addressId: string, ts: string, reason: Followup['status']): Followup[] {
  const f = openFollowupOf(addressId);
  if (!f) return [];
  return [{ ...f, status: reason, completed_at: ts, updated_at: ts, updated_by: ctx().uid }];
}

function tagDiff(addressId: string, next: string[] | undefined, ts: string) {
  if (!next) return { rows: [] as AddressTag[], added: [] as string[], removed: [] as string[] };
  const cur = new Set(tagsOf(addressId));
  const nxt = new Set(next);
  const added = [...nxt].filter((t) => !cur.has(t));
  const removed = [...cur].filter((t) => !nxt.has(t));
  const rows: AddressTag[] = [];
  for (const t of added) {
    const id = `${addressId}:${t}`;
    const prev = store.get('address_potential_tags', id);
    rows.push(
      prev
        ? { ...prev, removed_at: null, updated_at: ts, updated_by: ctx().uid }
        : { id, address_id: addressId, tag_id: t, removed_at: null, created_by: ctx().uid, updated_by: ctx().uid, ...owned(ts) },
    );
  }
  for (const t of removed) {
    const prev = store.get('address_potential_tags', `${addressId}:${t}`);
    if (prev) rows.push({ ...prev, removed_at: ts, updated_at: ts, updated_by: ctx().uid });
  }
  return { rows, added, removed };
}

export interface QualifyInput {
  status: StatusKey;
  note?: string;
  tags?: string[];
  contacted?: boolean;
  excludedReason?: string;
}

/** Hauptstatus setzen (inkl. optionaler Notiz & Tags) – ein Klick, eine Op. */
export function setStatus(addressId: string, input: QualifyInput) {
  const a = store.get('addresses', addressId);
  if (!a) return;
  const ts = nowIso();
  const upserts: Op['upserts'] = { address_status_history: [], notes: [], address_potential_tags: [], followups: [] };
  let noteId: string | null = null;
  if (input.note?.trim()) {
    noteId = uid();
    upserts.notes!.push({ id: noteId, address_id: addressId, body: input.note.trim(), occurred_at: ts, user_id: ctx().uid, ...owned(ts) });
  }
  const td = tagDiff(addressId, input.tags, ts);
  upserts.address_potential_tags = td.rows;
  if (CLOSING_STATUSES.includes(input.status)) upserts.followups = closeOpenFollowup(addressId, ts, 'done');
  const exclude = input.status === 'no_potential';
  upserts.addresses = [
    addressPatch(a, ts, {
      current_status: input.status,
      status_changed_at: ts,
      excluded: exclude,
      excluded_reason: exclude ? input.excludedReason ?? a.excluded_reason ?? null : null,
    }),
  ];
  upserts.address_status_history!.push(
    historyRow(addressId, exclude ? 'exclude' : 'status', ts, {
      status: input.status,
      previous_status: a.current_status,
      note_id: noteId,
      tags_added: td.added,
      tags_removed: td.removed,
      changes: {
        ...(input.contacted !== undefined ? { contacted: input.contacted } : {}),
        ...(exclude && input.excludedReason ? { reason: input.excludedReason } : {}),
        ...(noteId ? { note: input.note!.trim() } : {}),
      },
    }),
  );
  commit('Status gesetzt', upserts);
}

/** Ausgeschlossene Adresse wiederherstellen → letzter Status vor Ausschluss. */
export function restoreAddress(addressId: string) {
  const a = store.get('addresses', addressId);
  if (!a) return;
  const ts = nowIso();
  const prev = historyOf(addressId).find((h) => h.status && h.status !== 'no_potential' && h.kind !== 'exclude')?.status ?? 'unprocessed';
  commit('Adresse wiederhergestellt', {
    addresses: [addressPatch(a, ts, { current_status: prev, status_changed_at: ts, excluded: false, excluded_reason: null })],
    address_status_history: [historyRow(addressId, 'restore', ts, { status: prev, previous_status: a.current_status })],
  });
}

export function addNote(addressId: string, body: string) {
  const a = store.get('addresses', addressId);
  if (!a || !body.trim()) return;
  const ts = nowIso();
  const noteId = uid();
  commit('Notiz gespeichert', {
    notes: [{ id: noteId, address_id: addressId, body: body.trim(), occurred_at: ts, user_id: ctx().uid, ...owned(ts) }],
    address_status_history: [historyRow(addressId, 'note', ts, { note_id: noteId, changes: { note: body.trim() } })],
    addresses: [addressPatch(a, ts, {})],
  });
}

export function setTags(addressId: string, tags: string[]) {
  const a = store.get('addresses', addressId);
  if (!a) return;
  const ts = nowIso();
  const td = tagDiff(addressId, tags, ts);
  if (!td.added.length && !td.removed.length) return;
  commit('Tags geändert', {
    address_potential_tags: td.rows,
    address_status_history: [historyRow(addressId, 'tags', ts, { tags_added: td.added, tags_removed: td.removed })],
    addresses: [addressPatch(a, ts, {})],
  });
}

export interface FollowupInput {
  priority: Priority;
  period: FollowupPeriod;
  tags?: string[];
  note?: string;
  contacted?: boolean;
}

export function saveFollowup(addressId: string, input: FollowupInput) {
  const a = store.get('addresses', addressId);
  if (!a) return;
  const ts = nowIso();
  const fid = uid();
  const td = tagDiff(addressId, input.tags, ts);
  let noteId: string | null = null;
  const notes = [];
  if (input.note?.trim()) {
    noteId = uid();
    notes.push({ id: noteId, address_id: addressId, body: input.note.trim(), occurred_at: ts, user_id: ctx().uid, ...owned(ts) });
  }
  const followup: Followup = {
    id: fid,
    address_id: addressId,
    priority: input.priority,
    due_date: input.period.due_date,
    period_start: input.period.period_start,
    period_end: input.period.period_end,
    period_label: input.period.label,
    preset: input.period.preset,
    note: input.note?.trim() || null,
    status: 'open',
    completed_at: null,
    occurred_at: ts,
    user_id: ctx().uid,
    assigned_user_id: a.assigned_user_id ?? ctx().uid,
    created_by: ctx().uid,
    updated_by: ctx().uid,
    ...owned(ts),
  };
  commit('Wiedervorlage gespeichert', {
    followups: [...closeOpenFollowup(addressId, ts, 'superseded'), followup],
    notes,
    address_potential_tags: td.rows,
    addresses: [addressPatch(a, ts, { current_status: 'followup', status_changed_at: ts, excluded: false })],
    address_status_history: [
      historyRow(addressId, 'followup', ts, {
        status: 'followup',
        previous_status: a.current_status,
        followup_id: fid,
        note_id: noteId,
        tags_added: td.added,
        tags_removed: td.removed,
        changes: { priority: input.priority, due_date: input.period.due_date, period: input.period.label, contacted: !!input.contacted, ...(noteId ? { note: input.note!.trim() } : {}) },
      }),
    ],
  });
}

export function completeFollowup(followupId: string) {
  const f = store.get('followups', followupId);
  if (!f || f.status !== 'open') return;
  const ts = nowIso();
  commit('Wiedervorlage erledigt', {
    followups: [{ ...f, status: 'done', completed_at: ts, updated_at: ts, updated_by: ctx().uid }],
    address_status_history: [historyRow(f.address_id, 'system', ts, { followup_id: f.id, changes: { followup: 'erledigt' } })],
  });
}

// ---------------------------------------------------------------------
// Termine
// ---------------------------------------------------------------------
export interface AppointmentDraftInput {
  addressId: string | null;
  customer_name: string;
  phone: string;
  email: string;
  address_text: string;
  main_product_id: string;
  product_ids: string[];
  note: string;
  lead_source: LeadSource;
}

/** Legt den Termin als "pending" an, bevor Calendly bucht (Calendly-Webhook ordnet über diese ID zu). */
export function createAppointmentDraft(input: AppointmentDraftInput, bookingMode: string): string {
  const ts = nowIso();
  const id = uid();
  const appt: Appointment = {
    id,
    address_id: input.addressId,
    status: 'pending',
    start_time: null,
    end_time: null,
    customer_name: input.customer_name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim() || null,
    address_text: input.address_text.trim(),
    main_product_id: input.main_product_id,
    product_ids: input.product_ids.filter((p) => p !== input.main_product_id),
    note: input.note.trim() || null,
    lead_source: input.lead_source,
    lead_source_detail: null,
    booking_mode: bookingMode,
    calendly_event_uri: null,
    calendly_invitee_uri: null,
    calendly_cancel_url: null,
    calendly_reschedule_url: null,
    cancel_reason: null,
    user_id: ctx().uid,
    assigned_user_id: ctx().uid,
    created_by: ctx().uid,
    updated_by: ctx().uid,
    ...owned(ts),
  };
  commit('Terminentwurf', { appointments: [appt] });
  return id;
}

export interface BookingResult {
  start_time: string;
  end_time: string;
  event_uri?: string | null;
  invitee_uri?: string | null;
  cancel_url?: string | null;
  reschedule_url?: string | null;
}

/** Nach erfolgreicher Buchung: Termin bestätigen, Adresse → "Termin vereinbart", Verlauf ergänzen. */
export function confirmAppointment(appointmentId: string, r: BookingResult) {
  const ap = store.get('appointments', appointmentId);
  if (!ap) return;
  const ts = nowIso();
  const upserts: Op['upserts'] = {
    appointments: [
      {
        ...ap,
        status: 'scheduled',
        start_time: r.start_time,
        end_time: r.end_time,
        calendly_event_uri: r.event_uri ?? ap.calendly_event_uri,
        calendly_invitee_uri: r.invitee_uri ?? ap.calendly_invitee_uri,
        calendly_cancel_url: r.cancel_url ?? ap.calendly_cancel_url,
        calendly_reschedule_url: r.reschedule_url ?? ap.calendly_reschedule_url,
        updated_at: ts,
        updated_by: ctx().uid,
      },
    ],
  };
  const a = ap.address_id ? store.get('addresses', ap.address_id) : undefined;
  if (a) {
    upserts.followups = closeOpenFollowup(a.id, ts, 'done');
    upserts.addresses = [addressPatch(a, ts, { current_status: 'appointment', status_changed_at: ts, excluded: false })];
    upserts.address_products = [ap.main_product_id, ...ap.product_ids].map((p) => {
      const id = `${a.id}:${p}`;
      const prev = store.get('address_products', id);
      return prev
        ? { ...prev, removed_at: null, interest: p === ap.main_product_id ? 'primary' : prev.interest, updated_at: ts }
        : { id, address_id: a.id, product_id: p, interest: p === ap.main_product_id ? 'primary' : 'interest', removed_at: null, created_by: ctx().uid, updated_by: ctx().uid, ...owned(ts) };
    }) as Tables['address_products'][];
    upserts.address_status_history = [
      historyRow(a.id, 'appointment', ts, {
        // deterministische ID = Termin-ID: App und Calendly-Webhook schreiben denselben
        // Verlaufseintrag → niemals doppelt (Upsert + append-only-Trigger)
        id: ap.id,
        status: 'appointment',
        previous_status: a.current_status,
        appointment_id: ap.id,
        changes: { start_time: r.start_time, main_product: ap.main_product_id, products: ap.product_ids, note: ap.note },
      }),
    ];
  }
  commit('Termin vereinbart', upserts);
}

/** Termin lokal als storniert markieren (z. B. Abbruch im Buchungsdialog oder Webhook-Spiegel). */
export function cancelAppointmentDraft(appointmentId: string, reason = 'Buchung abgebrochen') {
  const ap = store.get('appointments', appointmentId);
  if (!ap || ap.status !== 'pending') return;
  const ts = nowIso();
  commit('Terminentwurf verworfen', { appointments: [{ ...ap, status: 'canceled', cancel_reason: reason, updated_at: ts }] });
}

// ---------------------------------------------------------------------
// Orte, Straßen, Adressen (manuell)
// ---------------------------------------------------------------------
export function createTown(name: string, postalCodes: string[], extra: Partial<Town> = {}): Town {
  const ts = nowIso();
  const town: Town = {
    id: uid(),
    name: name.trim(),
    postal_codes: postalCodes.filter(Boolean),
    state: null,
    osm_relation_id: null,
    source: 'manual',
    archived_at: null,
    created_by: ctx().uid,
    updated_by: ctx().uid,
    ...owned(ts),
    ...extra,
  };
  commit('Ort angelegt', { towns: [town] });
  return town;
}

export function newStreetRow(townId: string, name: string, postal: string | null, source: string, ts: string): Street {
  const clean = normalizeStreetName(name);
  return {
    id: uid(),
    town_id: townId,
    name: clean,
    name_key: streetKey(clean),
    postal_code: postal,
    source,
    archived_at: null,
    created_by: ctx().uid,
    updated_by: ctx().uid,
    ...owned(ts),
  };
}

export function newAddressRow(townId: string, streetId: string, number: string, postal: string | null, source: string, ts: string, sourceRef: string | null = null): Address {
  const p = parseHouseNumber(number);
  return {
    id: uid(),
    town_id: townId,
    street_id: streetId,
    house_number: p.display,
    house_number_numeric: p.numeric,
    house_number_suffix: p.suffix,
    number_key: p.key,
    postal_code: postal,
    current_status: 'unprocessed',
    status_changed_at: null,
    excluded: false,
    excluded_reason: null,
    source,
    source_ref: sourceRef,
    source_missing_at: null,
    last_activity_at: null,
    last_activity_by: null,
    assigned_user_id: ctx().uid,
    created_by: ctx().uid,
    updated_by: ctx().uid,
    ...owned(ts),
  };
}

/** Neue Straße (oder vorhandene gleichen Namens) + Hausnummern. Vorhandene Nummern bleiben unberührt. */
export function addStreetWithNumbers(townId: string, name: string, numbers: string[], postal: string | null): { street: Street; added: number; skipped: number } {
  const ts = nowIso();
  const key = streetKey(name);
  const existing = store.all('streets').find((s) => s.town_id === townId && s.name_key === key && !s.archived_at);
  const street = existing ?? newStreetRow(townId, name, postal, 'manual', ts);
  const res = addNumbersInternal(townId, street, numbers, postal, ts);
  commit(existing ? 'Hausnummern ergänzt' : 'Straße angelegt', { streets: existing ? [] : [street], addresses: res.rows });
  return { street, added: res.rows.length, skipped: res.skipped };
}

function addNumbersInternal(townId: string, street: Street, numbers: string[], postal: string | null, ts: string) {
  const have = new Set(addressesOf(street.id).map((a) => a.number_key));
  const rows: Address[] = [];
  let skipped = 0;
  for (const n of numbers) {
    const key = parseHouseNumber(n).key;
    if (!key || have.has(key)) {
      skipped++;
      continue;
    }
    have.add(key);
    rows.push(newAddressRow(townId, street.id, n, postal ?? street.postal_code, 'manual', ts));
  }
  return { rows, skipped };
}

export function addNumbers(streetId: string, numbers: string[]) {
  const street = store.get('streets', streetId);
  if (!street) return { added: 0, skipped: 0 };
  const ts = nowIso();
  const town = store.get('towns', street.town_id);
  const res = addNumbersInternal(street.town_id, street, numbers, street.postal_code ?? town?.postal_codes[0] ?? null, ts);
  if (res.rows.length) commit('Hausnummern ergänzt', { addresses: res.rows });
  return { added: res.rows.length, skipped: res.skipped };
}

export function renameStreet(streetId: string, name: string) {
  const s = store.get('streets', streetId);
  if (!s || !name.trim()) return;
  const ts = nowIso();
  const clean = normalizeStreetName(name);
  commit('Straße umbenannt', { streets: [{ ...s, name: clean, name_key: streetKey(clean), updated_at: ts, updated_by: ctx().uid }] });
}

export function commitRaw(label: string, upserts: Op['upserts']) {
  commit(label, upserts);
}
export { owned as ownedFields, historyRow };
