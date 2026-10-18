// Anmeldung & Sitzungsmodus.
// * Supabase-Modus: sobald NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY gesetzt sind.
// * Demo-Modus: ohne Zugangsdaten – alle Daten nur lokal auf dem Gerät (IndexedDB).

import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { store, type SessionUser } from './store';
import { createSupabaseRemote } from './remote-supabase';
import { requestPersistence, kvGet, kvSet } from './idb';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;
export async function getSupabase(): Promise<SupabaseClient | null> {
  if (!supabaseConfigured) return null;
  if (client) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export async function accessToken(): Promise<string | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function openSupabaseSession(session: Session) {
  const sb = (await getSupabase())!;
  const u = session.user;
  // Profil (Team) laden – offline: aus Cache
  let team: string | null = null;
  let displayName: string | null = null;
  try {
    const { data } = await sb.from('users').select('default_team_id, display_name').eq('id', u.id).single();
    team = (data?.default_team_id as string) ?? null;
    displayName = (data?.display_name as string) ?? null;
    await kvSet(`profile:${u.id}`, { team, displayName });
  } catch {
    const cached = await kvGet<{ team: string | null; displayName: string | null }>(`profile:${u.id}`);
    team = cached?.team ?? null;
    displayName = cached?.displayName ?? null;
  }
  const user: SessionUser = { id: u.id, email: u.email ?? null, display_name: displayName, team_id: team };
  await store.open(user, 'supabase', createSupabaseRemote(sb));
  void requestPersistence();
}

/** Beim App-Start: bestehende Sitzung wiederherstellen. Gibt true zurück, wenn angemeldet. */
export async function restoreSession(): Promise<boolean> {
  if (supabaseConfigured) {
    const sb = (await getSupabase())!;
    const { data } = await sb.auth.getSession();
    if (data.session) {
      await openSupabaseSession(data.session);
      return true;
    }
    return false;
  }
  const demo = await kvGet<SessionUser>('demo:session');
  if (demo) {
    await store.open(demo, 'demo', null);
    return true;
  }
  return false;
}

export async function signInWithPassword(email: string, password: string) {
  const sb = (await getSupabase())!;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error.message));
  await openSupabaseSession(data.session!);
}

export async function signUp(email: string, password: string) {
  const sb = (await getSupabase())!;
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) throw new Error(translateAuthError(error.message));
  if (data.session) await openSupabaseSession(data.session);
  return { needsConfirmation: !data.session };
}

export async function sendMagicLink(email: string) {
  const sb = (await getSupabase())!;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin, shouldCreateUser: false } });
  if (error) throw new Error(translateAuthError(error.message));
}

export async function startDemo(name = 'Demo-Benutzer') {
  const user: SessionUser = { id: '00000000-0000-4000-8000-000000000001', email: null, display_name: name, team_id: '00000000-0000-4000-8000-0000000000aa' };
  await kvSet('demo:session', user);
  await store.open(user, 'demo', null);
  void requestPersistence();
}

export async function signOut() {
  if (store.outbox.length) {
    const ok = confirm(`${store.outbox.length} Änderung(en) sind noch nicht synchronisiert. Trotzdem abmelden? Die Änderungen bleiben auf diesem Gerät gespeichert.`);
    if (!ok) return;
  }
  await store.saveNow();
  if (supabaseConfigured) {
    const sb = await getSupabase();
    await sb?.auth.signOut();
  } else {
    await kvSet('demo:session', null);
  }
  store.close();
}

function translateAuthError(msg: string): string {
  if (/invalid login/i.test(msg)) return 'E-Mail oder Passwort falsch.';
  if (/email not confirmed/i.test(msg)) return 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  if (/rate limit/i.test(msg)) return 'Zu viele Versuche – bitte kurz warten.';
  if (/signups not allowed|not allowed/i.test(msg)) return 'Registrierung ist deaktiviert.';
  return msg;
}
