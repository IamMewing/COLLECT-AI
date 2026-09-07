import type { Invoice, SweepResult, ApproveResult, DraftedMessage, ApiError } from './types';

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

export async function runSweep(invoice?: Invoice): Promise<SweepResult> {
  const res = await fetch(`${API_BASE}/agent/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice }),
  });
  return handleResponse<SweepResult>(res);
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
