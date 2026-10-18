// Hausnummern: Parsen, Sortieren, Straßenseiten-Navigation, Mehrfacheingabe.

export interface ParsedNumber {
  display: string; // bereinigte Anzeige, z. B. '14/1', '12a'
  numeric: number | null; // 14
  suffix: string; // '/1', 'a', '' …
  key: string; // Dublettenschlüssel
}

/** '12 a' → 12a · '14 / 1' → 14/1 · '3-5' bleibt · 'A' → nicht numerisch */
export function parseHouseNumber(raw: string): ParsedNumber {
  let s = String(raw ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
  // "12 a" → "12a", "14 / 1" → "14/1"
  s = s.replace(/^(\d+)\s+([a-zA-Z])$/, '$1$2').replace(/\s*\/\s*/g, '/').replace(/\s*-\s*/g, '-');
  const m = s.match(/^(\d+)(.*)$/);
  if (!m) return { display: s, numeric: null, suffix: s, key: s.toLowerCase() };
  const numeric = parseInt(m[1], 10);
  const suffix = m[2].trim().toLowerCase();
  const display = `${numeric}${suffix}`;
  return { display, numeric, suffix, key: display.toLowerCase() };
}

/** Rang eines Zusatzes: '' < Buchstaben (a,b,…) < '/1','/2' < sonstiges */
function suffixRank(suffix: string): [number, number, string] {
  if (!suffix) return [0, 0, ''];
  const letter = suffix.match(/^([a-z])$/);
  if (letter) return [1, letter[1].charCodeAt(0), ''];
  const slash = suffix.match(/^\/(\d+)$/);
  if (slash) return [2, parseInt(slash[1], 10), ''];
  const slashLetter = suffix.match(/^\/([a-z])$/);
  if (slashLetter) return [2, 1000 + slashLetter[1].charCodeAt(0), ''];
  return [3, 0, suffix];
}

export interface NumberLike {
  house_number: string;
  house_number_numeric: number | null;
  house_number_suffix: string;
}

export function compareHouseNumbers(a: NumberLike, b: NumberLike): number {
  const an = a.house_number_numeric;
  const bn = b.house_number_numeric;
  if (an === null && bn === null) return a.house_number.localeCompare(b.house_number, 'de');
  if (an === null) return 1;
  if (bn === null) return -1;
  if (an !== bn) return an - bn;
  const [ar, av, as] = suffixRank(a.house_number_suffix);
  const [br, bv, bs] = suffixRank(b.house_number_suffix);
  if (ar !== br) return ar - br;
  if (av !== bv) return av - bv;
  return as.localeCompare(bs, 'de');
}

export function sortByHouseNumber<T extends NumberLike>(list: T[]): T[] {
  return [...list].sort(compareHouseNumbers);
}

export type Side = 'even' | 'odd' | null;
export function sideOf(a: { house_number_numeric: number | null }): Side {
  if (a.house_number_numeric === null) return null;
  return a.house_number_numeric % 2 === 0 ? 'even' : 'odd';
}

interface NavItem extends NumberLike {
  id: string;
  excluded?: boolean;
}

export interface NavOptions {
  /** +1 = aufsteigend (Standard), -1 = absteigend */
  direction?: 1 | -1;
  /** ausgeschlossene Adressen überspringen (Standard: ja) */
  skipExcluded?: boolean;
}

/**
 * Nächste existierende Adresse derselben Straßenseite.
 * Erfindet keine Nummern: Es wird ausschließlich in der vorhandenen, sortierten Liste gesucht.
 * Zusätze (2, 2a, 2b, 4) werden in korrekter Reihenfolge durchlaufen, da sie dieselbe Parität haben.
 * Adressen ohne numerischen Anteil gelten als eigene "Seite" und werden linear durchlaufen.
 */
export function getNextSameSideAddress<T extends NavItem>(
  all: T[],
  currentId: string,
  opts: NavOptions = {},
): T | null {
  const dir = opts.direction ?? 1;
  const skip = opts.skipExcluded ?? true;
  const sorted = sortByHouseNumber(all);
  const idx = sorted.findIndex((a) => a.id === currentId);
  if (idx < 0) return null;
  const side = sideOf(sorted[idx]);
  for (let i = idx + dir; i >= 0 && i < sorted.length; i += dir) {
    const cand = sorted[i];
    if (skip && cand.excluded) continue;
    if (sideOf(cand) === side) return cand;
  }
  return null;
}

export function getPrevSameSideAddress<T extends NavItem>(all: T[], currentId: string, opts: NavOptions = {}): T | null {
  return getNextSameSideAddress(all, currentId, { ...opts, direction: opts.direction === -1 ? 1 : -1 });
}

/** Nächstgelegene Adresse der gegenüberliegenden Straßenseite (geringster Nummernabstand). */
export function getOppositeSideAddress<T extends NavItem>(all: T[], currentId: string, opts: NavOptions = {}): T | null {
  const skip = opts.skipExcluded ?? true;
  const cur = all.find((a) => a.id === currentId);
  if (!cur || cur.house_number_numeric === null) return null;
  const side = sideOf(cur);
  const n = cur.house_number_numeric;
  const dir = opts.direction ?? 1;
  let best: T | null = null;
  let bestDist = Infinity;
  for (const cand of sortByHouseNumber(all)) {
    if (skip && cand.excluded) continue;
    const s = sideOf(cand);
    if (s === null || s === side) continue;
    const d = Math.abs((cand.house_number_numeric as number) - n);
    // Gleichstand: in Laufrichtung bevorzugen (bei 12 aufwärts → 13 statt 11)
    const better = d < bestDist || (d === bestDist && best && dir * ((cand.house_number_numeric as number) - (best.house_number_numeric as number)) > 0);
    if (better) {
      best = cand;
      bestDist = d;
    }
  }
  return best;
}

/** Erste Adresse einer Seite in Laufrichtung (Start eines Straßendurchgangs). */
export function firstOfSide<T extends NavItem>(all: T[], side: 'even' | 'odd', direction: 1 | -1 = 1): T | null {
  const list = sortByHouseNumber(all).filter((a) => !a.excluded && sideOf(a) === side);
  if (!list.length) return null;
  return direction === 1 ? list[0] : list[list.length - 1];
}

/**
 * Mehrfacheingabe: "1-6", "1, 3, 5", "12a 12b", "2-20" mit Paritätsfilter, "14/1".
 * Bereiche erzeugen nur ganze Nummern. Ergebnis ist eindeutig und sortiert.
 */
export function expandHouseNumberInput(input: string, parity: 'all' | 'even' | 'odd' = 'all'): string[] {
  const tokens = input
    .split(/[\n,;]+|\s+(?=\d)/)
    .map((t) => t.trim())
    .filter(Boolean);
  const out = new Map<string, ParsedNumber>();
  for (const t of tokens) {
    const range = t.match(/^(\d+)\s*(?:-|–|bis)\s*(\d+)$/i);
    if (range) {
      let a = parseInt(range[1], 10);
      let b = parseInt(range[2], 10);
      if (a > b) [a, b] = [b, a];
      if (b - a > 500) continue; // Schutz vor Tippfehlern
      for (let n = a; n <= b; n++) {
        if (parity === 'even' && n % 2 !== 0) continue;
        if (parity === 'odd' && n % 2 === 0) continue;
        const p = parseHouseNumber(String(n));
        out.set(p.key, p);
      }
      continue;
    }
    const p = parseHouseNumber(t);
    if (!p.display) continue;
    out.set(p.key, p);
  }
  return sortByHouseNumber(
    [...out.values()].map((p) => ({ house_number: p.display, house_number_numeric: p.numeric, house_number_suffix: p.suffix })),
  ).map((p) => p.house_number);
}

/** OSM erlaubt "12;14" oder "12,14" in addr:housenumber → einzelne Nummern. */
export function splitOsmHouseNumbers(raw: string): string[] {
  return String(raw)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
