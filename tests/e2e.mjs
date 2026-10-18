// End-to-End-Test des V1-Workflows (iPhone-Größe + Desktop) gegen die statische Vorschau.
// Start: node scripts/build-preview.mjs && npx http-server preview/dist -p 4173 & node tests/e2e.mjs
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.env.URL ?? 'http://localhost:4173/';
const shots = process.env.SHOTS ?? 'tests/shots';
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    console.log('✗', name, '\n ', e.message.split('\n')[0]);
    await page.screenshot({ path: `${shots}/FAIL.png` });
    await browser.close();
    process.exit(1);
  }
};
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png` });

await page.goto(URL);
await step('1/2 App öffnen & einloggen (Demo)', async () => {
  await page.getByRole('button', { name: 'Demo starten' }).click();
  await page.getByText('Starte mit deinem ersten Ort').waitFor();
});
await step('Beispieldaten laden', async () => {
  await page.goto(URL + '#/einstellungen');
  await page.getByRole('button', { name: 'Beispieldaten laden' }).click();
  await page.locator('.street-row', { hasText: 'Goethestraße' }).waitFor();
});
await shot('01-strassen');
await step('6 Straße suchen', async () => {
  await page.getByPlaceholder(/Straße suchen/).fill('Goe');
  await page.waitForTimeout(100);
  if ((await page.locator('.street-row').count()) !== 1) throw new Error('Filter');
});
await step('7 Hausnummern sehen', async () => {
  await page.locator('.street-row').first().click();
  await page.locator('.tile').first().waitFor();
});
await shot('02-hausnummern');
await step('8 Adresse 12 öffnen', async () => {
  await page.getByRole('button', { name: /Goethestraße 12:/ }).click();
  await page.locator('.addr-title', { hasText: 'Goethestraße 12' }).waitFor();
});
await shot('03-adresse');
await step('9 Nicht angetroffen (sofort gespeichert)', async () => {
  await page.locator('.quick', { hasText: 'Nicht angetroffen' }).click();
  await page.locator('.addr-statusline').getByText('Nicht angetroffen').waitFor();
});
await step('14 Nächste gleiche Seite → 14', async () => {
  await page.locator('.next-cta').click();
  await page.locator('.addr-title', { hasText: /^Goethestraße 14$/ }).waitFor();
});
await step('10/12 Wiedervorlage hoch + Tag + Frühling + Notiz', async () => {
  await page.locator('.quick', { hasText: 'Wiedervorlage' }).click();
  await page.locator('.prio-btn', { hasText: 'Hoch' }).click();
  await page.locator('.panel-followup .chip', { hasText: 'Frühling 2027' }).click();
  await page.locator('.panel-followup .chip', { hasText: 'alte Fenster' }).click();
  await page.locator('.panel-followup textarea').fill('Fenster offensichtlich älter. Eigentümer heute nicht gesprochen.');
  await shot('04-wiedervorlage');
  await page.locator('.panel-followup').getByRole('button', { name: 'Speichern' }).click();
  await page.locator('.card-fu').getByText(/01\.03\.2027/).waitFor();
});
await step('11 Notiz speichern (Verlauf bleibt)', async () => {
  await page.locator('.addr-section textarea').fill('Zweite Notiz');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  await page.locator('.timeline .tl-quote', { hasText: 'Zweite Notiz' }).waitFor();
  await page.locator('.timeline .tl-quote', { hasText: 'Fenster offensichtlich' }).waitFor();
});
await step('Nächste → 14/1 → 16', async () => {
  await page.locator('.walk-next').click();
  await page.locator('.addr-title', { hasText: 'Goethestraße 14/1' }).waitFor();
  await page.locator('.walk-next').click();
  await page.locator('.addr-title', { hasText: 'Goethestraße 16' }).waitFor();
});
await step('15/16/17 Terminmaske + Demo-Buchung + Termin in Adresse', async () => {
  await page.locator('.quick', { hasText: 'Termin' }).click();
  await page.getByPlaceholder('Vor- und Nachname').fill('Max Mustermann');
  await page.getByPlaceholder('0151 …').fill('0151 2345678');
  const addr = await page.locator('.field', { hasText: 'Adresse' }).locator('input').inputValue();
  if (!addr.includes('Goethestraße 16')) throw new Error('Adresse nicht vorausgefüllt: ' + addr);
  await page.locator('.span-2', { hasText: 'Hauptprodukt' }).locator('.chip', { hasText: 'Kunststofffenster' }).click();
  await page.locator('.span-2', { hasText: 'Weitere Produkte' }).locator('.chip', { hasText: 'Haustüren' }).click();
  await page.locator('.form-grid textarea').fill('Bitte beide Eigentümer beim Termin.');
  await shot('05-terminmaske');
  await page.getByRole('button', { name: 'Weiter: Termin wählen' }).click();
  await page.locator('.slot-btn').first().click();
  await shot('06-slots');
  await page.getByRole('button', { name: /^Buchen/ }).click();
  await page.locator('.done-title').waitFor();
  await page.locator('.done-box').getByRole('button', { name: 'Schließen' }).click();
  await page.locator('.addr-statusline').getByText('Termin vereinbart').waitFor();
  await page.locator('.card-appt', { hasText: 'Max Mustermann' }).waitFor();
  await page.locator('.timeline', { hasText: 'Kunststofffenster' }).waitFor();
});
await shot('07-adresse-termin');
await step('18 Adresse ausschließen + wiederherstellen', async () => {
  await page.locator('.walk-next').click();
  await page.locator('.addr-title', { hasText: 'Goethestraße 18' }).waitFor();
  await page.locator('.quick', { hasText: 'Mehr' }).click();
  await page.locator('.quick', { hasText: 'Kein Potenzial' }).click();
  await page.locator('.chip', { hasText: 'Abrissgebäude' }).click();
  await page.getByText(/Aus Potenzial ausgeschlossen: Abrissgebäude/).waitFor();
  await page.getByRole('button', { name: 'Wiederherstellen' }).click();
  await page.locator('.addr-statusline').getByText('Unbearbeitet').waitFor();
});
await step('Andere Straßenseite', async () => {
  await page.locator('.walk-mid').click();
  await page.locator('.addr-title', { hasText: /Goethestraße (17|19)$/ }).waitFor();
});
await page.keyboard.press('Escape');
await step('19 fehlende Hausnummern ergänzen (6, 13)', async () => {
  await page.getByRole('button', { name: 'Nr.' }).click();
  await page.getByPlaceholder(/1-6/).fill('6, 13');
  await page.getByRole('button', { name: /2 Hausnummer\(n\) hinzufügen/ }).click();
  await page.getByRole('button', { name: /Goethestraße 6:/ }).waitFor();
});
await step('Filter Gerade/Alle', async () => {
  await page.getByRole('tab', { name: 'Gerade', exact: true }).click();
  const t = await page.locator('.tile-num').allTextContents();
  if (t.some((x) => parseInt(x) % 2)) throw new Error(t.join());
  await page.getByRole('tab', { name: 'Alle', exact: true }).click();
});
await step('Neue Straße mit Mehrfachanlage', async () => {
  await page.goto(URL + '#/adressen');
  await page.getByRole('button', { name: 'Straße', exact: true }).click();
  await page.getByPlaceholder('z. B. Am Sonnenhang').fill('Am Sonnenhang');
  await page.getByPlaceholder(/1-6/).fill('1-6');
  await page.getByRole('button', { name: /mit 6 Hausnummern anlegen/ }).click();
  await page.getByRole('button', { name: /Am Sonnenhang 6:/ }).waitFor();
});
await step('13 fällige Wiedervorlagen', async () => {
  await page.goto(URL + '#/wiedervorlagen');
  await page.locator('.fu-card').first().waitFor();
});
await shot('08-wiedervorlagen');
await step('Kalender', async () => {
  await page.goto(URL + '#/kalender');
  await page.locator('.cal-cell').first().waitFor();
});
await shot('08b-kalender');
await step('Termine', async () => {
  await page.goto(URL + '#/termine');
  await page.locator('.appt-card', { hasText: 'Max Mustermann' }).first().waitFor();
});
await step('Globale Suche (Name, Telefon, Adresse)', async () => {
  await page.goto(URL + '#/suche');
  const s = page.getByPlaceholder(/Goethe 12/);
  await s.fill('Mustermann');
  await page.locator('.result-row', { hasText: 'Max Mustermann' }).first().waitFor();
  await s.fill('2345678');
  await page.locator('.result-row', { hasText: '0151 2345678' }).waitFor();
  await s.fill('Goethe 14');
  await page.locator('.result-row', { hasText: 'Goethestraße 14' }).first().waitFor();
});
await step('Daten bleiben nach Reload (IndexedDB)', async () => {
  await page.reload();
  await page.goto(URL + '#/adressen');
  await page.locator('.street-row', { hasText: 'Am Sonnenhang' }).waitFor();
});
await page.goto(URL + '#/');
await page.waitForTimeout(200);
await shot('09-home');

// Desktop
const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const dp = await d.newPage();
dp.setDefaultTimeout(8000);
dp.on('pageerror', (e) => errors.push(e.message));
await dp.goto(URL);
await dp.getByRole('button', { name: 'Demo starten' }).click();
await dp.goto(URL + '#/einstellungen');
await dp.getByRole('button', { name: 'Beispieldaten laden' }).click();
await step('Desktop-Dashboard', async () => {
  await dp.goto(URL + '#/');
  await dp.getByText('Planung morgen').waitFor();
  await dp.screenshot({ path: `${shots}/10-desktop-dashboard.png`, fullPage: true });
});
await step('20 Auswertung am Desktop', async () => {
  await dp.goto(URL + '#/auswertung');
  await dp.getByText('Potenziale pro Straße').waitFor();
  await dp.screenshot({ path: `${shots}/11-desktop-auswertung.png`, fullPage: true });
});
await step('Desktop Straße + Seitenpanel', async () => {
  await dp.goto(URL + '#/adressen');
  await dp.locator('.street-row', { hasText: 'Hauptstraße' }).click();
  await dp.getByRole('button', { name: /Hauptstraße 4:/ }).click();
  await dp.locator('.card-appt').waitFor();
  await dp.screenshot({ path: `${shots}/12-desktop-strasse.png` });
});

await browser.close();
if (errors.length) {
  console.error('Konsolenfehler:', errors);
  process.exit(1);
}
console.log('\nAlle Schritte erfolgreich.');
