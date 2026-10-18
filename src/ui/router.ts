// Hash-Router: funktioniert identisch auf Vercel, als installierte PWA und offline.
import { useSyncExternalStore } from 'react';

export interface Route {
  path: string[]; // z. B. ['strasse', '<id>']
  query: URLSearchParams;
}

function parse(): Route {
  const h = typeof location === 'undefined' ? '' : location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

let current = parse();
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse();
    listeners.forEach((l) => l());
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => current,
  );
}

export function href(path: string, query?: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return `#/${path.replace(/^\//, '')}${qs ? `?${qs}` : ''}`;
}

export function go(path: string, query?: Record<string, string | null | undefined>, replace = false) {
  const h = href(path, query);
  if (replace) history.replaceState(null, '', h);
  else history.pushState(null, '', h);
  current = parse();
  listeners.forEach((l) => l());
  if (!replace) window.scrollTo({ top: 0 });
}

/** Nur Query ändern (z. B. Adresse im Sheet öffnen), ohne zu scrollen. */
export function setQuery(patch: Record<string, string | null>, replace = false) {
  const q = new URLSearchParams(current.query);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const qs = q.toString();
  const h = `#/${current.path.map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`;
  if (replace) history.replaceState(null, '', h);
  else history.pushState(null, '', h);
  current = parse();
  listeners.forEach((l) => l());
}

export function back(fallback = '') {
  if (history.length > 1) history.back();
  else go(fallback);
}
