// OpenStreetMap: Ortssuche (Nominatim) und Adressabruf innerhalb der Verwaltungsgrenze (Overpass).
// Beide Dienste erlauben Browser-Zugriffe (CORS). Für Produktion kann über /api/osm/* geproxied werden.

import type { RawAddress } from './pipeline';
import { splitOsmHouseNumbers } from '../lib/housenumber';

export interface PlaceResult {
  name: string;
  displayName: string;
  postalCodes: string[];
  state: string | null;
  county: string | null;
  osmType: string;
  osmId: number;
  kind: string;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

/** Suche nach Ortsname oder PLZ – nur Verwaltungsgrenzen (Gemeinde/Ortsteil), nur Deutschland. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim();
  if (!q) return [];
  const isPlz = /^\d{5}$/.test(q);
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'de',
    limit: '15',
    'accept-language': 'de',
    polygon_geojson: '0',
  });
  if (isPlz) params.set('postalcode', q);
  else params.set('q', q);
  const res = await fetch(`${NOMINATIM}/search?${params}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Ortssuche fehlgeschlagen (${res.status})`);
  const data = (await res.json()) as Array<Record<string, unknown>>;
  let results = data;
  // PLZ-Suche liefert einen Postleitzahl-Punkt → zugehörigen Ort per Reverse-Suche (Zoom 10/14) ermitteln
  if (isPlz) {
    const out: PlaceResult[] = [];
    for (const r of data.slice(0, 3)) {
      for (const zoom of [14, 12, 10]) {
        const rp = new URLSearchParams({ format: 'jsonv2', lat: String(r.lat), lon: String(r.lon), zoom: String(zoom), addressdetails: '1', 'accept-language': 'de' });
        const rr = await fetch(`${NOMINATIM}/reverse?${rp}`, { signal });
        if (!rr.ok) continue;
        const j = (await rr.json()) as Record<string, unknown>;
        const pr = toPlace(j, q);
        if (pr && !out.some((o) => o.osmId === pr.osmId)) out.push(pr);
      }
    }
    return out;
  }
  results = data.filter((r) => r.osm_type === 'relation' && (r.category === 'boundary' || r.class === 'boundary' || r.type === 'administrative'));
  return results.map((r) => toPlace(r)).filter((x): x is PlaceResult => !!x);
}

function toPlace(r: Record<string, unknown>, plz?: string): PlaceResult | null {
  if (r.osm_type !== 'relation') return null;
  const addr = (r.address ?? {}) as Record<string, string>;
  const name = (r.name as string) || addr.village || addr.town || addr.city || addr.municipality || '';
  if (!name) return null;
  return {
    name,
    displayName: String(r.display_name ?? name),
    postalCodes: [plz ?? addr.postcode].filter(Boolean) as string[],
    state: addr.state ?? null,
    county: addr.county ?? null,
    osmType: String(r.osm_type),
    osmId: Number(r.osm_id),
    kind: String(r.addresstype ?? r.type ?? ''),
  };
}

type OsmElement = { type: string; id: number; tags?: Record<string, string> };

function toRaw(elements: OsmElement[]): RawAddress[] {
  const out: RawAddress[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const street = t['addr:street'] || t['addr:place'] || '';
    for (const n of splitOsmHouseNumbers(t['addr:housenumber'] ?? '')) {
      out.push({ street, houseNumber: n, postalCode: t['addr:postcode'] ?? '', city: t['addr:city'] ?? '', ref: `osm:${el.type}/${el.id}` });
    }
  }
  return out;
}

export function overpassQuery(relationId: number): string {
  const areaId = 3600000000 + relationId;
  return `[out:json][timeout:50];area(id:${areaId})->.a;(nwr["addr:housenumber"](area.a););out tags;`;
}

/**
 * Alle Objekte mit addr:housenumber innerhalb der Grenze (Knoten, Wege, Relationen).
 * 1. über den eigenen Server (/api/osm/overpass, mehrere Overpass-Server, zuverlässig auch in Safari)
 * 2. Rückfall: direkt aus dem Browser
 */
export async function fetchOsmAddresses(relationId: number, signal?: AbortSignal): Promise<RawAddress[]> {
  let lastErr: unknown = null;
  try {
    const res = await fetch('/api/osm/overpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relationId }),
      signal,
    });
    const ct = res.headers.get('content-type') ?? '';
    if (res.ok && ct.includes('json')) {
      const json = (await res.json()) as { elements: OsmElement[] };
      return toRaw(json.elements);
    }
    if (ct.includes('json')) lastErr = new Error(((await res.json()) as { error?: string }).error ?? `Server ${res.status}`);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    lastErr = e;
  }
  const query = overpassQuery(relationId);
  for (const url of OVERPASS) {
    try {
      const res = await fetch(`${url}?data=${encodeURIComponent(query)}`, { signal });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements: OsmElement[] };
      return toRaw(json.elements);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw new Error(`Adressabruf aus OpenStreetMap fehlgeschlagen: ${(lastErr as Error)?.message ?? 'unbekannt'}. Bitte in 1–2 Minuten erneut versuchen.`);
}
