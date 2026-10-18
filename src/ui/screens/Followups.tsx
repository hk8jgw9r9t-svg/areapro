import { useMemo, useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { addressLabel, followupBuckets, openFollowups, productsOfAddress, tagsOf, towns } from '../../data/selectors';
import { completeFollowup } from '../../data/actions';
import { PRIORITIES, PRODUCT, TAGS } from '../../lib/constants';
import { formatDate, relativeDay, todayKey } from '../../lib/dates';
import type { Followup, Priority } from '../../lib/types';
import { go } from '../router';
import { Button, Chip, Empty, PageHeader, Segmented, cx, toast } from '../kit';
import { Icon } from '../icons';
import { PriorityPill, TagList } from '../components/StatusBits';

type View = 'overdue' | 'today' | 'week' | 'upcoming' | 'high' | 'all';
type Group = 'none' | 'town' | 'street' | 'product';

export function FollowupsScreen() {
  useStoreVersion();
  const b = followupBuckets();
  const [view, setView] = useState<View>(b.overdue.length ? 'overdue' : 'today');
  const [group, setGroup] = useState<Group>('none');
  const [town, setTown] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [prio, setPrio] = useState<Priority | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const base: Followup[] = view === 'all' ? openFollowups() : b[view];
  const list = base.filter((f) => {
    const a = store.get('addresses', f.address_id);
    if (!a) return false;
    if (town && a.town_id !== town) return false;
    if (tag && !tagsOf(a.id).includes(tag)) return false;
    if (prio && f.priority !== prio) return false;
    return true;
  });
  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: '', items: list }];
    const m = new Map<string, { key: string; label: string; items: Followup[] }>();
    for (const f of list) {
      const a = store.get('addresses', f.address_id)!;
      const keys: [string, string][] =
        group === 'town'
          ? [[a.town_id, store.get('towns', a.town_id)?.name ?? '?']]
          : group === 'street'
            ? [[a.street_id, `${store.get('streets', a.street_id)?.name ?? '?'} · ${store.get('towns', a.town_id)?.name ?? ''}`]]
            : (() => {
                const ps = productsOfAddress(a.id);
                return ps.length ? ps.map((p) => [p, PRODUCT[p]?.label ?? p] as [string, string]) : [['-', 'ohne Produktzuordnung'] as [string, string]];
              })();
      for (const [k, label] of keys) {
        const g = m.get(k) ?? { key: k, label, items: [] };
        g.items.push(f);
        m.set(k, g);
      }
    }
    return [...m.values()].sort((x, y) => y.items.length - x.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, group, store.version]);

  const count = (n: number) => (n ? <span className="count">{n}</span> : null);
  const filterCount = [town, tag, prio].filter(Boolean).length;

  return (
    <div className="page">
      <PageHeader
        title="Wiedervorlagen"
        sub={`${openFollowups().length} offen · ${b.overdue.length} überfällig · ${b.today.length} heute`}
        actions={
          <Button icon="calendar" onClick={() => go('kalender')}>
            Kalender
          </Button>
        }
      />
      <div className="tabs-scroll">
        {(
          [
            ['overdue', 'Überfällig', b.overdue.length],
            ['today', 'Heute', b.today.length],
            ['week', 'Diese Woche', b.week.length],
            ['upcoming', 'Kommende', b.upcoming.length],
            ['high', 'Hoch priorisiert', b.high.length],
            ['all', 'Alle', openFollowups().length],
          ] as [View, string, number][]
        ).map(([k, l, n]) => (
          <button key={k} className={cx('tab', view === k && 'tab-active', k === 'overdue' && n > 0 && 'tab-alert')} onClick={() => setView(k)}>
            {l} {count(n)}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <Segmented
          size="sm"
          value={group}
          onChange={setGroup}
          options={[
            { value: 'none', label: 'Liste' },
            { value: 'town', label: 'Nach Ort' },
            { value: 'street', label: 'Nach Straße' },
            { value: 'product', label: 'Nach Produkt' },
          ]}
        />
        <Button size="sm" icon="filter" variant={filterCount ? 'primary' : 'default'} onClick={() => setShowFilter((s) => !s)}>
          Filter{filterCount ? ` (${filterCount})` : ''}
        </Button>
      </div>
      {showFilter && (
        <div className="filter-panel">
          <div className="label">Ort</div>
          <div className="chip-wrap">
            <Chip active={!town} onClick={() => setTown(null)}>
              Alle
            </Chip>
            {towns().map((t) => (
              <Chip key={t.id} active={town === t.id} onClick={() => setTown(t.id)}>
                {t.name}
              </Chip>
            ))}
          </div>
          <div className="label">Priorität</div>
          <div className="chip-wrap">
            <Chip active={!prio} onClick={() => setPrio(null)}>
              Alle
            </Chip>
            {PRIORITIES.map((p) => (
              <Chip key={p.key} active={prio === p.key} onClick={() => setPrio(p.key)} color={p.color}>
                {p.label}
              </Chip>
            ))}
          </div>
          <div className="label">Potenzial-Tag</div>
          <div className="chip-wrap">
            <Chip active={!tag} onClick={() => setTag(null)}>
              Alle
            </Chip>
            {TAGS.map((t) => (
              <Chip key={t.id} active={tag === t.id} onClick={() => setTag(t.id)}>
                {t.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {list.length === 0 && (
        <Empty icon="check" title={view === 'overdue' ? 'Nichts überfällig' : 'Keine Wiedervorlagen'}>
          {view === 'today' && b.overdue.length > 0 && (
            <Button variant="primary" onClick={() => setView('overdue')}>
              {b.overdue.length} überfällige ansehen
            </Button>
          )}
        </Empty>
      )}
      {groups.map((g) => (
        <section key={g.key} className="fu-group">
          {g.label && (
            <h2 className="group-title">
              {g.label} <span className="count">{g.items.length}</span>
            </h2>
          )}
          <ul className="fu-list">
            {g.items.map((f) => (
              <FollowupCard key={`${g.key}-${f.id}`} f={f} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function FollowupCard({ f, compact }: { f: Followup; compact?: boolean }) {
  const a = store.get('addresses', f.address_id);
  if (!a) return null;
  const l = addressLabel(a);
  const overdue = f.due_date < todayKey();
  return (
    <li className={cx('fu-card', overdue && 'fu-overdue', f.priority === 'high' && 'fu-high')}>
      <button className="fu-open" onClick={() => go(`strasse/${a.street_id}`, { a: a.id })}>
        <div className="fu-top">
          <span className="fu-addr">{l.line1}</span>
          <PriorityPill priority={f.priority} />
        </div>
        <div className="fu-meta">
          <span className={cx(overdue && 'text-danger')}>
            <Icon name="clock" size={14} /> {relativeDay(f.due_date)} · {formatDate(f.due_date)}
            {f.period_label && f.preset !== 'date' ? ` · ${f.period_label}` : ''}
          </span>
          <span className="muted">{l.town?.name}</span>
        </div>
        {!compact && <TagList tags={tagsOf(a.id)} max={4} />}
        {!compact && f.note && <div className="fu-note">{f.note}</div>}
      </button>
      {!compact && (
        <div className="fu-actions">
          <Button size="sm" icon="check" onClick={() => (completeFollowup(f.id), toast('Wiedervorlage erledigt'))}>
            Erledigt
          </Button>
        </div>
      )}
    </li>
  );
}
