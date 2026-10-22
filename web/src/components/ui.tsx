import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ApiError } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession } from '../state.tsx';

export function Money({ minor, currency, sign, className }: { minor: number | null | undefined; currency?: string; sign?: 'auto' | 'always' | 'exceptZero'; className?: string }) {
  const { fmt } = useSession();
  const cls = minor !== null && minor !== undefined && minor > 0 && sign === 'always' ? 'pos' : '';
  return <span className={`money ${cls} ${className ?? ''}`}>{fmt.money(minor, currency, sign)}</span>;
}

export function Card({ title, actions, children, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const hid = useId();
  return (
    <section className={`card ${className ?? ''}`} aria-labelledby={title ? hid : undefined} id={id}>
      {(title || actions) && <div className="card-head">{title && <h2 id={hid}>{title}</h2>}{actions && <div className="card-actions">{actions}</div>}</div>}
      {children}
    </section>
  );
}

export function Loading({ label = m.common.loading }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" /> {label}</div>;
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <strong aria-hidden="true">⚠</strong> <span>{error.message}</span>
      {onRetry && <button className="btn btn-small" onClick={onRetry}>{m.common.retry}</button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><p className="empty-title">{title}</p>{children}</div>;
}

export function Badge({ tone, icon, children }: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted'; icon?: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{icon && <span aria-hidden="true">{icon} </span>}{children}</span>;
}

export function Help({ children }: { children: ReactNode }) {
  return <p className="help">{children}</p>;
}

/** Native <dialog> modal: focus trap, Esc to close and inert background come from the browser. */
export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const hid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={hid} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className="modal-head"><h2 id={hid}>{title}</h2><button className="icon-btn" aria-label={m.common.close} onClick={onClose}>✕</button></div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
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
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ok || busy} onClick={() => onConfirm(typed)}>{busy ? m.common.loading : confirmLabel}</button>
    </>}>
      <div>{text}</div>
      {typeToConfirm && (
        <div className="field">
          <label htmlFor={id}>Type <strong>{typeToConfirm}</strong> to confirm</label>
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

export const stateBadge = (s: 'ok' | 'warning' | 'over') =>
  s === 'over' ? <Badge tone="bad" icon="▲">{m.budgets.stateOver}</Badge> : s === 'warning' ? <Badge tone="warn" icon="!">{m.budgets.stateWarning}</Badge> : <Badge tone="ok" icon="✓">{m.budgets.stateOk}</Badge>;
