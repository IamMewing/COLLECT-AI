import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Invoice, SweepResult, ApproveResult, DraftedMessage, ApiError, PortfolioOutcome } from './types';
import { fetchInvoices, runSweep, approveAndExecute, markInvoicePaid, triggerVoiceCall, checkPaypalStatus } from './api';

/**
 * Shared application state, lifted above the router.
 *
 * Before routing existed this all lived in App.tsx, which worked because the
 * whole product was one scrolling page — nothing could navigate away from a
 * finished agent run. Now that /agent, /ledger and /history are separate
 * routes, this has to outlive any individual page: running the agent on the
 * ledger and then walking over to the approval gate must not throw away the
 * sweep result on the way. Anything a single page owns entirely (a panel's
 * own fetch, a local form) deliberately stays in that page instead.
 */
interface AppStateValue {
  invoices: Invoice[];
  selectedInvoice: Invoice | null;
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isSweeping: boolean;
  isApproving: boolean;
  isMarkingPaid: boolean;
  isCalling: boolean;
  callNote: string | null;
  error: ApiError | null;
  paypalConfigured: boolean;
  historyRefreshKey: number;
  showAddInvoice: boolean;

  setError: (e: ApiError | null) => void;
  setShowAddInvoice: (show: boolean) => void;
  loadInvoices: () => Promise<void>;
  selectInvoice: (inv: Invoice) => void;
  handleRunSweep: (inv: Invoice) => Promise<void>;
  handleApprove: (draft: DraftedMessage, editedBody?: string) => Promise<void>;
  handleReject: (draft: DraftedMessage) => Promise<void>;
  handleReset: () => void;
  handleInvoiceCreated: (invoice: Invoice) => Promise<void>;
  handleMarkPaid: (invoice: Invoice) => Promise<void>;
  handleCallThem: (invoice: Invoice) => Promise<void>;
  handleOpenPortfolioResult: (invoice: Invoice, outcome: PortfolioOutcome) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export const useAppState = (): AppStateValue => {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside <AppStateProvider>');
  return ctx;
};

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [isSweeping, setIsSweeping] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [callNote, setCallNote] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [paypalConfigured, setPaypalConfigured] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [showAddInvoice, setShowAddInvoice] = useState(false);

  useEffect(() => {
    checkPaypalStatus()
      .then((s) => setPaypalConfigured(s.configured))
      .catch(() => setPaypalConfigured(false));
  }, []);

  const loadInvoices = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchInvoices();
      setInvoices(data);
      setSelectedInvoice((cur) => {
        if (!cur) return data.length ? data[0] : null;
        // Keep the same invoice selected across a reload, but pick up any
        // status change (paid/active) that reload just brought in.
        return data.find((i) => i.invoice_id === cur.invoice_id) ?? cur;
      });
    } catch (err: any) {
      console.error('Failed to fetch invoices:', err);
      setError({
        error: err.error || 'Can’t reach the server',
        details: err.details || 'The API didn’t respond. Check the server is running on port 3001.',
        stderr: err.stderr || null,
      });
    }
  }, []);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const selectInvoice = useCallback((inv: Invoice) => {
    setSelectedInvoice(inv);
    setSweepResult(null);
    setApproveResult(null);
    setError(null);
  }, []);

  const handleRunSweep = useCallback(async (inv: Invoice) => {
    try {
      setIsSweeping(true);
      setError(null);
      setApproveResult(null);
      setSelectedInvoice(inv);
      // Go to the reasoning before the work starts — the whole point of
      // pressing this is to watch it think. (Pre-router this was a
      // scrollIntoView; the intent is identical, the mechanism isn't.)
      navigate('/agent');
      const result = await runSweep(inv);
      setSweepResult(result);
    } catch (err: any) {
      console.error('Sweep execution failed:', err);
      setError({
        error: err.error || 'The agent didn’t finish',
        details: err.details || err.message || 'The model may have hit a rate limit. Nothing was lost — try again.',
        stderr: err.stderr || null,
        status: err.status,
      });
    } finally {
      setIsSweeping(false);
    }
  }, [navigate]);

  const handleApprove = useCallback(async (draft: DraftedMessage, editedBody?: string) => {
    try {
      setIsApproving(true);
      setError(null);
      const outcome = await approveAndExecute({
        draft, approved: true, edited_body: editedBody,
        client_name: selectedInvoice?.client_name,
        invoice: selectedInvoice || undefined,
      });
      setApproveResult(outcome);
      setHistoryRefreshKey((k) => k + 1);
      await loadInvoices();
    } catch (err: any) {
      console.error('Approval failed:', err);
      setError({
        error: err.error || 'Couldn’t send that',
        details: err.details || err.message,
        stderr: err.stderr || null,
        status: err.status,
      });
    } finally {
      setIsApproving(false);
    }
  }, [selectedInvoice, loadInvoices]);

  const handleReject = useCallback(async (draft: DraftedMessage) => {
    try {
      setIsApproving(true);
      setError(null);
      const outcome = await approveAndExecute({
        draft, approved: false,
        client_name: selectedInvoice?.client_name,
        invoice: selectedInvoice || undefined,
      });
      setApproveResult(outcome);
      setHistoryRefreshKey((k) => k + 1);
    } catch (err: any) {
      console.error('Rejection failed:', err);
      setError({
        error: err.error || 'Couldn’t record that',
        details: err.details || err.message,
        stderr: err.stderr || null,
        status: err.status,
      });
    } finally {
      setIsApproving(false);
    }
  }, [selectedInvoice]);

  const handleReset = useCallback(() => {
    setSweepResult(null);
    setApproveResult(null);
    setError(null);
  }, []);

  const handleInvoiceCreated = useCallback(async (invoice: Invoice) => {
    setShowAddInvoice(false);
    await loadInvoices();
    selectInvoice(invoice);
  }, [loadInvoices, selectInvoice]);

  const handleMarkPaid = useCallback(async (invoice: Invoice) => {
    setIsMarkingPaid(true);
    try {
      await markInvoicePaid(invoice.invoice_id);
      setSelectedInvoice({ ...invoice, status: 'paid', paid_via: 'manual' });
      await loadInvoices();
    } catch (err) {
      console.error('Failed to mark invoice paid:', err);
    } finally {
      setIsMarkingPaid(false);
    }
  }, [loadInvoices]);

  const handleCallThem = useCallback(async (invoice: Invoice) => {
    setIsCalling(true);
    setCallNote(null);
    try {
      const result = await triggerVoiceCall(invoice.invoice_id);
      setCallNote(
        result.real_call
          ? `Calling ${invoice.client_name} now at ${result.recipient} — watch the negotiations page as it happens.`
          : 'Twilio voice calling is not configured yet, so this was a stub — no real call was placed.'
      );
      setHistoryRefreshKey((k) => k + 1);
    } catch (err: any) {
      setCallNote(err?.details || err?.error || 'Could not place the call.');
    } finally {
      setIsCalling(false);
    }
  }, []);

  /** "Open" on a portfolio-sweep row. A succeeded row already has the full
   *  SweepResult from the batch call — reuse it and go straight to the agent
   *  page, no second network round-trip. A failed row has no pipeline state
   *  to show, so it surfaces the real failure in the error toast instead and
   *  stays put on the ledger, where the retry lives. */
  const handleOpenPortfolioResult = useCallback((invoice: Invoice, outcome: PortfolioOutcome) => {
    setSelectedInvoice(invoice);
    setApproveResult(null);
    if (outcome.ok) {
      setError(null);
      setSweepResult(outcome);
      navigate('/agent');
    } else {
      setSweepResult(null);
      setError({
        error: `The agent failed on ${invoice.client_name}`,
        details: outcome.details || outcome.error,
        stderr: null,
      });
    }
  }, [navigate]);

  const value: AppStateValue = {
    invoices, selectedInvoice, sweepResult, approveResult,
    isSweeping, isApproving, isMarkingPaid, isCalling, callNote,
    error, paypalConfigured, historyRefreshKey, showAddInvoice,
    setError, setShowAddInvoice, loadInvoices, selectInvoice,
    handleRunSweep, handleApprove, handleReject, handleReset,
    handleInvoiceCreated, handleMarkPaid, handleCallThem,
    handleOpenPortfolioResult,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};
