import type { Invoice, SweepResult, ApproveResult, DraftedMessage, ApiError, PortfolioSweepResult } from './types';

const API_BASE = '/api';

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
    throw errBody;
  }
  return res.json();
}

export async function fetchInvoices(): Promise<Invoice[]> {
  const res = await fetch(`${API_BASE}/agent/invoices`);
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
}): Promise<Invoice> {
  const res = await fetch(`${API_BASE}/agent/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ invoice: Invoice }>(res);
  return data.invoice;
}

export async function markInvoicePaid(invoiceId: string): Promise<{ invoice_id: string; status: 'paid' }> {
  const res = await fetch(`${API_BASE}/agent/invoices/${encodeURIComponent(invoiceId)}/mark-paid`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function runSweep(invoice?: Invoice): Promise<SweepResult> {
  const res = await fetch(`${API_BASE}/agent/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice }),
  });
  return handleResponse<SweepResult>(res);
}

/** Sweeps every open invoice at once, or just `invoiceIds` if given. */
export async function sweepPortfolio(invoiceIds?: string[]): Promise<PortfolioSweepResult> {
  const res = await fetch(`${API_BASE}/agent/sweep-all`, {
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
  const res = await fetch(`${API_BASE}/agent/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse<ApproveResult>(res);
}

export async function checkHealth(): Promise<{ status: string; service: string; mode: string }> {
  const res = await fetch(`${API_BASE}/health`);
  return handleResponse(res);
}

export async function checkPaypalStatus(): Promise<{
  configured: boolean;
  environment: string;
  webhook_configured: boolean;
}> {
  const res = await fetch(`${API_BASE}/paypal/status`);
  return handleResponse(res);
}
