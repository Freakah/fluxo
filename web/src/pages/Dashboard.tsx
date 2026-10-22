import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowDownLeft, Scale, CalendarClock, TrendingDown, TrendingUp, TriangleAlert, ChevronRight, Hourglass, Wallet } from 'lucide-react';
import { useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useCategories, useSession } from '../state.tsx';
import { Card, ErrorBox, Loading, Money, Empty, CountUp, Info, Progress, stateBadge } from '../components/ui.tsx';
import { Donut, CumulativeChart } from '../components/charts.tsx';
import { CatIcon, Monogram } from '../components/icons.tsx';
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

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const { fmt, settings } = useSession();
  const { byId } = useCategories();
  const nav = useNavigate();
  const accts = useApi<Account[]>('/accounts');
  const [scope, setScope] = useState('');
  const [cat, setCat] = useState<string | number | null>(null);
  const d = useApi<Dash>(`/dashboard${scope ? `?accounts=${scope}` : ''}`);
  const x = d.data;
  const catTx = useApi<{ rows: Tx[] }>(x && cat !== null ? `/transactions?category=${cat}&from=${x.month}-01&to=${x.today}&status=posted&limit=5${scope ? `&accounts=${scope}` : ''}` : null);
  if (d.error) return <div className="page"><ErrorBox error={d.error} onRetry={() => d.reload()} /></div>;
  if (!x) return <div className="page"><Loading rows={6} /></div>;
  const main = x.totals.find((t) => t.currency === x.currency) ?? { currency: x.currency, spending: 0, income: 0, net: 0, pendingOut: 0, refunds: 0, count: 0 };
  const others = x.totals.filter((t) => t.currency !== x.currency);
  const cats = x.byCategory.filter((c) => c.currency === x.currency);
  const dayIdx = Math.max(0, x.trend.current.length - 1);
  const prevSameDay = x.trend.previous[Math.min(dayIdx, x.trend.previous.length - 1)];
  const diff = prevSameDay === undefined ? null : main.spending - prevSameDay;
  const daysLeft = Math.max(1, x.trend.days - x.trend.dayOfMonth + 1);
  const upcomingTotal = x.upcoming.filter((u) => u.currency === x.currency).reduce((a, u) => a + (u.user_amount_minor ?? u.typical_amount_minor), 0);
  const selected = cats.find((c) => (c.categoryId ?? 'none') === cat);
  const noAccounts = x.sync.connections === 0 && (accts.data?.length ?? 0) === 0;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-sub" style={{ margin: 0 }}>{greeting(settings.timezone)}</p>
          <h1>{fmt.month(x.month)} <span className="sr-only">{m.dashboard.title}</span></h1>
        </div>
        {(accts.data?.length ?? 0) > 1 && (
          <div className="page-actions">
            <label className="sr-only" htmlFor="scope">{m.dashboard.scope}</label>
            <select id="scope" className="chip-select" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">{m.dashboard.allAccounts}</option>
              {accts.data?.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.name}{a.iban_last4 ? ` ·${a.iban_last4}` : ''}</option>)}
            </select>
          </div>
        )}
      </header>

      {x.sync.problems.length > 0 && (
        <section className="attention" aria-label={m.dashboard.problems}>
          {x.sync.problems.map((p) => (
            <div key={p.id} className="attention-row" role="alert">
              <TriangleAlert size={18} aria-hidden="true" />
              <span><strong>{p.institution}:</strong> {p.message}</span>
              <Link className="btn btn-small" to="/accounts">Fix</Link>
            </div>
          ))}
        </section>
      )}

      {noAccounts ? (
        <Card><Empty art="bank" title={m.dashboard.empty} action={<Link className="btn btn-primary" to="/accounts?connect=1">{m.dashboard.connect}</Link>}>{m.dashboard.emptyHelp}</Empty></Card>
      ) : (
        <>
          <section className="card hero" aria-labelledby="hero-label">
            <div>
              <div className="hero-label" id="hero-label">{m.dashboard.spending}<Info label="How is this calculated?">{m.dashboard.spendingHelp}</Info></div>
              <div className="hero-big"><CountUp minor={main.spending} currency={x.currency} /></div>
              <div className="row">
                {diff !== null && diff !== 0 && (
                  <span className={`trend ${diff < 0 ? 'good' : 'bad'}`}>
                    {diff < 0 ? <TrendingDown size={16} aria-hidden="true" /> : <TrendingUp size={16} aria-hidden="true" />}
                    <Money minor={Math.abs(diff)} currency={x.currency} /> {diff < 0 ? 'less' : 'more'} than this time last month
                  </span>
                )}
                {main.pendingOut > 0 && <span className="muted small"><Hourglass size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> + <Money minor={main.pendingOut} currency={x.currency} /> processing<Info label="What does processing mean?">{m.dashboard.pendingHelp}</Info></span>}
              </div>
            </div>
            <div className="hero-side">
              {x.budget ? (
                <>
                  <div className="hero-side-top"><span className="muted">{m.dashboard.budgetRemaining}</span>{stateBadge(x.budget.state)}</div>
                  <div className="hero-side-top" style={{ margin: '.35rem 0 .6rem' }}>
                    <strong className={x.budget.remaining < 0 ? 'neg' : ''}><Money minor={Math.abs(x.budget.remaining)} currency={x.currency} /> {x.budget.remaining < 0 ? 'over' : 'left'}</strong>
                    <span className="muted small">of <Money minor={x.budget.amount} currency={x.currency} /></span>
                  </div>
                  <Progress pct={x.budget.pct} state={x.budget.state} label={`${x.budget.pct}% of monthly budget used`} />
                  <p className="help">{x.budget.remaining > 0 ? <>About <Money minor={Math.floor(x.budget.remaining / daysLeft)} currency={x.currency} /> a day for the next {daysLeft} days.</> : 'You have used the whole budget for this month.'} <Info label="About the budget">{m.dashboard.budgetHelp}</Info></p>
                </>
              ) : (
                <div className="stack" style={{ gap: '.5rem' }}>
                  <strong>Set a monthly budget</strong>
                  <span className="muted small">Pick an amount for the month and Fluxo shows how much is left every day.</span>
                  <Link className="btn btn-primary btn-small" to="/budgets" style={{ alignSelf: 'flex-start' }}>{m.dashboard.setBudget}</Link>
                </div>
              )}
            </div>
          </section>

          <div className="stats">
            <div className="stat"><span className="stat-icon ok"><ArrowDownLeft size={22} aria-hidden="true" /></span><div><div className="stat-label">{m.dashboard.income}</div><div className="stat-value"><Money minor={main.income} currency={x.currency} /></div></div></div>
            <div className="stat"><span className={`stat-icon ${main.net < 0 ? 'bad' : 'accent'}`}><Scale size={22} aria-hidden="true" /></span><div><div className="stat-label">{m.dashboard.net}<Info label="What is left over?">{m.dashboard.netHelp}</Info></div><div className={`stat-value ${main.net < 0 ? 'neg' : ''}`}><Money minor={main.net} currency={x.currency} sign="exceptZero" /></div></div></div>
            <Link to="/recurring" className="stat"><span className="stat-icon warn"><CalendarClock size={22} aria-hidden="true" /></span><div><div className="stat-label">Bills in the next 30 days</div><div className="stat-value">~<Money minor={upcomingTotal} currency={x.currency} /></div></div></Link>
          </div>
          {others.length > 0 && <p className="help">{m.dashboard.otherCurrencies} {others.map((o) => <span key={o.currency} className="chip">{o.currency}: <Money minor={o.spending} currency={o.currency} /> spent</span>)}</p>}

          <div className="grid-2">
            <Card title={m.dashboard.byCategory} actions={<Link to="/reports">{m.dashboard.viewAll}</Link>}>
              {cats.length ? (
                <div className="where">
                  <Donut caption={m.dashboard.byCategory} currency={x.currency} centerLabel="Spent" selected={cat} onSelect={(k) => setCat(cat === k ? null : k)}
                    rows={cats.map((c) => ({ key: c.categoryId ?? 'none', label: c.name, value: c.spending, dot: c.color }))} />
                  <ul className="list" aria-label="Categories">
                    {cats.slice(0, 6).map((c) => {
                      const k = c.categoryId ?? 'none';
                      return (
                        <li key={k}>
                          <button className={`item ${cat === k ? 'barlist-row on' : ''}`} aria-pressed={cat === k} onClick={() => setCat(cat === k ? null : k)}>
                            <CatIcon cat={c.categoryId ? byId.get(c.categoryId) ?? { color: c.color } : null} size={32} />
                            <span className="item-text"><strong>{c.name}</strong><small className="muted">{c.count} payments</small></span>
                            <Money minor={c.spending} currency={x.currency} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : <Empty art="chart" title="No spending yet this month">Your categories appear here as soon as payments come in.</Empty>}
            </Card>
            <Card title={selected ? `${selected.name} this month` : m.dashboard.recent} actions={selected
              ? <><button className="link small" onClick={() => setCat(null)}>Show all</button><Link to={`/transactions?category=${cat}&from=${x.month}-01&to=${x.today}&status=posted`}>{m.dashboard.viewAll}</Link></>
              : <Link to="/transactions">{m.dashboard.viewAll}</Link>}>
              {selected ? (catTx.data ? <TxList rows={catTx.data.rows} onOpen={(t) => nav(`/transactions?open=${t.id}`)} /> : <Loading />) : <TxList rows={x.recent.slice(0, 6)} onOpen={(t) => nav(`/transactions?open=${t.id}`)} />}
            </Card>
          </div>

          <Card title={m.dashboard.trend}>
            <CumulativeChart current={x.trend.current} previous={x.trend.previous} days={x.trend.days} currency={x.currency} />
          </Card>

          <div className="grid-2">
            <Card title={m.dashboard.balances} actions={<Link to="/accounts">Manage</Link>}>
              <ul className="list">
                {x.balances.map((b) => (
                  <li key={b.id} className="item">
                    <span className="stat-icon accent" style={{ width: 38, height: 38 }}><Wallet size={18} aria-hidden="true" /></span>
                    <span className="item-text"><strong>{b.display_name ?? b.name}</strong><small className="muted">{b.balance_label ? `${b.balance_label} · ${fmt.ago(b.balance_at)}` : m.dashboard.noBalance}{!b.included && ' · not in totals'}</small></span>
                    <strong><Money minor={b.balance_minor} currency={b.currency} /></strong>
                  </li>
                ))}
              </ul>
              <p className="help">{m.dashboard.lastSync}: {fmt.ago(x.sync.lastSuccess)}</p>
            </Card>
            <Card title={m.dashboard.upcoming} actions={<Link to="/recurring">{m.dashboard.viewAll}</Link>}>
              {x.upcoming.length ? (
                <ul className="list">
                  {x.upcoming.slice(0, 5).map((u) => (
                    <li key={u.id}>
                      <Link className="item" to="/recurring">
                        <Monogram name={u.merchant} />
                        <span className="item-text"><strong>{u.merchant}</strong><small className="muted">{fmt.shortDate(u.next_date)} · {m.freqs[u.frequency]}{u.status === 'suggested' ? ' · to review' : ''}</small></span>
                        <span>~<Money minor={u.user_amount_minor ?? u.typical_amount_minor} currency={u.currency} /></span>
                        <ChevronRight size={18} aria-hidden="true" className="muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <Empty art="calendar" title={m.dashboard.noUpcoming} />}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
