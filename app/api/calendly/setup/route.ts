// Registriert den Calendly-Webhook (invitee.created / invitee.canceled) auf diese App.
import { CalendlyError, ensureWebhook } from '@/server/calendly';
import { fail, json, requireUser } from '@/server/http';
import { configured, env } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (!configured.calendly) return fail('Calendly ist nicht konfiguriert', 503, 'calendly_missing');
  if (!env.calendlySigningKey) return fail('CALENDLY_WEBHOOK_SIGNING_KEY fehlt (beliebiger langer Zufallswert).', 503);
  if (!/^https:\/\//.test(env.appUrl)) return fail('APP_URL muss eine öffentliche https-Adresse sein (z. B. Vercel-Domain).', 422);
  try {
    return json(await ensureWebhook(`${env.appUrl}/api/calendly/webhook`));
  } catch (e) {
    const err = e as CalendlyError;
    return fail(err.message, err.status ?? 500, err.code);
  }
}
