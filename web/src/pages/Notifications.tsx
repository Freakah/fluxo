import { Link } from 'react-router';
import { api, useApi } from '../api.ts';
import { m } from '../i18n.ts';
import { useSession, useToast } from '../state.tsx';
import { Card, Empty, ErrorBox, Loading, Badge } from '../components/ui.tsx';
import type { Notification } from '../types.ts';

export function Notifications() {
  const { fmt } = useSession();
  const toast = useToast();
  const n = useApi<Notification[]>('/notifications');
  if (n.error) return <ErrorBox error={n.error} onRetry={() => n.reload()} />;
  if (!n.data) return <Loading />;
  const mark = (id: number, read: boolean) => api(`/notifications/${id}/${read ? 'read' : 'unread'}`, { method: 'POST' }).then(() => n.reload(true)).catch((e) => toast((e as Error).message, { kind: 'error' }));
  return (
    <div className="page">
      <div className="page-head"><h1>{m.notifications.title}</h1>
        <button className="btn" onClick={() => api('/notifications/read-all', { method: 'POST' }).then(() => n.reload(true))}>{m.notifications.markAll}</button></div>
      <Card>
        {!n.data.length ? <Empty title={m.notifications.empty} /> : (
          <ul className="list">
            {n.data.map((x) => (
              <li key={x.id} className={`list-row notif ${x.read_at ? 'read' : 'unread'}`}>
                <span>
                  {!x.read_at && <Badge tone="info">New</Badge>} {x.severity === 'warning' && <span aria-hidden="true">⚠ </span>}
                  <Link to={x.link} onClick={() => { if (!x.read_at) void mark(x.id, true); }}><strong>{x.title}</strong></Link><br />
                  <span>{x.body}</span><br /><small className="muted">{fmt.dateTime(x.created_at)}</small>
                </span>
                <button className="link" onClick={() => mark(x.id, !x.read_at)}>{x.read_at ? m.notifications.markUnread : m.notifications.markRead}</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
