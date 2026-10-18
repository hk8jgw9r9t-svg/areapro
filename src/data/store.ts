// Local-first Store
// ---------------------------------------------------------------------
// * Alle Daten liegen als Tabellen (Map<id,row>) im Speicher und werden in IndexedDB
//   gespiegelt → die App funktioniert bei schlechtem Empfang weiter.
// * Jede Änderung ist eine idempotente Op (nur Upserts, nie Löschungen).
// * Mit Server (Supabase) werden Ops in einer persistenten Outbox gesammelt und der Reihe nach
//   übertragen. Fehlt das Netz, bleiben sie erhalten und werden später automatisch gesendet.
// * Konflikte: Verlauf/Notizen sind append-only (kein Konflikt möglich). Beim aktuellen Status
//   gewinnt der neueste Zeitstempel (Server-Trigger addresses_keep_latest_status + gleiche
//   Regel lokal beim Einspielen von Server-Daten).

import { useSyncExternalStore } from 'react';
import { kvGet, kvSet } from './idb';
import type { Op, TableName, Tables } from '../lib/types';
import { TABLE_NAMES } from '../lib/types';
import { uid } from '../lib/id';

export type TableMaps = { [K in TableName]: Map<string, Tables[K]> };

export interface SessionUser {
  id: string;
  email: string | null;
  display_name: string | null;
  team_id: string | null;
}

export type SyncState = 'local' | 'synced' | 'syncing' | 'pending' | 'offline' | 'error';

export interface FailedOp {
  op: Op;
  error: string;
  at: string;
}

export interface Remote {
  kind: 'supabase';
  push(op: Op): Promise<void>;
  pull(cursor: string | null): Promise<{ rows: Partial<{ [K in TableName]: Tables[K][] }>; cursor: string | null }>;
}

/** Fehler, bei denen ein erneuter Versuch sinnlos ist (z. B. Constraint) – Op wird aufbewahrt, nicht verworfen. */
export class PermanentSyncError extends Error {}

function emptyTables(): TableMaps {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, new Map()])) as unknown as TableMaps;
}

class Store {
  tables: TableMaps = emptyTables();
  version = 0;
  user: SessionUser | null = null;
  mode: 'demo' | 'supabase' = 'demo';
  ready = false;
  outbox: Op[] = [];
  failed: FailedOp[] = [];
  syncState: SyncState = 'local';
  lastSyncAt: string | null = null;
  private cursor: string | null = null;
  private remote: Remote | null = null;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2000;
  private nsKey = 'demo';

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Startet die Sitzung (Demo oder Supabase) und lädt den lokalen Cache. */
  async open(user: SessionUser, mode: 'demo' | 'supabase', remote: Remote | null) {
    this.user = user;
    this.mode = mode;
    this.remote = remote;
    this.nsKey = `${mode}:${user.id}`;
    this.tables = emptyTables();
    const snap = await kvGet<Record<string, unknown[]>>(`${this.nsKey}:tables`);
    if (snap) {
      for (const t of TABLE_NAMES) {
        const rows = (snap[t] ?? []) as Tables[typeof t][];
        const m = this.tables[t] as Map<string, Tables[typeof t]>;
        rows.forEach((r) => m.set((r as { id: string }).id, r));
      }
    }
    this.outbox = (await kvGet<Op[]>(`${this.nsKey}:outbox`)) ?? [];
    this.failed = (await kvGet<FailedOp[]>(`${this.nsKey}:failed`)) ?? [];
    this.cursor = (await kvGet<string>(`${this.nsKey}:cursor`)) ?? null;
    this.lastSyncAt = (await kvGet<string>(`${this.nsKey}:lastSync`)) ?? null;
    this.ready = true;
    this.syncState = remote ? (this.outbox.length ? 'pending' : 'synced') : 'local';
    this.emit();
    if (remote) {
      if (typeof window !== 'undefined') {
        window.addEventListener('online', this.onOnline);
        document.addEventListener('visibilitychange', this.onVisible);
      }
      void this.sync();
    }
  }

  close() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    this.remote = null;
    this.user = null;
    this.ready = false;
    this.tables = emptyTables();
    this.emit();
  }

  private onOnline = () => void this.sync();
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.sync();
  };

  get<K extends TableName>(t: K, id: string | null | undefined): Tables[K] | undefined {
    if (!id) return undefined;
    return this.tables[t].get(id) as Tables[K] | undefined;
  }
  all<K extends TableName>(t: K): Tables[K][] {
    return [...(this.tables[t].values() as IterableIterator<Tables[K]>)];
  }

  /** Lokale Änderung anwenden (sofort sichtbar) und zur Synchronisation vormerken. */
  apply(op: Op) {
    this.merge(op.upserts, false);
    if (this.remote) {
      this.outbox.push(op);
      void kvSet(`${this.nsKey}:outbox`, this.outbox); // sofort sichern: Datenverlust vermeiden
      this.syncState = 'pending';
    }
    this.scheduleSave();
    this.emit();
    if (this.remote) void this.flush();
  }

  private merge(upserts: Op['upserts'], fromServer: boolean) {
    for (const t of TABLE_NAMES) {
      const rows = upserts[t] as Tables[typeof t][] | undefined;
      if (!rows?.length) continue;
      const m = this.tables[t] as Map<string, Tables[typeof t]>;
      for (const row of rows) {
        const id = (row as { id: string }).id;
        const prev = m.get(id) as Record<string, unknown> | undefined;
        if (fromServer && prev && t === 'addresses') {
          // gleiche Konfliktregel wie der Server: neuerer Status gewinnt
          const p = prev as unknown as Tables['addresses'];
          const n = row as unknown as Tables['addresses'];
          if (p.status_changed_at && n.status_changed_at && n.status_changed_at < p.status_changed_at) {
            m.set(id, { ...n, current_status: p.current_status, status_changed_at: p.status_changed_at, excluded: p.excluded, excluded_reason: p.excluded_reason } as never);
            continue;
          }
        }
        m.set(id, (prev ? { ...prev, ...(row as object) } : row) as never);
      }
    }
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 250);
  }

  async saveNow() {
    const snap: Record<string, unknown[]> = {};
    for (const t of TABLE_NAMES) snap[t] = [...this.tables[t].values()];
    await kvSet(`${this.nsKey}:tables`, snap);
  }

  /** Server-Daten einspielen + ausstehende Änderungen senden. */
  async sync() {
    if (!this.remote) return;
    await this.flush();
    try {
      this.syncState = this.outbox.length ? 'pending' : 'syncing';
      this.emit();
      let rounds = 0;
      // seitenweise ziehen, bis nichts Neues mehr kommt
      while (rounds++ < 50) {
        const { rows, cursor } = await this.remote.pull(this.cursor);
        const count = Object.values(rows).reduce((s, r) => s + (r?.length ?? 0), 0);
        if (count) this.merge(rows, true);
        if (cursor === this.cursor || !count) break;
        this.cursor = cursor;
        await kvSet(`${this.nsKey}:cursor`, cursor);
      }
      this.lastSyncAt = new Date().toISOString();
      await kvSet(`${this.nsKey}:lastSync`, this.lastSyncAt);
      this.syncState = this.outbox.length ? 'pending' : 'synced';
      this.scheduleSave();
    } catch {
      this.syncState = navigator.onLine === false ? 'offline' : 'error';
    }
    this.emit();
  }

  async flush() {
    if (!this.remote || this.flushing) return;
    this.flushing = true;
    try {
      while (this.outbox.length) {
        const op = this.outbox[0];
        try {
          this.syncState = 'syncing';
          await this.remote.push(op);
        } catch (e) {
          if (e instanceof PermanentSyncError) {
            // nicht verwerfen: in Liste "fehlgeschlagen" verschieben, in Einstellungen sichtbar
            this.failed.push({ op, error: e.message, at: new Date().toISOString() });
            await kvSet(`${this.nsKey}:failed`, this.failed);
          } else {
            this.syncState = navigator.onLine === false ? 'offline' : 'pending';
            this.scheduleRetry();
            this.emit();
            return;
          }
        }
        this.outbox.shift();
        await kvSet(`${this.nsKey}:outbox`, this.outbox);
      }
      this.retryDelay = 2000;
      this.syncState = 'synced';
      this.lastSyncAt = new Date().toISOString();
    } finally {
      this.flushing = false;
      this.emit();
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 60000);
  }

  async retryFailed() {
    const items = this.failed;
    this.failed = [];
    await kvSet(`${this.nsKey}:failed`, this.failed);
    this.outbox.push(...items.map((f) => f.op));
    await kvSet(`${this.nsKey}:outbox`, this.outbox);
    void this.flush();
  }

  /** Vollständige lokale Sicherung als JSON (Notfall-Backup, z. B. vor Gerätewechsel). */
  exportSnapshot() {
    const snap: Record<string, unknown[]> = {};
    for (const t of TABLE_NAMES) snap[t] = [...this.tables[t].values()];
    return { exported_at: new Date().toISOString(), mode: this.mode, user: this.user, tables: snap, outbox: this.outbox, failed: this.failed };
  }

  /** Sicherung wieder einspielen (nur additiv – überschreibt nichts Neueres). */
  importSnapshot(data: { tables: Record<string, unknown[]> }) {
    const upserts: Op['upserts'] = {};
    for (const t of TABLE_NAMES) {
      const rows = (data.tables?.[t] ?? []) as never[];
      const fresh = rows.filter((r: { id: string }) => !this.tables[t].has(r.id));
      if (fresh.length) (upserts as Record<string, unknown[]>)[t] = fresh;
    }
    this.apply({ op_id: uid(), ts: new Date().toISOString(), label: 'Backup eingespielt', upserts });
  }
}

export const store = new Store();

/** React-Hook: rendert neu, sobald sich der Store ändert. */
export function useStoreVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

/** Memoisiert eine Ableitung pro Store-Version. */
export function memo<T>(fn: () => T): () => T {
  let v = -1;
  let val: T;
  return () => {
    if (v !== store.version) {
      val = fn();
      v = store.version;
    }
    return val;
  };
}
