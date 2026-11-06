import React, { useCallback, useEffect, useState } from 'react';
import type { MessageHistoryEntry } from '../types';
import { fetchMessageHistory } from '../api';
import { ChevronDown, Mail, RefreshCw, XCircle } from 'lucide-react';

interface AgentHistoryProps {
  /** Bump this (e.g. after an approve/reject completes) to force a refetch
   *  without the person having to click "Refresh" themselves. */
  refreshKey: number;
}

const timeAgo = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const channelLabel = (channel: string): string => {
  if (channel === 'whatsapp') return 'WhatsApp';
  if (channel === 'sms') return 'SMS';
  if (channel === 'phone') return 'phone call';
  return 'email';
};

const statusLabel = (e: MessageHistoryEntry): { text: string; tone: 'sent' | 'rejected' | 'real' } => {
  if (e.status === 'rejected') return { text: 'Rejected by reviewer', tone: 'rejected' };
  if (e.real_send) return { text: `Sent (real ${channelLabel(e.channel)})`, tone: 'real' };
  return { text: 'Sent (mock)', tone: 'sent' };
};

/**
 * The agent's audit trail: what it actually sent (or didn't), to whom, and
 * when — reading straight from GET /api/history, which the Python agent
 * writes to on every approve/reject (agent/memory.py's record_message_history),
 * mock or real, Firestore or local JSON. Without this, "the agent sent an
 * email" is a claim the person can't check; this is the receipt.
 */
export const AgentHistory: React.FC<AgentHistoryProps> = ({ refreshKey }) => {
  const [entries, setEntries] = useState<MessageHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchMessageHistory(100);
      setEntries(data);
    } catch (err: any) {
      setLoadError(err?.details || err?.error || 'Could not load the message history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div className="pswp">
      <div className="pswp-head">
        <div>
          <h3 className="title" style={{ marginBottom: 6 }}>What it actually sent</h3>
          <p className="body body--sm" style={{ opacity: 0.75, maxWidth: '52ch' }}>
            Every message the agent dispatched or rejected, who it went to, and when —
            the receipt for every "I sent that" the agent makes.
          </p>
        </div>
        <button type="button" className="pill pill--lg" onClick={load} disabled={loading}>
          {loading ? <span className="spin" /> : <RefreshCw size={16} />}
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loadError && (
        <p className="body body--sm" style={{ color: 'var(--warn)', marginTop: 14 }}>{loadError}</p>
      )}

      {!loading && !loadError && entries.length === 0 && (
        <p className="body body--sm" style={{ opacity: 0.6, marginTop: 14 }}>
          Nothing sent yet — approve a drafted message and it'll show up here.
        </p>
      )}

      {entries.length > 0 && (
        <ul className="pswp-list">
          {entries.map((e, i) => {
            const { text, tone } = statusLabel(e);
            const open = openRow === i;
            const toggle = () => setOpenRow(open ? null : i);
            return (
              <li key={`${e.invoice_id ?? 'unknown'}-${e.timestamp}-${i}`} className="pswp-row">
                <div
                  className="pswp-row-main"
                  role="button"
                  tabIndex={0}
                  onClick={toggle}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } }}
                  aria-expanded={open}
                >
                  <span className="pswp-id mono">{e.invoice_id || '—'}</span>
                  <span className="pswp-client">{e.client_name || 'Unknown client'}</span>
                  <span className={`tag${tone === 'rejected' ? ' tag--risk' : ''}`} style={tone === 'sent' ? { opacity: 0.75 } : undefined}>
                    {tone === 'rejected' && <XCircle size={12} style={{ marginRight: 4 }} />}
                    {tone === 'real' && <Mail size={12} style={{ marginRight: 4 }} />}
                    {text}
                  </span>
                  <span className="mono pswp-odds" style={{ opacity: 0.65 }}>
                    {(e.recipient || e.recipient_email) ? `to ${e.recipient || e.recipient_email}` : 'to demo inbox'} · {timeAgo(e.timestamp)}
                  </span>
                  <ChevronDown size={14} className={`pswp-chev${open ? ' is-open' : ''}`} />
                </div>
                {open && (
                  <div className="pswp-reason">
                    {e.subject && <p><strong>Subject — </strong>{e.subject}</p>}
                    <p style={{ whiteSpace: 'pre-wrap' }}>{e.body}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AgentHistory;
