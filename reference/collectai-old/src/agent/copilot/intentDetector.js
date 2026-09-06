// ============================================
// CollectAI Agent Runtime — Intent Classifier
// Gemini-powered NLU with keyword fallback
// ============================================

const { getGeminiClient, GEMINI_MODEL } = require('../../config/gemini');

// All supported intents
const INTENTS = {
  CREATE_INVOICE: 'CREATE_INVOICE',
  EDIT_INVOICE: 'EDIT_INVOICE',
  DELETE_INVOICE: 'DELETE_INVOICE',
  DUPLICATE_INVOICE: 'DUPLICATE_INVOICE',
  MARK_PAID: 'MARK_PAID',
  SEARCH_INVOICE: 'SEARCH_INVOICE',
  SEARCH_CLIENT: 'SEARCH_CLIENT',
  FILTER_INVOICES: 'FILTER_INVOICES',
  SEND_REMINDER: 'SEND_REMINDER',
  GENERATE_REMINDER: 'GENERATE_REMINDER',
  ESCALATE_CLIENT: 'ESCALATE_CLIENT',
  RUN_SCAN: 'RUN_SCAN',
  SHOW_RISK: 'SHOW_RISK',
  SHOW_ANALYTICS: 'SHOW_ANALYTICS',
  PREDICT_PAYMENT: 'PREDICT_PAYMENT',
  GENERATE_REPORT: 'GENERATE_REPORT',
  NAVIGATE: 'NAVIGATE',
  SUMMARIZE_WORKSPACE: 'SUMMARIZE_WORKSPACE',
  GREETING: 'GREETING',
  QUESTION: 'QUESTION',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  GUIDE_USER: 'GUIDE_USER',
  UNKNOWN: 'UNKNOWN'
};

// Intent → tool mapping
const INTENT_TOOL_MAP = {
  [INTENTS.CREATE_INVOICE]: 'createInvoice',
  [INTENTS.EDIT_INVOICE]: 'updateInvoice',
  [INTENTS.DELETE_INVOICE]: 'deleteInvoice',
  [INTENTS.DUPLICATE_INVOICE]: 'duplicateInvoice',
  [INTENTS.MARK_PAID]: 'markInvoicePaid',
  [INTENTS.SEARCH_INVOICE]: 'searchInvoices',
  [INTENTS.SEARCH_CLIENT]: 'searchClients',
  [INTENTS.FILTER_INVOICES]: 'filterInvoices',
  [INTENTS.SEND_REMINDER]: 'sendReminder',
  [INTENTS.GENERATE_REMINDER]: 'generateReminder',
  [INTENTS.ESCALATE_CLIENT]: 'escalateClient',
  [INTENTS.RUN_SCAN]: 'runCollectionCycle',
  [INTENTS.SHOW_RISK]: 'searchClients',
  [INTENTS.SHOW_ANALYTICS]: 'generateInsights',
  [INTENTS.PREDICT_PAYMENT]: 'predictPayment',
  [INTENTS.GENERATE_REPORT]: 'generateReport',
  [INTENTS.NAVIGATE]: 'navigate',
  [INTENTS.SUMMARIZE_WORKSPACE]: 'summarizeWorkspace',
};

// Intents that require actions (tool execution)
const ACTION_INTENTS = new Set([
  INTENTS.CREATE_INVOICE, INTENTS.EDIT_INVOICE, INTENTS.DELETE_INVOICE,
  INTENTS.DUPLICATE_INVOICE, INTENTS.MARK_PAID, INTENTS.SEND_REMINDER,
  INTENTS.GENERATE_REMINDER, INTENTS.ESCALATE_CLIENT, INTENTS.RUN_SCAN,
  INTENTS.NAVIGATE, INTENTS.FILTER_INVOICES
]);

// Required fields per intent (for multi-step collection)
const REQUIRED_FIELDS = {
  [INTENTS.CREATE_INVOICE]: ['clientName', 'amount', 'dueDate'],
  [INTENTS.EDIT_INVOICE]: ['invoiceId'],
  [INTENTS.DELETE_INVOICE]: ['invoiceId'],
  [INTENTS.MARK_PAID]: [],  // Can infer from clientName or invoiceId
  [INTENTS.SEND_REMINDER]: [],
  [INTENTS.NAVIGATE]: ['page'],
};

const INTENT_CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: Object.values(INTENTS) },
    confidence: { type: "number" },
    entities: {
      type: "object",
      properties: {
        clientName: { type: "string" },
        amount: { type: "number" },
        dueDate: { type: "string" },
        invoiceId: { type: "string" },
        description: { type: "string" },
        channel: { type: "string", enum: ["email", "whatsapp", "sms"] },
        tone: { type: "string", enum: ["polite", "firm", "neutral", "legal"] },
        page: { type: "string" },
        filterType: { type: "string" },
        filterValue: { type: "string" },
        status: { type: "string" },
        clientEmail: { type: "string" },
        newAmount: { type: "number" }
      }
    },
    missingFields: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["intent", "confidence", "entities", "missingFields"]
};

/**
 * Detect intent using Gemini AI, with keyword fallback.
 */
async function detectIntent(query, workspaceContext = null) {
  // Try Gemini-powered classification first
  const ai = getGeminiClient();
  if (ai) {
    try {
      const result = await classifyWithGemini(ai, query, workspaceContext);
      if (result) return result;
    } catch (err) {
      console.warn('⚠️ Gemini intent classification failed, using keyword fallback:', err.message);
    }
  }

  // Fallback to keyword-based detection
  return classifyWithKeywords(query, workspaceContext);
}

/**
 * Gemini-powered intent classification + entity extraction.
 */
async function classifyWithGemini(ai, query, workspaceContext) {
  const clientList = workspaceContext?.clients?.map(c => c.name).join(', ') || 'none';
  const invoiceList = workspaceContext?.invoices?.slice(0, 10).map(i =>
    `${i.invoice_id} (${i.client_name}, ₹${i.amount}, ${i.status})`
  ).join('; ') || 'none';

  const systemPrompt = `You are the CollectAI intent classifier. Classify the user's request into exactly one intent.

Available intents: ${Object.values(INTENTS).join(', ')}

Known clients in workspace: ${clientList}
Known invoices: ${invoiceList}

Navigation pages: dashboard, clients, collections, timeline, insights, settings, add (new invoice)

Rules:
- Extract ALL entities mentioned (clientName, amount, dueDate, invoiceId, channel, tone, page, etc.)
- For dates like "next Monday", "next Friday", "tomorrow", convert to YYYY-MM-DD format. Today is ${new Date().toISOString().split('T')[0]}.
- For amounts like "25k", "₹45,000", extract as a number (25000, 45000).
- Match client names against the known client list when possible.
- List missingFields only for action intents where required info is absent.
- For CREATE_INVOICE, required fields: clientName, amount, dueDate.
- For NAVIGATE, extract page name.
- If the user asks to "show", "filter", or "find" invoices with criteria (over ₹50000, overdue, etc.), use FILTER_INVOICES.
- If the user says something like "Rahul has paid" or "Rahul paid", that's MARK_PAID.
- If user says "change amount to X" or "update invoice", that's EDIT_INVOICE.
- If the query is completely unrelated to accounts receivable or CollectAI operations (e.g., general knowledge, creative writing, science, weather, coding, jokes, poetry, Elon Musk), classify as OUT_OF_SCOPE.
- If the user is asking how to change password or update studio/profile details, classify as GUIDE_USER.
- Confidence should be 0.0-1.0.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `User says: "${query}"`,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: INTENT_CLASSIFICATION_SCHEMA,
      temperature: 0.1
    }
  });

  const parsed = JSON.parse(response.text);

  return {
    intent: parsed.intent,
    confidence: parsed.confidence,
    entities: parsed.entities || {},
    missingFields: parsed.missingFields || [],
    tool: INTENT_TOOL_MAP[parsed.intent] || null,
    requiresAction: ACTION_INTENTS.has(parsed.intent)
  };
}

/**
 * Keyword-based intent classification fallback.
 */
function classifyWithKeywords(query, workspaceContext) {
  const q = (query || '').toLowerCase().trim();
  const entities = extractEntities(q, workspaceContext);

  // Out of scope checks
  if (
    /elon\s+musk|poem|poetry|story|creative\s+writing|weather|climate|temperature|rain|sun|cloud|joke|recipe|cooking|movie|song|music|play\s+a\b/i.test(q)
  ) {
    return makeResult(INTENTS.OUT_OF_SCOPE, 0.98, entities, []);
  }

  // Guidance checks
  if (
    /change\s+password|update\s+password|edit\s+password|reset\s+password|how\s+(?:do|can)\s+i\s+(?:change|update|reset)\s+(?:my\s+)?password/i.test(q) ||
    /edit\s+studio|change\s+studio|edit\s+business|change\s+business|update\s+studio\s+name|change\s+studio\s+name|how\s+(?:do|can)\s+i\s+(?:edit|change|update)\s+(?:my\s+)?(?:studio|business|company)\s+name/i.test(q)
  ) {
    return makeResult(INTENTS.GUIDE_USER, 0.98, entities, []);
  }

  // Navigation
  const navPatterns = {
    'dashboard': 'dashboard', 'mission control': 'dashboard', 'home': 'dashboard',
    'client': 'clients', 'profiles': 'clients',
    'collection': 'collections', 'pipeline': 'collections',
    'timeline': 'timeline', 'reflection': 'timeline', 'journal': 'timeline',
    'insight': 'insights', 'analytics': 'insights',
    'setting': 'settings', 'config': 'settings',
    'add invoice': 'add', 'new invoice page': 'add', 'assign task': 'add'
  };

  if (q.startsWith('go to') || q.startsWith('open') || q.startsWith('show me') || q.startsWith('navigate')) {
    for (const [keyword, page] of Object.entries(navPatterns)) {
      if (q.includes(keyword)) {
        return makeResult(INTENTS.NAVIGATE, 0.95, { ...entities, page }, []);
      }
    }
  }

  // Create invoice
  if (/create\s+(?:an?\s+)?invoice|new\s+invoice|add\s+invoice|issue\s+invoice|make\s+(?:an?\s+)?invoice/.test(q)) {
    const missing = [];
    if (!entities.clientName) missing.push('clientName');
    if (!entities.amount) missing.push('amount');
    if (!entities.dueDate) missing.push('dueDate');
    return makeResult(INTENTS.CREATE_INVOICE, 0.95, entities, missing);
  }

  // Mark paid — check before other intents since "mark X as paid" has client name in the middle
  if (/mark\s+.+?\s+(?:as\s+)?paid|record\s+payment|payment\s+received|.+\s+has\s+paid|paid\s+(?:the\s+)?invoice|mark\s+(?:as\s+)?paid|\.+paid\s+invoice/.test(q)) {
    return makeResult(INTENTS.MARK_PAID, 0.96, entities, []);
  }

  // Edit invoice
  if (/edit\s+invoice|update\s+invoice|change\s+(?:the\s+)?(?:invoice|amount)|modify\s+invoice/.test(q)) {
    return makeResult(INTENTS.EDIT_INVOICE, 0.92, entities, []);
  }

  // Delete invoice
  if (/delete\s+invoice|remove\s+invoice|cancel\s+invoice/.test(q)) {
    return makeResult(INTENTS.DELETE_INVOICE, 0.92, entities, []);
  }

  // Duplicate invoice
  if (/duplicate\s+invoice|copy\s+invoice|clone\s+invoice/.test(q)) {
    return makeResult(INTENTS.DUPLICATE_INVOICE, 0.90, entities, []);
  }

  // Send reminder
  if (/send\s+(?:a\s+)?(?:reminder|email|whatsapp|sms|nudge|message)|dispatch\s+reminder|nudge\s+client/.test(q)) {
    return makeResult(INTENTS.SEND_REMINDER, 0.94, entities, []);
  }

  // Generate/draft reminder
  if (/write\s+(?:a\s+)?reminder|draft\s+(?:a\s+)?reminder|generate\s+(?:a\s+)?reminder|rewrite|draft\s+negotiation/.test(q)) {
    return makeResult(INTENTS.GENERATE_REMINDER, 0.91, entities, []);
  }

  // Escalate
  if (/escalate|escalation|flag\s+client/.test(q)) {
    return makeResult(INTENTS.ESCALATE_CLIENT, 0.93, entities, []);
  }

  // Run scan
  if (/run\s+(?:a\s+)?(?:scan|agent|evaluation|daily|cycle)|scan\s+invoices|eval/.test(q)) {
    return makeResult(INTENTS.RUN_SCAN, 0.96, entities, []);
  }

  // Filter/search invoices
  if (/show\s+(?:all\s+)?invoices?\s+(?:over|above|below|under|overdue|pending|paid)|filter\s+invoice|overdue\s+invoice|highest\s+invoice/.test(q)) {
    return makeResult(INTENTS.FILTER_INVOICES, 0.90, entities, []);
  }

  // Risk analysis
  if (/risk|risky|highest\s+risk|worst\s+client|worries\s+you/.test(q)) {
    return makeResult(INTENTS.SHOW_RISK, 0.92, entities, []);
  }

  // Predict payment
  if (/predict|forecast|this\s+week|cashflow|cash\s+flow|next\s+payment/.test(q)) {
    return makeResult(INTENTS.PREDICT_PAYMENT, 0.89, entities, []);
  }

  // Analytics/insights
  if (/analytics|insight|trend|pattern|report|stats|statistic/.test(q)) {
    return makeResult(INTENTS.SHOW_ANALYTICS, 0.88, entities, []);
  }

  // Summarize workspace
  if (/summary|summarize|summarise|overview|brief|what happened|status|today/.test(q)) {
    return makeResult(INTENTS.SUMMARIZE_WORKSPACE, 0.90, entities, []);
  }

  // Search client
  if (/search\s+client|find\s+client|look\s+up\s+client|client\s+(?:info|profile|details)/.test(q) || (entities.clientName && !entities.invoiceId)) {
    return makeResult(INTENTS.SEARCH_CLIENT, 0.85, entities, []);
  }

  // Search invoice
  if (/search\s+invoice|find\s+invoice|look\s+up\s+invoice|inv-/.test(q)) {
    return makeResult(INTENTS.SEARCH_INVOICE, 0.85, entities, []);
  }

  // Greetings
  if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|what's\s+up|howdy)/.test(q)) {
    return makeResult(INTENTS.GREETING, 0.98, entities, []);
  }

  // General question
  if (/\?$|how\s+(?:many|much)|what\s+is|who\s+(?:is|has)|when\s+(?:is|was)|why\s+(?:did|do)|explain|tell\s+me/.test(q)) {
    return makeResult(INTENTS.QUESTION, 0.75, entities, []);
  }

  // Check if query mentions a known client name — treat as client search
  if (entities.clientName) {
    return makeResult(INTENTS.SEARCH_CLIENT, 0.80, entities, []);
  }

  return makeResult(INTENTS.UNKNOWN, 0.50, entities, []);
}

function makeResult(intent, confidence, entities, missingFields) {
  return {
    intent,
    confidence,
    entities,
    missingFields,
    tool: INTENT_TOOL_MAP[intent] || null,
    requiresAction: ACTION_INTENTS.has(intent)
  };
}

/**
 * Extract entities from natural language query.
 */
function extractEntities(q, workspaceContext) {
  const entities = {};

  // Invoice ID (INV-001, INV-2026-001)
  const invMatch = q.match(/inv-[\w-]+/i);
  if (invMatch) entities.invoiceId = invMatch[0].toUpperCase();

  // Amount (₹25,000 / 25000 / 25k / Rs 45000 / for 75000)
  // Use multiple patterns, prioritize explicit currency markers
  const amountPatterns = [
    /(?:₹|\$|rs\.?\s*|inr\s*|amount\s*(?:of\s*)?|for\s+)(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?\s*(k|lakh|lac|cr)?(?!\w)/i,
    /\b(\d{4,8})(\.\d+)?\s*(k|lakh|lac|cr)?\b/i,
  ];
  for (const pattern of amountPatterns) {
    const amountMatch = q.match(pattern);
    if (amountMatch) {
      let val = parseFloat(amountMatch[1].replace(/,/g, '') + (amountMatch[2] || ''));
      const multiplier = amountMatch[3]?.toLowerCase();
      if (multiplier === 'k') val *= 1000;
      else if (multiplier === 'lakh' || multiplier === 'lac') val *= 100000;
      else if (multiplier === 'cr') val *= 10000000;
      if (!isNaN(val) && val >= 100 && val < 100000000) {
        entities.amount = val;
        break;
      }
    }
  }

  // Channel
  if (q.includes('whatsapp')) entities.channel = 'whatsapp';
  else if (q.includes('email') || q.includes('mail')) entities.channel = 'email';
  else if (q.includes('sms') || q.includes('text')) entities.channel = 'sms';

  // Tone
  if (q.includes('polite') || q.includes('friendly') || q.includes('gentle')) entities.tone = 'polite';
  else if (q.includes('firm') || q.includes('assertive') || q.includes('strict')) entities.tone = 'firm';
  else if (q.includes('legal') || q.includes('notice')) entities.tone = 'legal';
  else if (q.includes('formal') || q.includes('neutral')) entities.tone = 'neutral';

  // Status filter
  if (q.includes('overdue') || q.includes('past due')) entities.status = 'overdue';
  else if (q.includes('paid')) entities.status = 'paid';
  else if (q.includes('escalated')) entities.status = 'escalated';
  else if (q.includes('open') || q.includes('pending') || q.includes('unpaid')) entities.status = 'open';

  // Match known client names
  if (workspaceContext?.clients) {
    for (const client of workspaceContext.clients) {
      if (q.includes(client.name.toLowerCase())) {
        entities.clientName = client.name;
        break;
      }
    }
  }

  // Fallback client name extraction ("for Rahul", "client Rahul", "to TechVista")
  if (!entities.clientName) {
    const clientMatch = q.match(/(?:for|to|from|client|debtor|name|contact)\s+([a-z][a-z0-9\s]*?)(?=\s+(?:for|amount|of|due|₹|\$|\d|next|on|with|invoice|has|paid|reminder|in|at|$))/i);
    if (clientMatch) {
      const name = clientMatch[1].trim();
      if (name.length > 1 && name.length < 50 && !/^\d+$/.test(name)) {
        entities.clientName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
  }

  // Due date extraction
  const today = new Date();
  if (q.includes('tomorrow')) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    entities.dueDate = d.toISOString().split('T')[0];
  } else if (q.includes('next week')) {
    const d = new Date(today); d.setDate(d.getDate() + 7);
    entities.dueDate = d.toISOString().split('T')[0];
  } else {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < dayNames.length; i++) {
      if (q.includes(`next ${dayNames[i]}`)) {
        entities.dueDate = getNextWeekday(i).toISOString().split('T')[0];
        break;
      }
    }
  }
  if (!entities.dueDate) {
    const dateMatch = q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch) entities.dueDate = dateMatch[1];
  }

  // Filter value (e.g., "over ₹50000" → filterType: 'above', filterValue: '50000')
  const filterMatch = q.match(/(?:over|above|more\s+than|greater\s+than)\s+(?:₹|rs\.?\s*)?(\d[\d,]*)/i);
  if (filterMatch) {
    entities.filterType = 'above';
    entities.filterValue = filterMatch[1].replace(/,/g, '');
  }
  const filterBelow = q.match(/(?:under|below|less\s+than)\s+(?:₹|rs\.?\s*)?(\d[\d,]*)/i);
  if (filterBelow) {
    entities.filterType = 'below';
    entities.filterValue = filterBelow[1].replace(/,/g, '');
  }

  // Description
  const descMatch = q.match(/(?:description|for|scope|regarding)\s+["']([^"']+)["']/i);
  if (descMatch) entities.description = descMatch[1];

  // New amount for edits
  const newAmountMatch = q.match(/(?:change|update|set)\s+(?:the\s+)?amount\s+to\s+(?:₹|rs\.?\s*)?(\d[\d,]*)/i);
  if (newAmountMatch) entities.newAmount = parseFloat(newAmountMatch[1].replace(/,/g, ''));

  return entities;
}

function getNextWeekday(dayOfWeek) {
  const d = new Date();
  d.setDate(d.getDate() + ((dayOfWeek + 7 - d.getDay()) % 7 || 7));
  return d;
}

module.exports = { detectIntent, INTENTS, INTENT_TOOL_MAP, REQUIRED_FIELDS };
