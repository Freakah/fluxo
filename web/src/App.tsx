import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, NavLink, Link, Outlet, useLocation, useNavigate, Navigate } from 'react-router';
import {
  House, ListOrdered, Target, CalendarClock, ChartPie, Landmark, Tags, Settings as SettingsIcon, CircleHelp, Bell, Eye, EyeOff,
  Search, Menu, LogOut, Ellipsis, CircleCheck, TriangleAlert, Compass, FlaskConical, Inbox,
} from 'lucide-react';
import { CategoriesProvider, SessionProvider, ToastProvider, useSession, useToast } from './state.tsx';
import { api, useApi } from './api.ts';
import { m, t } from './i18n.ts';
import { Loading, Popover } from './components/ui.tsx';
import { CommandPalette, Tour, Welcome } from './components/overlays.tsx';
import { Login } from './pages/Login.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Transactions } from './pages/Transactions.tsx';
const Budgets = lazy(() => import('./pages/Budgets.tsx').then((x) => ({ default: x.Budgets })));
const RecurringPage = lazy(() => import('./pages/Recurring.tsx').then((x) => ({ default: x.RecurringPage })));
const Reports = lazy(() => import('./pages/Reports.tsx').then((x) => ({ default: x.Reports })));
const Accounts = lazy(() => import('./pages/Accounts.tsx').then((x) => ({ default: x.Accounts })));
const Categories = lazy(() => import('./pages/Categories.tsx').then((x) => ({ default: x.Categories })));
const SettingsPage = lazy(() => import('./pages/Settings.tsx').then((x) => ({ default: x.SettingsPage })));
const Notifications = lazy(() => import('./pages/Notifications.tsx').then((x) => ({ default: x.Notifications })));
const Review = lazy(() => import('./pages/Review.tsx').then((x) => ({ default: x.Review })));
const Help = lazy(() => import('./pages/Help.tsx').then((x) => ({ default: x.Help })));
import { DemoBank } from './pages/DemoBank.tsx';
import type { Connection, Notification } from './types.ts';

type NavItem = { to: string; label: string; icon: ReactNode; tour: string; badge?: number };
const I = 20;
const HOME: NavItem = { to: '/', label: m.nav.dashboard, icon: <House size={I} />, tour: 'nav-home' };
const REVIEW: NavItem = { to: '/review', label: m.nav.review, icon: <Inbox size={I} />, tour: 'nav-review' };
const MONEY: NavItem[] = [
  REVIEW,
  { to: '/transactions', label: m.nav.transactions, icon: <ListOrdered size={I} />, tour: 'nav-activity' },
  { to: '/budgets', label: m.nav.budgets, icon: <Target size={I} />, tour: 'nav-budgets' },
  { to: '/recurring', label: m.nav.recurring, icon: <CalendarClock size={I} />, tour: 'nav-bills' },
  { to: '/reports', label: m.nav.reports, icon: <ChartPie size={I} />, tour: 'nav-insights' },
];
const SETUP: NavItem[] = [
  { to: '/accounts', label: m.nav.accounts, icon: <Landmark size={I} />, tour: 'nav-banks' },
  { to: '/categories', label: m.nav.categories, icon: <Tags size={I} />, tour: 'nav-categories' },
  { to: '/settings', label: m.nav.settings, icon: <SettingsIcon size={I} />, tour: 'nav-settings' },
  { to: '/help', label: m.nav.help, icon: <CircleHelp size={I} />, tour: 'nav-help' },
];
const ALL = [HOME, ...MONEY, ...SETUP];

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

function SyncPill({ conns }: { conns: Connection[] | undefined }) {
  const { fmt } = useSession();
  if (!conns) return null;
  const live = conns.filter((c) => c.status !== 'disconnected');
  if (!live.length) return <Link to="/accounts" className="sync-pill idle" data-tour="sync" aria-label={t('No bank connected')}><Landmark size={15} aria-hidden="true" /><span className="sync-text">{t('No bank connected')}</span></Link>;
  const bad = live.filter((c) => c.status !== 'active');
  const last = live.map((c) => c.last_success_at).filter(Boolean).sort().at(-1) ?? null;
  return bad.length
    ? <Link to="/accounts" className="sync-pill warn" data-tour="sync" aria-label={t('{n} bank connection needs attention', { n: bad.length })}><TriangleAlert size={15} aria-hidden="true" /><span className="sync-text">{t('Needs attention')}</span></Link>
    : <Link to="/accounts" className="sync-pill ok" data-tour="sync" aria-label={t('Banks synced {ago}', { ago: fmt.ago(last) })}><CircleCheck size={15} aria-hidden="true" /><span className="sync-text">{t('Synced {ago}', { ago: fmt.ago(last) })}</span></Link>;
}

function NotificationsMenu({ items, reload }: { items: Notification[] | undefined; reload: () => void }) {
  const { fmt } = useSession();
  const unread = items?.filter((n) => !n.read_at).length ?? 0;
  const read = (id: number) => api(`/notifications/${id}/read`, { method: 'POST' }).then(reload).catch(() => undefined);
  return (
    <Popover label={`${m.nav.notifications}${unread ? ` (${t('{n} unread', { n: unread })})` : ''}`} className="bell" button={<><Bell size={20} aria-hidden="true" />{unread > 0 && <span className="count" aria-hidden="true">{unread}</span>}</>}>
      {(close) => (
        <div className="notif-pop">
          <div className="notif-pop-head"><strong>{m.nav.notifications}</strong>{unread > 0 && <button className="link small" onClick={() => { void api('/notifications/read-all', { method: 'POST' }).then(reload); }}>{m.notifications.markAll}</button>}</div>
          {items?.length ? (
            <ul className="notif-list">
              {items.slice(0, 6).map((n) => (
                <li key={n.id}>
                  <Link to={n.link} className="notif-item" onClick={() => { if (!n.read_at) void read(n.id); close(); }}>
                    <span className={`notif-dot ${n.read_at ? 'read' : ''}`} aria-hidden="true" />
                    <span><strong>{t(n.title)}</strong><small className="muted">{t(n.body)}</small><small className="muted">{fmt.ago(n.created_at)}</small></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="muted" style={{ padding: '1rem' }}>{m.notifications.empty}</p>}
          <div className="notif-pop-foot"><Link to="/notifications" onClick={close}>{t('See all notifications')}</Link></div>
        </div>
      )}
    </Popover>
  );
}

function ProfileMenu({ email, isDemo, onSignOut, onTour, up }: { email: string; isDemo: boolean; onSignOut: () => void; onTour: () => void; up?: boolean }) {
  const name = isDemo ? t('Demo') : email;
  return (
    <Popover label={m.nav.profile} align="start" className={up ? 'profile-pop' : undefined} button={
      <span className="profile" style={{ padding: 0, minHeight: 0 }}>
        <span className="avatar" aria-hidden="true">{name[0]?.toUpperCase()}</span>
        {up && <span className="profile-text"><strong>{name}</strong><small className="muted">{isDemo ? t('Simulated data') : t('Signed in')}</small></span>}
      </span>}>
      {(close) => (
        <div className={up ? 'up' : undefined}>
          <div className="menu-head">{name}</div>
          <Link className="menu-item" to="/settings" onClick={close}><SettingsIcon size={18} aria-hidden="true" />{m.nav.settings}</Link>
          <button className="menu-item" onClick={() => { close(); onTour(); }}><Compass size={18} aria-hidden="true" />{t('Take the tour')}</button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={onSignOut}><LogOut size={18} aria-hidden="true" />{m.nav.signOut}</button>
        </div>
      )}
    </Popover>
  );
}

function Shell() {
  const { session, refresh, settings, updateSettings } = useSession();
  const toast = useToast();
  const loc = useLocation();
  const nav = useNavigate();
  const online = useOnline();
  const [menuOpen, setMenuOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [tour, setTour] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const authed = !!session?.user;
  const notes = useApi<Notification[]>(authed ? `/notifications?_=${loc.pathname}` : null);
  const conns = useApi<Connection[]>(authed ? `/connections?_=${loc.pathname}` : null);
  const review = useApi<{ total: number }>(authed ? `/review/count?_=${loc.pathname}` : null);
  const reloadReview = review.reload;
  useEffect(() => { const h = () => void reloadReview(true); addEventListener('fluxo:review', h); return () => removeEventListener('fluxo:review', h); }, [reloadReview]);
  useEffect(() => { setMenuOpen(false); document.getElementById('main')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > 4);
    addEventListener('scroll', onScroll, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
      else if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) { e.preventDefault(); nav('/transactions?focus=1'); }
    };
    addEventListener('keydown', onKey);
    const onTour = () => setTour(true);
    addEventListener('fluxo:tour', onTour);
    return () => { removeEventListener('scroll', onScroll); removeEventListener('keydown', onKey); removeEventListener('fluxo:tour', onTour); };
  }, [nav]);
  const finishWelcome = useCallback((startTour: boolean) => {
    updateSettings({ onboarded: true }).catch(() => undefined);
    if (startTour) setTimeout(() => setTour(true), 250);
  }, [updateSettings]);
  const endTour = useCallback(() => setTour(false), []);

  if (!session) return <div className="center-page"><Loading /></div>;
  if (loc.pathname === '/demo-bank') return <DemoBank />;
  if (!session.user) return <Login />;
  const user = session.user;

  const signOut = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); await refresh(); nav('/'); };
  const resetDemo = async () => {
    try { await api('/demo/reset', { method: 'POST' }); await refresh(); nav('/'); toast(m.demo.resetDone); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  };
  const togglePrivacy = () => updateSettings({ hideAmounts: !settings.hideAmounts }).catch((e) => toast((e as Error).message, { kind: 'error' }));
  const link = (n: NavItem) => (
    <li key={n.to}><NavLink to={n.to} end={n.to === '/'} data-tour={n.tour}><span aria-hidden="true" className="nav-icon">{n.icon}</span>{t(n.label)}{n === REVIEW && !!review.data?.total && <span className="nav-badge"><span className="sr-only">, </span>{review.data.total}<span className="sr-only"> {t('waiting')}</span></span>}</NavLink></li>
  );

  return (
    <CategoriesProvider>
      <a className="skip" href="#main">{m.nav.skip}</a>
      {user.isDemo && <div className="demo-banner" role="note"><FlaskConical size={16} aria-hidden="true" /> {m.demo.banner} <button className="link" onClick={resetDemo}>{m.demo.reset}</button></div>}
      {!online && <div className="offline-banner" role="alert">{m.errors.offline}</div>}
      <div className="shell">
        <nav id="sidenav" className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label={t('Main')}>
          <NavLink to="/" className="brand" aria-label={t('Fluxo home')}><img src="/favicon.svg" alt="" width={32} height={32} />{m.app.name}</NavLink>
          <button className="side-search" onClick={() => setPalette(true)} data-tour="search"><Search size={17} aria-hidden="true" />{m.nav.search}<kbd>Ctrl K</kbd></button>
          <ul className="nav">{link(HOME)}</ul>
          <div className="nav-group-label" aria-hidden="true">{m.nav.groupMoney}</div>
          <ul className="nav">{MONEY.map(link)}</ul>
          <div className="nav-group-label" aria-hidden="true">{m.nav.groupSetup}</div>
          <ul className="nav">{SETUP.map(link)}</ul>
          <div className="side-foot">
            <ProfileMenu email={user.email} isDemo={user.isDemo} onSignOut={signOut} onTour={() => setTour(true)} up />
          </div>
        </nav>
        <div className={`scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
        <div className="mainwrap">
          <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
            <button className="icon-btn menu-btn" aria-expanded={menuOpen} aria-controls="sidenav" onClick={() => setMenuOpen(!menuOpen)} aria-label={m.nav.menu}><Menu size={22} aria-hidden="true" /></button>
            <NavLink to="/" className="brand" aria-label={t('Fluxo home')}><img src="/favicon.svg" alt="" width={28} height={28} />{m.app.name}</NavLink>
            <div className="topbar-actions">
              <SyncPill conns={conns.data} />
              <button className="icon-btn" onClick={() => setPalette(true)} aria-label={m.nav.search} title={t('Search (Ctrl K)')}><Search size={20} aria-hidden="true" /></button>
              <button className="icon-btn" data-tour="privacy" onClick={togglePrivacy} aria-pressed={settings.hideAmounts} title={settings.hideAmounts ? m.common.showAmounts : m.common.hideAmounts} aria-label={settings.hideAmounts ? m.common.showAmounts : m.common.hideAmounts}>
                {settings.hideAmounts ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
              <NotificationsMenu items={notes.data} reload={() => void notes.reload(true)} />
            </div>
          </header>
          <main id="main" tabIndex={-1}><Suspense fallback={<div className="page"><Loading rows={5} /></div>}><Outlet /></Suspense></main>
        </div>
      </div>
      <nav className="bottom-nav" aria-label={t('Quick')}>
        {[HOME, REVIEW, MONEY[1], MONEY[4]].map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} data-tour={n.tour}><span aria-hidden="true">{n.icon}</span>{t(n.label)}</NavLink>)}
        <button onClick={() => setMenuOpen(true)} aria-controls="sidenav" aria-expanded={menuOpen}><span aria-hidden="true"><Ellipsis size={20} /></span>{m.nav.more}</button>
      </nav>
      <CommandPalette open={palette} onClose={() => setPalette(false)} pages={ALL} onTour={() => setTour(true)} />
      {!settings.onboarded && !tour && <Welcome onDone={finishWelcome} />}
      {tour && <Tour onDone={endTour} />}
    </CategoriesProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/transactions', element: <Transactions /> },
      { path: '/budgets', element: <Budgets /> },
      { path: '/recurring', element: <RecurringPage /> },
      { path: '/reports', element: <Reports /> },
      { path: '/accounts', element: <Accounts /> },
      { path: '/categories', element: <Categories /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/notifications', element: <Notifications /> },
      { path: '/review', element: <Review /> },
      { path: '/help', element: <Help /> },
      { path: '/demo-bank', element: null },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

// Remounting on a language change re-renders every page in the new language.
function Routes() { const { lang } = useSession(); return <RouterProvider key={lang} router={router} />; }

export function App() {
  return <SessionProvider><ToastProvider><Routes /></ToastProvider></SessionProvider>;
}

