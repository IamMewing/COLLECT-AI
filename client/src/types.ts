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
}

export interface ApproveResult {
  status: string;
  reason?: string | null;
  channel?: string;
  subject?: string;
  final_body?: string;
  reflection?: Reflection | null;
  send_result?: {
    status: string;
    channel: string;
  };
}

export interface ApiError {
  error: string;
  details?: string;
  stderr?: string | null;
  status?: number;
}
