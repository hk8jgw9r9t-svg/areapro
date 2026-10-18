import { useState } from 'react';
import { sendMagicLink, signInWithPassword, signUp, startDemo, supabaseConfigured } from '../../data/session';
import { Button, Field } from '../kit';
import { Icon } from '../icons';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'login') await signInWithPassword(email.trim(), password);
      else {
        const r = await signUp(email.trim(), password);
        if (r.needsConfirmation) setMsg({ text: 'Bitte E-Mail-Adresse über den zugesandten Link bestätigen, dann anmelden.', tone: 'ok' });
      }
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: 'err' });
    } finally {
      setBusy(false);
    }
  };
  const magic = async () => {
    if (!email.trim()) return setMsg({ text: 'Bitte E-Mail-Adresse eingeben.', tone: 'err' });
    setBusy(true);
    try {
      await sendMagicLink(email.trim());
      setMsg({ text: 'Anmeldelink wurde per E-Mail gesendet.', tone: 'ok' });
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand brand-lg">
          <span className="brand-mark">
            <Icon name="pinned" size={24} />
          </span>
          <span>
            <span className="brand-name">AreaPro</span>
            <span className="brand-sub">D2D Sales</span>
          </span>
        </div>
        <p className="login-claim">Straße für Straße. Haus für Haus. Kein Potenzial vergessen.</p>

        {supabaseConfigured ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="E-Mail">
              <input className="input" type="email" autoComplete="email" inputMode="email" autoCapitalize="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Passwort">
              <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </Field>
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
            </Button>
            <div className="login-links">
              <button type="button" className="link-btn" onClick={magic}>
                Anmeldelink per E-Mail
              </button>
              <button type="button" className="link-btn" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
                {mode === 'login' ? 'Erstes Konto anlegen' : 'Zur Anmeldung'}
              </button>
            </div>
          </form>
        ) : (
          <div className="stack">
            <div className="info-box">
              <Icon name="alert" size={18} />
              <span>
                Supabase ist noch nicht verbunden. Im <strong>Demo-Modus</strong> funktioniert die App vollständig, speichert aber nur lokal auf diesem Gerät.
              </span>
            </div>
            <Button variant="primary" size="xl" block icon="arrowRight" onClick={() => void startDemo()}>
              Demo starten
            </Button>
          </div>
        )}
        {msg && <div className={msg.tone === 'ok' ? 'hint-ok' : 'error-box'}>{msg.text}</div>}
      </div>
    </div>
  );
}
