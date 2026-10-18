-- =====================================================================
-- AreaPro – D2D Sales · Initiales Datenbankschema (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------
-- Grundsätze
--  * Nichts wird physisch gelöscht. Ausschluss, Archiv, Entfernen von Tags
--    erfolgt über Flags (excluded, removed_at, archived_at).
--  * Verlauf (address_status_history) und Notizen sind append-only:
--    UPDATE/DELETE werden per Trigger verhindert.
--  * Jede Zeile trägt owner_user_id + team_id (Mehrbenutzer-Vorbereitung,
--    einfache und schnelle Row Level Security).
--  * IDs werden clientseitig erzeugt (UUID) → Offline-Schreibvorgänge sind
--    idempotent (Upsert), doppelte Synchronisation erzeugt keine Dubletten.
--  * Konflikte beim aktuellen Status: neuester Zeitstempel gewinnt
--    (status_changed_at), siehe Trigger addresses_keep_latest_status.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Hilfsfunktion: updated_at + server_updated_at pflegen
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  -- clock_timestamp() statt now(): eindeutige Zeitstempel auch bei Massenimporten in einer
  -- Transaktion → saubere seitenweise Synchronisation (Cursor je Tabelle)
  new.server_updated_at := clock_timestamp();
  if new.updated_at is null or (tg_op = 'UPDATE' and new.updated_at = old.updated_at) then
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Benutzer & Teams
-- ---------------------------------------------------------------------
create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  display_name    text,
  role            text not null default 'sales' check (role in ('admin','team_lead','sales')),
  default_team_id uuid,
  active_town_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_user_id uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

create table public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('lead','member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table public.users
  add constraint users_default_team_fk foreign key (default_team_id) references public.teams(id);

-- Gebietszuordnung (vorbereitet, in V1 ohne Oberfläche)
create table public.territory_assignments (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id),
  user_id    uuid not null references public.users(id),
  town_id    uuid,
  street_id  uuid,
  valid_from date,
  valid_to   date,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- Zugriff: Mitglied des Teams ODER Eigentümer
create or replace function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid());
$$;

create or replace function public.can_access(p_owner uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (p_owner = auth.uid() or (p_team is not null and public.is_team_member(p_team)));
$$;

-- Neuer Auth-Benutzer → users-Zeile + persönliches Team
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  insert into public.teams (name, owner_user_id) values ('Mein Team', new.id) returning id into t;
  insert into public.team_members (team_id, user_id, role) values (t, new.id, 'lead');
  update public.users set default_team_id = t, role = 'admin' where id = new.id;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Referenzdaten: Produkte & Potenzial-Tags (global lesbar)
-- ---------------------------------------------------------------------
create table public.products (
  id         text primary key,          -- saubere interne ID, z. B. 'kunststofffenster'
  label      text not null,             -- deutsche UI-Bezeichnung
  sort       int  not null default 0,
  active     boolean not null default true
);

create table public.potential_tags (
  id          text primary key,
  label       text not null,
  product_id  text references public.products(id),
  sort        int not null default 0,
  active      boolean not null default true,
  team_id     uuid references public.teams(id)   -- null = globaler Standard-Tag
);

insert into public.products (id, label, sort) values
  ('markise',                 'Markisen', 10),
  ('rollladen',               'Rollladen', 20),
  ('kunststofffenster',       'Kunststofffenster', 30),
  ('haustuer',                'Haustüren', 40),
  ('dachfenster',             'Wohndachfenster / Dachfenster', 50),
  ('dachfenster_rollladen',   'Dachfenster-Rollladen', 60),
  ('terrassenueberdachung',   'Terrassenüberdachung', 70),
  ('wintergartenbeschattung', 'Wintergartenbeschattung', 80),
  ('vordach',                 'Vordächer', 90),
  ('garagenrolltor',          'Garagenrolltore', 100),
  ('senkrechtbeschattung',    'Senkrechtbeschattungen', 110);

insert into public.potential_tags (id, label, product_id, sort) values
  ('alte_fenster',                  'alte Fenster',                       'kunststofffenster', 10),
  ('haustuer_alt',                  'Haustür alt',                        'haustuer', 20),
  ('dachfenster_vorhanden',         'Dachfenster vorhanden',              'dachfenster', 30),
  ('dachfenster_ohne_beschattung',  'Dachfenster ohne Beschattung',       'dachfenster_rollladen', 40),
  ('alte_markise',                  'alte Markise',                       'markise', 50),
  ('keine_markise_terrasse',        'keine Markise / Terrasse vorhanden', 'markise', 60),
  ('rollladen_alt',                 'Rollladen alt',                      'rollladen', 70),
  ('keine_rolllaeden',              'keine Rollläden',                    'rollladen', 80),
  ('terrassenueberdachung_int',     'Terrassenüberdachung interessant',   'terrassenueberdachung', 90),
  ('wintergarten_vorhanden',        'Wintergarten vorhanden',             'wintergartenbeschattung', 100),
  ('wintergartenbeschattung_int',   'Wintergartenbeschattung interessant','wintergartenbeschattung', 110),
  ('vordach_int',                   'Vordach interessant',                'vordach', 120),
  ('garagentor_alt',                'Garagentor alt',                     'garagenrolltor', 130),
  ('senkrechtbeschattung_moeglich', 'Senkrechtbeschattung möglich',       'senkrechtbeschattung', 140),
  ('sonstiges',                     'sonstiges Potenzial',                null, 150);

-- ---------------------------------------------------------------------
-- Gebiete: Orte, Straßen, Adressen
-- ---------------------------------------------------------------------
create table public.towns (
  id               uuid primary key,
  name             text not null,
  postal_codes     text[] not null default '{}',
  state            text,
  osm_relation_id  bigint,
  source           text not null default 'manual',   -- osm | csv | manual | ...
  archived_at      timestamptz,
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

create table public.streets (
  id               uuid primary key,
  town_id          uuid not null references public.towns(id),
  name             text not null,
  name_key         text not null,           -- normalisiert für Dubletten/Suche
  postal_code      text,
  source           text not null default 'manual',
  archived_at      timestamptz,
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  unique (town_id, name_key)
);

create type public.address_status as enum (
  'unprocessed',        -- Unbearbeitet
  'not_home',           -- Nicht angetroffen
  'contacted',          -- Angetroffen / kein unmittelbarer Abschluss
  'followup',           -- Wiedervorlage
  'appointment',        -- Termin vereinbart
  'not_interested',     -- Kein Interesse
  'existing_customer',  -- Bestandskunde / bereits erneuert
  'no_potential'        -- Kein Potenzial / Adresse ausschließen
);

create table public.addresses (
  id                   uuid primary key,
  town_id              uuid not null references public.towns(id),
  street_id            uuid not null references public.streets(id),
  house_number         text not null,       -- vollständige Anzeige, z. B. '14/1'
  house_number_numeric int,                 -- 14
  house_number_suffix  text not null default '',  -- '/1', 'a'
  number_key           text not null,       -- normalisiert für Dubletten
  postal_code          text,
  current_status       public.address_status not null default 'unprocessed',
  status_changed_at    timestamptz,
  excluded             boolean not null default false,
  excluded_reason      text,
  source               text not null default 'manual',
  source_ref           text,                -- z. B. 'osm:way/123'
  source_missing_at    timestamptz,         -- bei Aktualisierung nicht mehr in Quelle → prüfen
  last_activity_at     timestamptz,
  last_activity_by     uuid references public.users(id),
  assigned_user_id     uuid references public.users(id),
  owner_user_id        uuid not null references public.users(id),
  team_id              uuid references public.teams(id),
  created_by           uuid references public.users(id),
  updated_by           uuid references public.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  server_updated_at    timestamptz not null default now(),
  unique (street_id, number_key)
);
create index addresses_town_idx   on public.addresses (town_id);
create index addresses_status_idx on public.addresses (town_id, current_status);

-- Konfliktregel: neuerer Status gewinnt, älterer (verspätet synchronisierter) wird ignoriert
create or replace function public.addresses_keep_latest_status() returns trigger
language plpgsql as $$
begin
  if old.status_changed_at is not null and new.status_changed_at is not null
     and new.status_changed_at < old.status_changed_at then
    new.current_status    := old.current_status;
    new.status_changed_at := old.status_changed_at;
    new.excluded          := old.excluded;
    new.excluded_reason   := old.excluded_reason;
  end if;
  if old.last_activity_at is not null and (new.last_activity_at is null or new.last_activity_at < old.last_activity_at) then
    new.last_activity_at := old.last_activity_at;
    new.last_activity_by := old.last_activity_by;
  end if;
  return new;
end $$;
create trigger addresses_latest_status before update on public.addresses
  for each row execute function public.addresses_keep_latest_status();

-- ---------------------------------------------------------------------
-- Verlauf, Notizen, Tags, Produkte (append-only bzw. soft-remove)
-- ---------------------------------------------------------------------
create table public.address_status_history (
  id               uuid primary key,
  address_id       uuid not null references public.addresses(id),
  kind             text not null,   -- status | note | tags | exclude | restore | followup | appointment | import | system
  status           public.address_status,
  previous_status  public.address_status,
  note_id          uuid,
  tags_added       text[] not null default '{}',
  tags_removed     text[] not null default '{}',
  changes          jsonb not null default '{}'::jsonb,
  followup_id      uuid,
  appointment_id   uuid,
  occurred_at      timestamptz not null,  -- Zeitpunkt auf dem Gerät (offline-sicher)
  user_id          uuid references public.users(id),
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);
create index history_address_idx on public.address_status_history (address_id, occurred_at desc);

create table public.notes (
  id               uuid primary key,
  address_id       uuid not null references public.addresses(id),
  body             text not null,
  occurred_at      timestamptz not null,
  user_id          uuid references public.users(id),
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);
create index notes_address_idx on public.notes (address_id);

-- Append-only-Schutz für Verlauf und Notizen
create or replace function public.prevent_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Verlaufsdaten dürfen nicht gelöscht werden (%).', tg_table_name;
  end if;
  -- erneutes Synchronisieren derselben Zeile (Upsert) ist erlaubt, Inhalte bleiben unverändert
  return old;
end $$;
create trigger history_append_only before update or delete on public.address_status_history
  for each row execute function public.prevent_mutation();
create trigger notes_append_only before update or delete on public.notes
  for each row execute function public.prevent_mutation();

create table public.address_potential_tags (
  id               text primary key,         -- '<address_id>:<tag_id>'
  address_id       uuid not null references public.addresses(id),
  tag_id           text not null references public.potential_tags(id),
  removed_at       timestamptz,              -- statt Löschen
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);
create index apt_address_idx on public.address_potential_tags (address_id);

create table public.address_products (
  id               text primary key,         -- '<address_id>:<product_id>'
  address_id       uuid not null references public.addresses(id),
  product_id       text not null references public.products(id),
  interest         text not null default 'interest' check (interest in ('primary','interest')),
  removed_at       timestamptz,
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Wiedervorlagen
-- ---------------------------------------------------------------------
create table public.followups (
  id               uuid primary key,
  address_id       uuid not null references public.addresses(id),
  priority         text not null check (priority in ('high','medium','low')),
  due_date         date not null,            -- Stichtag, ab dem die WV fällig ist
  period_start     date,
  period_end       date,
  period_label     text,                     -- z. B. 'Frühling 2027', 'in 2 Wochen'
  preset           text,                     -- date | next_week | two_weeks | next_month | season:spring:2027 ...
  note             text,
  status           text not null default 'open' check (status in ('open','done','superseded','cancelled')),
  completed_at     timestamptz,
  occurred_at      timestamptz not null,
  user_id          uuid references public.users(id),
  assigned_user_id uuid references public.users(id),
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);
create index followups_due_idx on public.followups (status, due_date);

-- ---------------------------------------------------------------------
-- Termine (Calendly ist die Terminquelle; hier Spiegel + Kundendaten)
-- ---------------------------------------------------------------------
create table public.appointments (
  id                    uuid primary key,
  address_id            uuid references public.addresses(id),
  status                text not null default 'pending'
                        check (status in ('pending','scheduled','canceled','completed','no_show')),
  start_time            timestamptz,
  end_time              timestamptz,
  customer_name         text not null,
  phone                 text not null,
  email                 text,
  address_text          text not null,
  main_product_id       text not null references public.products(id),
  product_ids           text[] not null default '{}',
  note                  text,
  lead_source           text not null default 'd2d' check (lead_source in ('d2d','pos','fair','other')),
  lead_source_detail    text,                 -- später: POS-Standort, Messe-Name …
  booking_mode          text,                 -- api | embed | link | mock
  calendly_event_uri    text,
  calendly_invitee_uri  text unique,
  calendly_cancel_url   text,
  calendly_reschedule_url text,
  cancel_reason         text,
  user_id               uuid references public.users(id),
  assigned_user_id      uuid references public.users(id),
  owner_user_id         uuid not null references public.users(id),
  team_id               uuid references public.teams(id),
  created_by            uuid references public.users(id),
  updated_by            uuid references public.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  server_updated_at     timestamptz not null default now()
);
create index appointments_start_idx on public.appointments (start_time);

-- ---------------------------------------------------------------------
-- Importe & Integrationen
-- ---------------------------------------------------------------------
create table public.imports (
  id               uuid primary key,
  town_id          uuid references public.towns(id),
  source           text not null,             -- osm | csv | xlsx | manual | <künftige amtliche Quelle>
  mode             text not null default 'initial' check (mode in ('initial','refresh','append')),
  status           text not null default 'confirmed' check (status in ('preview','confirmed','cancelled')),
  stats            jsonb not null default '{}'::jsonb,
  occurred_at      timestamptz not null,
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

-- KEINE Geheimnisse: Tokens liegen ausschließlich in Server-Umgebungsvariablen.
create table public.external_integrations (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null check (provider in ('calendly','google_sheets','ical')),
  status           text not null default 'disconnected',
  config           jsonb not null default '{}'::jsonb,   -- nicht-geheime Einstellungen (z. B. Sheet-ID)
  feed_token       text unique default encode(gen_random_bytes(24), 'hex'),
  owner_user_id    uuid not null references public.users(id),
  team_id          uuid references public.teams(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  unique (owner_user_id, provider)
);

-- Rohdaten eingehender Webhooks (Nachvollziehbarkeit, Idempotenz)
create table public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event        text not null,
  payload      jsonb not null,
  dedupe_key   text unique,
  processed_at timestamptz,
  error        text,
  received_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- updated_at-Trigger
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users','teams','towns','streets','addresses','address_status_history','notes',
    'address_potential_tags','address_products','followups','appointments','imports','external_integrations']
  loop
    execute format('create trigger %I_touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.users                  enable row level security;
alter table public.teams                  enable row level security;
alter table public.team_members           enable row level security;
alter table public.territory_assignments  enable row level security;
alter table public.products               enable row level security;
alter table public.potential_tags         enable row level security;
alter table public.towns                  enable row level security;
alter table public.streets                enable row level security;
alter table public.addresses              enable row level security;
alter table public.address_status_history enable row level security;
alter table public.notes                  enable row level security;
alter table public.address_potential_tags enable row level security;
alter table public.address_products       enable row level security;
alter table public.followups              enable row level security;
alter table public.appointments           enable row level security;
alter table public.imports                enable row level security;
alter table public.external_integrations  enable row level security;
alter table public.webhook_events         enable row level security;  -- nur Service-Role

create policy users_self on public.users for select using (
  id = auth.uid() or exists (select 1 from team_members a join team_members b on a.team_id = b.team_id
                             where a.user_id = auth.uid() and b.user_id = users.id));
create policy users_update_self on public.users for update using (id = auth.uid());

create policy teams_read on public.teams for select using (public.is_team_member(id) or owner_user_id = auth.uid());
create policy team_members_read on public.team_members for select using (public.is_team_member(team_id));
create policy territory_read on public.territory_assignments for select using (public.is_team_member(team_id));

create policy products_read on public.products for select using (auth.uid() is not null);
create policy tags_read on public.potential_tags for select using (auth.uid() is not null and (team_id is null or public.is_team_member(team_id)));

-- Standard-Policies für alle Datentabellen: lesen/anlegen/ändern bei Zugriff, niemals löschen
do $$
declare t text;
begin
  foreach t in array array['towns','streets','addresses','address_status_history','notes',
    'address_potential_tags','address_products','followups','appointments','imports','external_integrations']
  loop
    execute format('create policy %I_select on public.%I for select using (public.can_access(owner_user_id, team_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (public.can_access(owner_user_id, team_id))', t, t);
    execute format('create policy %I_update on public.%I for update using (public.can_access(owner_user_id, team_id)) with check (public.can_access(owner_user_id, team_id))', t, t);
  end loop;
end $$;
-- Bewusst KEINE delete-Policies: physisches Löschen ist für Clients nicht möglich.
