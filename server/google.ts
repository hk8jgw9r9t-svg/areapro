// Google Sheets Export über ein Dienstkonto (Service Account) – ohne zusätzliche Bibliotheken.
// Google Sheets ist NUR Export/Reporting, nie Datenbank.
import 'server-only';
import { createSign } from 'node:crypto';
import { env } from './env';

let tokenCache: { token: string; exp: number } | null = null;

function b64url(input: string | Buffer) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: env.googleClientEmail, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(env.googlePrivateKey))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google-Anmeldung fehlgeschlagen: ${j.error_description ?? res.status}`);
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function g<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const j = (await res.json().catch(() => ({}))) as { error?: { message: string } };
  if (!res.ok) throw new Error(`Google Sheets: ${j.error?.message ?? res.status}`);
  return j as T;
}

/** Schreibt die Tabelle vollständig in ein Tabellenblatt (wird bei Bedarf angelegt, Inhalt ersetzt). */
export async function writeSheet(sheetName: string, rows: string[][]) {
  const id = env.googleSpreadsheetId;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  const meta = await g<{ sheets: { properties: { title: string } }[] }>(`${base}?fields=sheets.properties.title`);
  if (!meta.sheets.some((s) => s.properties.title === sheetName)) {
    await g(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }) });
  }
  const range = encodeURIComponent(`'${sheetName}'`);
  await g(`${base}/values/${range}:clear`, { method: 'POST', body: '{}' });
  const r = await g<{ updatedRows: number }>(`${base}/values/${encodeURIComponent(`'${sheetName}'!A1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: rows }),
  });
  return { updatedRows: r.updatedRows ?? rows.length, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}
