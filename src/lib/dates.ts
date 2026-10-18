// Datumslogik (lokale Zeitzone, Kalendertage als 'YYYY-MM-DD').

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(now = new Date()): string {
  return toDateKey(now);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

/** Montag der Woche (ISO). */
export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - wd);
  return r;
}
export function endOfWeek(d: Date): Date {
  return addDays(startOfWeek(d), 6);
}

const fmtDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDateShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtMonth = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '–';
  const d = typeof iso === 'string' ? (iso.length === 10 ? fromDateKey(iso) : new Date(iso)) : iso;
  return fmtDate.format(d);
}
export function formatDateShort(iso: string | Date): string {
  const d = typeof iso === 'string' ? (iso.length === 10 ? fromDateKey(iso) : new Date(iso)) : iso;
  return fmtDateShort.format(d);
}
export function formatTime(iso: string | Date): string {
  return fmtTime.format(typeof iso === 'string' ? new Date(iso) : iso);
}
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)} Uhr`;
}
export function formatMonth(d: Date): string {
  return fmtMonth.format(d);
}

/** "heute", "gestern", "vor 3 Tagen", "in 5 Tagen" */
export function relativeDay(key: string, now = new Date()): string {
  const diff = Math.round((fromDateKey(key).getTime() - fromDateKey(todayKey(now)).getTime()) / 86400000);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'gestern';
  if (diff < 0) return `seit ${-diff} Tagen`;
  if (diff < 60) return `in ${diff} Tagen`;
  return formatDate(key);
}

// ---------------------------------------------------------------------
// Wiedervorlage-Zeiträume
// ---------------------------------------------------------------------

export interface FollowupPeriod {
  preset: string;
  label: string;
  due_date: string; // Stichtag (ab dann fällig)
  period_start: string;
  period_end: string;
}

type Season = 'spring' | 'summer' | 'autumn' | 'winter';
const SEASON_LABEL: Record<Season, string> = {
  spring: 'Frühling',
  summer: 'Sommer',
  autumn: 'Herbst',
  winter: 'Winter',
};

/** Meteorologische Jahreszeiten. Winter YYYY = 1.12.YYYY – Ende Feb YYYY+1. */
export function seasonRange(season: Season, year: number): { start: Date; end: Date } {
  switch (season) {
    case 'spring':
      return { start: new Date(year, 2, 1), end: new Date(year, 4, 31) };
    case 'summer':
      return { start: new Date(year, 5, 1), end: new Date(year, 7, 31) };
    case 'autumn':
      return { start: new Date(year, 8, 1), end: new Date(year, 10, 30) };
    case 'winter':
      return { start: new Date(year, 11, 1), end: new Date(year + 1, 2, 0) };
  }
}

function currentSeason(d: Date): { season: Season; year: number } {
  const m = d.getMonth();
  if (m >= 2 && m <= 4) return { season: 'spring', year: d.getFullYear() };
  if (m >= 5 && m <= 7) return { season: 'summer', year: d.getFullYear() };
  if (m >= 8 && m <= 10) return { season: 'autumn', year: d.getFullYear() };
  return { season: 'winter', year: m === 11 ? d.getFullYear() : d.getFullYear() - 1 };
}

const ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Die nächsten n Jahreszeiten ab heute (aktuelle Jahreszeit ausgenommen). */
export function upcomingSeasons(now = new Date(), n = 5): FollowupPeriod[] {
  let { season, year } = currentSeason(now);
  const out: FollowupPeriod[] = [];
  for (let i = 0; i < n; i++) {
    const idx = ORDER.indexOf(season);
    if (idx === 3) {
      season = 'spring';
      year += 1;
    } else {
      season = ORDER[idx + 1];
    }
    const r = seasonRange(season, year);
    out.push({
      preset: `season:${season}:${year}`,
      label: `${SEASON_LABEL[season]} ${year}`,
      due_date: toDateKey(r.start),
      period_start: toDateKey(r.start),
      period_end: toDateKey(r.end),
    });
  }
  return out;
}

export function quickPeriods(now = new Date()): FollowupPeriod[] {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mk = (preset: string, label: string, start: Date, end: Date): FollowupPeriod => ({
    preset,
    label,
    due_date: toDateKey(start),
    period_start: toDateKey(start),
    period_end: toDateKey(end),
  });
  const nextWeekStart = addDays(startOfWeek(t), 7);
  const twoWeeks = addDays(t, 14);
  const nextMonth = new Date(t.getFullYear(), t.getMonth() + 1, 1);
  return [
    mk('tomorrow', 'Morgen', addDays(t, 1), addDays(t, 1)),
    mk('next_week', 'Nächste Woche', nextWeekStart, addDays(nextWeekStart, 6)),
    mk('two_weeks', 'In 2 Wochen', twoWeeks, addDays(twoWeeks, 6)),
    mk('next_month', 'Nächsten Monat', nextMonth, new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0)),
  ];
}

export function exactDatePeriod(dateKey: string): FollowupPeriod {
  return { preset: 'date', label: formatDate(dateKey), due_date: dateKey, period_start: dateKey, period_end: dateKey };
}
