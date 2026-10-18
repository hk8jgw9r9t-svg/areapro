// Client-Seite der Integrationen. Alle Geheimnisse liegen serverseitig (Next.js API-Routen).
// Ist kein Server/keine Konfiguration vorhanden, arbeitet die App mit einer Mock-Integration.

import { accessToken } from '../data/session';
import type { BookingResult } from '../data/actions';
import { APPOINTMENT_DURATION_MIN } from '../lib/constants';
import { addDays } from '../lib/dates';

export interface ServerConfig {
  server: boolean;
  calendly: {
    configured: boolean;
    mode: 'api' | 'embed' | 'link' | 'mock';
    eventTypeName: string | null;
    schedulingUrl: string | null;
    fallbackEmail: string | null;
    webhook: 'active' | 'missing' | 'unknown';
  };
  google: { configured: boolean; spreadsheetUrl: string | null };
}

const MOCK: ServerConfig = {
  server: false,
  calendly: { configured: false, mode: 'mock', eventTypeName: null, schedulingUrl: null, fallbackEmail: null, webhook: 'unknown' },
  google: { configured: false, spreadsheetUrl: null },
};

let cached: Promise<ServerConfig> | null = null;
export function getServerConfig(force = false): Promise<ServerConfig> {
  if (cached && !force) return cached;
  cached = (async () => {
    try {
      const res = await fetch('/api/config', { headers: await authHeaders() });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return MOCK;
      return { ...(await res.json()), server: true } as ServerConfig;
    } catch {
      return MOCK;
    }
  })();
  return cached;
}

async function authHeaders(): Promise<Record<string, string>> {
  const t = await accessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init.headers as Record<string, string>) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Fehler ${res.status}`, res.status, body.code);
  return body as T;
}

// ---------------------------------------------------------------------
// Calendly
// ---------------------------------------------------------------------
export interface Slot {
  start_time: string;
}

export async function fetchSlots(mode: ServerConfig['calendly']['mode'], days = 14): Promise<Slot[]> {
  if (mode === 'mock') return mockSlots(days);
  const from = new Date();
  const to = addDays(from, days);
  const r = await api<{ slots: Slot[] }>(`/api/calendly/availability?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
  return r.slots;
}

export interface BookPayload {
  appointmentId: string;
  start_time: string;
  name: string;
  email: string | null;
  phone: string;
  address: string;
  products: string;
  note: string | null;
  lead_source: string;
}

export async function bookSlot(mode: ServerConfig['calendly']['mode'], p: BookPayload): Promise<BookingResult> {
  if (mode === 'mock') {
    await new Promise((r) => setTimeout(r, 400));
    const end = new Date(new Date(p.start_time).getTime() + APPOINTMENT_DURATION_MIN * 60000).toISOString();
    return { start_time: p.start_time, end_time: end, event_uri: null, invitee_uri: null };
  }
  return api<BookingResult>('/api/calendly/book', { method: 'POST', body: JSON.stringify(p) });
}

export async function confirmEmbedBooking(appointmentId: string, eventUri: string, inviteeUri: string): Promise<BookingResult> {
  return api<BookingResult>('/api/calendly/confirm', { method: 'POST', body: JSON.stringify({ appointmentId, eventUri, inviteeUri }) });
}

export async function createSingleUseLink(): Promise<{ url: string }> {
  return api<{ url: string }>('/api/calendly/link', { method: 'POST', body: '{}' });
}

export async function setupCalendlyWebhook(): Promise<{ status: string; message: string }> {
  return api('/api/calendly/setup', { method: 'POST', body: '{}' });
}

/** Demo-Verfügbarkeit: Mo–Fr 9:00–18:00 (90-Minuten-Raster), Sa 9:00–13:00. */
function mockSlots(days: number): Slot[] {
  const out: Slot[] = [];
  const now = new Date();
  for (let d = 0; d <= days; d++) {
    const day = addDays(now, d);
    const wd = day.getDay();
    if (wd === 0) continue;
    const hours = wd === 6 ? [9, 10.5] : [9, 10.5, 13, 14.5, 16, 17.5];
    for (const h of hours) {
      const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(h), (h % 1) * 60);
      if (s.getTime() < now.getTime() + 2 * 3600000) continue;
      // pseudo-zufällig belegte Slots, damit es realistisch aussieht
      if ((s.getDate() * 7 + Math.floor(h)) % 5 === 0) continue;
      out.push({ start_time: s.toISOString() });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Google Sheets
// ---------------------------------------------------------------------
export async function exportToGoogleSheets(rows: string[][], sheetName: string): Promise<{ updatedRows: number; url: string }> {
  return api('/api/google/sheets', { method: 'POST', body: JSON.stringify({ rows, sheetName }) });
}
