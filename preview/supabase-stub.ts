// Nur für die statische Vorschau: Supabase wird dort nie geladen (keine Zugangsdaten).
export function createClient(): never { throw new Error('Supabase ist in der Vorschau nicht verfügbar'); }
export type SupabaseClient = unknown; export type Session = unknown;
