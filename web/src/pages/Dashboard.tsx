import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession } from '../state.tsx';
import { Card, ErrorBox, Loading, Money, Empty, Badge, Progress, stateBadge } from '../components/ui.tsx';
import { BarList, CumulativeChart } from '../components/charts.tsx';
import { TxList } from './Transactions.tsx';
import type { Account, BudgetLine, Totals, Tx } from '../types.ts';

type Dash = {
  today: string; month: string; currency: string; totals: Totals[]; budget: BudgetLine | null;
  balances: (Pick<Account, 'id' | 'name' | 'display_name' | 'kind' | 'currency' | 'balance_minor' | 'balance_label' | 'balance_at' | 'included'>)[];
  byCategory: { categoryId: number | null; currency: string; spending: number; count: number; name: string; color: string }[];
  trend: { days: number; dayOfMonth: number; current: number[]; previous: number[] };
  recent: Tx[]; upcoming: { id: number; merchant: string; kind: string; frequency: string; typical_amount_minor: number; user_amount_minor: number | null; currency: string; next_date: string; status: string }[];
  sync: { lastSuccess: string | null; connections: number; problems: { id: number; institution: string; status: string; message: string | null }[] };
};

export function Dashboard() {
  const { fmt } = useSession();
  const nav = useNavigate();
  const accts = useApi<Account[]>('/accounts');
  const [scope, setScope] = useState('');
  const d = useApi<Dash>(`/dashboard${scope ? `?accounts=${scope}` : ''}`);
  if (d.error) return <ErrorBox error={d.error} onRetry={() => d.reload()} />;
  if (!d.data) return <Loading />;
  const x = d.data;
  const main = x.totals.find((t) => t.currency === x.currency) ?? { currency: x.currency, spending: 0, income: 0, net: 0, pendingOut: 0, refunds: 0, count: 0 };
  const others = x.totals.filter((t) => t.currency !== x.currency);
  const cats = x.byCategory.filter((c) => c.currency === x.currency);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{m.dashboard.title} <small className="muted">{fmt.month(x.month)}</small></h1>
        <div className="field inline">
          <label htmlFor="scope">{m.dashboard.scope}</label>
          <select id="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">{m.dashboard.allAccounts}</option>
            {accts.data?.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.name}{a.iban_last4 ? ` ·${a.iban_last4}` : ''}</option>)}
          </select>
        </div>
      </div>

      {x.sync.problems.length > 0 && (
        <div className="alert alert-warn" role="alert">
          <strong><span aria-hidden="true">⚠ </span>{m.dashboard.problems}</strong>
          <ul>{x.sync.problems.map((p) => <li key={p.id}>{p.institution}: {p.message} <Link to="/accounts">{m.accounts.reconnect} →</Link></li>)}</ul>
        </div>
      )}

      {x.sync.connections === 0 && (accts.data?.length ?? 0) === 0 ? (
        <Card><Empty title={m.dashboard.empty}><p>{m.dashboard.emptyHelp}</p><Link className="btn btn-primary" to="/accounts">{m.dashboard.connect}</Link></Empty></Card>
      ) : (
        <>
          <div className="tiles">
            <div className="tile"><h2>{m.dashboard.spending}</h2><p className="big"><Money minor={main.spending} currency={x.currency} /></p><p className="help">{m.dashboard.spendingHelp}</p></div>
            <div className="tile"><h2>{m.dashboard.income}</h2><p className="big"><Money minor={main.income} currency={x.currency} /></p></div>
            <div className="tile"><h2>{m.dashboard.net}</h2><p className={`big ${main.net < 0 ? 'neg' : ''}`}><Money minor={main.net} currency={x.currency} sign="exceptZero" /></p><p className="help">{m.dashboard.netHelp}</p></div>
            <div className="tile">
              <h2>{m.dashboard.budgetRemaining}</h2>
              {x.budget ? (
                <>
                  <p className={`big ${x.budget.remaining < 0 ? 'neg' : ''}`}><Money minor={x.budget.remaining} currency={x.currency} /></p>
                  <Progress pct={x.budget.pct} state={x.budget.state} label={`${x.budget.pct}% of monthly budget used`} />
                  <p className="help">{stateBadge(x.budget.state)} {x.budget.pct}% {m.budgets.spent} {m.budgets.of} <Money minor={x.budget.amount} currency={x.currency} />. {m.dashboard.budgetHelp}</p>
                </>
              ) : <p>{m.dashboard.noBudget}. <Link to="/budgets">{m.dashboard.setBudget}</Link></p>}
            </div>
            <div className="tile"><h2>{m.dashboard.pending}</h2><p className="big"><Money minor={main.pendingOut} currency={x.currency} /></p><p className="help">{m.dashboard.pendingHelp}</p></div>
          </div>
          {others.length > 0 && (
            <p className="help">{m.dashboard.otherCurrencies} {others.map((o) => <span key={o.currency} className="chip">{o.currency}: <Money minor={o.spending} currency={o.currency} /> spent</span>)}</p>
          )}

          <div className="grid-2">
            <Card title={m.dashboard.byCategory} actions={<Link to="/reports">{m.dashboard.viewAll}</Link>}>
              {cats.length ? <BarList caption={m.dashboard.byCategory} currency={x.currency} rows={cats.map((c) => ({ key: c.categoryId ?? 'none', label: c.name, value: c.spending, dot: c.color }))}
                onSelect={(k) => nav(`/transactions?category=${k === 'none' ? 'none' : k}&from=${x.month}-01&to=${x.today}&status=posted`)} /> : <Empty title="No spending yet this month." />}
            </Card>
            <Card title={m.dashboard.trend}>
              <CumulativeChart current={x.trend.current} previous={x.trend.previous} days={x.trend.days} currency={x.currency} />
            </Card>
          </div>

          <div className="grid-2">
            <Card title={m.dashboard.balances}>
              <p className="help">{m.dashboard.balanceHelp}</p>
              <ul className="list">
                {x.balances.map((b) => (
                  <li key={b.id} className="list-row">
                    <span><strong>{b.display_name ?? b.name}</strong>{!b.included && <> <Badge tone="muted">not in totals</Badge></>}<br /><small className="muted">{b.balance_label ? `${b.balance_label} · ${fmt.dateTime(b.balance_at)}` : m.dashboard.noBalance}</small></span>
                    <Money minor={b.balance_minor} currency={b.currency} />
                  </li>
                ))}
              </ul>
              <p className="help">{m.dashboard.lastSync}: <strong>{fmt.ago(x.sync.lastSuccess)}</strong>{x.sync.lastSuccess && ` (${fmt.dateTime(x.sync.lastSuccess)})`}</p>
            </Card>
            <Card title={m.dashboard.upcoming} actions={<Link to="/recurring">{m.dashboard.viewAll}</Link>}>
              {x.upcoming.length ? (
                <ul className="list">
                  {x.upcoming.map((u) => (
                    <li key={u.id} className="list-row">
                      <span><strong>{u.merchant}</strong> {u.status === 'suggested' && <Badge tone="info">{m.recurring.suggested}</Badge>}<br /><small className="muted">~{fmt.date(u.next_date)} · {m.freqs[u.frequency]} · {m.kinds[u.kind]}</small></span>
                      <span>~<Money minor={u.user_amount_minor ?? u.typical_amount_minor} currency={u.currency} /></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">{m.dashboard.noUpcoming}</p>}
            </Card>
          </div>

          <Card title={m.dashboard.recent} actions={<Link to="/transactions">{m.dashboard.viewAll}</Link>}>
            <TxList rows={x.recent} />
          </Card>
        </>
      )}
    </div>
  );
}
