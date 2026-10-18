// Importpipeline: Rohdaten → bereinigter Plan → Vorschau (Statistik) → Bestätigung → Op.
// Bestehende Adressen und deren Vertriebsdaten werden NIE verändert oder gelöscht.

import { store } from '../data/store';
import { newAddressRow, newStreetRow, ownedFields, historyRow } from '../data/actions';
import { uid, nowIso } from '../lib/id';
import { parseHouseNumber } from '../lib/housenumber';
import { normalizeStreetName, streetKey } from '../lib/text';
import type { Address, Op, Street, Town } from '../lib/types';

export interface RawAddress {
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  ref: string | null;
}

export interface PlannedAddress {
  streetKey: string;
  streetName: string;
  number: string;
  numberKey: string;
  postal: string | null;
  ref: string | null;
}

export interface ImportPlan {
  source: string;
  town: Town | null; // existierender Ort (Aktualisierung/Ergänzung) oder null (neu)
  townDraft: { name: string; postal_codes: string[]; state: string | null; osm_relation_id: number | null };
  streets: { key: string; name: string; postal: string | null; existingId: string | null; count: number }[];
  newAddresses: PlannedAddress[];
  stats: {
    rawCount: number;
    streetsFound: number;
    addressesFound: number;
    withoutStreet: number;
    invalidNumber: number;
    duplicates: number;
    alreadyPresent: number;
    newStreets: number;
    newAddresses: number;
    missingInSource: number; // nur Aktualisierung
    foreignCity: number;
  };
  missing: { addressId: string; label: string }[];
  samplesWithoutStreet: string[];
}

export function buildImportPlan(
  raw: RawAddress[],
  source: string,
  target: { town: Town | null; name: string; postal_codes: string[]; state?: string | null; osm_relation_id?: number | null },
  opts: { compareMissing?: boolean } = {},
): ImportPlan {
  const town = target.town;
  const existingStreets = town ? store.all('streets').filter((s) => s.town_id === town.id && !s.archived_at) : [];
  const streetByKey = new Map(existingStreets.map((s) => [s.name_key, s]));
  const existingAddr = town ? store.all('addresses').filter((a) => a.town_id === town.id) : [];
  const existingKeys = new Set(existingAddr.map((a) => `${a.street_id}|${a.number_key}`));

  const stats: ImportPlan['stats'] = {
    rawCount: raw.length,
    streetsFound: 0,
    addressesFound: 0,
    withoutStreet: 0,
    invalidNumber: 0,
    duplicates: 0,
    alreadyPresent: 0,
    newStreets: 0,
    newAddresses: 0,
    missingInSource: 0,
    foreignCity: 0,
  };
  const seen = new Set<string>();
  const sourceKeys = new Set<string>(); // streetKey|numberKey (für Vergleich verschwundener Adressen)
  const streets = new Map<string, ImportPlan['streets'][number]>();
  const newAddresses: PlannedAddress[] = [];
  const samplesWithoutStreet: string[] = [];
  const townKey = streetKey(target.name);

  for (const r of raw) {
    const sName = normalizeStreetName(r.street);
    if (!sName) {
      stats.withoutStreet++;
      if (samplesWithoutStreet.length < 5 && r.houseNumber) samplesWithoutStreet.push(`Nr. ${r.houseNumber}${r.city ? ` (${r.city})` : ''}`);
      continue;
    }
    const p = parseHouseNumber(r.houseNumber);
    if (!p.display) {
      stats.invalidNumber++;
      continue;
    }
    if (r.city && townKey && !streetKey(r.city).includes(townKey) && !townKey.includes(streetKey(r.city))) stats.foreignCity++;
    const sKey = streetKey(sName);
    const dupKey = `${sKey}|${p.key}`;
    if (seen.has(dupKey)) {
      stats.duplicates++;
      continue;
    }
    seen.add(dupKey);
    sourceKeys.add(dupKey);
    stats.addressesFound++;
    let st = streets.get(sKey);
    if (!st) {
      const ex = streetByKey.get(sKey);
      st = { key: sKey, name: ex?.name ?? sName, postal: r.postalCode || null, existingId: ex?.id ?? null, count: 0 };
      streets.set(sKey, st);
    }
    st.count++;
    if (!st.postal && r.postalCode) st.postal = r.postalCode;
    if (st.existingId && existingKeys.has(`${st.existingId}|${p.key}`)) {
      stats.alreadyPresent++;
      continue;
    }
    newAddresses.push({ streetKey: sKey, streetName: st.name, number: p.display, numberKey: p.key, postal: r.postalCode || null, ref: r.ref });
  }
  stats.streetsFound = streets.size;
  stats.newStreets = [...streets.values()].filter((s) => !s.existingId).length;
  stats.newAddresses = newAddresses.length;

  const missing: ImportPlan['missing'] = [];
  if (town && opts.compareMissing) {
    const streetKeyById = new Map(existingStreets.map((s) => [s.id, s]));
    for (const a of existingAddr) {
      const s = streetKeyById.get(a.street_id);
      if (!s || a.source !== source) continue; // nur Adressen derselben Quelle vergleichen (manuelle bleiben unberührt)
      if (!sourceKeys.has(`${s.name_key}|${a.number_key}`) && !a.source_missing_at) missing.push({ addressId: a.id, label: `${s.name} ${a.house_number}` });
    }
    stats.missingInSource = missing.length;
  }

  return {
    source,
    town,
    townDraft: { name: target.name, postal_codes: target.postal_codes, state: target.state ?? null, osm_relation_id: target.osm_relation_id ?? null },
    streets: [...streets.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    newAddresses,
    stats,
    missing,
    samplesWithoutStreet,
  };
}

/** Bestätigten Import ausführen. Gibt den (ggf. neu angelegten) Ort zurück. */
export function applyImportPlan(plan: ImportPlan, mode: 'initial' | 'refresh' | 'append'): Town {
  const ts = nowIso();
  const o = ownedFields(ts);
  const uidUser = store.user!.id;
  const town: Town =
    plan.town ??
    ({
      id: uid(),
      name: plan.townDraft.name,
      postal_codes: plan.townDraft.postal_codes,
      state: plan.townDraft.state,
      osm_relation_id: plan.townDraft.osm_relation_id,
      source: plan.source,
      archived_at: null,
      created_by: uidUser,
      updated_by: uidUser,
      ...o,
    } as Town);

  // Postleitzahlen des Ortes ergänzen
  const plzs = new Set(town.postal_codes);
  plan.newAddresses.forEach((a) => a.postal && plzs.add(a.postal));
  const townRow: Town = { ...town, postal_codes: [...plzs].sort(), updated_at: ts };

  const streetRows: Street[] = [];
  const streetIdByKey = new Map<string, string>();
  for (const s of plan.streets) {
    if (s.existingId) {
      streetIdByKey.set(s.key, s.existingId);
      continue;
    }
    const row = newStreetRow(town.id, s.name, s.postal, plan.source, ts);
    streetRows.push(row);
    streetIdByKey.set(s.key, row.id);
  }
  const addrRows: Address[] = plan.newAddresses.map((a) =>
    newAddressRow(town.id, streetIdByKey.get(a.streetKey)!, a.number, a.postal ?? townRow.postal_codes[0] ?? null, plan.source, ts, a.ref),
  );
  // In der Quelle verschwundene Adressen: nur markieren (prüfen), nie löschen
  const missingRows: Address[] = plan.missing
    .map((m) => store.get('addresses', m.addressId))
    .filter((a): a is Address => !!a)
    .map((a) => ({ ...a, source_missing_at: ts, updated_at: ts }));

  const upserts: Op['upserts'] = {
    towns: [townRow],
    streets: streetRows,
    addresses: [...addrRows, ...missingRows],
    imports: [
      {
        id: uid(),
        town_id: town.id,
        source: plan.source,
        mode,
        status: 'confirmed',
        stats: plan.stats as unknown as Record<string, unknown>,
        occurred_at: ts,
        created_by: uidUser,
        ...o,
      },
    ],
    address_status_history: missingRows.map((a) => historyRow(a.id, 'import', ts, { changes: { source_missing: true, source: plan.source } })),
  };
  store.apply({ op_id: uid(), ts, label: 'Import', upserts });
  return townRow;
}

/** Markierung "in Quelle nicht mehr vorhanden" als geprüft entfernen. */
export function clearMissingFlag(addressId: string) {
  const a = store.get('addresses', addressId);
  if (!a) return;
  const ts = nowIso();
  store.apply({ op_id: uid(), ts, label: 'Prüfung erledigt', upserts: { addresses: [{ ...a, source_missing_at: null, updated_at: ts }] } });
}
