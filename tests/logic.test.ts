// Ausführen: npx tsx tests/logic.test.ts   (ohne Test-Framework, bewusst abhängigkeitsfrei)
import assert from 'node:assert/strict';
import {
  expandHouseNumberInput,
  getNextSameSideAddress,
  getOppositeSideAddress,
  getPrevSameSideAddress,
  parseHouseNumber,
  sortByHouseNumber,
} from '../src/lib/housenumber';
import { normalizeStreetName, streetKey, matchesSearch } from '../src/lib/text';
import { upcomingSeasons, quickPeriods } from '../src/lib/dates';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log('✓', name);
}

const mk = (nums: string[], excluded: string[] = []) =>
  nums.map((n) => {
    const p = parseHouseNumber(n);
    return { id: n, house_number: p.display, house_number_numeric: p.numeric, house_number_suffix: p.suffix, excluded: excluded.includes(n) };
  });
const ids = (l: { id: string }[]) => l.map((x) => x.id);

test('parse Zusätze', () => {
  assert.deepEqual(parseHouseNumber('12 a'), { display: '12a', numeric: 12, suffix: 'a', key: '12a' });
  assert.equal(parseHouseNumber('14 / 1').display, '14/1');
  assert.equal(parseHouseNumber(' 7B ').display, '7b');
  assert.equal(parseHouseNumber('A').numeric, null);
});

test('Sortierung 12, 12a, 12b, 14, 14/1', () => {
  assert.deepEqual(ids(sortByHouseNumber(mk(['14/1', '12b', '14', '12', '12a']))), ['12', '12a', '12b', '14', '14/1']);
});

test('nächste gerade Nummer, fehlende 6 wird nicht erfunden', () => {
  const l = mk(['1', '2', '3', '4', '5', '8', '10']);
  assert.equal(getNextSameSideAddress(l, '2')?.id, '4');
  assert.equal(getNextSameSideAddress(l, '4')?.id, '8');
  assert.equal(getNextSameSideAddress(l, '8')?.id, '10');
  assert.equal(getNextSameSideAddress(l, '10'), null);
  assert.equal(getNextSameSideAddress(l, '1')?.id, '3');
  assert.equal(getNextSameSideAddress(l, '5'), null);
});

test('Zusätze: 2 → 2a → 4 → 6', () => {
  const l = mk(['2', '2a', '4', '6', '3']);
  assert.equal(getNextSameSideAddress(l, '2')?.id, '2a');
  assert.equal(getNextSameSideAddress(l, '2a')?.id, '4');
  assert.equal(getNextSameSideAddress(l, '4')?.id, '6');
  assert.equal(getPrevSameSideAddress(l, '4')?.id, '2a');
});

test('ausgeschlossene Adressen werden übersprungen', () => {
  const l = mk(['2', '4', '6'], ['4']);
  assert.equal(getNextSameSideAddress(l, '2')?.id, '6');
});

test('absteigende Laufrichtung', () => {
  const l = mk(['1', '3', '5', '7']);
  assert.equal(getNextSameSideAddress(l, '5', { direction: -1 })?.id, '3');
});

test('andere Straßenseite', () => {
  const l = mk(['1', '3', '5', '2', '4', '8']);
  // Gleichstand |3-4| = |5-4| → in Laufrichtung (aufwärts) 5, absteigend 3
  assert.equal(getOppositeSideAddress(l, '4')?.id, '5');
  assert.equal(getOppositeSideAddress(l, '4', { direction: -1 })?.id, '3');
  assert.equal(getOppositeSideAddress(l, '8')?.id, '5');
});

test('Mehrfacheingabe', () => {
  assert.deepEqual(expandHouseNumberInput('1-6'), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(expandHouseNumberInput('2-10', 'even'), ['2', '4', '6', '8', '10']);
  assert.deepEqual(expandHouseNumberInput('12a, 12, 14/1\n3'), ['3', '12', '12a', '14/1']);
  assert.deepEqual(expandHouseNumberInput('1 2 3'), ['1', '2', '3']);
});

test('Straßennamen vereinheitlichen', () => {
  assert.equal(normalizeStreetName('Goethestr.'), 'Goethestraße');
  assert.equal(normalizeStreetName('goethestrasse'), 'Goethestraße');
  assert.equal(normalizeStreetName('Am  Sonnenhang'), 'Am Sonnenhang');
  assert.equal(normalizeStreetName('Karlsruher Str.'), 'Karlsruher Straße');
  assert.equal(streetKey('Goethestr.'), streetKey('Goethestraße'));
  assert.ok(matchesSearch('Goethestraße', 'Goe'));
  assert.ok(matchesSearch('Hauptstraße', 'hauptstr'));
});

test('Jahreszeiten ab 18.10.2026', () => {
  const s = upcomingSeasons(new Date(2026, 9, 18), 5).map((x) => x.label);
  assert.deepEqual(s, ['Winter 2026', 'Frühling 2027', 'Sommer 2027', 'Herbst 2027', 'Winter 2027']);
  const spring = upcomingSeasons(new Date(2026, 9, 18), 5)[1];
  assert.equal(spring.due_date, '2027-03-01');
  assert.equal(spring.period_end, '2027-05-31');
  const q = quickPeriods(new Date(2026, 9, 18));
  assert.equal(q.find((p) => p.preset === 'next_week')?.due_date, '2026-10-19');
  assert.equal(q.find((p) => p.preset === 'next_month')?.due_date, '2026-11-01');
});

console.log(`\n${passed} Tests bestanden.`);
