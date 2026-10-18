// Export (CSV für Excel / Google Sheets). Persönliche Kundendaten nur bei bewusster Auswahl.
import { store } from '../data/store';
import { addressLabel, appointmentsOf, notesOf, openFollowupOf, productsOfAddress, tagsOf } from '../data/selectors';
import { PRIORITY, PRODUCT, STATUS, TAG } from './constants';
import { formatDate, formatDateTime } from './dates';
import { compareHouseNumbers } from './housenumber';
import type { Address } from './types';

export const EXPORT_HEADER = [
  'Adresse',
  'PLZ',
  'Ort',
  'Straße',
  'Hausnummer',
  'Status',
  'Ausgeschlossen',
  'letzte Bearbeitung',
  'Potenzial-Tags',
  'Produkt',
  'Priorität',
  'Wiedervorlage',
  'Termin',
  'Telefonnummer',
  'Name',
  'Notiz',
];

export function buildExportRows(addresses: Address[], includePersonal: boolean): string[][] {
  const sorted = [...addresses].sort((a, b) => {
    const ta = store.get('towns', a.town_id)?.name ?? '';
    const tb = store.get('towns', b.town_id)?.name ?? '';
    if (ta !== tb) return ta.localeCompare(tb, 'de');
    const sa = store.get('streets', a.street_id)?.name ?? '';
    const sb = store.get('streets', b.street_id)?.name ?? '';
    if (sa !== sb) return sa.localeCompare(sb, 'de');
    return compareHouseNumbers(a, b);
  });
  const rows: string[][] = [EXPORT_HEADER];
  for (const a of sorted) {
    const l = addressLabel(a);
    const fu = openFollowupOf(a.id);
    const appt = appointmentsOf(a.id).find((x) => x.status === 'scheduled');
    const note = notesOf(a.id)[0];
    rows.push([
      `${l.line1}, ${l.line2}`,
      a.postal_code ?? '',
      l.town?.name ?? '',
      l.street?.name ?? '',
      a.house_number,
      STATUS[a.current_status].label,
      a.excluded ? `ja${a.excluded_reason ? ` (${a.excluded_reason})` : ''}` : '',
      a.last_activity_at ? formatDateTime(a.last_activity_at) : '',
      tagsOf(a.id).map((t) => TAG[t]?.label ?? t).join(', '),
      productsOfAddress(a.id).map((p) => PRODUCT[p]?.label ?? p).join(', '),
      fu ? PRIORITY[fu.priority].label : '',
      fu ? `${formatDate(fu.due_date)}${fu.period_label && fu.preset !== 'date' ? ` (${fu.period_label})` : ''}` : '',
      appt?.start_time ? formatDateTime(appt.start_time) : '',
      includePersonal ? appt?.phone ?? '' : '',
      includePersonal ? appt?.customer_name ?? '' : '',
      includePersonal ? note?.body ?? '' : '',
    ]);
  }
  return rows;
}

export function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + rows.map((r) => r.map((c) => esc(String(c ?? ''))).join(';')).join('\r\n');
}

export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
