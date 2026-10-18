import { useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { addressLabel } from '../../data/selectors';
import { STATUS } from '../../lib/constants';
import { formatDate } from '../../lib/dates';
import { parseHouseNumber } from '../../lib/housenumber';
import { matchesSearch, searchKey } from '../../lib/text';
import { go } from '../router';
import { PageHeader, SearchInput } from '../kit';
import { Icon } from '../icons';

/** Globale Suche über alle Orte: Straße, Hausnummer, Name, Telefonnummer, Notiz. */
export function SearchScreen() {
  useStoreVersion();
  const [q, setQ] = useState('');
  const query = q.trim();
  const digits = query.replace(/\D/g, '');
  const res = query.length < 2 ? null : run(query, digits);
  return (
    <div className="page">
      <PageHeader title="Suche" sub="Straße, Hausnummer, Name, Telefonnummer oder Notiz" />
      <div className="sticky-search">
        <SearchInput value={q} onChange={setQ} placeholder="z. B. „Goethe 12“, „Mustermann“, „0151“, „Haustür“" autoFocus />
      </div>
      {res && (
        <div className="search-results">
          {res.addresses.length > 0 && <h2 className="group-title">Adressen</h2>}
          {res.addresses.map((a) => {
            const l = addressLabel(a);
            const s = STATUS[a.current_status];
            return (
              <button key={a.id} className="result-row" onClick={() => go(`strasse/${a.street_id}`, { a: a.id })}>
                <span className="tile-mini" style={{ background: s.bg, color: s.fg, borderColor: s.accent }}>
                  <Icon name={s.icon} size={14} />
                </span>
                <span className="grow">
                  <strong>{l.line1}</strong> <span className="muted small">{l.line2}</span>
                </span>
              </button>
            );
          })}
          {res.streets.length > 0 && <h2 className="group-title">Straßen</h2>}
          {res.streets.map((s) => (
            <button key={s.id} className="result-row" onClick={() => go(`strasse/${s.id}`)}>
              <Icon name="signpost" />
              <span className="grow">
                <strong>{s.name}</strong> <span className="muted small">{store.get('towns', s.town_id)?.name}</span>
              </span>
            </button>
          ))}
          {res.customers.length > 0 && <h2 className="group-title">Kunden / Termine</h2>}
          {res.customers.map((a) => {
            const addr = a.address_id ? store.get('addresses', a.address_id) : undefined;
            return (
              <button key={a.id} className="result-row" onClick={() => (addr ? go(`strasse/${addr.street_id}`, { a: addr.id }) : go('termine'))}>
                <Icon name="users" />
                <span className="grow">
                  <strong>{a.customer_name}</strong> · {a.phone}
                  <div className="muted small">
                    {a.address_text}
                    {a.start_time ? ` · ${formatDate(a.start_time)}` : ''}
                  </div>
                </span>
              </button>
            );
          })}
          {res.notes.length > 0 && <h2 className="group-title">Notizen</h2>}
          {res.notes.map((n) => {
            const addr = store.get('addresses', n.address_id);
            return (
              <button key={n.id} className="result-row" onClick={() => addr && go(`strasse/${addr.street_id}`, { a: addr.id })}>
                <Icon name="note" />
                <span className="grow">
                  <span className="small">{n.body}</span>
                  <div className="muted small">
                    {addressLabel(addr).line1} · {formatDate(n.occurred_at)}
                  </div>
                </span>
              </button>
            );
          })}
          {!res.addresses.length && !res.streets.length && !res.customers.length && !res.notes.length && <div className="empty-inline">Keine Treffer.</div>}
        </div>
      )}
    </div>
  );
}

function run(query: string, digits: string) {
  const streets = store.all('streets').filter((s) => !s.archived_at);
  const m = query.match(/^(.*?)\s+(\d+\s*[a-z]?(?:\/\d+)?)$/i);
  let addresses = [] as ReturnType<typeof store.all<'addresses'>>;
  if (m) {
    const key = parseHouseNumber(m[2]).key;
    const sIds = new Set(streets.filter((s) => matchesSearch(s.name, m[1])).map((s) => s.id));
    addresses = store.all('addresses').filter((a) => sIds.has(a.street_id) && a.number_key === key);
  }
  const sk = searchKey(query);
  const customers = store
    .all('appointments')
    .filter((a) => searchKey(a.customer_name).includes(sk) || (digits.length >= 3 && a.phone.replace(/\D/g, '').includes(digits)) || (a.email && searchKey(a.email).includes(sk)))
    .slice(0, 20);
  const notes = store
    .all('notes')
    .filter((n) => searchKey(n.body).includes(sk))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 20);
  return { addresses: addresses.slice(0, 20), streets: m ? [] : streets.filter((s) => matchesSearch(s.name, query)).slice(0, 20), customers, notes };
}
