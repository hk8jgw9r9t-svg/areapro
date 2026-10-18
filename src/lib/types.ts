// Zentrale Domänentypen – spiegeln die Tabellen in supabase/migrations exakt wider.

export type StatusKey =
  | 'unprocessed'
  | 'not_home'
  | 'contacted'
  | 'followup'
  | 'appointment'
  | 'not_interested'
  | 'existing_customer'
  | 'no_potential';

export type Priority = 'high' | 'medium' | 'low';
export type LeadSource = 'd2d' | 'pos' | 'fair' | 'other';

interface Owned {
  owner_user_id: string;
  team_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  default_team_id: string | null;
}

export interface Town extends Owned {
  id: string;
  name: string;
  postal_codes: string[];
  state: string | null;
  osm_relation_id: number | null;
  source: string;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface Street extends Owned {
  id: string;
  town_id: string;
  name: string;
  name_key: string;
  postal_code: string | null;
  source: string;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface Address extends Owned {
  id: string;
  town_id: string;
  street_id: string;
  house_number: string;
  house_number_numeric: number | null;
  house_number_suffix: string;
  number_key: string;
  postal_code: string | null;
  current_status: StatusKey;
  status_changed_at: string | null;
  excluded: boolean;
  excluded_reason: string | null;
  source: string;
  source_ref: string | null;
  source_missing_at: string | null;
  last_activity_at: string | null;
  last_activity_by: string | null;
  assigned_user_id: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export type HistoryKind =
  | 'status'
  | 'note'
  | 'tags'
  | 'exclude'
  | 'restore'
  | 'followup'
  | 'appointment'
  | 'import'
  | 'system';

export interface HistoryEntry extends Owned {
  id: string;
  address_id: string;
  kind: HistoryKind;
  status: StatusKey | null;
  previous_status: StatusKey | null;
  note_id: string | null;
  tags_added: string[];
  tags_removed: string[];
  changes: Record<string, unknown>;
  followup_id: string | null;
  appointment_id: string | null;
  occurred_at: string;
  user_id: string | null;
}

export interface Note extends Owned {
  id: string;
  address_id: string;
  body: string;
  occurred_at: string;
  user_id: string | null;
}

export interface AddressTag extends Owned {
  id: string; // `${address_id}:${tag_id}`
  address_id: string;
  tag_id: string;
  removed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface AddressProduct extends Owned {
  id: string; // `${address_id}:${product_id}`
  address_id: string;
  product_id: string;
  interest: 'primary' | 'interest';
  removed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface Followup extends Owned {
  id: string;
  address_id: string;
  priority: Priority;
  due_date: string; // YYYY-MM-DD
  period_start: string | null;
  period_end: string | null;
  period_label: string | null;
  preset: string | null;
  note: string | null;
  status: 'open' | 'done' | 'superseded' | 'cancelled';
  completed_at: string | null;
  occurred_at: string;
  user_id: string | null;
  assigned_user_id: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export type AppointmentStatus = 'pending' | 'scheduled' | 'canceled' | 'completed' | 'no_show';

export interface Appointment extends Owned {
  id: string;
  address_id: string | null;
  status: AppointmentStatus;
  start_time: string | null;
  end_time: string | null;
  customer_name: string;
  phone: string;
  email: string | null;
  address_text: string;
  main_product_id: string;
  product_ids: string[];
  note: string | null;
  lead_source: LeadSource;
  lead_source_detail: string | null;
  booking_mode: string | null;
  calendly_event_uri: string | null;
  calendly_invitee_uri: string | null;
  calendly_cancel_url: string | null;
  calendly_reschedule_url: string | null;
  cancel_reason: string | null;
  user_id: string | null;
  assigned_user_id: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface ImportRecord extends Owned {
  id: string;
  town_id: string | null;
  source: string;
  mode: 'initial' | 'refresh' | 'append';
  status: 'preview' | 'confirmed' | 'cancelled';
  stats: Record<string, unknown>;
  occurred_at: string;
  created_by: string | null;
}

/** Alle synchronisierten Tabellen des lokalen Stores. */
export interface Tables {
  towns: Town;
  streets: Street;
  addresses: Address;
  address_status_history: HistoryEntry;
  notes: Note;
  address_potential_tags: AddressTag;
  address_products: AddressProduct;
  followups: Followup;
  appointments: Appointment;
  imports: ImportRecord;
}
export type TableName = keyof Tables;
export const TABLE_NAMES: TableName[] = [
  'towns',
  'streets',
  'addresses',
  'address_status_history',
  'notes',
  'address_potential_tags',
  'address_products',
  'followups',
  'appointments',
  'imports',
];

/** Ein atomarer, idempotenter Schreibvorgang (lokal sofort, remote via Outbox). */
export interface Op {
  op_id: string;
  ts: string;
  label: string;
  upserts: Partial<{ [K in TableName]: Tables[K][] }>;
}
