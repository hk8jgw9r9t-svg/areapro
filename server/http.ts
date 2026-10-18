import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { configured, env } from './env';

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function fail(error: string, status = 400, code?: string) {
  return json({ error, code }, status);
}

/** Service-Role-Client (umgeht RLS) – nur für Webhooks/Feeds, niemals an den Client geben. */
let admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!configured.supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY fehlt');
  admin ??= createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Client im Namen des Benutzers (RLS greift). */
export function supabaseAsUser(token: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Prüft das Supabase-Zugriffstoken aus dem Authorization-Header.
 * Integrationsrouten sind ohne gültige Anmeldung nicht nutzbar (Schutz vor Missbrauch der API-Schlüssel).
 */
export async function requireUser(req: Request): Promise<{ user: User; token: string } | Response> {
  if (!configured.supabase) return fail('Supabase ist nicht konfiguriert – Integrationen erfordern eine Anmeldung.', 503, 'supabase_missing');
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return fail('Nicht angemeldet', 401, 'unauthorized');
  const sb = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return fail('Sitzung abgelaufen – bitte neu anmelden', 401, 'unauthorized');
  return { user: data.user, token };
}
