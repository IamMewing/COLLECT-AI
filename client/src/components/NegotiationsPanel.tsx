import React, { useCallback, useEffect, useState } from 'react';
import type { Conversation, PaymentPlan } from '../types';
import { fetchNegotiations, triggerCheckReplies } from '../api';
import { ChevronDown, MessageSquare, RefreshCw, Siren, Zap } from 'lucide-react';

interface NegotiationsPanelProps {
  /** Bump this (e.g. after an approve/reject completes) to force a refetch
   *  without the person having to click "Refresh" themselves — same
   *  convention as AgentHistory's refreshKey. */
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

const dueLabel = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const days = Math.round((then - Date.now()) / 86_400_000);
  if (days === 0) return 'due today';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `due in ${days}d`;
};

const conversationTag = (status: Conversation['status']) => {
  if (status === 'escalated') return { className: 'tag tag--risk', icon: <Siren size={12} style={{ marginRight: 4 }} />, text: 'Escalated to human' };
  if (status === 'resolved') return { className: 'tag tag--paid', icon: null, text: 'Resolved' };
  return { className: 'tag', icon: null, text: 'Active thread' };
};

const planTag = (status: PaymentPlan['status']) =>
  status === 'completed' ? { className: 'tag tag--paid', text: 'Plan completed' } : { className: 'tag', text: 'Plan active' };

const installmentTag = (status: PaymentPlan['installments'][number]['status']) => {
  if (status === 'paid') return { className: 'tag tag--paid', text: 'Paid' };
  if (status === 'awaiting_payment') return { className: 'tag', text: 'Awaiting payment', live: true };
  return { className: 'tag', text: 'Scheduled' };
};

/**
 * What the autonomous negotiation loop is actually doing: every tracked
 * reply thread (agent/inbox.py polls IMAP, agent/execute.py's
 * handle_incoming_reply decides continue/resolve/escalate) and every
 * multi-installment plan it has negotiated and is now auto-billing — read
 * straight from GET /api/agent/negotiations, so nothing here is simulated.
 * Without this panel, three phases of real backend work (negotiation,
 * PayPal Agent Toolkit orders, payment plans) are invisible in the UI.
 */
export const NegotiationsPanel: React.FC<NegotiationsPanelProps> = ({ refreshKey }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openConvo, setOpenConvo] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchNegotiations();
      setConversations(data.conversations);
      setPlans(data.payment_plans);
    } catch (err: any) {
      setLoadError(err?.details || err?.error || 'Could not load the negotiation state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleCheckNow = async () => {
    setIsChecking(true);
    setCheckNote(null);
    try {
      const result = await triggerCheckReplies();
      const billed = result.billed_installments?.length || 0;
      setCheckNote(
        result.checked === 0 && billed === 0
          ? 'No new replies, and nothing due to bill right now.'
          : `Handled ${result.checked} repl${result.checked === 1 ? 'y' : 'ies'}, billed ${billed} installment${billed === 1 ? '' : 's'}.`
      );
      await load();
    } catch (err: any) {
      setCheckNote(err?.details || err?.error || 'Could not run the check.');
    } finally {
      setIsChecking(false);
    }
  };

  const activeConvoCount = conversations.filter((c) => c.status === 'active').length;
  const activePlanCount = plans.filter((p) => p.status === 'active').length;

  return (
    <div className="pswp">
      <div className="pswp-head">
        <div>
          <h3 className="title" style={{ marginBottom: 6 }}>Still talking it out</h3>
          <p className="body body--sm" style={{ opacity: 0.75, maxWidth: '58ch' }}>
            {activeConvoCount} active thread{activeConvoCount === 1 ? '' : 's'}, {activePlanCount} plan{activePlanCount === 1 ? '' : 's'} mid-payment —
            the agent reading replies, negotiating, and minting real PayPal orders mid-conversation, not just sending one reminder and waiting.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="pill pill--lg" onClick={handleCheckNow} disabled={isChecking}>
            {isChecking ? <span className="spin" /> : <Zap size={16} />}
            {isChecking ? 'Checking…' : 'Check for replies now'}
          </button>
          <button type="button" className="pill pill--lg" onClick={load} disabled={loading}>
            {loading ? <span className="spin" /> : <RefreshCw size={16} />}
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {checkNote && (
        <p className="body body--sm" style={{ opacity: 0.75, marginTop: 14 }}>{checkNote}</p>
      )}
      {loadError && (
        <p className="body body--sm" style={{ color: 'var(--warn)', marginTop: 14 }}>{loadError}</p>
      )}

      {!loading && !loadError && conversations.length === 0 && (
        <p className="body body--sm" style={{ opacity: 0.6, marginTop: 14 }}>
          No reply threads yet — once a client replies to a real email, it'll show up here.
        </p>
      )}

      {conversations.length > 0 && (
        <ul className="pswp-list">
          {conversations.map((c) => {
            const tag = conversationTag(c.status);
            const open = openConvo === c.invoice_id;
            const toggle = () => setOpenConvo(open ? null : c.invoice_id);
            const lastTurn = c.turns[c.turns.length - 1];
            return (
              <li key={c.invoice_id} className="pswp-row">
                <div
                  className="pswp-row-main"
                  role="button"
                  tabIndex={0}
                  onClick={toggle}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } }}
                  aria-expanded={open}
                >
                  <span className="pswp-id mono">{c.invoice_id}</span>
                  <span className="pswp-client">{c.client_name || 'Unknown client'}</span>
                  <span className={tag.className}>{tag.icon}{tag.text}</span>
                  <span className="mono pswp-odds" style={{ opacity: 0.65 }}>
                    <MessageSquare size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                    {c.turns.length} turn{c.turns.length === 1 ? '' : 's'}
                    {lastTurn ? ` · last ${timeAgo(lastTurn.timestamp)}` : ''}
                  </span>
                  <ChevronDown size={14} className={`pswp-chev${open ? ' is-open' : ''}`} />
                </div>
                {open && (
                  <div className="pswp-reason">
                    {c.turns.length === 0 && <p style={{ opacity: 0.6 }}>No turns recorded yet.</p>}
                    {c.turns.map((t, i) => (
                      <p key={i}>
                        <strong>{t.role === 'client' ? `${c.client_name || 'Client'} — ` : 'Agent — '}</strong>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{t.body}</span>
                        <span style={{ opacity: 0.5, fontSize: '0.78rem' }}> ({timeAgo(t.timestamp)})</span>
                      </p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {plans.length > 0 && (
        <>
          <div className="pswp-summary">
            <h3 className="title" style={{ marginBottom: 6, fontSize: '1.1rem' }}>Negotiated payment plans</h3>
            <p className="body body--sm" style={{ opacity: 0.75, maxWidth: '58ch' }}>
              Each installment is its own real PayPal order, billed automatically as it comes due —
              paying one doesn't falsely close the rest.
            </p>
          </div>
          <ul className="pswp-list">
            {plans.map((p) => {
              const tag = planTag(p.status);
              const open = openPlan === p.invoice_id;
              const toggle = () => setOpenPlan(open ? null : p.invoice_id);
              const paidCount = p.installments.filter((i) => i.status === 'paid').length;
              return (
                <li key={p.invoice_id} className="pswp-row">
                  <div
                    className="pswp-row-main"
                    role="button"
                    tabIndex={0}
                    onClick={toggle}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } }}
                    aria-expanded={open}
                  >
                    <span className="pswp-id mono">{p.invoice_id}</span>
                    <span className="pswp-client">{p.client_name || 'Unknown client'}</span>
                    <span className={tag.className}>{tag.text}</span>
                    <span className="mono pswp-odds" style={{ opacity: 0.65 }}>
                      {paidCount}/{p.installments.length} installments paid
                    </span>
                    <ChevronDown size={14} className={`pswp-chev${open ? ' is-open' : ''}`} />
                  </div>
                  {open && (
                    <div className="pswp-reason">
                      {p.installments.map((inst) => {
                        const iTag = installmentTag(inst.status);
                        return (
                          <p key={inst.index} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span className={iTag.className}>
                              {iTag.live && <span className="dot dot--live" style={{ marginRight: 4 }} />}
                              {iTag.text}
                            </span>
                            <span>{inst.description} — ${inst.amount_usd.toFixed(2)}</span>
                            <span style={{ opacity: 0.6, fontSize: '0.82rem' }}>
                              {inst.status === 'paid' ? 'paid' : dueLabel(inst.due_at)}
                            </span>
                            {inst.payment_link && inst.status !== 'paid' && (
                              <a href={inst.payment_link} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: '0.78rem' }}>
                                payment link ↗
                              </a>
                            )}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};

export default NegotiationsPanel;
