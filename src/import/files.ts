// CSV- und Excel-Import (XLSX) ohne schwere Abhängigkeiten.
import JSZip from 'jszip';
import type { RawAddress } from './pipeline';

/** CSV mit automatischer Trennzeichenerkennung (; , Tab) und Anführungszeichen. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/)[0] ?? '';
  const delim = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Erstes Tabellenblatt einer .xlsx-Datei als Zeilen. */
export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buf);
  const shared: string[] = [];
  const ss = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (ss) {
    const doc = new DOMParser().parseFromString(ss, 'application/xml');
    doc.querySelectorAll('si').forEach((si) => shared.push([...si.querySelectorAll('t')].map((t) => t.textContent ?? '').join('')));
  }
  const sheetName = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort()[0];
  if (!sheetName) throw new Error('Kein Tabellenblatt gefunden');
  const xml = await zip.file(sheetName)!.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const rows: string[][] = [];
  doc.querySelectorAll('sheetData > row').forEach((r) => {
    const out: string[] = [];
    r.querySelectorAll('c').forEach((c) => {
      const ref = c.getAttribute('r') ?? '';
      const col = colIndex(ref.replace(/\d+/g, ''));
      const t = c.getAttribute('t');
      let v = c.querySelector('v')?.textContent ?? '';
      if (t === 's') v = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') v = [...c.querySelectorAll('t')].map((x) => x.textContent ?? '').join('');
      out[col] = v;
    });
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
    if (out.some((x) => String(x).trim())) rows.push(out.map(String));
  });
  return rows;
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

export interface ColumnMap {
  street: number;
  number: number;
  postal: number;
  city: number;
  combined: number; // "Goethestraße 12" in einer Spalte
}

/** Spalten anhand der Kopfzeile erkennen (Straße, Hausnummer, PLZ, Ort oder kombinierte Adresse). */
export function detectColumns(header: string[]): ColumnMap {
  const h = header.map((x) => x.toLowerCase().trim());
  const find = (...re: RegExp[]) => h.findIndex((x) => re.some((r) => r.test(x)));
  return {
    street: find(/^stra(ss|ß)e$/, /^street$/, /stra(ss|ß)enname/, /^str\.?$/),
    number: find(/hausn/, /^nr\.?$/, /^hnr$/, /number/, /^hausnummer$/),
    postal: find(/^plz$/, /postleitzahl/, /postal/, /^zip/),
    city: find(/^ort$/, /^stadt$/, /^gemeinde$/, /^city$/, /ortsname/),
    combined: find(/^adresse$/, /^anschrift$/, /^address$/),
  };
}

export function rowsToRaw(rows: string[][], map: ColumnMap, hasHeader = true): RawAddress[] {
  const body = hasHeader ? rows.slice(1) : rows;
  const out: RawAddress[] = [];
  for (const r of body) {
    let street = map.street >= 0 ? r[map.street] ?? '' : '';
    let num = map.number >= 0 ? r[map.number] ?? '' : '';
    if ((!street || !num) && map.combined >= 0) {
      const m = String(r[map.combined] ?? '').match(/^(.*?)[\s,]+(\d+\s*[a-zA-Z]?(?:\s*\/\s*\d+)?)\s*$/);
      if (m) {
        street = street || m[1];
        num = num || m[2];
      }
    }
    // "Goethestraße 12" in der Straßenspalte ohne Nummernspalte
    if (street && !num) {
      const m = street.match(/^(.*?)\s+(\d+\s*[a-zA-Z]?(?:\s*\/\s*\d+)?)$/);
      if (m) {
        street = m[1];
        num = m[2];
      }
    }
    out.push({
      street,
      houseNumber: num,
      postalCode: map.postal >= 0 ? String(r[map.postal] ?? '').trim() : '',
      city: map.city >= 0 ? String(r[map.city] ?? '').trim() : '',
      ref: null,
    });
  }
  return out;
}
