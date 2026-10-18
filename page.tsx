'use client';
// Die App ist local-first und läuft vollständig im Browser (Offline-Cache, Outbox).
// Next.js liefert die Hülle + sichere API-Routen für Integrationen.
import dynamic from 'next/dynamic';

const App = dynamic(() => import('../src/ui/App').then((m) => m.App), { ssr: false });

export default function Page() {
  return <App />;
}
