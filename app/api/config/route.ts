// Liefert dem Client NUR, welche Integrationen konfiguriert sind (keine Geheimnisse).
import { configured, env } from '@/server/env';
import { json } from '@/server/http';
import { bookingMode, getEventType, listWebhooks } from '@/server/calendly';

export const dynamic = 'force-dynamic';

export async function GET() {
  let eventTypeName: string | null = null;
  let schedulingUrl: string | null = null;
  let webhook: 'active' | 'missing' | 'unknown' = 'unknown';
  if (configured.calendly) {
    try {
      const et = await getEventType();
      eventTypeName = `${et.name} (${et.duration} Min)`;
      schedulingUrl = et.scheduling_url;
      const hooks = await listWebhooks();
      webhook = hooks.some((h) => h.callback_url === `${env.appUrl}/api/calendly/webhook` && h.state === 'active') ? 'active' : 'missing';
    } catch {
      webhook = 'unknown';
    }
  }
  return json({
    calendly: {
      configured: configured.calendly && configured.supabase,
      mode: configured.calendly && configured.supabase ? bookingMode() : 'mock',
      eventTypeName,
      schedulingUrl,
      fallbackEmail: env.calendlyFallbackEmail || null,
      webhook,
    },
    google: { configured: configured.google && configured.supabase, spreadsheetUrl: configured.google ? `https://docs.google.com/spreadsheets/d/${env.googleSpreadsheetId}/edit` : null },
  });
}
