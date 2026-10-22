import { Link } from 'react-router';
import { TriangleAlert, Info, CheckCheck } from 'lucide-react';
import { api, useApi } from '../api.ts';
import { m, t } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Card, Empty, ErrorBox, Loading, Badge, PageHeader } from '../components/ui.tsx';
import type { Notification } from '../types.ts';

export function Notifications() {
  const { fmt } = useSession();
  const toast = useToast();
  const n = useApi<Notification[]>('/notifications');
  if (n.error) return <div className="page"><ErrorBox error={n.error} onRetry={() => n.reload()} /></div>;
  if (!n.data) return <div className="page"><Loading rows={5} /></div>;
  const mark = (id: number, read: boolean) => api(`/notifications/${id}/${read ? 'read' : 'unread'}`, { method: 'POST' }).then(() => n.reload(true)).catch((e) => toast((e as Error).message, { kind: 'error' }));
  return (
    <div className="page">
      <PageHeader title={m.notifications.title} subtitle={t('Budget alerts, bank connection problems and new bills.')}
        actions={n.data.some((x) => !x.read_at) && <button className="btn" onClick={() => api('/notifications/read-all', { method: 'POST' }).then(() => n.reload(true))}><CheckCheck size={18} aria-hidden="true" />{m.notifications.markAll}</button>} />
      <Card>
        {!n.data.length ? <Empty art="done" title={m.notifications.empty}>{t('New alerts about budgets and your banks will show up here.')}</Empty> : (
          <ul className="list">
            {n.data.map((x) => (
              <li key={x.id} className="item" style={{ opacity: x.read_at ? 0.75 : 1 }}>
                <span className={`stat-icon ${x.severity === 'warning' ? 'warn' : 'accent'}`} style={{ width: 40, height: 40 }}>{x.severity === 'warning' ? <TriangleAlert size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}</span>
                <span className="item-text" style={{ whiteSpace: 'normal' }}>
                  <span>{!x.read_at && <Badge tone="info">{t('New')}</Badge>} <Link to={x.link} onClick={() => { if (!x.read_at) void mark(x.id, true); }}><strong>{t(x.title)}</strong></Link></span>
                  <span className="muted small">{t(x.body)}</span>
                  <small className="muted">{fmt.dateTime(x.created_at)}</small>
                </span>
                <button className="link small" onClick={() => mark(x.id, !x.read_at)}>{x.read_at ? m.notifications.markUnread : m.notifications.markRead}</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
