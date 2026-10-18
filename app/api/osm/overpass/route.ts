// Server-Proxy für den OpenStreetMap-Adressabruf (Overpass API).
// Grund: Browser (v. a. Safari) blockieren bzw. Overpass-Server drosseln direkte Anfragen.
// Es werden ausschließlich feste Adressabfragen für einen Ort ausgeführt:
//   1. innerhalb der Verwaltungsgrenze (Relation → Fläche per map_to_area)
//   2. Rückfall: Begrenzungsrechteck des Ortes, gefiltert nach PLZ bzw. Ortsname
// Leere Antworten mit Laufzeitfehler ("remark") gelten als Fehler → nächster Server.
import { fail, json } from '@/server/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

type El = { type: string; id: number; tags?: Record<string, string> };

async function runQuery(query: string, errors: string[]): Promise<El[] | null> {
  for (const url of SERVERS) {
    const host = new URL(url).host;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AreaPro-D2D/1.0 (Adressimport)' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(22_000),
        cache: 'no-store',
      });
      if (!res.ok) {
        errors.push(`${host}: ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { elements?: El[]; remark?: string };
      if (!Array.isArray(data.elements)) {
        errors.push(`${host}: ungültige Antwort`);
        continue;
      }
      if (data.remark && /error|timed out|out of memory/i.test(data.remark)) {
        errors.push(`${host}: ${data.remark.slice(0, 80)}`);
        continue;
      }
      return data.elements;
    } catch (e) {
      errors.push(`${host}: ${(e as Error).name === 'TimeoutError' ? 'Zeitüberschreitung' : (e as Error).message}`);
    }
  }
  return null;
}

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function boundingBox(relationId: number): Promise<[number, number, number, number] | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/lookup?osm_ids=R${relationId}&format=json`, {
      headers: { 'User-Agent': 'AreaPro-D2D/1.0 (Adressimport)', 'Accept-Language': 'de' },
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as { boundingbox?: string[] }[];
    const b = j[0]?.boundingbox?.map(Number);
    if (!b || b.length !== 4 || b.some((x) => !Number.isFinite(x))) return null;
    return [b[0], b[2], b[1], b[3]]; // south, west, north, east
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { relationId?: number; name?: string; postalCodes?: string[] };
  const relationId = Number(body.relationId);
  if (!Number.isInteger(relationId) || relationId <= 0 || relationId > 99_999_999) return fail('Ungültige Ortskennung', 422);
  const errors: string[] = [];

  // 1. Verwaltungsgrenze
  const q1 = `[out:json][timeout:45];rel(${relationId});map_to_area->.a;(nwr["addr:housenumber"](area.a););out tags;`;
  const inArea = await runQuery(q1, errors);
  if (inArea && inArea.length) return json({ elements: inArea, method: 'boundary' });

  // 2. Begrenzungsrechteck + Filter auf PLZ / Ortsname
  const bbox = await boundingBox(relationId);
  if (bbox) {
    const q2 = `[out:json][timeout:45];(nwr["addr:housenumber"](${bbox.join(',')}););out tags;`;
    const inBox = await runQuery(q2, errors);
    if (inBox) {
      const plz = new Set((body.postalCodes ?? []).filter((p) => /^\d{5}$/.test(p)));
      const name = norm(body.name ?? '');
      const filtered = inBox.filter((el) => {
        const t = el.tags ?? {};
        if (plz.size && t['addr:postcode'] && plz.has(t['addr:postcode'])) return true;
        const city = norm(t['addr:city'] ?? t['addr:suburb'] ?? t['addr:place'] ?? '');
        return !!name && !!city && (city === name || city.includes(name));
      });
      if (filtered.length) return json({ elements: filtered, method: 'bbox' });
      if (inArea) return json({ elements: [], method: 'none', hint: 'OpenStreetMap enthält für diesen Ort keine Hausnummern.' });
    }
  }
  if (inArea) return json({ elements: [], method: 'none', hint: 'OpenStreetMap enthält für diesen Ort keine Hausnummern.' });
  return fail(`OpenStreetMap-Server ausgelastet – bitte in 1–2 Minuten erneut versuchen (${errors.slice(0, 3).join('; ')})`, 502);
}
