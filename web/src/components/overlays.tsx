// App-wide overlays: first-run welcome, guided tour and the Ctrl+K command palette.
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Search, ArrowRight, Plus, Landmark, Target, Compass, EyeOff } from 'lucide-react';
import { m } from '../i18n.ts';
import { useSession } from '../state.tsx';
import { Modal } from './ui.tsx';
import { Art } from './illustrations.tsx';

export function Welcome({ onDone }: { onDone: (tour: boolean) => void }) {
  const [i, setI] = useState(0);
  const steps = m.welcome.steps;
  const s = steps[i];
  const A = Art[s.art];
  const last = i === steps.length - 1;
  return (
    <Modal open title={`Welcome (${i + 1} of ${steps.length})`} onClose={() => onDone(false)} footer={<>
      <button className="btn btn-ghost" onClick={() => onDone(false)}>{m.welcome.skip}</button>
      <span className="spacer" />
      {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>{m.welcome.back}</button>}
      {last ? <>
        <button className="btn" onClick={() => onDone(true)}><Compass size={18} aria-hidden="true" />{m.welcome.tour}</button>
        <button className="btn btn-primary" onClick={() => onDone(false)}>{m.welcome.start}</button>
      </> : <button className="btn btn-primary" onClick={() => setI(i + 1)}>{m.welcome.next}<ArrowRight size={18} aria-hidden="true" /></button>}
    </>}>
      <div className="welcome" key={i} style={{ animation: 'rise .25s ease-out' }}>
        <div className="wizard-art"><A /></div>
        <h3>{s.title}</h3>
        <p>{s.text}</p>
        <div className="steps-dots" aria-hidden="true">{steps.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
      </div>
    </Modal>
  );
}

const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; };
const findTarget = (t: string) => [...document.querySelectorAll(`[data-tour="${t}"]`)].find(visible);

/** Highlights parts of the screen one at a time. Steps whose target is not on screen (e.g. on phones) are skipped. */
export function Tour({ onDone }: { onDone: () => void }) {
  const steps = useMemo(() => m.tour.steps.filter((s) => findTarget(s.target)), []);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];
  useLayoutEffect(() => {
    if (!step) return;
    const update = () => setRect(findTarget(step.target)?.getBoundingClientRect() ?? null);
    update();
    addEventListener('resize', update);
    addEventListener('scroll', update, true);
    return () => { removeEventListener('resize', update); removeEventListener('scroll', update, true); };
  }, [step]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onDone]);
  useEffect(() => { if (!steps.length) onDone(); }, [steps.length, onDone]);
  if (!step || !rect) return null;
  const pad = 6;
  const cardW = Math.min(320, innerWidth - 32);
  const right = rect.right + 16 + cardW < innerWidth;
  const pos = right
    ? { left: rect.right + 16, top: Math.min(Math.max(16, rect.top - 8), innerHeight - 220) }
    : { left: Math.min(Math.max(16, rect.left + rect.width / 2 - cardW / 2), innerWidth - cardW - 16), top: rect.bottom + 230 < innerHeight ? rect.bottom + 14 : Math.max(16, rect.top - 214) };
  const last = i === steps.length - 1;
  return (
    <>
      <div className="tour-hl" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title" style={pos}>
        <small className="muted">{i + 1} of {steps.length}</small>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-foot">
          <button className="btn btn-ghost btn-small" onClick={onDone}>{m.tour.skip}</button>
          <span className="spacer" />
          {i > 0 && <button className="btn btn-small" onClick={() => setI(i - 1)}>{m.tour.back}</button>}
          <button className="btn btn-primary btn-small" autoFocus onClick={() => (last ? onDone() : setI(i + 1))}>{last ? m.tour.done : m.tour.next}</button>
        </div>
      </div>
    </>
  );
}

type Cmd = { id: string; label: string; icon: ReactNode; run: () => void };

/** Ctrl+K: jump to any page or search activity. */
export function CommandPalette({ open, onClose, pages, onTour }: { open: boolean; onClose: () => void; pages: { to: string; label: string; icon: ReactNode }[]; onTour: () => void }) {
  const nav = useNavigate();
  const { settings, updateSettings } = useSession();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);
  const go = (to: string) => () => nav(to);
  const all: Cmd[] = [
    ...pages.map((p) => ({ id: p.to, label: `Go to ${p.label}`, icon: p.icon, run: go(p.to) })),
    { id: 'cash', label: 'Add a cash payment', icon: <Plus size={18} />, run: go('/transactions?add=cash') },
    { id: 'connect', label: 'Connect a bank', icon: <Landmark size={18} />, run: go('/accounts?connect=1') },
    { id: 'budget', label: 'Set a budget', icon: <Target size={18} />, run: go('/budgets') },
    { id: 'hide', label: settings.hideAmounts ? 'Show amounts' : 'Hide amounts', icon: <EyeOff size={18} />, run: () => { void updateSettings({ hideAmounts: !settings.hideAmounts }); } },
    { id: 'tour', label: 'Take the tour', icon: <Compass size={18} />, run: onTour },
  ];
  const needle = q.trim().toLowerCase();
  const items = [
    ...all.filter((c) => c.label.toLowerCase().includes(needle)),
    ...(needle ? [{ id: 'search', label: `Search activity for “${q.trim()}”`, icon: <Search size={18} />, run: go(`/transactions?q=${encodeURIComponent(q.trim())}`) }] : []),
  ];
  const pick = (c: Cmd) => { onClose(); c.run(); };
  return (
    <Modal open={open} title={m.nav.search} onClose={onClose}>
      <label className="sr-only" htmlFor="palette-q">{m.nav.searchHint}</label>
      <input id="palette-q" className="palette-input" data-autofocus placeholder={m.nav.searchHint} value={q} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[sel] ? `pal-${items[sel].id}` : undefined}
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter' && items[sel]) { e.preventDefault(); pick(items[sel]); }
        }} />
      <ul className="palette-list" id="palette-list" role="listbox" aria-label="Results">
        {items.map((c, k) => (
          <li key={c.id} role="presentation">
            <button id={`pal-${c.id}`} role="option" aria-selected={k === sel} tabIndex={-1} className={`palette-item ${k === sel ? 'on' : ''}`} onMouseMove={() => { if (sel !== k) setSel(k); }} onClick={() => pick(c)}>
              <span aria-hidden="true">{c.icon}</span>{c.label}
            </button>
          </li>
        ))}
        {!items.length && <li className="muted" style={{ padding: '.6rem' }}>No matches</li>}
      </ul>
    </Modal>
  );
}
