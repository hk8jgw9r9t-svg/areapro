// Server-Proxy für den OpenStreetMap-Adressabruf (Overpass API).
// Grund: Browser (v. a. Safari) blockieren bzw. Overpass-Server drosseln direkte Anfragen.
// Es wird ausschließlich die feste Adressabfrage für eine Verwaltungsgrenze ausgeführt.
import { fail, json } from '@/server/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export async function POST(req: Request) {
  const { relationId } = (await req.json().catch(() => ({}))) as { relationId?: number };
  if (!Number.isInteger(relationId) || (relationId as number) <= 0 || (relationId as number) > 99_999_999) return fail('Ungültige Ortskennung', 422);
  const areaId = 3600000000 + (relationId as number);
  const query = `[out:json][timeout:50];area(id:${areaId})->.a;(nwr["addr:housenumber"](area.a););out tags;`;
  const errors: string[] = [];
  for (const url of SERVERS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AreaPro-D2D/1.0 (Adressimport)' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(25_000),
        cache: 'no-store',
      });
      if (!res.ok) {
        errors.push(`${new URL(url).host}: ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { elements?: unknown[]; remark?: string };
      if (!Array.isArray(data.elements)) {
        errors.push(`${new URL(url).host}: ungültige Antwort`);
        continue;
      }
      return json({ elements: data.elements, server: new URL(url).host });
    } catch (e) {
      errors.push(`${new URL(url).host}: ${(e as Error).name === 'TimeoutError' ? 'Zeitüberschreitung' : (e as Error).message}`);
    }
  }
  return fail(`Alle OpenStreetMap-Server ausgelastet (${errors.join('; ')})`, 502);
}
