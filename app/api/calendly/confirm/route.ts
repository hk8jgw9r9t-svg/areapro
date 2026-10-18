// Nach eingebetteter Calendly-Buchung (postMessage): Details serverseitig verifizieren und zurückgeben.
import { CalendlyError, fetchBooking } from '@/server/calendly';
import { fail, json, requireUser } from '@/server/http';
import { configured } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (!configured.calendly) return fail('Calendly ist nicht konfiguriert', 503, 'calendly_missing');
  const { eventUri, inviteeUri } = (await req.json()) as { appointmentId: string; eventUri: string; inviteeUri: string };
  if (!/^https:\/\/api\.calendly\.com\/scheduled_events\//.test(eventUri ?? '')) return fail('Ungültige Calendly-Event-URI', 422);
  if (inviteeUri && !/^https:\/\/api\.calendly\.com\/scheduled_events\//.test(inviteeUri)) return fail('Ungültige Invitee-URI', 422);
  try {
    return json(await fetchBooking(eventUri, inviteeUri));
  } catch (e) {
    const err = e as CalendlyError;
    return fail(err.message, err.status ?? 500, err.code);
  }
}
