import type { Invoice, SweepResult, ApproveResult, DraftedMessage, ApiError, PortfolioSweepResult, MessageHistoryEntry, NegotiationState, CallTriggerResult } from './types';

const API_BASE = '/api';

/** Every call goes through this so the session cookie (the shared-password
 *  gate, see auth.js) is always sent/received — same-origin requests do
 *  this by default, but local dev runs the client on a different port than
 *  the API, where fetch's default credentials mode ('same-origin') would
 *  silently drop the cookie. 'include' makes both cases work identically. */
function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { ...init, credentials: 'include' });
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errBody: ApiError;
    try {
      errBody = await res.json();
    } catch {
      errBody = {
        error: `HTTP Error ${res.status}`,
        details: res.statusText,
      };
    }
    throw { ...errBody, status: res.status };
  }
  return res.json();
}

export async function fetchInvoices(): Promise<Invoice[]> {
  const res = await apiFetch('/agent/invoices');
  const data = await handleResponse<{ invoices: Invoice[] }>(res);
  return data.invoices;
}

export async function createInvoice(payload: {
  client_name: string;
  amount: number;
  days_overdue?: number;
  ignored_reminders?: number;
  relationship_score?: number;
  historical_on_time_rate?: number;
  email?: string;
}): Promise<Invoice> {
  const res = await apiFetch('/agent/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ invoice: Invoice }>(res);
  return data.invoice;
}

/** Edits an existing invoice in place. Only send the fields that changed —
 *  anything omitted is left as-is server-side. Pass email: '' or phone: ''
 *  to clear that field (e.g. to switch an invoice's channel). */
export async function updateInvoice(
  invoiceId: string,
  payload: Partial<{
    client_name: string;
    amount: number;
    days_overdue: number;
    ignored_reminders: number;
    relationship_score: number;
    historical_on_time_rate: number;
    email: string;
    phone: string;
  }>
): Promise<Invoice> {
  const res = await apiFetch(`/agent/invoices/${encodeURIComponent(invoiceId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ invoice: Invoice }>(res);
  return data.invoice;
}

/** Permanently removes an invoice from the ledger. Does not touch its
 *  message-history or PayPal-order audit trail. */
export async function deleteInvoice(invoiceId: string): Promise<{ invoice_id: string; status: 'deleted' }> {
  const res = await apiFetch(`/agent/invoices/${encodeURIComponent(invoiceId)}`, {
    method: 'DELETE',
  });
  return handleResponse(res);
}

export interface ImportInvoicesResult {
  created: Invoice[];
  created_count: number;
  errors: { row: number; error: string }[];
  warnings?: string[];
}

/** Bulk-creates invoices from a CSV file's raw text. Partial success is
 *  normal — check `errors` even on a 2xx response, since some rows can
 *  fail while others are saved. See server/csvImport.js for the expected
 *  columns. */
export async function importInvoicesCsv(csvText: string): Promise<ImportInvoicesResult> {
  const res = await apiFetch('/agent/invoices/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: csvText }),
  });
  return handleResponse<ImportInvoicesResult>(res);
}

export async function markInvoicePaid(invoiceId: string): Promise<{ invoice_id: string; status: 'paid' }> {
  const res = await apiFetch(`/agent/invoices/${encodeURIComponent(invoiceId)}/mark-paid`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function runSweep(invoice?: Invoice): Promise<SweepResult> {
  const res = await apiFetch('/agent/sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice }),
  });
  return handleResponse<SweepResult>(res);
}

/** Sweeps every open invoice at once, or just `invoiceIds` if given. */
export async function sweepPortfolio(invoiceIds?: string[]): Promise<PortfolioSweepResult> {
  const res = await apiFetch('/agent/sweep-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(invoiceIds && invoiceIds.length ? { invoice_ids: invoiceIds } : {}),
  });
  return handleResponse<PortfolioSweepResult>(res);
}

export async function approveAndExecute(params: {
  draft: DraftedMessage;
  approved: boolean;
  edited_body?: string;
  client_name?: string;
  invoice?: Invoice;
}): Promise<ApproveResult> {
  const res = await apiFetch('/agent/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse<ApproveResult>(res);
}

export async function checkHealth(): Promise<{ status: string; service: string; mode: string }> {
  const res = await apiFetch('/health');
  return handleResponse(res);
}

/** The agent's sent-message audit log — what it sent, to whom, and when
 *  (most recent first), for the History panel. */
export async function fetchMessageHistory(limit = 100): Promise<MessageHistoryEntry[]> {
  const res = await apiFetch(`/history?limit=${encodeURIComponent(String(limit))}`);
  const data = await handleResponse<{ entries: MessageHistoryEntry[] }>(res);
  return data.entries;
}

/** Every tracked conversation thread and payment plan, regardless of
 *  status — what the Negotiations panel polls (GET /api/agent/negotiations).
 *  Read-only: never triggers anything server-side. */
export async function fetchNegotiations(): Promise<NegotiationState> {
  const res = await apiFetch('/agent/negotiations');
  return handleResponse<NegotiationState>(res);
}

/** Manually fires the same inbox-poll + due-installment-billing job Cloud
 *  Scheduler would normally trigger on a timer (POST /api/agent/check-replies)
 *  — so a live demo doesn't have to sit and wait out the schedule interval to
 *  show a reply actually being handled. Safe to call anytime: idempotent on
 *  an empty inbox / no due installments. */
export async function triggerCheckReplies(): Promise<{
  checked: number;
  results: Array<Record<string, unknown>>;
  billed_installments: Array<Record<string, unknown>>;
}> {
  const res = await apiFetch('/agent/check-replies', { method: 'POST' });
  return handleResponse(res);
}

export async function checkPaypalStatus(): Promise<{
  configured: boolean;
  environment: string;
  webhook_configured: boolean;
}> {
  const res = await apiFetch('/paypal/status');
  return handleResponse(res);
}

// ── Shared-password gate ────────────────────────────────────────────────────
// See server/auth.js. `required` is false when ACCESS_PASSWORD isn't set on
// the server at all — local dev and any deployment that hasn't opted in.

export async function fetchAuthStatus(): Promise<{ required: boolean; authenticated: boolean }> {
  const res = await apiFetch('/auth/status');
  return handleResponse(res);
}

export async function login(password: string): Promise<{ authenticated: boolean }> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return handleResponse(res);
}

export async function logout(): Promise<{ authenticated: boolean }> {
  const res = await apiFetch('/auth/logout', { method: 'POST' });
  return handleResponse(res);
}

/** Places a real outbound AI voice call to this invoice's client (Phase 5) —
 *  the call itself unfolds over actual phone minutes after this returns, so
 *  this only confirms Twilio accepted the request. Watch NegotiationsPanel
 *  (channel: 'phone') for the conversation as it happens. */
export async function triggerVoiceCall(invoiceId: string): Promise<CallTriggerResult> {
  const res = await apiFetch(`/agent/invoices/${encodeURIComponent(invoiceId)}/call`, {
    method: 'POST',
  });
  return handleResponse(res);
}
