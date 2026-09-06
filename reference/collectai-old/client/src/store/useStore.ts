import { create } from 'zustand';
import { api } from '../lib/api';
import type { Business, Invoice, AgentAction, DashboardStats } from '../lib/api';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AppState {
  businesses: Business[];
  selectedBusinessId: string | null;
  invoices: Invoice[];
  actions: AgentAction[];
  stats: DashboardStats | null;
  loading: boolean;
  introCompleted: boolean;
  isThinking: boolean;
  thinkingProgress: string[];
  thinkingStep: number;
  toasts: Toast[];
  tourActive: boolean;

  // Actions
  setIntroCompleted: (completed: boolean) => void;
  setSelectedBusinessId: (id: string | null) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;
  startTour: () => void;
  endTour: () => void;
  
  // API Fetch wrappers
  fetchBusinesses: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchInvoices: (status?: string) => Promise<void>;
  fetchActions: () => Promise<void>;
  loadAllData: () => Promise<void>;
  
  // Triggers
  runAgentCycle: () => Promise<string | null>;  // Returns jobId for SSE stream
  markInvoicePaid: (id: string, amount: number) => Promise<void>;
  createInvoice: (data: Parameters<typeof api.createInvoice>[0]) => Promise<void>;
  createBusiness: (data: Parameters<typeof api.createBusiness>[0]) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  businesses: [],
  selectedBusinessId: null,
  invoices: [],
  actions: [],
  stats: null,
  loading: false,
  introCompleted: false,
  isThinking: false,
  thinkingProgress: [],
  thinkingStep: 0,
  toasts: [],
  tourActive: false,

  setIntroCompleted: (completed) => set({ introCompleted: completed }),

  startTour: () => set({ tourActive: true }),
  endTour: () => set({ tourActive: false }),

  setSelectedBusinessId: (id) => {
    set({ selectedBusinessId: id });
    get().loadAllData();
  },

  addToast: (message, type = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    setTimeout(() => get().removeToast(id), 4000);
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  fetchBusinesses: async () => {
    try {
      const data = await api.getBusinesses();
      set({ businesses: data });
      if (data.length > 0 && !get().selectedBusinessId) {
        set({ selectedBusinessId: data[0].business_id });
      }
    } catch (e: any) {
      get().addToast(`Error loading profiles: ${e.message}`, 'error');
    }
  },

  fetchStats: async () => {
    try {
      const bizId = get().selectedBusinessId || undefined;
      const data = await api.getStats(bizId);
      set({ stats: data });
    } catch (e: any) {
      console.error(e);
    }
  },

  fetchInvoices: async (status) => {
    try {
      const bizId = get().selectedBusinessId || undefined;
      const data = await api.getInvoices(bizId, status);
      set({ invoices: data });
    } catch (e: any) {
      get().addToast(`Error loading invoices: ${e.message}`, 'error');
    }
  },

  fetchActions: async () => {
    try {
      const bizId = get().selectedBusinessId || undefined;
      const data = await api.getActions(bizId, 50);
      set({ actions: data });
    } catch (e: any) {
      console.error(e);
    }
  },

  loadAllData: async () => {
    set({ loading: true });
    await Promise.all([
      get().fetchStats(),
      get().fetchInvoices(),
      get().fetchActions()
    ]);
    set({ loading: false });
  },

  runAgentCycle: async () => {
    try {
      const bizId = get().selectedBusinessId || undefined;
      const result = await api.runAgent(bizId);
      // Return jobId — Dashboard will open SSE stream on this ID
      return result.jobId;
    } catch (e: any) {
      get().addToast(`Agent cycle failed to start: ${e.message}`, 'error');
      return null;
    }
  },

  markInvoicePaid: async (id, amount) => {
    try {
      set({ loading: true });
      await api.markAsPaid(id, amount);
      get().addToast(`Payment of ₹${amount.toLocaleString('en-IN')} recorded successfully`, 'success');
      await get().loadAllData();
    } catch (e: any) {
      get().addToast(`Failed to record payment: ${e.message}`, 'error');
    } finally {
      set({ loading: false });
    }
  },

  createInvoice: async (data) => {
    try {
      set({ loading: true });
      const result = await api.createInvoice(data);
      get().addToast(`Invoice ${result.invoice_id} issued successfully`, 'success');
      await get().loadAllData();
    } catch (e: any) {
      get().addToast(`Failed to create invoice: ${e.message}`, 'error');
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  createBusiness: async (data) => {
    try {
      set({ loading: true });
      const result = await api.createBusiness(data);
      get().addToast(`Studio profile "${result.name}" created`, 'success');
      await get().fetchBusinesses();
      set({ selectedBusinessId: result.business_id });
    } catch (e: any) {
      get().addToast(`Failed to create profile: ${e.message}`, 'error');
      throw e;
    } finally {
      set({ loading: false });
    }
  }
}));
