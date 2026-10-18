// Einstiegspunkt der statischen Vorschau (ohne Next.js-Server): identische App, Demo-Modus.
import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import '../src/ui/styles.css';
createRoot(document.getElementById('root')!).render(<App />);
