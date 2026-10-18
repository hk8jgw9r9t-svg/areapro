import { useMemo, useState } from 'react';
import { PRIORITIES, TAGS } from '../../lib/constants';
import { exactDatePeriod, quickPeriods, upcomingSeasons, type FollowupPeriod, formatDate, todayKey, toDateKey, addDays } from '../../lib/dates';
import type { Priority } from '../../lib/types';
import { saveFollowup } from '../../data/actions';
import { tagsOf, openFollowupOf } from '../../data/selectors';
import { Button, Chip, NoteArea, cx } from '../kit';
import { Icon } from '../icons';

export function FollowupPanel({ addressId, onDone, onCancel }: { addressId: string; onDone: () => void; onCancel: () => void }) {
  const existing = openFollowupOf(addressId);
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? 'medium');
  const periods = useMemo(() => [...quickPeriods(), ...upcomingSeasons(new Date(), 5)], []);
  const [period, setPeriod] = useState<FollowupPeriod | null>(null);
  const [customDate, setCustomDate] = useState('');
  const [tags, setTags] = useState<string[]>(tagsOf(addressId));
  const [note, setNote] = useState('');
  const [contacted, setContacted] = useState(false);

  const toggleTag = (t: string) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));
  const chosen = period ?? (customDate ? exactDatePeriod(customDate) : null);

  const save = () => {
    if (!chosen) return;
    saveFollowup(addressId, { priority, period: chosen, tags, note, contacted });
    onDone();
  };

  return (
    <div className="panel panel-followup">
      <div className="panel-title">
        <Icon name="clock" /> Wiedervorlage
      </div>

      <div className="label">Priorität</div>
      <div className="prio-row">
        {PRIORITIES.map((p) => (
          <button key={p.key} type="button" className={cx('prio-btn', priority === p.key && 'prio-active')} style={priority === p.key ? { background: p.color, borderColor: p.color } : { borderColor: p.color, color: p.color }} onClick={() => setPriority(p.key)} aria-pressed={priority === p.key}>
            {p.key === 'high' && <Icon name="flame" size={18} />}
            {p.label}
          </button>
        ))}
      </div>

      <div className="label">Wann?</div>
      <div className="chip-wrap">
        {periods.map((p) => (
          <Chip
            key={p.preset}
            active={period?.preset === p.preset}
            onClick={() => {
              setPeriod(p);
              setCustomDate('');
            }}
          >
            {p.label}
          </Chip>
        ))}
      </div>
      <div className="date-row">
        <span className="muted">oder Datum:</span>
        <input
          type="date"
          className="date-input"
          min={todayKey()}
          max={toDateKey(addDays(new Date(), 365 * 3))}
          value={customDate}
          onChange={(e) => {
            setCustomDate(e.target.value);
            setPeriod(null);
          }}
        />
      </div>
      {chosen && (
        <div className="hint-ok">
          <Icon name="calendarClock" size={16} /> Erscheint ab <strong>{formatDate(chosen.due_date)}</strong> in den fälligen Wiedervorlagen
          {chosen.period_end !== chosen.period_start ? ` (Zeitraum bis ${formatDate(chosen.period_end)})` : ''}.
        </div>
      )}

      <div className="label">Potenzial</div>
      <div className="chip-wrap">
        {TAGS.map((t) => (
          <Chip key={t.id} active={tags.includes(t.id)} onClick={() => toggleTag(t.id)}>
            {t.label}
          </Chip>
        ))}
      </div>

      <label className="toggle-row">
        <input type="checkbox" checked={contacted} onChange={(e) => setContacted(e.target.checked)} />
        <span>Kunde persönlich gesprochen</span>
      </label>

      <NoteArea value={note} onChange={setNote} placeholder="z. B. „Kunde sagt aktuell nicht, im Frühjahr noch einmal melden.“" />

      <div className="panel-actions">
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button variant="primary" size="lg" icon="check" onClick={save} disabled={!chosen}>
          Speichern
        </Button>
      </div>
    </div>
  );
}
