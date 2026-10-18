// Calendly-Webhook: hält Terminstatus synchron (neu, verschoben, storniert).
import { verifySignature } from '@/server/calendly';
import { handleInviteeCanceled, handleInviteeCreated } from '@/server/appointment-sync';
import { fail, json, supabaseAdmin } from '@/server/http';
import { configured } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(req.headers.get('calendly-webhook-signature'), raw)) return fail('Ungültige Signatur', 401);
  if (!configured.supabaseAdmin) return fail('SUPABASE_SERVICE_ROLE_KEY fehlt', 503);
  const body = JSON.parse(raw) as { event: string; created_at?: string; payload: { uri: string } & Record<string, unknown> };
  const sb = supabaseAdmin();
  const dedupe = `${body.event}:${body.payload?.uri}`;
  const { error: dupErr } = await sb.from('webhook_events').insert({ provider: 'calendly', event: body.event, payload: body, dedupe_key: dedupe });
  if (dupErr?.code === '23505') return json({ ok: true, duplicate: true }); // bereits verarbeitet
  try {
    let result: unknown = { action: 'ignored' };
    if (body.event === 'invitee.created') result = await handleInviteeCreated(body.payload as never);
    else if (body.event === 'invitee.canceled') result = await handleInviteeCanceled(body.payload as never);
    await sb.from('webhook_events').update({ processed_at: new Date().toISOString() }).eq('dedupe_key', dedupe);
    return json({ ok: true, result });
  } catch (e) {
    await sb.from('webhook_events').update({ error: (e as Error).message }).eq('dedupe_key', dedupe);
    // 500 → Calendly wiederholt die Zustellung
    return fail((e as Error).message, 500);
  }
}
