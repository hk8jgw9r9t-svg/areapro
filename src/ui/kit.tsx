// UI-Bausteine: große Touch-Flächen (min. 48 px), wenig Text, keine kleinen Dropdowns.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Button({
  children,
  onClick,
  variant = 'default',
  icon,
  size = 'md',
  disabled,
  type = 'button',
  className,
  style,
  title,
  block,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'success' | 'subtle';
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  block?: boolean;
}) {
  return (
    <button type={type} title={title} className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', className)} onClick={onClick} disabled={disabled} style={style}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : size === 'xl' ? 24 : 20} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Chip({ active, onClick, children, color, icon }: { active?: boolean; onClick?: () => void; children: ReactNode; color?: string; icon?: IconName }) {
  return (
    <button type="button" className={cx('chip', active && 'chip-active')} onClick={onClick} aria-pressed={!!active} style={active && color ? { background: color, borderColor: color, color: '#fff' } : undefined}>
      {icon && <Icon name={icon} size={16} />}
      {children}
      {active && !icon && <Icon name="check" size={14} />}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' }) {
  return (
    <div className={cx('seg', size === 'sm' && 'seg-sm')} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={cx('seg-item', o.value === value && 'seg-active')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Bottom Sheet (Mobil) / Seitenpanel (Desktop). */
export function Sheet({ open, onClose, children, title, wide, labelledBy }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean; labelledBy?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-root" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={cx('sheet', wide && 'sheet-wide')}>
        <div className="sheet-grip" aria-hidden />
        {title && (
          <div className="sheet-head">
            <div className="sheet-title">{title}</div>
            <button className="icon-btn" onClick={onClose} aria-label="Schließen">
              <Icon name="x" />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon = 'map', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, onClick, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void; icon?: IconName }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={cx('stat', onClick && 'stat-click')} onClick={onClick} style={tone ? ({ '--tone': tone } as React.CSSProperties) : undefined}>
      <div className="stat-label">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Tag>
  );
}

export function SearchInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="search">
      <Icon name="search" size={20} />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {value && (
        <button className="icon-btn" aria-label="Suche leeren" onClick={() => (onChange(''), ref.current?.focus())}>
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  );
}

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: ReactNode; required?: boolean }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="req"> *</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Großes Notizfeld – kompatibel mit iOS-Diktierfunktion (Mikrofon in der Tastatur). */
export function NoteArea({ value, onChange, placeholder = 'Notiz … (Diktat über Mikrofon der Tastatur)', rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea className="note-area" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} autoCapitalize="sentences" />;
}

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------
type ToastItem = { id: number; text: string; action?: { label: string; run: () => void }; tone?: 'ok' | 'warn' };
let pushToast: (t: Omit<ToastItem, 'id'>) => void = () => {};
export function toast(text: string, opts: Omit<ToastItem, 'id' | 'text'> = {}) {
  pushToast({ text, ...opts });
}
export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let n = 0;
    pushToast = (t) => {
      const id = ++n;
      // immer nur ein Hinweis gleichzeitig – verdeckt vor der Haustür nichts Wichtiges
      setItems([{ ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.action ? 3500 : 1800);
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cx('toast', t.tone === 'warn' && 'toast-warn')}>
          <Icon name={t.tone === 'warn' ? 'alert' : 'check'} size={18} />
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                setItems((x) => x.filter((i) => i.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span className="badge" style={tone ? { background: tone, color: '#fff' } : undefined}>
      {children}
    </span>
  );
}

export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: () => void }) {
  return (
    <header className="page-head">
      {back && (
        <button className="icon-btn back-btn" onClick={back} aria-label="Zurück">
          <Icon name="chevronLeft" size={24} />
        </button>
      )}
      <div className="page-head-text">
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
