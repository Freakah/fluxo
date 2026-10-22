// Small hand-rolled SVG charts. Every chart can switch to an accessible table with the same numbers.
import { useState, type ReactNode } from 'react';
import { m } from '../i18n.ts';
import { useSession } from '../state.tsx';

export function ChartFrame({ table, children, caption }: { table: ReactNode; children: ReactNode; caption: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="chart-toggle"><button className="link" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>{asTable ? m.common.showChart : m.common.showTable}</button></div>
      {asTable ? <div className="table-wrap">{table}</div> : children}
    </figure>
  );
}

/** Ranked horizontal bars with direct labels (magnitude: one hue). */
export function BarList({ rows, currency, caption, max: maxIn, onSelect }: { rows: { key: string | number; label: string; value: number; dot?: string; sub?: string }[]; currency: string; caption: string; max?: number; onSelect?: (key: string | number) => void }) {
  const { fmt } = useSession();
  const max = maxIn ?? Math.max(1, ...rows.map((r) => r.value));
  const table = (
    <table className="table"><caption className="sr-only">{caption}</caption>
      <thead><tr><th scope="col">Name</th><th scope="col" className="num">Amount</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.label}</th><td className="num">{fmt.money(r.value, currency)}</td></tr>)}</tbody>
    </table>
  );
  return (
    <ChartFrame caption={caption} table={table}>
      <ul className="barlist">
        {rows.map((r) => {
          const inner = (
            <>
              <span className="barlist-label">{r.dot && <span className="dot" style={{ background: r.dot }} aria-hidden="true" />}{r.label}{r.sub && <small> {r.sub}</small>}</span>
              <span className="barlist-track" aria-hidden="true"><span className="barlist-bar" style={{ width: `${Math.max(0, (r.value / max) * 100)}%` }} /></span>
              <span className="barlist-value money">{fmt.money(r.value, currency)}</span>
            </>
          );
          return <li key={r.key}>{onSelect ? <button className="barlist-row" onClick={() => onSelect(r.key)}>{inner}</button> : <div className="barlist-row">{inner}</div>}</li>;
        })}
      </ul>
    </ChartFrame>
  );
}

const W = 640, H = 220, PAD = { l: 8, r: 8, t: 12, b: 24 };

/** Cumulative spending through the month: this month vs last month. */
export function CumulativeChart({ current, previous, days, currency }: { current: number[]; previous: number[]; days: number; currency: string }) {
  const { fmt } = useSession();
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(days, previous.length);
  const max = Math.max(1, ...current, ...previous);
  const x = (i: number) => PAD.l + (i / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (Math.max(0, v) / max) * (H - PAD.t - PAD.b);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const hi = hover ?? current.length - 1;
  const table = (
    <table className="table"><caption className="sr-only">Cumulative spending by day</caption>
      <thead><tr><th scope="col">Day</th><th scope="col" className="num">{m.dashboard.trendThis}</th><th scope="col" className="num">{m.dashboard.trendPrev}</th></tr></thead>
      <tbody>{Array.from({ length: n }, (_, i) => <tr key={i}><th scope="row">{i + 1}</th><td className="num">{i < current.length ? fmt.money(current[i], currency) : '—'}</td><td className="num">{i < previous.length ? fmt.money(previous[i], currency) : '—'}</td></tr>)}</tbody>
    </table>
  );
  return (
    <ChartFrame caption="Cumulative spending this month compared with last month" table={table}>
      <div className="legend" aria-hidden="true"><span><i className="swatch s1" />{m.dashboard.trendThis}</span><span><i className="swatch s-prev" />{m.dashboard.trendPrev}</span></div>
      <p className="chart-readout" aria-live="off">Day {hi + 1}: <strong>{fmt.money(current[hi] ?? null, currency)}</strong> · {m.dashboard.trendPrev.toLowerCase()} {fmt.money(previous[hi] ?? null, currency)}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="svg-chart" role="img" aria-label="Line chart of cumulative spending; use the table view for values"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width * W - PAD.l) / (W - PAD.l - PAD.r) * (n - 1)); setHover(Math.max(0, Math.min(current.length - 1, i))); }}>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} />)}
        <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
        <path d={path(previous)} className="line line-prev" />
        <path d={path(current)} className="line line-1" />
        {current.length > 0 && <><line className="crosshair" x1={x(hi)} x2={x(hi)} y1={PAD.t} y2={H - PAD.b} /><circle className="marker" cx={x(hi)} cy={y(current[hi])} r={4.5} /></>}
        {[1, Math.ceil(n / 2), n].map((d) => <text key={d} className="tick" x={x(d - 1)} y={H - 6} textAnchor={d === 1 ? 'start' : d === n ? 'end' : 'middle'}>{d}</text>)}
      </svg>
    </ChartFrame>
  );
}

/** Monthly grouped bars (two series). */
export function MonthBars({ months, a, b, labels, currency, budgets }: { months: string[]; a: number[]; b?: number[]; labels: [string, string?]; currency: string; budgets?: (number | null)[] }) {
  const { fmt } = useSession();
  const max = Math.max(1, ...a, ...(b ?? []), ...(budgets ?? []).map((v) => v ?? 0));
  const n = months.length;
  const slot = (W - PAD.l - PAD.r) / Math.max(1, n);
  const bw = Math.max(4, Math.min(22, (slot - 6) / (b ? 2 : 1) - 2));
  const y = (v: number) => H - PAD.b - (Math.max(0, v) / max) * (H - PAD.t - PAD.b);
  const table = (
    <table className="table"><caption className="sr-only">Values by month</caption>
      <thead><tr><th scope="col">Month</th><th scope="col" className="num">{labels[0]}</th>{b && <th scope="col" className="num">{labels[1]}</th>}{budgets && <th scope="col" className="num">{m.reports.budget}</th>}</tr></thead>
      <tbody>{months.map((mo, i) => <tr key={mo}><th scope="row">{fmt.month(mo)}</th><td className="num">{fmt.money(a[i], currency)}</td>{b && <td className="num">{fmt.money(b[i], currency)}</td>}{budgets && <td className="num">{budgets[i] === null ? '—' : fmt.money(budgets[i], currency)}</td>}</tr>)}</tbody>
    </table>
  );
  return (
    <ChartFrame caption={`${labels.filter(Boolean).join(' and ')} by month`} table={table}>
      <div className="legend" aria-hidden="true"><span><i className="swatch s1" />{labels[0]}</span>{b && <span><i className="swatch s2" />{labels[1]}</span>}{budgets && <span><i className="swatch s-budget" />{m.reports.budget}</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="svg-chart" role="img" aria-label="Bar chart by month; use the table view for values">
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} />)}
        {months.map((mo, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const x0 = b ? cx - bw - 1 : cx - bw / 2;
          return (
            <g key={mo}>
              <rect className="bar s1" x={x0} y={y(a[i])} width={bw} height={H - PAD.b - y(a[i])} rx={3}><title>{`${fmt.month(mo)} · ${labels[0]}: ${fmt.money(a[i], currency)}`}</title></rect>
              {b && <rect className="bar s2" x={cx + 1} y={y(b[i])} width={bw} height={H - PAD.b - y(b[i])} rx={3}><title>{`${fmt.month(mo)} · ${labels[1]}: ${fmt.money(b[i], currency)}`}</title></rect>}
              {budgets && budgets[i] !== null && <line className="budget-mark" x1={cx - slot / 2 + 3} x2={cx + slot / 2 - 3} y1={y(budgets[i]!)} y2={y(budgets[i]!)}><title>{`${m.reports.budget}: ${fmt.money(budgets[i], currency)}`}</title></line>}
              {(n <= 12 || i % 2 === 0) && <text className="tick" x={cx} y={H - 6} textAnchor="middle">{fmt.monthShort(mo)}</text>}
            </g>
          );
        })}
        <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
      </svg>
    </ChartFrame>
  );
}
