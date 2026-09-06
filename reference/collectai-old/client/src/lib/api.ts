// ============================================
// CollectAI — API Client (Production)
// Uses real Firebase Auth ID token for every request.
// No mock sessions. No localStorage fallback.
// ============================================

import { auth } from '../firebase/config';

const API_BASE = '/api';

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface Business {
  business_id: string;
  name: string;
  owner_email: string;
  owner_contact?: string;
  preferred_channel?: string;
  tone_preference: 'polite' | 'neutral' | 'firm';
  timezone?: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_id: string;
  business_id: string;
  client_name: string;
  client_email?: string;
  amount: number;
  currency?: string;
  due_date: string;
  description?: string;
  status: 'open' | 'paid' | 'escalated' | 'closed';
  escalation_level: number;
  last_action_at?: string;
  next_check_date?: string;
  created_at: string;
}

export interface AgentAction {
  action_id: string;
  invoice_id: string;
  business_id: string;
  decision: 'gentle_reminder' | 'firm_nudge' | 'escalate_to_owner' | 'no_action_needed';
  reasoning_summary: string;
  message_sent?: string;
  email_subject?: string;
  channel: string;
  timestamp: string;
  gemini_model_used?: string;
  outcome: 'sent' | 'failed' | 'skipped' | 'skipped_no_email';
  urgency_score?: number;
  escalation_level?: number;
  email_message_id?: string;
  email_preview_url?: string;
}

export interface DashboardStats {
  open_invoices: number;
  total_amount_outstanding: number;
  total_amount_recovered: number;
  messages_sent: number;
  collection_rate: number;
  estimated_hours_saved: number;
}

// ─── Auth Token Resolution ───────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No authenticated user. Please sign in to continue.');
  }
  return user.getIdToken();
}

// ─── Core Request Helper ─────────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  });

  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON response from ${path}: ${text}`);
  }

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status} on ${path}`);
  }

  return data as T;
}

// ─── API Surface ─────────────────────────────────────────────────────────────

export const api = {

  // ── Businesses ──────────────────────────────────────────────────────────────

  getBusinesses: () =>
    request<Business[]>('/businesses'),

  createBusiness: (data: Omit<Business, 'business_id' | 'created_at'>) =>
    request<Business>('/businesses', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateBusiness: (id: string, data: Partial<Omit<Business, 'business_id' | 'created_at'>>) =>
    request<Business>(`/businesses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ── Invoices ────────────────────────────────────────────────────────────────

  getInvoices: (businessId?: string, status?: string) => {
    const params = new URLSearchParams();
    if (businessId) params.append('business_id', businessId);
    if (status) params.append('status', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<Invoice[]>(`/invoices${query}`);
  },

  createInvoice: (data: Omit<Invoice, 'id' | 'invoice_id' | 'status' | 'escalation_level' | 'created_at'>) =>
    request<Invoice>('/invoices', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateInvoice: (id: string, data: Partial<Invoice>) =>
    request<Invoice>(`/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteInvoice: (id: string) =>
    request<{ success: boolean }>(`/invoices/${id}`, { method: 'DELETE' }),

  // ── Stats ────────────────────────────────────────────────────────────────────

  getStats: (businessId?: string) => {
    const query = businessId ? `?business_id=${businessId}` : '';
    return request<DashboardStats>(`/stats${query}`);
  },

  // ── Payments ─────────────────────────────────────────────────────────────────

  markAsPaid: (invoiceId: string, amount: number) =>
    request<{ success: boolean }>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoice_id: invoiceId,
        amount_recorded: amount,
        marked_by: 'owner',
      }),
    }),

  // ── Agent ────────────────────────────────────────────────────────────────────

  runAgent: (businessId?: string) => {
    const body = businessId ? { business_id: businessId } : {};
    return request<{ jobId: string; status: 'queued' }>('/agent/run', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getActions: (businessId?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (businessId) params.append('business_id', businessId);
    if (limit) params.append('limit', limit.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<AgentAction[]>(`/agent/actions${query}`);
  },

  // ── Copilot ──────────────────────────────────────────────────────────────────

  agentChat: (query: string, conversationId: string, businessId?: string) =>
    request<{
      responseText: string;
      reasoning: string;
      intent: string;
      confidence: number;
      actions: Array<{
        tool: string;
        params: Record<string, any>;
        success: boolean;
        result: any;
        message: string;
      }>;
      uiCommands: Array<{ type: string; payload?: Record<string, any> }>;
      toolResult: any;
      conversationId: string;
      awaitingInput: boolean;
      awaitingField: string | null;
      actionExecuted: boolean;
      executedToolName: string | null;
      durationMs: number;
      evidence: string;
      recommendation: string;
    }>('/agent/copilot', {
      method: 'POST',
      body: JSON.stringify({ query, conversation_id: conversationId, business_id: businessId }),
    }),
};
