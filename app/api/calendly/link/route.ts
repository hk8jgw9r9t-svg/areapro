import { CalendlyError, singleUseLink } from '@/server/calendly';
import { fail, json, requireUser } from '@/server/http';
import { configured } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (!configured.calendly) return fail('Calendly ist nicht konfiguriert', 503, 'calendly_missing');
  try {
    return json({ url: await singleUseLink() });
  } catch (e) {
    const err = e as CalendlyError;
    return fail(err.message, err.status ?? 500, err.code);
  }
}
