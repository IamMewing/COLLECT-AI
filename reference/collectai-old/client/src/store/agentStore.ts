import { create } from 'zustand';
import { api } from '../lib/api';
import { useStore } from './useStore';

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

export interface AgentMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  // Agent-specific fields
  intent?: string;
  confidence?: number;
  actions?: AgentAction[];
  uiCommands?: UICommand[];
  toolResult?: any;
  awaitingInput?: boolean;
  awaitingField?: string | null;
  reasoning?: string;
}

export interface AgentAction {
  tool: string;
  params: Record<string, any>;
  success: boolean;
  result: any;
  message: string;
}

export interface UICommand {
  type: string;
  payload?: Record<string, any>;
}

export interface ExecutionStep {
  id: string;
  label: string;
  status: 'pending' | 'executing' | 'done' | 'error';
  detail?: string;
  startTime?: number;
  endTime?: number;
}

interface AgentState {
  // Panel state
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  togglePanel: () => void;

  // Conversation
  conversationId: string;
  messages: AgentMessage[];
  isProcessing: boolean;
  currentSteps: ExecutionStep[];

  // UI automation state
  highlightedInvoiceId: string | null;
  highlightedClientName: string | null;
  activeFilter: { type: string; value: string; results: string[] } | null;
  pendingNavigation: string | null;

  // Actions
  sendMessage: (text: string) => Promise<void>;
  clearConversation: () => void;
  clearHighlights: () => void;
  setPendingNavigation: (page: string | null) => void;
  consumeNavigation: () => string | null;
  setActiveFilter: (filter: AgentState['activeFilter']) => void;
}

// Generate unique IDs
let msgCounter = 0;
const genId = () => `msg_${Date.now()}_${++msgCounter}`;

// Load conversationId from localStorage
const getStoredConvId = () => {
  try {
    return localStorage.getItem('collectai_conv_id') || `conv_${Date.now()}`;
  } catch { return `conv_${Date.now()}`; }
};

export const useAgentStore = create<AgentState>((set, get) => ({
  isOpen: false,
  setIsOpen: (open) => set({ isOpen: open }),
  togglePanel: () => set((s) => ({ isOpen: !s.isOpen })),

  conversationId: getStoredConvId(),
  messages: [],
  isProcessing: false,
  currentSteps: [],

  highlightedInvoiceId: null,
  highlightedClientName: null,
  activeFilter: null,
  pendingNavigation: null,

  sendMessage: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Add user message immediately
    const userMsg: AgentMessage = {
      id: genId(), role: 'user', content: trimmed, timestamp: new Date().toISOString()
    };
    set((s) => ({ messages: [...s.messages, userMsg], isProcessing: true, currentSteps: [] }));

    // Show execution steps as visual feedback while request is in-flight
    const steps: ExecutionStep[] = [
      { id: 'intent', label: 'Classifying intent', status: 'executing' },
      { id: 'context', label: 'Reading workspace memory', status: 'pending' },
      { id: 'plan', label: 'Planning action', status: 'pending' },
    ];
    set({ currentSteps: [...steps] });

    try {
      const { conversationId } = get();
      const businessId = useStore.getState().selectedBusinessId || undefined;

      // Call Agent Runtime API — steps animate as we await
      const responsePromise = api.agentChat(trimmed, conversationId, businessId);
      
      // Update steps visually while awaiting response (no fake delays)
      steps[0].status = 'done';
      steps[1].status = 'executing';
      set({ currentSteps: [...steps] });

      const response = await responsePromise;

      steps[1].status = 'done';
      steps[2].status = 'executing';
      set({ currentSteps: [...steps] });

      // Add tool execution step if a tool was called
      if (response.executedToolName) {
        steps[2].status = 'done';
        steps.push({
          id: 'tool', label: `Executed: ${response.executedToolName}`, status: 'done',
          detail: response.actions?.[0]?.message || ''
        });
        set({ currentSteps: [...steps] });
      } else {
        steps[2].status = 'done';
        set({ currentSteps: [...steps] });
      }

      // Build agent message
      const agentMsg: AgentMessage = {
        id: genId(),
        role: 'agent',
        content: response.responseText,
        timestamp: new Date().toISOString(),
        intent: response.intent,
        confidence: response.confidence,
        actions: response.actions || [],
        uiCommands: response.uiCommands || [],
        toolResult: response.toolResult,
        awaitingInput: response.awaitingInput,
        awaitingField: response.awaitingField,
        reasoning: response.reasoning
      };

      set((s) => ({ messages: [...s.messages, agentMsg] }));

      // Process UI commands
      processUICommands(response.uiCommands || [], set);

      // If data was modified, reload the main store
      if (response.actionExecuted) {
        useStore.getState().loadAllData();
      }

    } catch (err: any) {
      const errorMsg: AgentMessage = {
        id: genId(), role: 'agent',
        content: 'Encountered an operational issue. Workspace connection may need verification.',
        timestamp: new Date().toISOString()
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
    } finally {
      set({ isProcessing: false });
      // Clear steps after a brief moment
      setTimeout(() => set({ currentSteps: [] }), 1500);
    }
  },

  clearConversation: () => {
    const newConvId = `conv_${Date.now()}`;
    try { localStorage.setItem('collectai_conv_id', newConvId); } catch {}
    set({ messages: [], conversationId: newConvId, currentSteps: [] });
  },

  clearHighlights: () => set({
    highlightedInvoiceId: null, highlightedClientName: null, activeFilter: null
  }),

  setPendingNavigation: (page) => set({ pendingNavigation: page }),

  consumeNavigation: () => {
    const val = get().pendingNavigation;
    if (val) set({ pendingNavigation: null });
    return val;
  },

  setActiveFilter: (filter) => set({ activeFilter: filter }),
}));

/**
 * Process UI commands from the agent response.
 * These control the React UI — navigation, highlights, filters, toasts.
 */
function processUICommands(
  commands: UICommand[],
  set: (fn: Partial<AgentState> | ((s: AgentState) => Partial<AgentState>)) => void
) {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'navigate': {
        const pageMap: Record<string, string> = {
          'dashboard': '/', 'home': '/', 'mission': '/', 'mission control': '/',
          'clients': '/clients', 'client profiles': '/clients',
          'collections': '/collections', 'pipeline': '/collections', 'invoices': '/collections',
          'timeline': '/timeline', 'reflections': '/timeline',
          'insights': '/insights', 'analytics': '/insights',
          'settings': '/settings',
          'add': '/add', 'new invoice': '/add'
        };
        const page = cmd.payload?.page || 'dashboard';
        const route = cmd.payload?.route || pageMap[page.toLowerCase()] || '/';
        set({ pendingNavigation: route });
        break;
      }
      case 'highlightInvoice':
        set({ highlightedInvoiceId: cmd.payload?.invoiceId || null });
        // Auto-clear after 5 seconds
        setTimeout(() => set({ highlightedInvoiceId: null }), 5000);
        break;
      case 'highlightClient':
        set({ highlightedClientName: cmd.payload?.clientName || null });
        setTimeout(() => set({ highlightedClientName: null }), 5000);
        break;
      case 'filterInvoices':
        set({
          activeFilter: {
            type: cmd.payload?.filterType || '',
            value: cmd.payload?.filterValue || '',
            results: cmd.payload?.results || []
          }
        });
        break;
      case 'refreshData':
        useStore.getState().loadAllData();
        break;
      case 'showToast':
        useStore.getState().addToast(
          cmd.payload?.message || 'Action completed',
          cmd.payload?.type || 'success'
        );
        break;
      case 'scrollTo':
        // Frontend will handle via useAgentUI hook
        break;
      case 'glowCard':
      case 'updateCounter':
        // Handled by component-level observers
        break;
    }
  }
}


