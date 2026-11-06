export type RiskCategory = 'Low' | 'Medium' | 'High' | 'Critical';
export type PlanBranch = 'standard' | 'escalation' | 'no_action';
export type CommunicationChannel = 'email' | 'whatsapp' | 'phone' | 'none';
export type CommunicationTone = 'friendly' | 'firm' | 'urgent' | 'none';

export interface Invoice {
  invoice_id: string;
  client_name: string;
  amount: number;
  days_overdue: number;
  ignored_reminders: number;
  relationship_score: number;
  historical_on_time_rate: number;
  scenario?: string;
  /** The client's real email address, used as the send target instead of
   * the fixed demo inbox when SEND_REAL_EMAIL is on. Optional — invoices
   * without one (e.g. the curated sample set) still work exactly as before. */
  email?: string;
  status?: 'active' | 'paid';
  /** How this invoice was closed, when status is 'paid': 'paypal' means a
   * real PayPal webhook confirmed payment automatically; 'manual' means a
   * human clicked "Mark as Paid". Undefined for still-active invoices. */
  paid_via?: 'manual' | 'paypal';
}

export interface RiskAssessment {
  score: number;
  category: RiskCategory;
  reasoning: string;
}

export interface ProbabilityAssessment {
  probability: number;
  explanation: string;
}

export interface ActionPlan {
  branch: PlanBranch;
  channel: CommunicationChannel;
  tone: CommunicationTone;
  reasoning: string;
}

export interface DraftedMessage {
  subject: string;
  body: string;
  channel: 'email' | 'whatsapp';
}

export interface Reflection {
  was_best_decision: boolean;
  suggested_tone_shift: string;
  suggested_relationship_delta: number;
}

export interface SweepResult {
  invoice: Invoice;
  risk: RiskAssessment;
  probability: ProbabilityAssessment;
  plan: ActionPlan;
  draft: DraftedMessage | null;
  client_memory?: any;
}

export interface ApproveResult {
  status: string;
  reason?: string | null;
  channel?: string;
  subject?: string;
  final_body?: string;
  reflection?: Reflection | null;
  client_memory?: any;
  send_result?: {
    status: string;
    channel: string;
  };
  /** Real PayPal sandbox payment link, when PayPal is configured and the
   * invoice creation call succeeded. Null otherwise (graceful fallback). */
  paypal_payment_link?: string | null;
}

export interface ApiError {
  error: string;
  details?: string;
  stderr?: string | null;
  status?: number;
}

/** One invoice's outcome inside a portfolio sweep — either a normal
 *  SweepResult's fields (plus the id/name duplicated at the top level by the
 *  server for convenience), tagged ok:true, or a per-invoice failure that
 *  doesn't take the rest of the batch down with it. */
export type PortfolioOutcome =
  | ({ invoice_id: string; client_name: string; ok: true } & SweepResult)
  | { invoice_id: string; client_name: string; ok: false; error: string; details?: string | null };

export interface PortfolioSummary {
  total: number;
  escalation: number;
  standard: number;
  no_action: number;
  failed: number;
}

export interface PortfolioSweepResult {
  results: PortfolioOutcome[];
  summary: PortfolioSummary;
}

// ── Autonomous negotiation loop + payment plans ─────────────────────────────
// Mirrors agent/memory.py's conversations/payment_plans stores exactly (see
// start_conversation/append_conversation_turn and create_payment_plan/
// update_installment) — this is read-only data from GET /api/agent/negotiations,
// never constructed client-side.

export type ConversationStatus = 'active' | 'resolved' | 'escalated';

export interface ConversationTurn {
  role: 'agent' | 'client';
  subject: string | null;
  body: string;
  timestamp: string;
}

export interface Conversation {
  invoice_id: string;
  client_name: string;
  recipient_email: string | null;
  status: ConversationStatus;
  turns: ConversationTurn[];
  created_at: string;
  updated_at: string;
}

export type InstallmentStatus = 'scheduled' | 'awaiting_payment' | 'paid';

export interface PlanInstallmentRecord {
  index: number;
  amount_usd: number;
  description: string;
  /** Absolute ISO timestamp — agent/execute.py converts the agent's
   *  relative due_in_days to this when the plan is first persisted. */
  due_at: string;
  status: InstallmentStatus;
  paypal_order_id?: string | null;
  payment_link?: string | null;
  paid_at?: string;
}

export interface PaymentPlan {
  invoice_id: string;
  client_name: string;
  status: 'active' | 'completed';
  installments: PlanInstallmentRecord[];
  created_at: string;
  updated_at: string;
}

export interface NegotiationState {
  conversations: Conversation[];
  payment_plans: PaymentPlan[];
}

/** One entry in the agent's sent-message audit log (GET /api/history) —
 *  what was sent (or attempted), to whom, and what happened. Written by the
 *  Python agent on every approve/reject, mock or real. */
export interface MessageHistoryEntry {
  invoice_id: string | null;
  client_name: string;
  channel: string;
  subject: string;
  body: string;
  /** Null when the invoice had no email on file, or on a rejected draft. */
  recipient_email?: string | null;
  /** e.g. 'sent (mock)', 'sent', 'rejected'. */
  status: string;
  /** True only when SEND_REAL_EMAIL actually dispatched via SMTP. */
  real_send: boolean;
  timestamp: string;
}
