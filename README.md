# AreaPro – D2D Sales

Persönliches Door-to-Door-Vertriebs- und Adressqualifizierungssystem für Bauelemente (HEIM & HAUS Produktpalette).
Mobile-first Progressive Web App für iPhone/iPad (Arbeit vor der Haustür) und Mac (Planung, Auswertung).

```
Ort wählen → Straße wählen → Hausnummer antippen → in Sekunden qualifizieren → nächste Adresse
```

---

## Technische Entscheidungen

| Bereich | Entscheidung | Warum |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, eigenes CSS-Designsystem | wartbar, Vercel-nativ, keine fragile UI-Bibliothek |
| Datenhaltung | Supabase / PostgreSQL mit Row Level Security | professionelle DB, Mehrbenutzer, Auth inklusive |
| Architektur | **Local-first**: Daten in IndexedDB, Änderungen als idempotente Ops in einer Outbox | funktioniert bei schlechtem Empfang, nichts geht verloren |
| Konfliktregel | Verlauf & Notizen append-only (DB-Trigger), aktueller Status: neuester Zeitstempel gewinnt | „Datenverlust ist schlimmer als ein fehlendes Feature“ |
| Löschen | Für Clients unmöglich (keine DELETE-Policies). Ausschluss/Tags/Archiv per Flag | Nachvollziehbarkeit, Wiederherstellung |
| Routing | Hash-Router im Client | identisch online, offline und als installierte App |
| Import | OSM Nominatim + Overpass (Verwaltungsgrenze), CSV, Excel (.xlsx), manuell | drei Importwege, erweiterbar um amtliche Quellen |
| Integrationen | Next.js API-Routen, Geheimnisse nur in Server-Umgebungsvariablen | keine API-Schlüssel im Frontend |
| Kalender | interne Monatsansicht + iCal-Abo für Wiedervorlagen | Termine bleiben in Calendly (keine zweite Terminlogik) |

## Projektstruktur

```
app/                    Next.js: Hülle + API-Routen
  api/calendly/*        availability · book (Scheduling API) · confirm (Embed) · link · setup · webhook
  api/google/sheets     Export nach Google Sheets (Dienstkonto)
  api/ical              Kalender-Abo der Wiedervorlagen
  api/config            meldet dem Client nur, WAS konfiguriert ist (keine Geheimnisse)
server/                 serverseitige Services (Calendly, Google, Webhook-Spiegel)
src/lib/                Fachlogik: Hausnummern & Straßenseite, Zeiträume, Kennzahlen, Export
src/data/               Local-first Store, Outbox/Sync, Aktionen, Supabase-Remote, Seed
src/import/             OSM, CSV/XLSX, Importpipeline (Vorschau, Dubletten, Aktualisierung)
src/ui/                 Oberfläche (Screens, Adress-Sheet, Terminmaske, Designsystem)
supabase/migrations/    vollständiges Schema inkl. RLS, Trigger, Produkte & Potenzial-Tags
tests/                  Logiktests + End-to-End-Test des V1-Workflows (Playwright)
preview/                statische Vorschau (Demo-Modus) ohne Server
```

### Datenmodell (Auszug)

`users · teams · team_members · territory_assignments · towns · streets · addresses · address_status_history · notes · potential_tags · address_potential_tags · products · address_products · followups · appointments · imports · external_integrations · webhook_events`

Jede Datenzeile trägt `owner_user_id`, `team_id`, `created_by`, `updated_by`; Adressen/Wiedervorlagen/Termine zusätzlich `assigned_user_id`. Bei Registrierung entsteht automatisch ein persönliches Team → spätere Teammitglieder sehen per RLS die Teamdaten, ohne Datenmigration.

### Straßenseitenlogik

`getNextSameSideAddress()` in `src/lib/housenumber.ts`: sortiert natürlich (`12, 12a, 12b, 14, 14/1`), springt nur auf **existierende** Nummern gleicher Parität, überspringt ausgeschlossene Adressen, unterstützt Laufrichtung auf/ab und „andere Straßenseite“ (dreht die Laufrichtung automatisch). Tests: `npm test`.

---

## Inbetriebnahme (ca. 20 Minuten)

### 1. Supabase
1. Projekt auf supabase.com anlegen (Region Frankfurt `eu-central-1`).
2. **SQL Editor** → Inhalt von `supabase/migrations/20261018000000_init.sql` ausführen.
3. **Authentication → Providers → Email** aktiv lassen. Nach dem eigenen Konto unter **Authentication → Sign In / Providers** „Allow new users to sign up“ deaktivieren (nur eingeladene Mitarbeiter).
4. **Authentication → URL Configuration**: Site URL = Ihre Vercel-Adresse.
5. **Project Settings → API**: URL, `anon`-Key und `service_role`-Key kopieren.

### 2. Vercel
1. Projektordner in ein GitHub-Repository legen, in Vercel importieren (Framework: Next.js).
2. Umgebungsvariablen aus `.env.example` eintragen, deployen.
3. App öffnen → „Erstes Konto anlegen“ → anmelden → Einstellungen → „Beispieldaten laden“ (optional) oder **Ort hinzufügen**.

### 3. Calendly
1. Ereignistyp **„Beratungstermin HEIM & HAUS“**, 90 Minuten, Verfügbarkeit Mo–Fr (ggf. Sa).
2. Zusatzfragen in dieser Reihenfolge (für die Vorausfüllung): **1 Telefon, 2 Adresse, 3 Produkte, 4 Hinweis**.
3. Calendly → Integrations → **API & Webhooks** → Personal Access Token erzeugen → `CALENDLY_PAT`.
4. `CALENDLY_WEBHOOK_SIGNING_KEY` = langer Zufallswert, neu deployen.
5. In der App: Einstellungen → Integrationen → **Webhook registrieren**.
6. Calendly mit dem iPhone-/Mac-Kalender verbinden (Calendly → Kalenderverbindungen) – die App erfindet keine zweite Terminlogik.

Buchungsablauf (automatisch gewählt): **Direktbuchung** über die Scheduling API (kostenpflichtiger Tarif) → bei fehlender Berechtigung automatisch **eingebettete Calendly-Buchung** → per `CALENDLY_BOOKING_MODE=link` **Einmal-Link**. Stornieren, Verschieben und direkt in Calendly erstellte Termine kommen per Webhook in die App – ohne Dubletten (Zuordnung über Termin-ID in `utm_content`).

### 4. Google Sheets (optional, nur Export)
1. Google Cloud → Projekt → **Google Sheets API** aktivieren → **Dienstkonto** anlegen → JSON-Schlüssel.
2. Ziel-Tabelle anlegen und mit der Dienstkonto-E-Mail als **Bearbeiter** teilen.
3. `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEETS_SPREADSHEET_ID` setzen.
Kundendaten (Name, Telefon, Notiz) werden nur exportiert, wenn der Schalter bewusst aktiviert ist.

### iPhone/iPad als App
Safari → Teilen → **Zum Home-Bildschirm**. Die Sprachdiktierfunktion der iOS-Tastatur funktioniert in allen Notizfeldern.

---

## Offline-Verhalten
- Alle Daten (aktiver Ort und alle weiteren) liegen lokal in IndexedDB; die App-Hülle cached der Service Worker.
- Qualifizierungen ohne Netz werden sofort lokal gespeichert, in der Outbox gesichert und bei Verbindung automatisch übertragen (Statusanzeige oben rechts).
- Vom Server abgelehnte Änderungen werden **nicht verworfen**, sondern in Einstellungen angezeigt („Erneut senden“).
- Zusätzlich: JSON-Backup herunterladen/einspielen (ergänzt nur fehlende Datensätze).
- Ortssuche/OSM-Import und Calendly-Buchung benötigen Netz.

## Entwicklung
```bash
npm install
cp .env.example .env.local   # ohne Supabase-Werte: Demo-Modus
npm run dev                  # http://localhost:3000
npm test                     # Logiktests (Hausnummern, Straßenseite, Zeiträume)
npm run preview:build && npx http-server preview/dist -p 4173 & npm run e2e   # End-to-End-Workflow
```

## Vorbereitet für spätere Versionen
- **Team**: Rollen (`admin`, `team_lead`, `sales`), `team_members`, `territory_assignments`, `assigned_user_id`, Filter „Bearbeiter“ in der Auswertung.
- **Weitere Importquellen** (amtliche Adressdaten): neue Quelle liefert `RawAddress[]` an `buildImportPlan()`.
- **Kartenansicht / naheliegende Straßen**: `source_ref` speichert OSM-Objekt-IDs; Koordinaten können ergänzt werden, ohne das Schema zu brechen.
- **Kalender-Sync der Wiedervorlagen**: iCal-Feed ist bereits umgesetzt (Google/Apple abonnierbar).


