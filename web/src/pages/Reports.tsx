import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession } from '../state.tsx';
import { Card, ErrorBox, Loading, Money, Field, Help, Empty } from '../components/ui.tsx';
import { BarList, MonthBars } from '../components/charts.tsx';
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

const PRESETS = { '1m': 'This month', '3m': 'Last 3 months', '6m': 'Last 6 months', '12m': 'Last 12 months', custom: 'Custom' } as const;

export function Reports() {
  const { settings, fmt } = useSession();
  const nav = useNavigate();
  const today = todayIn(settings.timezone);
  const [preset, setPreset] = useState<keyof typeof PRESETS>('12m');
  const [from, setFrom] = useState(`${addMonths(monthOf(today), -11)}-01`);
  const [to, setTo] = useState(today);
  const [acct, setAcct] = useState('');
  const accts = useApi<Account[]>('/accounts');
  const range = preset === 'custom' ? { from, to } : { from: `${addMonths(monthOf(today), -({ '1m': 0, '3m': 2, '6m': 5, '12m': 11 }[preset]))}-01`, to: today };
  const r = useApi<R>(`/reports?from=${range.from}&to=${range.to}${acct ? `&accounts=${acct}` : ''}`);

  const filters = (
    <div className="toolbar">
      <Field label={m.reports.range}>{(id) => <select id={id} value={preset} onChange={(e) => setPreset(e.target.value as keyof typeof PRESETS)}>{Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
      {preset === 'custom' && <>
        <Field label={m.tx.from}>{(id) => <input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={m.tx.to}>{(id) => <input id={id} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
      </>}
      <Field label={m.tx.account}>{(id) => <select id={id} value={acct} onChange={(e) => setAcct(e.target.value)}><option value="">{m.dashboard.allAccounts}</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>)}</select>}</Field>
    </div>
  );
  if (r.error) return <div className="page"><h1>{m.reports.title}</h1>{filters}<ErrorBox error={r.error} onRetry={() => r.reload()} /></div>;
  if (!r.data) return <div className="page"><h1>{m.reports.title}</h1>{filters}<Loading /></div>;
  const x = r.data;
  const cur = x.currency;
  const t = x.totals.find((v) => v.currency === cur);
  const months: string[] = [];
  for (let mo = monthOf(x.from); mo <= monthOf(x.to); mo = addMonths(mo, 1)) months.push(mo);
  const bm = new Map(x.byMonth.filter((v) => v.currency === cur).map((v) => [v.month, v]));
  const cats = x.byCategory.filter((c) => c.currency === cur);
  const merch = x.merchants.filter((c) => c.currency === cur);
  const commit = x.commitments[cur] ?? {};

  return (
    <div className="page">
      <div className="page-head"><h1>{m.reports.title}</h1><a className="btn" href={`/api/transactions/export.csv?from=${x.from}&to=${x.to}${acct ? `&accounts=${acct}` : ''}`} download>{m.tx.export}</a></div>
      {filters}
      <p className="muted">{fmt.date(x.from)} – {fmt.date(x.to)}. Posted transactions by booking date; excluded transactions and transfers between your accounts are not counted. Amounts in {cur}{x.totals.length > 1 ? `; other currencies (${x.totals.filter((v) => v.currency !== cur).map((v) => v.currency).join(', ')}) are not converted or added` : ''}.</p>
      <div className="tiles">
        <div className="tile"><h2>{m.reports.spending}</h2><p className="big"><Money minor={t?.spending ?? 0} currency={cur} /></p></div>
        <div className="tile"><h2>{m.reports.income}</h2><p className="big"><Money minor={t?.income ?? 0} currency={cur} /></p></div>
        <div className="tile"><h2>{m.reports.net}</h2><p className={`big ${(t?.net ?? 0) < 0 ? 'neg' : ''}`}><Money minor={t?.net ?? 0} currency={cur} sign="exceptZero" /></p></div>
      </div>
      <div className="grid-2">
        <Card title={m.reports.byCategory}>
          {cats.length ? <BarList caption={m.reports.byCategory} currency={cur} rows={cats.map((c) => ({ key: c.categoryId ?? 'none', label: c.name, value: c.spending, dot: c.color, sub: `${c.count}×` }))}
            onSelect={(k) => nav(`/transactions?category=${k}&from=${x.from}&to=${x.to}&status=posted${acct ? `&accounts=${acct}` : ''}`)} /> : <Empty title="No spending in this period." />}
          {cats.some((c) => c.spending < 0) && <Help>{m.reports.negativeNote}</Help>}
        </Card>
        <Card title={m.reports.merchants}>
          {merch.length ? <BarList caption={m.reports.merchants} currency={cur} rows={merch.map((c) => ({ key: c.merchant, label: c.merchant, value: c.spending, sub: `${c.count}×` }))} onSelect={(k) => nav(`/transactions?q=${encodeURIComponent(String(k))}&from=${x.from}&to=${x.to}`)} /> : <Empty title="No merchants in this period." />}
        </Card>
      </div>
      <Card title={m.reports.byMonth}>
        <MonthBars months={months} a={months.map((mo) => bm.get(mo)?.spending ?? 0)} b={months.map((mo) => bm.get(mo)?.income ?? 0)} labels={[m.reports.spending, m.reports.income]} currency={cur} />
      </Card>
      <div className="grid-2">
        <Card title={m.reports.budgetVsActual}>
          <Help>Monthly budget across all included accounts (budgets are not per account). Current month is partial ({fmt.date(monthBounds(monthOf(today)).from)} – today).</Help>
          <MonthBars months={x.budgetVsActual.map((v) => v.month)} a={x.budgetVsActual.map((v) => v.actual)} labels={[m.reports.actual]} budgets={x.budgetVsActual.map((v) => v.budget)} currency={cur} />
        </Card>
        <Card title={m.reports.commitments}>
          {Object.keys(commit).length ? (
            <table className="table"><thead><tr><th scope="col">{m.recurring.kind}</th><th scope="col" className="num">{m.recurring.monthly}</th></tr></thead>
              <tbody>{Object.entries(commit).map(([k, v]) => <tr key={k}><th scope="row">{m.kinds[k]}</th><td className="num">~<Money minor={v} currency={cur} /></td></tr>)}
                <tr><th scope="row">Total</th><td className="num"><strong>~<Money minor={Object.values(commit).reduce((a, b) => a + b, 0)} currency={cur} /></strong></td></tr></tbody></table>
          ) : <Empty title="No confirmed recurring payments yet."><p>Confirm suggestions on the Recurring page to include them here.</p></Empty>}
          <Help>{m.recurring.help}</Help>
        </Card>
      </div>
    </div>
  );
}
