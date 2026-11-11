import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PageField } from '../components/PageField';
import { useNotifications, type AppNotification } from '../notifications';
import { BadgeCheck, MessageSquare, Send, AlertTriangle, Flag, CalendarClock, Info } from 'lucide-react';

const ICONS: Record<AppNotification['kind'], React.ElementType> = {
  payment: BadgeCheck,
  reply: MessageSquare,
  sent: Send,
  failed: AlertTriangle,
  escalation: Flag,
  installment: CalendarClock,
  info: Info,
};

/** Relative time, because "4 minutes ago" is what you actually want to know
 *  about a payment landing — the absolute timestamp is kept in the title
 *  attribute for when it isn't. */
const ago = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

export const NotificationsPage: React.FC = () => {
  const { notifications, unreadCount, loading, markAllRead } = useNotifications();

  // Opening the page is the act of reading them. This runs once on mount
  // rather than on every change, so a notification that arrives while
  // you're sitting on the page still shows up as unread.
  useEffect(() => {
    if (unreadCount > 0) markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageField
      id="notifications"
      tone="ink"
      tight
      marker="What happened"
      statement="Every event, the moment it lands"
    >
      {loading && notifications.length === 0 ? (
        <p className="body" style={{ opacity: 0.6 }}>Loading…</p>
      ) : notifications.length === 0 ? (
        <div className="empty">
          <h3 className="title">Nothing has happened yet</h3>
          <p className="body" style={{ marginTop: 12, opacity: 0.8 }}>
            Payments landing, clients replying, messages failing to send, installments
            coming due — they all show up here the moment they happen. Run the agent on
            an account and this starts filling up.
          </p>
          <Link className="pill pill--lg pill--solid" to="/ledger" style={{ marginTop: 26 }}>
            Go to the ledger
          </Link>
        </div>
      ) : (
        <ul className="notif-list">
          {notifications.map((n) => {
            const Icon = ICONS[n.kind] ?? Info;
            return (
              <li key={n.id} className={`notif notif--${n.kind}${n.read ? '' : ' is-unread'}`}>
                <span className="notif-icon"><Icon size={17} /></span>
                <div className="notif-main">
                  <p className="notif-title">
                    {n.title}
                    {!n.read && <span className="notif-dot" aria-label="unread" />}
                  </p>
                  {n.body && <p className="body body--sm notif-body">{n.body}</p>}
                  <p className="mono notif-meta" title={new Date(n.at).toLocaleString()}>
                    {[n.client_name, n.invoice_id].filter(Boolean).join(' · ')}
                    {(n.client_name || n.invoice_id) && ' · '}
                    {ago(n.at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageField>
  );
};

export default NotificationsPage;
