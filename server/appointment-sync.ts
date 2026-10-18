// Spiegelt Calendly-Ereignisse (Webhook / eingebettete Buchung) in die Datenbank.
// Calendly bleibt die Terminquelle; es gibt nie doppelte Datensätze:
//  * Zuordnung über tracking.utm_content (= Termin-ID der App), Invitee-URI oder alte Invitee-URI (Verschiebung)
//  * Verlaufseintrag der Erstbuchung hat die Termin-ID als ID → idempotent
import 'server-only';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from './http';

interface InviteePayload {
  uri: string;
  name?: string;
  email?: string;
  status?: string;
  event?: string;
  scheduled_event?: { uri: string; start_time: string; end_time: string; name?: string };
  tracking?: { utm_content?: string | null; utm_medium?: string | null };
  cancel_url?: string;
  reschedule_url?: string;
  rescheduled?: boolean;
  old_invitee?: string | null;
  new_invitee?: string | null;
  cancellation?: { reason?: string; canceled_by?: string };
  questions_and_answers?: { question: string; answer: string }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findAppointment(p: InviteePayload) {
  const sb = supabaseAdmin();
  const id = p.tracking?.utm_content;
  if (id && UUID.test(id)) {
    const { data } = await sb.from('appointments').select('*').eq('id', id).maybeSingle();
    if (data) return data;
  }
  for (const uri of [p.uri, p.old_invitee].filter(Boolean) as string[]) {
    const { data } = await sb.from('appointments').select('*').eq('calendly_invitee_uri', uri).maybeSingle();
    if (data) return data;
  }
  return null;
}

async function setAddressStatus(addressId: string, ownerId: string, teamId: string | null, status: string, appointmentId: string, historyId: string, changes: Record<string, unknown>, kind = 'appointment') {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const { data: addr } = await sb.from('addresses').select('current_status').eq('id', addressId).maybeSingle();
  if (!addr) return;
  await sb.from('addresses').update({ current_status: status, status_changed_at: now, last_activity_at: now, excluded: false }).eq('id', addressId);
  await sb.from('address_status_history').upsert(
    {
      id: historyId,
      address_id: addressId,
      kind,
      status,
      previous_status: addr.current_status,
      appointment_id: appointmentId,
      changes,
      occurred_at: now,
      user_id: null,
      owner_user_id: ownerId,
      team_id: teamId,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
}

export async function handleInviteeCreated(p: InviteePayload) {
  const sb = supabaseAdmin();
  const ev = p.scheduled_event;
  const appt = await findAppointment(p);
  const fields = {
    status: 'scheduled',
    start_time: ev?.start_time ?? null,
    end_time: ev?.end_time ?? null,
    calendly_event_uri: ev?.uri ?? p.event ?? null,
    calendly_invitee_uri: p.uri,
    calendly_cancel_url: p.cancel_url ?? null,
    calendly_reschedule_url: p.reschedule_url ?? null,
    cancel_reason: null,
  };
  if (appt) {
    const wasPending = appt.status === 'pending';
    const isReschedule = !!p.old_invitee && appt.calendly_invitee_uri === p.old_invitee;
    await sb.from('appointments').update(fields).eq('id', appt.id);
    if (appt.address_id) {
      if (wasPending) await setAddressStatus(appt.address_id, appt.owner_user_id, appt.team_id, 'appointment', appt.id, appt.id, { start_time: fields.start_time, source: 'calendly' });
      else if (isReschedule)
        await setAddressStatus(appt.address_id, appt.owner_user_id, appt.team_id, 'appointment', appt.id, randomUUID(), { text: 'Termin verschoben (Calendly)', start_time: fields.start_time, previous_start: appt.start_time });
    }
    return { action: isReschedule ? 'rescheduled' : 'confirmed', id: appt.id };
  }
  // Direkt in Calendly gebuchter Termin ohne App-Bezug → als Termin ohne Adresse anlegen
  const { data: owner } = await sb.from('users').select('id, default_team_id').eq('role', 'admin').order('created_at').limit(1).maybeSingle();
  if (!owner) return { action: 'ignored', reason: 'kein Benutzer' };
  const qa = Object.fromEntries((p.questions_and_answers ?? []).map((q) => [q.question.toLowerCase(), q.answer]));
  const id = randomUUID();
  await sb.from('appointments').insert({
    id,
    address_id: null,
    ...fields,
    customer_name: p.name ?? 'Calendly-Buchung',
    phone: qa.telefon ?? qa.telefonnummer ?? '',
    email: p.email ?? null,
    address_text: qa.adresse ?? '',
    main_product_id: 'kunststofffenster',
    product_ids: [],
    note: qa.hinweis ?? null,
    lead_source: 'other',
    booking_mode: 'calendly-direct',
    owner_user_id: owner.id,
    team_id: owner.default_team_id,
  });
  return { action: 'created', id };
}

export async function handleInviteeCanceled(p: InviteePayload) {
  if (p.rescheduled) return { action: 'ignored', reason: 'verschoben – Folgetermin kommt als invitee.created' };
  const sb = supabaseAdmin();
  const appt = await findAppointment(p);
  if (!appt) return { action: 'ignored', reason: 'unbekannt' };
  await sb.from('appointments').update({ status: 'canceled', cancel_reason: p.cancellation?.reason ?? 'in Calendly storniert' }).eq('id', appt.id);
  if (appt.address_id) {
    const { data: addr } = await sb.from('addresses').select('current_status').eq('id', appt.address_id).maybeSingle();
    // Status nur zurücksetzen, wenn die Adresse noch auf "Termin vereinbart" steht – Verlauf bleibt vollständig
    if (addr?.current_status === 'appointment')
      await setAddressStatus(appt.address_id, appt.owner_user_id, appt.team_id, 'contacted', appt.id, randomUUID(), { text: 'Termin storniert (Calendly)', reason: p.cancellation?.reason ?? null });
  }
  return { action: 'canceled', id: appt.id };
}
