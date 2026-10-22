import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider, NavLink, Outlet, useLocation, useNavigate, Navigate } from 'react-router';
import { SessionProvider, ToastProvider, useSession, useToast } from './state.tsx';
import { api, useApi } from './api.ts';
import { m } from './i18n.ts';
import { Loading } from './components/ui.tsx';
import { Login } from './pages/Login.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Transactions } from './pages/Transactions.tsx';
import { Budgets } from './pages/Budgets.tsx';
import { RecurringPage } from './pages/Recurring.tsx';
import { Reports } from './pages/Reports.tsx';
import { Accounts } from './pages/Accounts.tsx';
import { Categories } from './pages/Categories.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { Notifications } from './pages/Notifications.tsx';
import { Help } from './pages/Help.tsx';
import { DemoBank } from './pages/DemoBank.tsx';

const NAV = [
  ['/', m.nav.dashboard, '◧'], ['/transactions', m.nav.transactions, '≡'], ['/budgets', m.nav.budgets, '◔'], ['/recurring', m.nav.recurring, '↻'],
  ['/reports', m.nav.reports, '▤'], ['/accounts', m.nav.accounts, '⌂'], ['/categories', m.nav.categories, '◇'], ['/settings', m.nav.settings, '⚙'],
] as const;

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

function Shell() {
  const { session, refresh, settings, updateSettings } = useSession();
  const toast = useToast();
  const loc = useLocation();
  const nav = useNavigate();
  const online = useOnline();
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = useApi<{ read_at: string | null }[]>(session?.user ? `/notifications?_=${loc.pathname}` : null);
  useEffect(() => { setMenuOpen(false); document.getElementById('main')?.focus({ preventScroll: true }); }, [loc.pathname]);

  if (!session) return <div className="center-page"><Loading /></div>;
  if (loc.pathname === '/demo-bank') return <DemoBank />;
  if (!session.user) return <Login />;
  const user = session.user;
  const unreadCount = unread.data?.filter((n) => !n.read_at).length ?? 0;

  const signOut = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); await refresh(); nav('/'); };
  const resetDemo = async () => {
    try { await api('/demo/reset', { method: 'POST' }); await refresh(); nav('/'); toast(m.demo.resetDone); } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  };
  const togglePrivacy = () => updateSettings({ hideAmounts: !settings.hideAmounts }).catch((e) => toast((e as Error).message, { kind: 'error' }));

  return (
    <div className="shell">
      <a className="skip" href="#main">{m.nav.skip}</a>
      {user.isDemo && <div className="demo-banner" role="note"><span aria-hidden="true">◆</span> {m.demo.banner} <button className="link" onClick={resetDemo}>{m.demo.reset}</button></div>}
      {!online && <div className="offline-banner" role="alert">{m.errors.offline}</div>}
      <header className="topbar">
        <button className="icon-btn menu-btn" aria-expanded={menuOpen} aria-controls="sidenav" onClick={() => setMenuOpen(!menuOpen)} aria-label={m.nav.menu}>☰</button>
        <NavLink to="/" className="brand"><img src="/favicon.svg" alt="" width={24} height={24} /> {m.app.name}</NavLink>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={togglePrivacy} aria-pressed={settings.hideAmounts} title={settings.hideAmounts ? m.common.showAmounts : m.common.hideAmounts} aria-label={settings.hideAmounts ? m.common.showAmounts : m.common.hideAmounts}>{settings.hideAmounts ? '◌' : '◉'}</button>
          <NavLink to="/notifications" className="icon-btn bell" aria-label={`${m.nav.notifications}${unreadCount ? ` (${unreadCount} unread)` : ''}`}>🔔{unreadCount > 0 && <span className="count" aria-hidden="true">{unreadCount}</span>}</NavLink>
          <button className="btn btn-small" onClick={signOut}>{m.nav.signOut}</button>
        </div>
      </header>
      <div className="layout">
        <nav id="sidenav" className={`sidenav ${menuOpen ? 'open' : ''}`} aria-label="Main">
          <ul>
            {NAV.map(([to, label, icon]) => <li key={to}><NavLink to={to} end={to === '/'}><span aria-hidden="true" className="nav-icon">{icon}</span>{label}</NavLink></li>)}
            <li><NavLink to="/help"><span aria-hidden="true" className="nav-icon">?</span>{m.nav.help}</NavLink></li>
          </ul>
          <p className="nav-foot">{user.isDemo ? 'Demo' : user.email}<br /><small>v{session.version}</small></p>
        </nav>
        <main id="main" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
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
      { path: '/help', element: <Help /> },
      { path: '/demo-bank', element: null },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <SessionProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></SessionProvider>;
}
