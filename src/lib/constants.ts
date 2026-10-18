import type { LeadSource, Priority, StatusKey } from './types';

export const APP_NAME = 'AreaPro';
export const APP_SUBTITLE = 'D2D Sales';

export interface StatusDef {
  key: StatusKey;
  label: string;
  short: string;
  /** Kachel-Hintergrund, Kachel-Text, Akzent (Rahmen/Badge) */
  bg: string;
  fg: string;
  accent: string;
  icon: string; // Schlüssel in ui/icons
}

// Farben bewusst mit hohem Kontrast (WCAG AA für Text auf Kachel) + eindeutiges Icon je Status,
// damit der Status nie allein über Farbe kommuniziert wird.
export const STATUSES: StatusDef[] = [
  { key: 'unprocessed', label: 'Unbearbeitet', short: 'Offen', bg: '#ffffff', fg: '#1f2937', accent: '#cbd2dc', icon: 'circle' },
  { key: 'not_home', label: 'Nicht angetroffen', short: 'Nicht da', bg: '#f97316', fg: '#ffffff', accent: '#c2410c', icon: 'doorClosed' },
  { key: 'contacted', label: 'Angetroffen / kein unmittelbarer Abschluss', short: 'Angetroffen', bg: '#2563eb', fg: '#ffffff', accent: '#1d4ed8', icon: 'userCheck' },
  { key: 'followup', label: 'Wiedervorlage', short: 'Wiedervorl.', bg: '#facc15', fg: '#422006', accent: '#ca8a04', icon: 'clock' },
  { key: 'appointment', label: 'Termin vereinbart', short: 'Termin', bg: '#16a34a', fg: '#ffffff', accent: '#15803d', icon: 'calendarCheck' },
  { key: 'not_interested', label: 'Kein Interesse', short: 'Kein Int.', bg: '#dc2626', fg: '#ffffff', accent: '#b91c1c', icon: 'x' },
  { key: 'existing_customer', label: 'Bestandskunde / bereits erneuert', short: 'Bestand', bg: '#7c3aed', fg: '#ffffff', accent: '#6d28d9', icon: 'badgeCheck' },
  { key: 'no_potential', label: 'Kein Potenzial / ausgeschlossen', short: 'Ausgeschl.', bg: '#4b5563', fg: '#ffffff', accent: '#374151', icon: 'ban' },
];
export const STATUS: Record<StatusKey, StatusDef> = Object.fromEntries(STATUSES.map((s) => [s.key, s])) as Record<
  StatusKey,
  StatusDef
>;

/** Status, die einen persönlichen Kontakt bedeuten (für Kontaktquote). */
export const CONTACT_STATUSES: StatusKey[] = ['contacted', 'appointment', 'not_interested', 'existing_customer'];
/** Status, nach denen offene Wiedervorlagen automatisch erledigt sind. */
export const CLOSING_STATUSES: StatusKey[] = ['appointment', 'not_interested', 'existing_customer', 'no_potential'];

export interface ProductDef {
  id: string;
  label: string;
}
export const PRODUCTS: ProductDef[] = [
  { id: 'markise', label: 'Markisen' },
  { id: 'rollladen', label: 'Rollladen' },
  { id: 'kunststofffenster', label: 'Kunststofffenster' },
  { id: 'haustuer', label: 'Haustüren' },
  { id: 'dachfenster', label: 'Wohndachfenster / Dachfenster' },
  { id: 'dachfenster_rollladen', label: 'Dachfenster-Rollladen' },
  { id: 'terrassenueberdachung', label: 'Terrassenüberdachung' },
  { id: 'wintergartenbeschattung', label: 'Wintergartenbeschattung' },
  { id: 'vordach', label: 'Vordächer' },
  { id: 'garagenrolltor', label: 'Garagenrolltore' },
  { id: 'senkrechtbeschattung', label: 'Senkrechtbeschattungen' },
];
export const PRODUCT: Record<string, ProductDef> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

export interface TagDef {
  id: string;
  label: string;
  product_id: string | null;
}
export const TAGS: TagDef[] = [
  { id: 'alte_fenster', label: 'alte Fenster', product_id: 'kunststofffenster' },
  { id: 'haustuer_alt', label: 'Haustür alt', product_id: 'haustuer' },
  { id: 'dachfenster_vorhanden', label: 'Dachfenster vorhanden', product_id: 'dachfenster' },
  { id: 'dachfenster_ohne_beschattung', label: 'Dachfenster ohne Beschattung', product_id: 'dachfenster_rollladen' },
  { id: 'alte_markise', label: 'alte Markise', product_id: 'markise' },
  { id: 'keine_markise_terrasse', label: 'keine Markise / Terrasse vorhanden', product_id: 'markise' },
  { id: 'rollladen_alt', label: 'Rollladen alt', product_id: 'rollladen' },
  { id: 'keine_rolllaeden', label: 'keine Rollläden', product_id: 'rollladen' },
  { id: 'terrassenueberdachung_int', label: 'Terrassenüberdachung interessant', product_id: 'terrassenueberdachung' },
  { id: 'wintergarten_vorhanden', label: 'Wintergarten vorhanden', product_id: 'wintergartenbeschattung' },
  { id: 'wintergartenbeschattung_int', label: 'Wintergartenbeschattung interessant', product_id: 'wintergartenbeschattung' },
  { id: 'vordach_int', label: 'Vordach interessant', product_id: 'vordach' },
  { id: 'garagentor_alt', label: 'Garagentor alt', product_id: 'garagenrolltor' },
  { id: 'senkrechtbeschattung_moeglich', label: 'Senkrechtbeschattung möglich', product_id: 'senkrechtbeschattung' },
  { id: 'sonstiges', label: 'sonstiges Potenzial', product_id: null },
];
export const TAG: Record<string, TagDef> = Object.fromEntries(TAGS.map((t) => [t.id, t]));

export const PRIORITIES: { key: Priority; label: string; color: string }[] = [
  { key: 'high', label: 'Hoch', color: '#dc2626' },
  { key: 'medium', label: 'Mittel', color: '#d97706' },
  { key: 'low', label: 'Niedrig', color: '#64748b' },
];
export const PRIORITY: Record<Priority, { key: Priority; label: string; color: string }> = Object.fromEntries(
  PRIORITIES.map((p) => [p.key, p]),
) as never;

export const LEAD_SOURCES: { key: LeadSource; label: string }[] = [
  { key: 'd2d', label: 'Door-to-Door / Direktwerbung' },
  { key: 'pos', label: 'POS / Kaufland' },
  { key: 'fair', label: 'Messe' },
  { key: 'other', label: 'Sonstige' },
];

export const EXCLUDE_REASONS = [
  'Ruine',
  'Abrissgebäude',
  'Gewerbeobjekt ohne Relevanz',
  'unbewohnt',
  'Neubau / bereits modern',
  'dauerhaft ungeeignet',
];

export const APPOINTMENT_DURATION_MIN = 90;
export const APPOINTMENT_TITLE = 'Beratungstermin HEIM & HAUS';
