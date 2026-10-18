import { configured } from '@/server/env';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

export function GET() {
  return json({ ok: true, supabase: configured.supabase, calendly: configured.calendly, google: configured.google });
}
