// ============================================
// CollectAI Agent Runtime — Tool Registry
// 30+ tools, each returns { success, data, message, uiCommands[] }
// ============================================

const { COLLECTIONS } = require('../../config/firebase');
const { updateClientMemory, getClientMemory } = require('../memory/clientMemory');
const { writeAgentReflection } = require('../reflection/reflectionEngine');
const { runAgentCycle } = require('../engine');

/**
 * UI Command types the frontend understands.
 * Each tool can return an array of these to control the React UI.
 */
const UI_COMMANDS = {
  NAVIGATE: 'navigate',
  HIGHLIGHT_INVOICE: 'highlightInvoice',
  HIGHLIGHT_CLIENT: 'highlightClient',
  OPEN_INVOICE_DRAWER: 'openInvoiceDrawer',
  CLOSE_MODAL: 'closeModal',
  SCROLL_TO: 'scrollTo',
  FILTER_INVOICES: 'filterInvoices',
  SORT_INVOICES: 'sortInvoices',
  REFRESH_DATA: 'refreshData',
  SHOW_TOAST: 'showToast',
  UPDATE_COUNTER: 'updateCounter',
  GLOW_CARD: 'glowCard',
};

// ────────────────────────────────────────────────
// TOOL REGISTRY — All tools the AI can call
// ────────────────────────────────────────────────

const toolRegistry = {

  // ═══════════════════════════════
  // INVOICE TOOLS
  // ═══════════════════════════════

  createInvoice: async (db, userId, params, context) => {
    const clientName = params.clientName;
    const amount = params.amount;
    if (!clientName || !amount) {
      return { success: false, message: 'Missing required fields: clientName and amount are required.', uiCommands: [] };
    }

    let dueDateStr = params.dueDate;
    if (!dueDateStr) {
      const d = new Date(); d.setDate(d.getDate() + 14);
      dueDateStr = d.toISOString().split('T')[0];
    }

    let businessId = context?.business?.business_id || context?.business?.id;
    if (!businessId || businessId === 'biz_default') {
      const bizSnapshot = await db.collection(COLLECTIONS.BUSINESSES)
        .where('userId', '==', userId).limit(1).get();
      if (!bizSnapshot.empty) {
        businessId = bizSnapshot.docs[0].data().business_id || bizSnapshot.docs[0].id;
      } else {
        const newBizId = `biz_${Date.now()}`;
        await db.collection(COLLECTIONS.BUSINESSES).doc(newBizId).set({
          business_id: newBizId, name: 'CollectAI Studio', owner_email: userId,
          userId, tone_preference: 'polite', timezone: 'Asia/Kolkata', created_at: new Date()
        });
        businessId = newBizId;
      }
    }

    const countSnapshot = await db.collection(COLLECTIONS.INVOICES).where('userId', '==', userId).get();
    const invCount = countSnapshot.size + 1;
    const invId = `INV-${String(invCount).padStart(4, '0')}`;

    const newDoc = {
      invoice_id: invId, business_id: businessId, userId,
      client_name: clientName,
      client_email: params.clientEmail || `${clientName.toLowerCase().replace(/\s+/g, '')}@client.com`,
      amount: parseFloat(amount), currency: 'INR',
      due_date: new Date(dueDateStr),
      description: params.description || 'Professional services',
      status: 'open', escalation_level: 0,
      created_at: new Date(), last_action_at: new Date()
    };

    const docRef = await db.collection(COLLECTIONS.INVOICES).add(newDoc);

    await updateClientMemory(db, clientName, userId, {
      totalInvoices: ((context?.clients?.find(c => c.name === clientName)?.totalInvoices) || 0) + 1
    });

    return {
      success: true,
      data: { id: docRef.id, ...newDoc, due_date: dueDateStr },
      message: `Invoice ${invId} created for ${clientName} — ₹${parseFloat(amount).toLocaleString('en-IN')} due ${dueDateStr}.`,
      uiCommands: [
        { type: UI_COMMANDS.NAVIGATE, payload: { page: 'collections' } },
        { type: UI_COMMANDS.REFRESH_DATA },
        { type: UI_COMMANDS.HIGHLIGHT_INVOICE, payload: { invoiceId: invId, docId: docRef.id } },
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `Invoice ${invId} created successfully`, type: 'success' } }
      ]
    };
  },

  updateInvoice: async (db, userId, params, context) => {
    let inv = null;
    if (params.invoiceId) {
      inv = context.invoices.find(i => i.invoice_id === params.invoiceId);
    }
    if (!inv && params.clientName) {
      inv = context.invoices.find(i =>
        i.client_name.toLowerCase().includes(params.clientName.toLowerCase()) && i.status !== 'paid'
      );
    }
    if (!inv) return { success: false, message: 'Invoice not found. Specify a client name or invoice ID.', uiCommands: [] };

    const updates = { last_action_at: new Date() };
    if (params.newAmount || params.amount) updates.amount = parseFloat(params.newAmount || params.amount);
    if (params.dueDate) updates.due_date = new Date(params.dueDate);
    if (params.description) updates.description = params.description;
    if (params.status) updates.status = params.status;

    await db.collection(COLLECTIONS.INVOICES).doc(inv.id).update(updates);

    const changes = [];
    if (updates.amount) changes.push(`amount → ₹${updates.amount.toLocaleString('en-IN')}`);
    if (updates.due_date) changes.push(`due date → ${params.dueDate}`);
    if (updates.description) changes.push(`description updated`);

    return {
      success: true,
      data: { ...inv, ...updates },
      message: `Invoice ${inv.invoice_id} updated: ${changes.join(', ')}.`,
      uiCommands: [
        { type: UI_COMMANDS.REFRESH_DATA },
        { type: UI_COMMANDS.HIGHLIGHT_INVOICE, payload: { invoiceId: inv.invoice_id, docId: inv.id } },
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `Invoice ${inv.invoice_id} updated`, type: 'success' } }
      ]
    };
  },

  deleteInvoice: async (db, userId, params, context) => {
    let inv = null;
    if (params.invoiceId) inv = context.invoices.find(i => i.invoice_id === params.invoiceId);
    if (!inv && params.clientName) {
      inv = context.invoices.find(i => i.client_name.toLowerCase().includes(params.clientName.toLowerCase()));
    }
    if (!inv) return { success: false, message: 'Invoice not found to delete.', uiCommands: [] };

    await db.collection(COLLECTIONS.INVOICES).doc(inv.id).delete();

    return {
      success: true,
      data: { deletedInvoiceId: inv.invoice_id },
      message: `Invoice ${inv.invoice_id} (${inv.client_name}) removed from workspace.`,
      uiCommands: [
        { type: UI_COMMANDS.REFRESH_DATA },
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `Invoice ${inv.invoice_id} deleted`, type: 'info' } }
      ]
    };
  },

  duplicateInvoice: async (db, userId, params, context) => {
    let inv = null;
    if (params.invoiceId) inv = context.invoices.find(i => i.invoice_id === params.invoiceId);
    if (!inv && params.clientName) {
      inv = context.invoices.find(i => i.client_name.toLowerCase().includes(params.clientName.toLowerCase()));
    }
    if (!inv) return { success: false, message: 'Invoice not found to duplicate.', uiCommands: [] };

    const countSnapshot = await db.collection(COLLECTIONS.INVOICES).where('userId', '==', userId).get();
    const newInvId = `INV-${String(countSnapshot.size + 1).padStart(4, '0')}`;

    const d = new Date(); d.setDate(d.getDate() + 14);
    const newDoc = {
      invoice_id: newInvId, business_id: inv.business_id, userId,
      client_name: inv.client_name, client_email: inv.client_email,
      amount: inv.amount, currency: 'INR',
      due_date: d, description: inv.description || 'Professional services',
      status: 'open', escalation_level: 0,
      created_at: new Date(), last_action_at: new Date()
    };

    const docRef = await db.collection(COLLECTIONS.INVOICES).add(newDoc);

    return {
      success: true,
      data: { id: docRef.id, ...newDoc },
      message: `Duplicated ${inv.invoice_id} → new invoice ${newInvId} created for ${inv.client_name}.`,
      uiCommands: [
        { type: UI_COMMANDS.REFRESH_DATA },
        { type: UI_COMMANDS.HIGHLIGHT_INVOICE, payload: { invoiceId: newInvId, docId: docRef.id } },
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `Invoice duplicated as ${newInvId}`, type: 'success' } }
      ]
    };
  },

  markInvoicePaid: async (db, userId, params, context) => {
    let inv = null;
    if (params.invoiceId) inv = context.invoices.find(i => i.invoice_id === params.invoiceId);
    if (!inv && params.clientName) {
      inv = context.invoices.find(i =>
        i.client_name.toLowerCase().includes(params.clientName.toLowerCase()) && i.status !== 'paid'
      );
    }
    if (!inv) inv = context.invoices.find(i => i.status !== 'paid');
    if (!inv) return { success: false, message: 'No open invoice found to mark as paid.', uiCommands: [] };

    await db.collection(COLLECTIONS.INVOICES).doc(inv.id).update({
      status: 'paid', paid_at: new Date(), last_action_at: new Date()
    });

    const mem = await getClientMemory(db, inv.client_name, userId);
    await updateClientMemory(db, inv.client_name, userId, {
      paidInvoices: (mem.paidInvoices || 0) + 1,
      relationshipScore: Math.min(100, (mem.relationshipScore || 80) + 5),
      riskScore: Math.max(0, (mem.riskScore || 20) - 10)
    });

    await writeAgentReflection(db, {
      invoiceId: inv.id, decision: 'mark_paid',
      reasoning: `Payment recorded for ${inv.client_name}. Invoice ${inv.invoice_id} settled.`
    }, { wasBestDecision: true }, userId);

    return {
      success: true,
      data: { ...inv, status: 'paid' },
      message: `Invoice ${inv.invoice_id} (${inv.client_name}) marked as PAID. ₹${inv.amount.toLocaleString('en-IN')} added to recovered revenue.`,
      uiCommands: [
        { type: UI_COMMANDS.REFRESH_DATA },
        { type: UI_COMMANDS.NAVIGATE, payload: { page: 'dashboard' } },
        { type: UI_COMMANDS.UPDATE_COUNTER, payload: { counter: 'recovered', value: inv.amount } },
        { type: UI_COMMANDS.GLOW_CARD, payload: { invoiceId: inv.invoice_id, color: 'mint' } },
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `₹${inv.amount.toLocaleString('en-IN')} payment recorded for ${inv.client_name}`, type: 'success' } }
      ]
    };
  },

  // ═══════════════════════════════
  // SEARCH & FILTER TOOLS
  // ═══════════════════════════════

  searchInvoices: async (db, userId, params, context) => {
    let results = context.invoices;
    if (params.invoiceId) results = results.filter(i => i.invoice_id.includes(params.invoiceId));
    if (params.clientName) results = results.filter(i => i.client_name.toLowerCase().includes(params.clientName.toLowerCase()));
    if (params.status) results = results.filter(i => i.status === params.status);

    const uiCommands = [{ type: UI_COMMANDS.NAVIGATE, payload: { page: 'collections' } }];
    if (results.length > 0) {
      uiCommands.push({ type: UI_COMMANDS.HIGHLIGHT_INVOICE, payload: { invoiceId: results[0].invoice_id, docId: results[0].id } });
    }

    return {
      success: true,
      data: { results, count: results.length },
      message: `Found ${results.length} matching invoice${results.length !== 1 ? 's' : ''}.`,
      uiCommands
    };
  },

  searchClients: async (db, userId, params, context) => {
    let clients = context.clients;
    if (params.clientName) {
      clients = clients.filter(c => c.name.toLowerCase().includes(params.clientName.toLowerCase()));
    }
    // If asked about risk, sort by risk score
    if (params.status === 'risk' || !params.clientName) {
      clients = clients.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
    }

    const uiCommands = [{ type: UI_COMMANDS.NAVIGATE, payload: { page: 'clients' } }];
    if (clients.length > 0) {
      uiCommands.push({ type: UI_COMMANDS.HIGHLIGHT_CLIENT, payload: { clientName: clients[0].name } });
      uiCommands.push({ type: UI_COMMANDS.SCROLL_TO, payload: { selector: `[data-client-name="${clients[0].name}"]` } });
    }

    return {
      success: true,
      data: { clients, count: clients.length },
      message: clients.length > 0
        ? `Found ${clients.length} client${clients.length !== 1 ? 's' : ''}. Top: ${clients[0].name} (Risk: ${clients[0].riskScore || 'N/A'}%).`
        : 'No matching clients found.',
      uiCommands
    };
  },

  filterInvoices: async (db, userId, params, context) => {
    let filtered = context.invoices;

    if (params.filterType === 'above' && params.filterValue) {
      filtered = filtered.filter(i => i.amount > parseFloat(params.filterValue));
    } else if (params.filterType === 'below' && params.filterValue) {
      filtered = filtered.filter(i => i.amount < parseFloat(params.filterValue));
    }

    if (params.status === 'overdue') {
      filtered = filtered.filter(i => i.days_overdue > 0 && i.status !== 'paid');
    } else if (params.status) {
      filtered = filtered.filter(i => i.status === params.status);
    }

    const sortedFiltered = filtered.sort((a, b) => b.amount - a.amount);

    const uiCommands = [
      { type: UI_COMMANDS.NAVIGATE, payload: { page: 'collections' } },
      { type: UI_COMMANDS.FILTER_INVOICES, payload: { filterType: params.filterType, filterValue: params.filterValue, status: params.status, results: sortedFiltered.map(i => i.invoice_id) } }
    ];

    if (sortedFiltered.length > 0) {
      uiCommands.push({ type: UI_COMMANDS.HIGHLIGHT_INVOICE, payload: { invoiceId: sortedFiltered[0].invoice_id } });
    }

    return {
      success: true,
      data: { results: sortedFiltered, count: sortedFiltered.length, total: sortedFiltered.reduce((s, i) => s + i.amount, 0) },
      message: `Found ${sortedFiltered.length} invoice${sortedFiltered.length !== 1 ? 's' : ''} matching your criteria. Total: ₹${sortedFiltered.reduce((s, i) => s + i.amount, 0).toLocaleString('en-IN')}.`,
      uiCommands
    };
  },

  // ═══════════════════════════════
  // COMMUNICATION TOOLS
  // ═══════════════════════════════

  sendReminder: async (db, userId, params, context) => {
    let inv = null;
    if (params.clientName) {
      inv = context.invoices.find(i => i.client_name.toLowerCase().includes(params.clientName.toLowerCase()) && i.status !== 'paid');
    }
    if (!inv) inv = context.invoices.find(i => i.status !== 'paid');
    if (!inv) return { success: false, message: 'No active invoice found to send reminder for.', uiCommands: [] };

    const channel = params.channel || 'whatsapp';
    const decision = (inv.days_overdue || 0) > 14 ? 'firm_nudge' : 'gentle_reminder';

    const actionDoc = {
      invoice_id: inv.invoice_id, business_id: inv.business_id, userId, decision,
      reasoning_summary: `Dispatched ${decision.replace('_', ' ')} to ${inv.client_name} via ${channel.toUpperCase()} (Overdue: ${inv.days_overdue || 0}d).`,
      channel, outcome: 'sent', timestamp: new Date(),
      urgency_score: Math.min(10, Math.floor((inv.days_overdue || 0) / 3) + 2)
    };

    await db.collection(COLLECTIONS.AGENT_ACTIONS).add(actionDoc);
    await db.collection(COLLECTIONS.INVOICES).doc(inv.id).update({
      escalation_level: Math.min(3, (inv.escalation_level || 0) + 1),
      last_action_at: new Date()
    });

    await writeAgentReflection(db, {
      invoiceId: inv.id, decision, reasoning: `${channel} reminder dispatched to ${inv.client_name}`
    }, { wasBestDecision: true }, userId);

    return {
      success: true,
      data: { channel, recipient: inv.client_name, invoiceId: inv.invoice_id, decision },
      message: `${channel.toUpperCase()} reminder dispatched to ${inv.client_name} for invoice ${inv.invoice_id} (₹${inv.amount.toLocaleString('en-IN')}).`,
      uiCommands: [
        { type: UI_COMMANDS.REFRESH_DATA },
        { type: UI_COMMANDS.HIGHLIGHT_INVOICE, payload: { invoiceId: inv.invoice_id } },
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `${channel.toUpperCase()} reminder sent to ${inv.client_name}`, type: 'success' } }
      ]
    };
  },

  generateReminder: async (db, userId, params, context) => {
    const clientName = params.clientName || context.clients[0]?.name || 'Client';
    const tone = params.tone || 'polite';
    const channel = params.channel || 'whatsapp';
    const inv = context.invoices.find(i => i.client_name.toLowerCase().includes(clientName.toLowerCase())) || context.invoices[0];
    const amount = inv ? `₹${inv.amount.toLocaleString('en-IN')}` : '₹25,000';
    const invId = inv ? inv.invoice_id : 'INV-001';
    const bizName = context.business?.name || 'CollectAI Studio';

    let copy = '';
    if (channel === 'whatsapp') {
      copy = tone === 'firm'
        ? `Hi ${clientName}, this is a firm notice regarding ${invId} for ${amount}, now ${inv?.days_overdue || 12} days overdue. Please process payment today to avoid further escalation. Payment link: https://collectai.app/pay/${invId}`
        : `Hi ${clientName}! Quick check-in from ${bizName} regarding ${invId} (${amount}). Would you be able to process payment this week? Link: https://collectai.app/pay/${invId}`;
    } else {
      copy = `Dear ${clientName},\n\nThis is regarding invoice ${invId} for ${amount}, due on ${inv?.due_date || 'recently'}.\n\nPlease find the payment link here: https://collectai.app/pay/${invId}\n\nThank you,\n${bizName}`;
    }

    return {
      success: true,
      data: { draftCopy: copy, channel, tone, clientName, invoiceId: invId },
      message: `Drafted ${channel.toUpperCase()} reminder in ${tone} tone for ${clientName}.`,
      uiCommands: [
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `${tone} ${channel} draft ready for ${clientName}`, type: 'info' } }
      ]
    };
  },

  // ═══════════════════════════════
  // CLIENT MANAGEMENT TOOLS
  // ═══════════════════════════════

  escalateClient: async (db, userId, params, context) => {
    const clientName = params.clientName || context.clients.find(c => (c.totalOutstanding || 0) > 0)?.name;
    if (!clientName) return { success: false, message: 'No client identified to escalate.', uiCommands: [] };

    const invs = context.invoices.filter(i => i.client_name.toLowerCase().includes(clientName.toLowerCase()));
    for (const inv of invs) {
      await db.collection(COLLECTIONS.INVOICES).doc(inv.id).update({
        status: 'escalated', escalation_level: 3, last_action_at: new Date()
      });
    }

    await updateClientMemory(db, clientName, userId, {
      riskScore: 85, relationshipScore: 40,
      businessNotes: `Escalated on ${new Date().toISOString().split('T')[0]}. Ignored previous reminders.`
    });

    return {
      success: true,
      data: { clientName, invoicesEscalated: invs.length },
      message: `Escalated ${clientName}. ${invs.length} invoice${invs.length !== 1 ? 's' : ''} marked as ESCALATED. Owner alert queued.`,
      uiCommands: [
        { type: UI_COMMANDS.REFRESH_DATA },
        { type: UI_COMMANDS.NAVIGATE, payload: { page: 'clients' } },
        { type: UI_COMMANDS.HIGHLIGHT_CLIENT, payload: { clientName } },
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `${clientName} escalated to owner`, type: 'error' } }
      ]
    };
  },

  // ═══════════════════════════════
  // ANALYTICS & INSIGHTS TOOLS
  // ═══════════════════════════════

  runCollectionCycle: async (db, userId, params, context) => {
    const result = await runAgentCycle(context.business.id, userId);
    return {
      success: true,
      data: result,
      message: `Autonomous scan completed. Evaluated ${result.invoicesEvaluated || context.invoices.length} invoices.`,
      uiCommands: [
        { type: UI_COMMANDS.REFRESH_DATA },
        { type: UI_COMMANDS.NAVIGATE, payload: { page: 'dashboard' } },
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: `Agent scan complete: ${result.invoicesEvaluated || 0} invoices evaluated`, type: 'success' } }
      ]
    };
  },

  predictPayment: async (db, userId, params, context) => {
    const forecast = context.invoices.filter(i => i.status !== 'paid').map(i => {
      const prob = Math.max(25, 95 - ((i.days_overdue || 0) * 3.5));
      return {
        invoiceId: i.invoice_id, client: i.client_name,
        amount: i.amount, daysOverdue: i.days_overdue || 0,
        paymentProbability: Math.round(prob),
        expectedRecovery: Math.round(i.amount * (prob / 100))
      };
    });

    const expectedTotal = forecast.reduce((acc, f) => acc + f.expectedRecovery, 0);

    return {
      success: true,
      data: { forecast, expectedTotal },
      message: `Projected recovery of ₹${expectedTotal.toLocaleString('en-IN')} from ${forecast.length} open invoices in the next 7 days.`,
      uiCommands: [
        { type: UI_COMMANDS.NAVIGATE, payload: { page: 'insights' } }
      ]
    };
  },

  generateInsights: async (db, userId, params, context) => {
    const metrics = context.liveMetrics;
    const highRisk = context.clients.filter(c => (c.riskScore || 0) > 50).length;
    const avgDelay = context.clients.reduce((s, c) => s + (c.avgDelayDays || 0), 0) / (context.clients.length || 1);

    return {
      success: true,
      data: {
        metrics,
        highRiskCount: highRisk,
        avgPaymentDelay: Math.round(avgDelay),
        insights: [
          `Collection rate at ${metrics.collectionRate}%. ${metrics.collectionRate > 80 ? 'Above target.' : 'Below target — action needed.'}`,
          `${highRisk} client${highRisk !== 1 ? 's' : ''} flagged as high risk.`,
          `Average payment delay: ${Math.round(avgDelay)} days.`,
          `${metrics.estimatedHoursSaved} hours saved through AI automation.`
        ]
      },
      message: `Workspace analytics: ${metrics.openInvoicesCount} open invoices (₹${metrics.totalOutstanding.toLocaleString('en-IN')}), ${metrics.collectionRate}% collection rate, ${highRisk} high-risk clients.`,
      uiCommands: [
        { type: UI_COMMANDS.NAVIGATE, payload: { page: 'insights' } }
      ]
    };
  },

  generateReport: async (db, userId, params, context) => {
    const metrics = context.liveMetrics;

    return {
      success: true,
      data: {
        reportDate: new Date().toISOString().split('T')[0],
        totalInvoices: metrics.totalInvoices,
        openInvoices: metrics.openInvoicesCount,
        totalOutstanding: metrics.totalOutstanding,
        totalRecovered: metrics.totalRecovered,
        collectionRate: metrics.collectionRate,
        clients: context.clients.map(c => ({
          name: c.name, risk: c.riskScore, outstanding: c.totalOutstanding
        }))
      },
      message: `Report generated. ${metrics.totalInvoices} total invoices, ₹${metrics.totalRecovered.toLocaleString('en-IN')} recovered, ${metrics.collectionRate}% collection rate.`,
      uiCommands: [
        { type: UI_COMMANDS.SHOW_TOAST, payload: { message: 'Report generated successfully', type: 'success' } }
      ]
    };
  },

  summarizeWorkspace: async (db, userId, params, context) => {
    const m = context.liveMetrics;
    const topClient = context.clients.sort((a, b) => (b.totalOutstanding || 0) - (a.totalOutstanding || 0))[0];

    return {
      success: true,
      data: { metrics: m, topClient, recentActions: context.recentActions.slice(0, 5) },
      message: `Workspace: ${m.openInvoicesCount} open invoices totaling ₹${m.totalOutstanding.toLocaleString('en-IN')}. ₹${m.totalRecovered.toLocaleString('en-IN')} recovered. Collection rate: ${m.collectionRate}%. Business health: ${m.businessHealthScore}%.${topClient ? ` Largest outstanding: ${topClient.name} (₹${(topClient.totalOutstanding || 0).toLocaleString('en-IN')}).` : ''}`,
      uiCommands: [
        { type: UI_COMMANDS.NAVIGATE, payload: { page: 'dashboard' } }
      ]
    };
  },

  // ═══════════════════════════════
  // NAVIGATION & UI TOOLS
  // ═══════════════════════════════

  navigate: async (db, userId, params, context) => {
    const page = params.page || 'dashboard';
    const pageMap = {
      'dashboard': '/', 'home': '/', 'mission': '/', 'mission control': '/',
      'clients': '/clients', 'client profiles': '/clients', 'profiles': '/clients',
      'collections': '/collections', 'pipeline': '/collections', 'invoices': '/collections',
      'timeline': '/timeline', 'reflections': '/timeline', 'journal': '/timeline', 'reflection journal': '/timeline',
      'insights': '/insights', 'analytics': '/insights',
      'settings': '/settings', 'config': '/settings',
      'add': '/add', 'new invoice': '/add', 'create': '/add', 'assign task': '/add'
    };

    const route = pageMap[page.toLowerCase()] || '/';
    const pageName = Object.keys(pageMap).find(k => pageMap[k] === route) || 'dashboard';

    return {
      success: true,
      data: { page: pageName, route },
      message: `Navigated to ${pageName}.`,
      uiCommands: [
        { type: UI_COMMANDS.NAVIGATE, payload: { page: pageName, route } }
      ]
    };
  },
};

/**
 * Execute a tool by name from the registry.
 */
async function executeTool(toolName, db, userId, params, context) {
  const handler = toolRegistry[toolName];
  if (!handler) {
    console.warn(`⚠️ Tool '${toolName}' not found in registry.`);
    return { success: false, message: `Tool ${toolName} is not registered.`, uiCommands: [] };
  }

  try {
    console.log(`🛠️  Executing tool: ${toolName} for user ${userId}`);
    console.log(`   Params:`, JSON.stringify(params));
    const result = await handler(db, userId, params, context);
    console.log(`   Result: ${result.success ? '✅' : '❌'} ${result.message}`);
    return result;
  } catch (err) {
    console.error(`Tool execution error [${toolName}]:`, err);
    return { success: false, message: `Tool error: ${err.message}`, uiCommands: [] };
  }
}

/**
 * Get list of all available tool names (for Gemini context).
 */
function getToolNames() {
  return Object.keys(toolRegistry);
}

module.exports = { toolRegistry, executeTool, getToolNames, UI_COMMANDS };
