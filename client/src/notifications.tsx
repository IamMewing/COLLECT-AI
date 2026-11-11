import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';

export interface AppNotification {
  id: string;
  /** Drives the accent colour and icon. Unknown kinds render neutrally
   *  rather than breaking, so the server can add new ones without a
   *  lockstep client deploy. */
  kind: 'payment' | 'reply' | 'sent' | 'failed' | 'escalation' | 'installment' | 'info';
  title: string;
  body?: string;
  invoice_id?: string;
  client_name?: string;
  at: string;
  read: boolean;
}

interface NotificationsValue {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

export const useNotifications = (): NotificationsValue => {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return ctx;
};

/** How often to re-check for new notifications. Deliberately unhurried: the
 *  events that produce them (a PayPal webhook landing, a scheduled
 *  check-replies run) happen on their own timescale, and this endpoint is
 *  cheap but not free — it's a Firestore read per poll per open tab. */
const POLL_MS = 30_000;

export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
    } catch {
      // A failed poll is not worth surfacing — the next one in 30s may well
      // succeed, and a toast per transient blip would be its own problem.
    } finally {
      setLoading(false);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    // Optimistic: the badge should clear the instant you open the page,
    // not a round-trip later.
    setNotifications((cur) => cur.map((n) => ({ ...n, read: true })));
    try {
      await fetch('/api/notifications/read', { method: 'POST', credentials: 'include' });
    } catch {
      /* next refresh reconciles */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    // Catch up immediately when the tab comes back, rather than waiting out
    // the remainder of an interval that was throttled while backgrounded.
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const unreadCount = notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, loading, refresh, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
};
