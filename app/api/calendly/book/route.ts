// Direktbuchung über die Calendly Scheduling API. Der Termin-Datensatz selbst wird vom Client
// (offline-sicher) geschrieben; der Webhook bestätigt anschließend idempotent.
import { bookInvitee, CalendlyError, type BookInput } from '@/server/calendly';
import { fail, json, requireUser } from '@/server/http';
import { configured } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (!configured.calendly) return fail('Calendly ist nicht konfiguriert', 503, 'calendly_missing');
  const body = (await req.json()) as BookInput;
  if (!body.appointmentId || !body.start_time || !body.name || !body.phone) return fail('Pflichtangaben fehlen', 422);
  try {
    return json(await bookInvitee(body));
  } catch (e) {
    const err = e as CalendlyError;
    return fail(err.message, err.status ?? 500, err.code);
  }
}
