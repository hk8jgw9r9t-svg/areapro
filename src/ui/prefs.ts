// Geräte-Einstellungen (aktiver Ort, Laufrichtung …) – bewusst lokal, nicht synchronisiert.
import { useSyncExternalStore } from 'react';
import { store } from '../data/store';

interface Prefs {
  activeTownId: string | null;
  walkDirection: 1 | -1;
  autoNext: boolean;
  numberFilter: 'all' | 'even' | 'odd';
}
const DEFAULTS: Prefs = { activeTownId: null, walkDirection: 1, autoNext: false, numberFilter: 'all' };

let prefs: Prefs = DEFAULTS;
let loadedFor = '';
const listeners = new Set<() => void>();

function key() {
  return `areapro:prefs:${store.user?.id ?? 'anon'}`;
}
function ensure() {
  const k = key();
  if (loadedFor === k) return;
  loadedFor = k;
  try {
    prefs = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(k) ?? '{}') as Partial<Prefs>) };
  } catch {
    prefs = DEFAULTS;
  }
}

export function getPrefs(): Prefs {
  ensure();
  return prefs;
}
export function setPrefs(p: Partial<Prefs>) {
  ensure();
  prefs = { ...prefs, ...p };
  try {
    localStorage.setItem(key(), JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getPrefs,
    getPrefs,
  );
}

/** Aktiver Ort: gesetzter Wert, sonst erster vorhandener Ort. */
export function activeTownId(): string | null {
  const p = getPrefs();
  if (p.activeTownId && store.get('towns', p.activeTownId)) return p.activeTownId;
  const first = store.all('towns').filter((t) => !t.archived_at).sort((a, b) => a.name.localeCompare(b.name, 'de'))[0];
  return first?.id ?? null;
}
