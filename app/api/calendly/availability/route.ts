import { availableTimes, CalendlyError } from '@/server/calendly';
import { fail, json, requireUser } from '@/server/http';
import { configured } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (!configured.calendly) return fail('Calendly ist nicht konfiguriert', 503, 'calendly_missing');
  const u = new URL(req.url);
  const from = new Date(u.searchParams.get('from') ?? Date.now());
  const to = new Date(u.searchParams.get('to') ?? Date.now() + 14 * 86400000);
  try {
    return json({ slots: await availableTimes(from, to) });
  } catch (e) {
    const err = e as CalendlyError;
    return fail(err.message, err.status ?? 500, err.code);
  }
}
