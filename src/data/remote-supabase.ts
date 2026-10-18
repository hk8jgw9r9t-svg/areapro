// Supabase-Anbindung für den Store: Upsert-Push und inkrementeller Pull (Cursor je Tabelle).
import type { SupabaseClient } from '@supabase/supabase-js';
import { PermanentSyncError, type Remote } from './store';
import { TABLE_NAMES, type Op, type TableName, type Tables } from '../lib/types';

const PAGE = 1000;

export function createSupabaseRemote(sb: SupabaseClient): Remote {
  return {
    kind: 'supabase',
    async push(op: Op) {
      // Reihenfolge der Tabellen beachtet Fremdschlüssel (Orte → Straßen → Adressen → …)
      for (const t of TABLE_NAMES) {
        const rows = op.upserts[t] as Record<string, unknown>[] | undefined;
        if (!rows?.length) continue;
        // pro Tabelle nur die letzte Version je ID senden
        const byId = new Map<string, Record<string, unknown>>();
        for (const r of rows) byId.set(String(r.id), { ...(byId.get(String(r.id)) ?? {}), ...r });
        const clean = [...byId.values()].map(({ server_updated_at: _s, ...rest }) => rest);
        for (let i = 0; i < clean.length; i += 500) {
          const { error } = await sb.from(t).upsert(clean.slice(i, i + 500), { onConflict: 'id' });
          if (error) {
            const code = String((error as { code?: string }).code ?? '');
            if (/^(22|23|42|PGRST)/.test(code)) throw new PermanentSyncError(`${t}: ${error.message} (${code})`);
            throw new Error(error.message);
          }
        }
      }
    },
    async pull(cursorRaw) {
      const cursor: Record<string, string> = cursorRaw ? JSON.parse(cursorRaw) : {};
      const rows: Partial<{ [K in TableName]: Tables[K][] }> = {};
      const next = { ...cursor };
      await Promise.all(
        TABLE_NAMES.map(async (t) => {
          let q = sb.from(t).select('*').order('server_updated_at', { ascending: true }).limit(PAGE);
          if (cursor[t]) q = q.gt('server_updated_at', cursor[t]);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          if (data?.length) {
            (rows as Record<string, unknown[]>)[t] = data;
            next[t] = String((data[data.length - 1] as { server_updated_at: string }).server_updated_at);
          }
        }),
      );
      return { rows, cursor: JSON.stringify(next) };
    },
  };
}
