// Abonnierbarer Kalender (iCal) mit offenen Wiedervorlagen – für iPhone-, Mac- und Google-Kalender.
// Zugriff über geheimes Feed-Token (external_integrations.feed_token). Keine Kundendaten im Feed.
import { supabaseAdmin } from '@/server/http';
import { configured } from '@/server/env';

export const dynamic = 'force-dynamic';

function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
const PRIO: Record<string, string> = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' };

export async function GET(req: Request) {
  if (!configured.supabaseAdmin) return new Response('Nicht konfiguriert', { status: 503 });
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (token.length < 32) return new Response('Unbekannt', { status: 404 });
  const sb = supabaseAdmin();
  const { data: integ } = await sb.from('external_integrations').select('owner_user_id').eq('provider', 'ical').eq('feed_token', token).maybeSingle();
  if (!integ) return new Response('Unbekannt', { status: 404 });
  const { data: fus } = await sb
    .from('followups')
    .select('id, due_date, priority, period_label, preset, address_id, addresses(house_number, streets(name), towns(name))')
    .eq('owner_user_id', integ.owner_user_id)
    .eq('status', 'open')
    .limit(5000);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AreaPro//D2D Sales//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:AreaPro Wiedervorlagen', 'X-WR-TIMEZONE:Europe/Berlin'];
  for (const f of (fus ?? []) as unknown as {
    id: string;
    due_date: string;
    priority: string;
    period_label: string | null;
    preset: string | null;
    addresses: { house_number: string; streets: { name: string } | null; towns: { name: string } | null } | null;
  }[]) {
    const d = f.due_date.replace(/-/g, '');
    const next = new Date(`${f.due_date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const addr = f.addresses ? `${f.addresses.streets?.name ?? ''} ${f.addresses.house_number}, ${f.addresses.towns?.name ?? ''}` : 'Adresse';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${f.id}@areapro`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
      `SUMMARY:${esc(`WV ${PRIO[f.priority] ?? ''}: ${addr}`)}`,
      `DESCRIPTION:${esc(`Wiedervorlage${f.period_label && f.preset !== 'date' ? ` (${f.period_label})` : ''}`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
}
