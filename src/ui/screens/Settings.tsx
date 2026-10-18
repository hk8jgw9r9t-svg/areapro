import { useEffect, useState } from 'react';
import { store, useStoreVersion } from '../../data/store';
import { getSupabase, signOut, supabaseConfigured } from '../../data/session';
import { seedDemoData } from '../../data/seed';
import { exportToGoogleSheets, getServerConfig, setupCalendlyWebhook, type ServerConfig } from '../../integrations/api';
import { buildExportRows, downloadFile, toCsv } from '../../lib/export';
import { formatDateTime, toDateKey } from '../../lib/dates';
import { setPrefs, usePrefs } from '../prefs';
import { go } from '../router';
import { Button, PageHeader, cx, toast } from '../kit';
import { Icon } from '../icons';
import { SyncDot } from '../components/StatusBits';

export function SettingsScreen() {
  useStoreVersion();
  const prefs = usePrefs();
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [personal, setPersonal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [icalUrl, setIcalUrl] = useState<string | null>(null);

  useEffect(() => {
    void getServerConfig(true).then(setCfg);
  }, []);

  const csv = () => {
    const rows = buildExportRows(store.all('addresses'), personal);
    downloadFile(`areapro-export-${toDateKey(new Date())}.csv`, toCsv(rows));
  };
  const sheets = async () => {
    setBusy('sheets');
    try {
      const r = await exportToGoogleSheets(buildExportRows(store.all('addresses'), personal), 'AreaPro Export');
      toast(`${r.updatedRows} Zeilen nach Google Sheets exportiert`, { action: r.url ? { label: 'Öffnen', run: () => window.open(r.url, '_blank') } : undefined });
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };
  const webhook = async () => {
    setBusy('webhook');
    try {
      const r = await setupCalendlyWebhook();
      toast(r.message);
      setCfg(await getServerConfig(true));
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };
  const ical = async () => {
    const sb = await getSupabase();
    if (!sb || !store.user) return toast('Kalender-Abo benötigt Supabase-Anmeldung', { tone: 'warn' });
    setBusy('ical');
    try {
      let { data } = await sb.from('external_integrations').select('feed_token').eq('provider', 'ical').eq('owner_user_id', store.user.id).maybeSingle();
      if (!data) {
        const ins = await sb.from('external_integrations').insert({ provider: 'ical', status: 'active', owner_user_id: store.user.id, team_id: store.user.team_id }).select('feed_token').single();
        if (ins.error) throw new Error(ins.error.message);
        data = ins.data;
      }
      setIcalUrl(`${location.origin}/api/ical?token=${data!.feed_token}`);
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };
  const backup = () => downloadFile(`areapro-backup-${toDateKey(new Date())}.json`, JSON.stringify(store.exportSnapshot()), 'application/json');
  const restore = async (f: File) => {
    try {
      store.importSnapshot(JSON.parse(await f.text()));
      toast('Backup eingespielt (nur fehlende Datensätze ergänzt)');
    } catch {
      toast('Backup-Datei ungültig', { tone: 'warn' });
    }
  };

  const cal = cfg?.calendly;
  return (
    <div className="page">
      <PageHeader title="Einstellungen" />

      <section className="card settings-card">
        <div className="card-title">
          <Icon name="users" size={16} /> Konto & Synchronisation
        </div>
        <div className="kv">
          <span>Benutzer</span>
          <span>{store.user?.email ?? store.user?.display_name}</span>
        </div>
        <div className="kv">
          <span>Modus</span>
          <span>{store.mode === 'demo' ? 'Demo – Daten nur auf diesem Gerät' : 'Supabase (Cloud, verschlüsselt per HTTPS)'}</span>
        </div>
        <div className="kv">
          <span>Status</span>
          <SyncDot state={store.syncState} pending={store.outbox.length} />
        </div>
        {store.lastSyncAt && (
          <div className="kv">
            <span>Letzter Abgleich</span>
            <span>{formatDateTime(store.lastSyncAt)}</span>
          </div>
        )}
        {store.failed.length > 0 && (
          <div className="warn-box">
            <Icon name="alert" size={18} />
            <span>{store.failed.length} Änderung(en) wurden vom Server abgelehnt und lokal aufbewahrt: {store.failed[0].error}</span>
            <Button size="sm" onClick={() => void store.retryFailed()}>
              Erneut senden
            </Button>
          </div>
        )}
        <div className="card-actions">
          {store.mode === 'supabase' && (
            <Button icon="refresh" onClick={() => void store.sync()}>
              Jetzt synchronisieren
            </Button>
          )}
          <Button icon="logout" variant="ghost" onClick={() => void signOut()}>
            Abmelden
          </Button>
        </div>
      </section>

      <section className="card settings-card">
        <div className="card-title">
          <Icon name="signpost" size={16} /> Arbeiten vor Ort
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={prefs.autoNext} onChange={(e) => setPrefs({ autoNext: e.target.checked })} />
          <span>Nach „Nicht angetroffen“ automatisch zur nächsten Adresse derselben Straßenseite</span>
        </label>
      </section>

      <section className="card settings-card">
        <div className="card-title">
          <Icon name="plug" size={16} /> Integrationen
        </div>
        <div className="integration">
          <div className="int-head">
            <strong>Calendly</strong>
            <span className={cx('int-state', cal?.configured ? 'int-on' : 'int-off')}>{cal?.configured ? 'Verbunden' : 'Nicht verbunden'}</span>
          </div>
          <div className="small muted">
            {cal?.configured
              ? `Buchungsart: ${{ api: 'Direktbuchung (Scheduling API)', embed: 'Eingebettete Buchung', link: 'Einmal-Link', mock: '–' }[cal.mode]} · Ereignistyp: ${cal.eventTypeName ?? '–'} · Webhook: ${{ active: 'aktiv', missing: 'fehlt', unknown: 'unbekannt' }[cal.webhook]}`
              : 'Demo-Buchung aktiv. Zum Verbinden CALENDLY_PAT u. a. in Vercel hinterlegen (siehe README).'}
          </div>
          {cal?.configured && cal.webhook !== 'active' && (
            <Button size="sm" icon="link" onClick={webhook} disabled={busy === 'webhook'}>
              Webhook registrieren
            </Button>
          )}
        </div>
        <div className="integration">
          <div className="int-head">
            <strong>Google Sheets</strong>
            <span className={cx('int-state', cfg?.google.configured ? 'int-on' : 'int-off')}>{cfg?.google.configured ? 'Verbunden' : 'Nicht verbunden'}</span>
          </div>
          <div className="small muted">Nur Export/Reporting – die Datenbank bleibt Supabase.</div>
        </div>
        <div className="integration">
          <div className="int-head">
            <strong>Kalender-Abo (Wiedervorlagen)</strong>
            <span className="int-state">{supabaseConfigured ? 'verfügbar' : 'mit Supabase'}</span>
          </div>
          <div className="small muted">Abonnierbarer iCal-Link für iPhone-, Mac- oder Google-Kalender. Termine kommen weiterhin direkt aus Calendly.</div>
          <Button size="sm" icon="calendar" onClick={ical} disabled={!supabaseConfigured || busy === 'ical'}>
            Abo-Link erzeugen
          </Button>
          {icalUrl && (
            <div className="copy-row">
              <code>{icalUrl}</code>
              <Button size="sm" icon="copy" onClick={() => (navigator.clipboard?.writeText(icalUrl), toast('Link kopiert'))} />
              <a className="btn btn-ghost btn-sm" href={icalUrl.replace(/^https?:/, 'webcal:')}>
                <Icon name="external" size={16} />
                <span>Abonnieren</span>
              </a>
            </div>
          )}
        </div>
      </section>

      <section className="card settings-card">
        <div className="card-title">
          <Icon name="sheet" size={16} /> Export
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
          <span>Persönliche Kundendaten (Name, Telefon, Notiz) einschließen – nur bewusst und datenschutzkonform</span>
        </label>
        <div className="card-actions">
          <Button icon="download" onClick={csv}>
            CSV (Excel)
          </Button>
          <Button icon="sheet" onClick={sheets} disabled={!cfg?.google.configured || busy === 'sheets'}>
            {busy === 'sheets' ? 'Exportiere …' : 'Nach Google Sheets exportieren'}
          </Button>
        </div>
      </section>

      <section className="card settings-card">
        <div className="card-title">
          <Icon name="cloud" size={16} /> Daten
        </div>
        <div className="small muted">Lokale Sicherung aller Daten als JSON. Einspielen ergänzt nur fehlende Datensätze und überschreibt nichts.</div>
        <div className="card-actions">
          <Button icon="download" onClick={backup}>
            Backup herunterladen
          </Button>
          <label className="btn btn-default btn-md">
            <Icon name="upload" size={20} />
            <span>Backup einspielen</span>
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
          </label>
          <Button
            icon="plus"
            variant="ghost"
            onClick={() => {
              const id = seedDemoData();
              setPrefs({ activeTownId: id });
              toast('Beispieldaten Kürnbach geladen');
              go('adressen');
            }}
          >
            Beispieldaten laden
          </Button>
        </div>
      </section>

      <section className="card settings-card">
        <div className="card-title">
          <Icon name="home" size={16} /> Als App installieren
        </div>
        <div className="small">
          iPhone/iPad: In Safari <strong>Teilen → „Zum Home-Bildschirm“</strong>. Mac: Safari → Ablage → „Zum Dock hinzufügen“ bzw. Chrome → „App installieren“.
        </div>
      </section>
    </div>
  );
}
