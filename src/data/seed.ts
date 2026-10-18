// Beispieldaten für Entwicklung/Demo: Kürnbach (75057) mit Lücken in den Hausnummern,
// damit die Straßenseitenlogik testbar ist, plus etwas Verlauf für Dashboard & Auswertung.

import { store } from './store';
import { buildImportPlan, applyImportPlan, type RawAddress } from '../import/pipeline';
import { addressesOf, streetsOf } from './selectors';
import { ownedFields, historyRow } from './actions';
import { uid } from '../lib/id';
import { addDays, toDateKey, upcomingSeasons } from '../lib/dates';
import type { Address, Appointment, Followup, HistoryEntry, Note, Op, StatusKey } from '../lib/types';

const STREETS: Record<string, string[]> = {
  Goethestraße: ['1', '2', '2a', '3', '4', '5', '7', '8', '9', '10', '11', '12', '14', '14/1', '15', '16', '17', '18', '20'],
  Hauptstraße: ['1', '2', '3', '4', '5', '6', '8', '9', '10', '11', '13', '14', '15', '16', '17', '19', '20'],
  Schillerstraße: ['1', '3', '4', '5', '6', '7', '9', '10', '12', '12a', '12b', '13', '15', '16', '18'],
};

export function seedDemoData(): string {
  const existing = store.all('towns').find((t) => t.name === 'Kürnbach');
  if (existing) return existing.id;
  const raw: RawAddress[] = [];
  for (const [street, nums] of Object.entries(STREETS)) for (const n of nums) raw.push({ street, houseNumber: n, postalCode: '75057', city: 'Kürnbach', ref: null });
  const plan = buildImportPlan(raw, 'seed', { town: null, name: 'Kürnbach', postal_codes: ['75057'], state: 'Baden-Württemberg' });
  const town = applyImportPlan(plan, 'initial');

  // Verlauf der letzten Tage
  const now = new Date();
  const byName = Object.fromEntries(streetsOf(town.id).map((s) => [s.name, addressesOf(s.id)]));
  const find = (street: string, n: string) => (byName[street] as Address[]).find((a) => a.house_number === n)!;
  const at = (daysAgo: number, h: number, m = 0) => {
    const d = addDays(now, -daysAgo);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const upserts: Op['upserts'] = { addresses: [], address_status_history: [], followups: [], notes: [], address_potential_tags: [], appointments: [] };
  const setS = (a: Address, s: StatusKey, ts: string, extra: Partial<HistoryEntry> = {}) => {
    upserts.address_status_history!.push(historyRow(a.id, s === 'followup' ? 'followup' : 'status', ts, { status: s, previous_status: a.current_status, ...extra }));
    const nextA = { ...a, current_status: s, status_changed_at: ts, last_activity_at: ts, last_activity_by: store.user!.id, excluded: s === 'no_potential', excluded_reason: s === 'no_potential' ? 'unbewohnt' : null };
    Object.assign(a, nextA);
    upserts.addresses!.push(nextA);
  };
  const tag = (a: Address, t: string, ts: string) =>
    upserts.address_potential_tags!.push({ id: `${a.id}:${t}`, address_id: a.id, tag_id: t, removed_at: null, created_by: store.user!.id, updated_by: store.user!.id, ...ownedFields(ts) });
  const note = (a: Address, body: string, ts: string) => {
    const n: Note = { id: uid(), address_id: a.id, body, occurred_at: ts, user_id: store.user!.id, ...ownedFields(ts) };
    upserts.notes!.push(n);
    upserts.address_status_history!.push(historyRow(a.id, 'note', ts, { note_id: n.id, changes: { note: body } }));
  };
  const fu = (a: Address, prio: Followup['priority'], due: string, label: string, ts: string, n?: string) => {
    const f: Followup = {
      id: uid(), address_id: a.id, priority: prio, due_date: due, period_start: due, period_end: due, period_label: label, preset: 'date',
      note: n ?? null, status: 'open', completed_at: null, occurred_at: ts, user_id: store.user!.id, assigned_user_id: store.user!.id,
      created_by: store.user!.id, updated_by: store.user!.id, ...ownedFields(ts),
    };
    upserts.followups!.push(f);
    setS(a, 'followup', ts, { followup_id: f.id, changes: { priority: prio, due_date: due, period: label } });
  };

  // Goethestraße: einige erledigt
  setS(find('Goethestraße', '1'), 'not_home', at(3, 15, 10));
  setS(find('Goethestraße', '3'), 'not_interested', at(3, 15, 18));
  setS(find('Goethestraße', '5'), 'not_home', at(3, 15, 25));
  const g7 = find('Goethestraße', '7');
  tag(g7, 'alte_fenster', at(3, 15, 31));
  fu(g7, 'high', toDateKey(addDays(now, -1)), 'Datum', at(3, 15, 31), 'Fenster sichtbar alt, Eigentümer nicht angetroffen.');
  setS(find('Goethestraße', '2'), 'not_home', at(1, 16, 2));
  const g2a = find('Goethestraße', '2a');
  setS(g2a, 'existing_customer', at(1, 16, 6));
  const g4 = find('Goethestraße', '4');
  setS(g4, 'not_home', at(6, 14, 0));
  tag(g4, 'haustuer_alt', at(1, 16, 9));
  fu(g4, 'medium', toDateKey(now), 'Heute', at(1, 16, 9), 'Alte Haustür gesehen.');
  setS(find('Goethestraße', '8'), 'no_potential', at(1, 16, 12));

  // Hauptstraße
  setS(find('Hauptstraße', '1'), 'contacted', at(2, 11, 0));
  const h3 = find('Hauptstraße', '3');
  tag(h3, 'alte_markise', at(2, 11, 8));
  tag(h3, 'keine_markise_terrasse', at(2, 11, 8));
  const spring = upcomingSeasons(now, 5).find((s) => s.label.startsWith('Frühling'))!;
  fu(h3, 'high', spring.due_date, spring.label, at(2, 11, 8), 'Kunde sagt aktuell nicht, im Frühjahr noch einmal melden.');
  setS(find('Hauptstraße', '5'), 'not_home', at(2, 11, 15));
  setS(find('Hauptstraße', '2'), 'not_home', at(2, 11, 30));

  const h4 = find('Hauptstraße', '4');
  const apptId = uid();
  const start = addDays(now, 2);
  start.setHours(17, 30, 0, 0);
  const appt: Appointment = {
    id: apptId, address_id: h4.id, status: 'scheduled', start_time: start.toISOString(), end_time: new Date(start.getTime() + 90 * 60000).toISOString(),
    customer_name: 'Max Mustermann', phone: '0151 0000000', email: null, address_text: 'Hauptstraße 4, 75057 Kürnbach',
    main_product_id: 'kunststofffenster', product_ids: ['haustuer'], note: 'Bitte beide Eigentümer beim Termin.', lead_source: 'd2d',
    lead_source_detail: null, booking_mode: 'mock', calendly_event_uri: null, calendly_invitee_uri: null, calendly_cancel_url: null,
    calendly_reschedule_url: null, cancel_reason: null, user_id: store.user!.id, assigned_user_id: store.user!.id,
    created_by: store.user!.id, updated_by: store.user!.id, ...ownedFields(at(2, 11, 40)),
  };
  upserts.appointments!.push(appt);
  tag(h4, 'alte_fenster', at(2, 11, 40));
  setS(h4, 'appointment', at(2, 11, 40), { id: apptId, appointment_id: apptId, changes: { start_time: appt.start_time, main_product: 'kunststofffenster', products: ['haustuer'] } });

  // Schillerstraße
  setS(find('Schillerstraße', '1'), 'not_home', at(0, 10, 5));
  const s3 = find('Schillerstraße', '3');
  tag(s3, 'dachfenster_ohne_beschattung', at(0, 10, 12));
  note(s3, 'Zwei Dachfenster zur Südseite.', at(0, 10, 12));
  fu(s3, 'low', toDateKey(addDays(now, 9)), 'In 2 Wochen', at(0, 10, 12));

  store.apply({ op_id: uid(), ts: new Date().toISOString(), label: 'Beispieldaten', upserts });
  return town.id;
}
