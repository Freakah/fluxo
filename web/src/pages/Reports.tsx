import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, ArrowUpRight, ArrowDownLeft, Scale } from 'lucide-react';
import { useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useCategories, useSession } from '../state.tsx';
import { Card, ErrorBox, Loading, Money, Field, Help, Empty, PageHeader, Segmented, Info } from '../components/ui.tsx';
import { BarList, Donut, MonthBars } from '../components/charts.tsx';
import { CatIcon, Monogram } from '../components/icons.tsx';
import { addMonths, monthOf, todayIn, monthBounds } from '../../../shared/dates.ts';
import type { Account, Totals } from '../types.ts';

type R = {
  from: string; to: string; currency: string; totals: Totals[];
  byCategory: { categoryId: number | null; currency: string; spending: number; count: number; name: string; color: string }[];
  byMonth: { month: string; currency: string; spending: number; income: number; net: number }[];
  merchants: { merchant: string; currency: string; spending: number; count: number }[];
  budgetVsActual: { month: string; budget: number | null; actual: number }[];
  commitments: Record<string, Record<string, number>>;
};

type Preset = '1m' | '3m' | 'year' | '12m' | 'custom';
const PRESETS: { value: Preset; label: string }[] = [
  { value: '1m', label: 'This month' }, { value: '3m', label: '3 months' }, { value: 'year', label: 'This year' }, { value: '12m', label: '12 months' }, { value: 'custom', label: 'Custom' },
];

export function Reports() {
  const { settings, fmt } = useSession();
  const { byId } = useCategories();
  const nav = useNavigate();
  const today = todayIn(settings.timezone);
  const [preset, setPreset] = useState<Preset>('12m');
  const [view, setView] = useState<'overview' | 'trends'>('overview');
  const [from, setFrom] = useState(`${addMonths(monthOf(today), -11)}-01`);
  const [to, setTo] = useState(today);
  const [acct, setAcct] = useState('');
  const accts = useApi<Account[]>('/accounts');
  const range = preset === 'custom' ? { from, to }
    : preset === 'year' ? { from: `${today.slice(0, 4)}-01-01`, to: today }
      : { from: `${addMonths(monthOf(today), -({ '1m': 0, '3m': 2, '12m': 11 }[preset]))}-01`, to: today };
  const r = useApi<R>(`/reports?from=${range.from}&to=${range.to}${acct ? `&accounts=${acct}` : ''}`);
  const acctQs = acct ? `&accounts=${acct}` : '';

  const controls = (
    <div className="stack">
      <div className="toolbar">
        <Segmented label={m.reports.range} value={preset} onChange={setPreset} options={PRESETS} />
        {(accts.data?.length ?? 0) > 1 && (
          <select aria-label={m.tx.account} className={`chip-select ${acct ? 'set' : ''}`} value={acct} onChange={(e) => setAcct(e.target.value)}>
            <option value="">{m.dashboard.allAccounts}</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>)}
          </select>
        )}
      </div>
      {preset === 'custom' && (
        <div className="row">
          <Field label={m.tx.from}>{(id) => <input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label={m.tx.to}>{(id) => <input id={id} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
      )}
    </div>
  );
  const header = (
    <PageHeader title={m.reports.title} subtitle="See patterns in your spending over time."
      info={<>Completed payments by booking date. Payments marked “not counted” and transfers between your own accounts are left out. Other currencies are never converted or added together.</>}
      actions={<a className="btn" href={`/api/transactions/export.csv?from=${range.from}&to=${range.to}${acctQs}`} download><Download size={18} aria-hidden="true" />{m.tx.export}</a>} />
  );
  if (r.error) return <div className="page">{header}{controls}<ErrorBox error={r.error} onRetry={() => r.reload()} /></div>;
  if (!r.data) return <div className="page">{header}{controls}<Loading rows={6} /></div>;
  const x = r.data;
  const cur = x.currency;
  const t = x.totals.find((v) => v.currency === cur);
  const months: string[] = [];
  for (let mo = monthOf(x.from); mo <= monthOf(x.to); mo = addMonths(mo, 1)) months.push(mo);
  const bm = new Map(x.byMonth.filter((v) => v.currency === cur).map((v) => [v.month, v]));
  const cats = x.byCategory.filter((c) => c.currency === cur);
  const merch = x.merchants.filter((c) => c.currency === cur);
  const commit = x.commitments[cur] ?? {};
  const toCat = (k: string | number) => nav(`/transactions?category=${k}&from=${x.from}&to=${x.to}&status=posted${acctQs}`);
  const toMonth = (mo: string) => nav(`/transactions?from=${mo}-01&to=${monthBounds(mo).to}&status=posted${acctQs}`);

  return (
    <div className="page">
      {header}
      {controls}
      <p className="muted small" style={{ margin: 0 }}>{fmt.date(x.from)} – {fmt.date(x.to)}{x.totals.length > 1 ? ` · amounts in ${cur}; ${x.totals.filter((v) => v.currency !== cur).map((v) => v.currency).join(', ')} shown separately` : ''}</p>
      <div className="stats">
        <div className="stat"><span className="stat-icon warn"><ArrowUpRight size={22} aria-hidden="true" /></span><div><div className="stat-label">{m.reports.spending}</div><div className="stat-value"><Money minor={t?.spending ?? 0} currency={cur} /></div></div></div>
        <div className="stat"><span className="stat-icon ok"><ArrowDownLeft size={22} aria-hidden="true" /></span><div><div className="stat-label">{m.reports.income}</div><div className="stat-value"><Money minor={t?.income ?? 0} currency={cur} /></div></div></div>
        <div className="stat"><span className={`stat-icon ${(t?.net ?? 0) < 0 ? 'bad' : 'accent'}`}><Scale size={22} aria-hidden="true" /></span><div><div className="stat-label">{m.dashboard.net}<Info>{m.dashboard.netHelp}</Info></div><div className={`stat-value ${(t?.net ?? 0) < 0 ? 'neg' : ''}`}><Money minor={t?.net ?? 0} currency={cur} sign="exceptZero" /></div></div></div>
      </div>

      <Segmented label="View" value={view} onChange={setView} options={[{ value: 'overview', label: 'Where it went' }, { value: 'trends', label: 'Month by month' }]} />

      {view === 'overview' ? (
        <div className="grid-2">
          <Card title={m.reports.byCategory}>
            {cats.length ? <>
              <Donut caption={`${m.reports.byCategory} chart`} currency={cur} centerLabel="Total spent" onSelect={toCat} rows={cats.map((c) => ({ key: c.categoryId ?? 'none', label: c.name, value: c.spending, dot: c.color }))} />
              <BarList caption={m.reports.byCategory} currency={cur} onSelect={toCat}
                rows={cats.map((c) => ({ key: c.categoryId ?? 'none', label: c.name, value: c.spending, dot: c.color, sub: `${c.count}×`, icon: <CatIcon cat={c.categoryId ? byId.get(c.categoryId) ?? { color: c.color } : null} size={34} /> }))} />
            </> : <Empty art="chart" title="No spending in this period" />}
            {cats.some((c) => c.spending < 0) && <Help>{m.reports.negativeNote}</Help>}
          </Card>
          <Card title={m.reports.merchants}>
            {merch.length ? <BarList caption={m.reports.merchants} currency={cur} onSelect={(k) => nav(`/transactions?q=${encodeURIComponent(String(k))}&from=${x.from}&to=${x.to}`)}
              rows={merch.map((c) => ({ key: c.merchant, label: c.merchant, value: c.spending, sub: `${c.count}×`, icon: <Monogram name={c.merchant} size={34} /> }))} /> : <Empty art="search" title="No merchants in this period" />}
          </Card>
        </div>
      ) : (
        <>
          <Card title={m.reports.byMonth}>
            <MonthBars months={months} a={months.map((mo) => bm.get(mo)?.spending ?? 0)} b={months.map((mo) => bm.get(mo)?.income ?? 0)} labels={[m.reports.spending, m.reports.income]} currency={cur} onSelect={toMonth} />
            <Help>Tip: click a month to see its payments.</Help>
          </Card>
          <div className="grid-2">
            <Card title={m.reports.budgetVsActual}>
              <MonthBars months={x.budgetVsActual.map((v) => v.month)} a={x.budgetVsActual.map((v) => v.actual)} labels={[m.reports.actual]} budgets={x.budgetVsActual.map((v) => v.budget)} currency={cur} onSelect={toMonth} />
              <Help>Monthly budget across all accounts. The current month is not over yet ({fmt.date(monthBounds(monthOf(today)).from)} – today).</Help>
            </Card>
            <Card title={m.reports.commitments}>
              {Object.keys(commit).length ? (
                <table className="table"><thead><tr><th scope="col">{m.recurring.kind}</th><th scope="col" className="num">{m.recurring.monthly}</th></tr></thead>
                  <tbody>{Object.entries(commit).map(([k, v]) => <tr key={k}><th scope="row">{m.kinds[k]}</th><td className="num">~<Money minor={v} currency={cur} /></td></tr>)}
                    <tr><th scope="row">Total</th><td className="num"><strong>~<Money minor={Object.values(commit).reduce((a, b) => a + b, 0)} currency={cur} /></strong></td></tr></tbody></table>
              ) : <Empty art="calendar" title="No confirmed bills yet">Confirm suggestions on the Bills page to include them here.</Empty>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
