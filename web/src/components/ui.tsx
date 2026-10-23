import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleAlert, TriangleAlert, Info as InfoIcon, X } from 'lucide-react';
import type { ApiError } from '../api.ts';
import { m, t, T } from '../i18n.ts';
import { useSession } from '../state.tsx';
import { Art, type ArtName } from './illustrations.tsx';

export function Money({ minor, currency, sign, className }: { minor: number | null | undefined; currency?: string; sign?: 'auto' | 'always' | 'exceptZero'; className?: string }) {
  const { fmt } = useSession();
  const cls = minor !== null && minor !== undefined && minor > 0 && sign === 'always' ? 'pos' : '';
  return <span className={`money ${cls} ${className ?? ''}`}>{withCents(fmt.money(minor, currency, sign))}</span>;
}

/** Shows the cents a little smaller than the whole amount, as banking apps do ("1,587.93 €" in any locale). */
function withCents(text: string) {
  const x = /^(.*\d)([.,]\d{2})(\D*)$/.exec(text);
  return x ? <>{x[1]}<span className="cents">{x[2]}</span>{x[3]}</> : text;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Money that counts up from zero when it first appears (skipped for reduced motion and hidden amounts). */
export function CountUp({ minor, currency, sign }: { minor: number; currency?: string; sign?: 'auto' | 'always' | 'exceptZero' }) {
  const { fmt } = useSession();
  const [shown, setShown] = useState(() => (reducedMotion() ? minor : 0));
  useEffect(() => {
    if (reducedMotion()) { setShown(minor); return; }
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setShown(Math.round(minor * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [minor]);
  return (
    <span className="money">
      <span aria-hidden="true">{withCents(fmt.money(shown, currency, sign))}</span>
      <span className="sr-only">{fmt.money(minor, currency, sign)}</span>
    </span>
  );
}

export function Card({ title, actions, children, className, id, icon }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; icon?: ReactNode }) {
  const hid = useId();
  return (
    <section className={`card ${className ?? ''}`} aria-labelledby={title ? hid : undefined} id={id}>
      {(title || actions) && <div className="card-head">{title && <h2 id={hid}>{icon && <span className="card-icon" aria-hidden="true">{icon}</span>}{title}</h2>}{actions && <div className="card-actions">{actions}</div>}</div>}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, info }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; info?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}{info && <Info label={t('About {page}', { page: typeof title === 'string' ? title : t('this page') })}>{info}</Info>}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Grey placeholder shapes while data loads. */
export function Loading({ label = m.common.loading, rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="skeleton-wrap" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${92 - i * 14}%` }} />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <TriangleAlert size={18} aria-hidden="true" /> <span>{error.message}</span>
      {onRetry && <button className="btn btn-small" onClick={onRetry}>{m.common.retry}</button>}
    </div>
  );
}

export function Empty({ title, children, art, action }: { title: string; children?: ReactNode; art?: ArtName; action?: ReactNode }) {
  const A = art ? Art[art] : null;
  return <div className="empty">{A && <A />}<p className="empty-title">{title}</p>{children && <div className="empty-text">{children}</div>}{action}</div>;
}

export function Badge({ tone, icon, children }: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted'; icon?: ReactNode; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{icon && <span aria-hidden="true" className="badge-icon">{icon}</span>}{children}</span>;
}

export function Help({ children }: { children: ReactNode }) {
  return <p className="help">{children}</p>;
}

/** Small ⓘ button that reveals an explanation, keeping screens uncluttered. */
export function Info({ children, label }: { children: ReactNode; label?: string }) {
  label ??= t('More information');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <span className="info" ref={ref}>
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><InfoIcon size={16} aria-hidden="true" /></button>
      {open && <span id={id} role="note" className="info-pop">{children}</span>}
    </span>
  );
}

/** Native <dialog>: focus trap, Esc to close and inert background come from the browser. `side` slides in from the right. */
// The native close event arrives a moment after close(); if the dialog was reopened meanwhile it is stale and ignored.
export function Modal({ open, title, onClose, children, footer, wide, side }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; side?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const hid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); d.querySelector<HTMLElement>("[data-autofocus]")?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''} ${side ? 'modal-side' : ''}`} aria-labelledby={hid} onClose={(e) => { if (!e.currentTarget.open) onClose(); }} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {open && (
        <div className="modal-inner">
          <div className="modal-head"><h2 id={hid}>{title}</h2><button className="icon-btn" aria-label={m.common.close} onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for consequential actions. With `typeToConfirm`, the user must type the phrase. */
export function Confirm({ open, title, text, confirmLabel, danger, typeToConfirm, busy, onConfirm, onClose }: {
  open: boolean; title: string; text: ReactNode; confirmLabel: string; danger?: boolean; typeToConfirm?: string; busy?: boolean; onConfirm: (typed: string) => void; onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const id = useId();
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const ok = !typeToConfirm || typed === typeToConfirm;
  return (
    <Modal open={open} title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{m.common.cancel}</button>
      <button className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={!ok || busy} onClick={() => onConfirm(typed)}>{busy ? m.common.loading : confirmLabel}</button>
    </>}>
      <div>{text}</div>
      {typeToConfirm && (
        <div className="field">
          <label htmlFor={id}><T s="Type {phrase} to confirm" phrase={<strong>{typeToConfirm}</strong>} /></label>
          <input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
    </Modal>
  );
}

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode; id?: string }) {
  const gen = useId();
  const fid = id ?? gen;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      {children(fid, hint ? `${fid}-hint` : undefined)}
      {hint && <small id={`${fid}-hint`} className="hint">{hint}</small>}
    </div>
  );
}

export function Progress({ pct, state, label }: { pct: number; state: 'ok' | 'warning' | 'over'; label: string }) {
  return (
    <div className={`progress progress-${state}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(pct, 100)} aria-label={label}>
      <div className="progress-bar" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

/** Circular progress with the percentage in the middle. */
export function Ring({ pct, state, size = 120, label, children }: { pct: number; state: 'ok' | 'warning' | 'over'; size?: number; label: string; children?: ReactNode }) {
  const r = 42, c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, pct));
  return (
    <div className={`ring ring-${state}`} style={{ width: size, height: size }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={r} />
        <circle className="ring-bar" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} />
      </svg>
      <div className="ring-center">{children ?? <strong>{Math.round(pct)}%</strong>}</div>
    </div>
  );
}

export const stateBadge = (s: 'ok' | 'warning' | 'over') =>
  s === 'over' ? <Badge tone="bad" icon={<CircleAlert size={13} />}>{m.budgets.stateOver}</Badge>
    : s === 'warning' ? <Badge tone="warn" icon={<TriangleAlert size={13} />}>{m.budgets.stateWarning}</Badge>
      : <Badge tone="ok" icon={<CircleCheck size={13} />}>{m.budgets.stateOk}</Badge>;

/** Pill-style tabs. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => <button key={o.value} role="tab" type="button" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/** Button that opens a small floating panel; closes on outside click or Esc. */
export function Popover({ button, label, children, align = 'end', className }: { button: ReactNode; label: string; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className={`popover-wrap ${className ?? ''}`} ref={ref}>
      <button type="button" className="icon-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{button}</button>
      {open && <div id={id} className={`popover popover-${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}
