import { useEffect, useState } from 'react';
import { store, useStoreVersion } from '../data/store';
import { restoreSession } from '../data/session';
import { followupBuckets } from '../data/selectors';
import { activeTownId, usePrefs } from './prefs';
import { go, href, useRoute } from './router';
import { Toasts, cx } from './kit';
import { Icon, type IconName } from './icons';
import { SyncDot } from './components/StatusBits';
import { LoginScreen } from './screens/Login';
import { DashboardScreen } from './screens/Dashboard';
import { TownsScreen } from './screens/Towns';
import { StreetScreen, StreetsScreen } from './screens/Streets';
import { ImportScreen } from './screens/Import';
import { FollowupsScreen } from './screens/Followups';
import { CalendarScreen } from './screens/Calendar';
import { AppointmentsScreen } from './screens/Appointments';
import { AnalyticsScreen } from './screens/Analytics';
import { SearchScreen } from './screens/Search';
import { SettingsScreen } from './screens/Settings';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  match: string[];
}

const SIDEBAR: NavItem[] = [
  { path: '', label: 'Dashboard', icon: 'dashboard', match: [''] },
  { path: 'orte', label: 'Gebiete', icon: 'map', match: ['orte'] },
  { path: 'adressen', label: 'Adressen', icon: 'signpost', match: ['adressen', 'strasse'] },
  { path: 'wiedervorlagen', label: 'Wiedervorlagen', icon: 'clock', match: ['wiedervorlagen'] },
  { path: 'kalender', label: 'Kalender', icon: 'calendar', match: ['kalender'] },
  { path: 'termine', label: 'Termine', icon: 'calendarCheck', match: ['termine'] },
  { path: 'auswertung', label: 'Auswertung', icon: 'chart', match: ['auswertung'] },
  { path: 'import', label: 'Import', icon: 'upload', match: ['import'] },
  { path: 'suche', label: 'Suche', icon: 'search', match: ['suche'] },
  { path: 'einstellungen', label: 'Einstellungen', icon: 'settings', match: ['einstellungen'] },
];

const BOTTOM: NavItem[] = [
  { path: '', label: 'Home', icon: 'home', match: [''] },
  { path: 'adressen', label: 'Orte', icon: 'signpost', match: ['adressen', 'strasse', 'orte', 'import'] },
  { path: 'wiedervorlagen', label: 'Wiedervorl.', icon: 'clock', match: ['wiedervorlagen', 'kalender'] },
  { path: 'termine', label: 'Termine', icon: 'calendarCheck', match: ['termine'] },
  { path: 'mehr', label: 'Mehr', icon: 'more', match: ['mehr', 'auswertung', 'suche', 'einstellungen'] },
];

export function App() {
  const [booting, setBooting] = useState(true);
  useStoreVersion();
  useEffect(() => {
    void restoreSession().finally(() => setBooting(false));
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai')) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  if (booting)
    return (
      <div className="boot">
        <span className="brand-mark">
          <Icon name="pinned" size={28} />
        </span>
      </div>
    );
  if (!store.user || !store.ready)
    return (
      <>
        <LoginScreen />
        <Toasts />
      </>
    );
  return (
    <>
      <Shell />
      <Toasts />
    </>
  );
}

function Shell() {
  useStoreVersion();
  usePrefs();
  const route = useRoute();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const p0 = route.path[0] ?? '';
  const due = followupBuckets();
  const dueCount = due.overdue.length + due.today.length;
  const town = store.get('towns', activeTownId());
  const isActive = (n: NavItem) => n.match.includes(p0);

  let screen: React.ReactNode;
  switch (p0) {
    case '':
      screen = <DashboardScreen />;
      break;
    case 'orte':
      screen = <TownsScreen />;
      break;
    case 'adressen':
      screen = <StreetsScreen />;
      break;
    case 'strasse':
      screen = <StreetScreen key={route.path[1]} streetId={route.path[1]} />;
      break;
    case 'import':
      screen = <ImportScreen key={route.query.toString()} />;
      break;
    case 'wiedervorlagen':
      screen = <FollowupsScreen />;
      break;
    case 'kalender':
      screen = <CalendarScreen />;
      break;
    case 'termine':
      screen = <AppointmentsScreen />;
      break;
    case 'auswertung':
      screen = <AnalyticsScreen />;
      break;
    case 'suche':
      screen = <SearchScreen />;
      break;
    case 'einstellungen':
      screen = <SettingsScreen />;
      break;
    case 'mehr':
      screen = <MoreScreen />;
      break;
    default:
      screen = <DashboardScreen />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="pinned" size={20} />
          </span>
          <span>
            <span className="brand-name">AreaPro</span>
            <span className="brand-sub">D2D Sales</span>
          </span>
        </div>
        {town && (
          <button className="side-town" onClick={() => go('orte')}>
            <Icon name="pin" size={16} />
            <span className="grow">{town.name}</span>
            <span className="small">wechseln</span>
          </button>
        )}
        <nav>
          {SIDEBAR.map((n) => (
            <a key={n.path} href={href(n.path)} className={cx('side-link', isActive(n) && 'side-active')}>
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
              {n.path === 'wiedervorlagen' && dueCount > 0 && <span className="nav-badge">{dueCount}</span>}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <SyncDot state={online ? store.syncState : store.mode === 'demo' ? 'local' : 'offline'} pending={store.outbox.length} />
          {store.mode === 'demo' && <div className="demo-note">Demo-Modus: Daten nur lokal</div>}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="topbar-town" onClick={() => go('orte')}>
            <Icon name="pin" size={16} />
            {town?.name ?? 'Kein Ort'}
          </button>
          <div className="grow" />
          <SyncDot state={online ? store.syncState : store.mode === 'demo' ? 'local' : 'offline'} pending={store.outbox.length} />
          <button className="icon-btn" onClick={() => go('suche')} aria-label="Suche">
            <Icon name="search" />
          </button>
        </div>
        {!online && store.mode === 'supabase' && (
          <div className="offline-bar">
            <Icon name="offline" size={16} /> Offline – Qualifizierungen werden gespeichert und automatisch nachgesendet.
          </div>
        )}
        {screen}
      </main>

      <nav className="bottom-nav">
        {BOTTOM.map((n) => (
          <a key={n.path} href={href(n.path)} className={cx('bn-item', isActive(n) && 'bn-active')}>
            <span className="bn-icon">
              <Icon name={n.icon} size={22} />
              {n.path === 'wiedervorlagen' && dueCount > 0 && <span className="nav-badge">{dueCount}</span>}
            </span>
            <span className="bn-label">{n.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

function MoreScreen() {
  const items: { path: string; label: string; icon: IconName; sub: string }[] = [
    { path: 'orte', label: 'Gebiete / Ort wechseln', icon: 'map', sub: 'Orte verwalten, aktiven Ort wählen' },
    { path: 'kalender', label: 'Kalender', icon: 'calendar', sub: 'Wiedervorlagen & Termine' },
    { path: 'auswertung', label: 'Auswertung', icon: 'chart', sub: 'Kennzahlen, Filter, Export' },
    { path: 'suche', label: 'Suche', icon: 'search', sub: 'Straße, Name, Telefon, Notiz' },
    { path: 'import', label: 'Import', icon: 'upload', sub: 'OpenStreetMap, CSV/Excel, manuell' },
    { path: 'einstellungen', label: 'Einstellungen', icon: 'settings', sub: 'Integrationen, Export, Konto' },
  ];
  return (
    <div className="page">
      <h1 className="page-title-plain">Mehr</h1>
      <div className="more-list">
        {items.map((i) => (
          <a key={i.path} className="more-item" href={href(i.path)}>
            <span className="more-icon">
              <Icon name={i.icon} size={22} />
            </span>
            <span className="grow">
              <span className="strong">{i.label}</span>
              <span className="muted small">{i.sub}</span>
            </span>
            <Icon name="chevronRight" />
          </a>
        ))}
      </div>
    </div>
  );
}
