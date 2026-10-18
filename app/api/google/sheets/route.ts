// Export der (clientseitig aufbereiteten) Tabelle nach Google Sheets.
import { writeSheet } from '@/server/google';
import { fail, json, requireUser } from '@/server/http';
import { configured } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (!configured.google) return fail('Google Sheets ist nicht konfiguriert', 503, 'google_missing');
  const { rows, sheetName } = (await req.json()) as { rows: string[][]; sheetName?: string };
  if (!Array.isArray(rows) || rows.length > 50000) return fail('Ungültige Exportdaten', 422);
  try {
    return json(await writeSheet((sheetName || 'AreaPro Export').slice(0, 90), rows.map((r) => r.map((c) => String(c ?? '').slice(0, 5000)))));
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
