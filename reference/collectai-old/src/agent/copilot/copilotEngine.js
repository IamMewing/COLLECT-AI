// ============================================
// CollectAI — Agent Runtime Engine
// Multi-turn, tool-calling AI employee
// ============================================

const { getDb } = require('../../config/firebase');
const { getGeminiClient, GEMINI_MODEL } = require('../../config/gemini');
const { getWorkspaceContext } = require('./ragRetriever');
const { detectIntent, INTENTS, REQUIRED_FIELDS } = require('./intentDetector');
const { executeTool, getToolNames } = require('./tools');

// In-memory conversation store (per userId+conversationId)
const conversationStore = new Map();

const MAX_CONVERSATION_TURNS = 20;
const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Core Agent Runtime — processes a user message through the full agent pipeline:
 * Reason → Classify Intent → Plan → Collect Missing Fields → Execute Tool → Generate Response
 */
async function processAgentMessage(query, userId, businessId = null, conversationId = null) {
  const startTime = Date.now();

  try {
    const db = getDb();
    if (!db) {
      return buildErrorResponse('Database unavailable. Operating in limited mode.');
    }

    // 1. Load or create conversation
    const convKey = `${userId}:${conversationId || 'default'}`;
    let conversation = getConversation(convKey);
    conversation.messages.push({ role: 'user', content: query, timestamp: new Date().toISOString() });

    // 2. Fetch workspace context (RAG)
    const context = await getWorkspaceContext(db, userId, businessId);
    if (!context) {
      return buildErrorResponse('Could not retrieve workspace context.');
    }

    // 3. Check for settings guidance confirmations (e.g. Yes/No to navigating to settings)
    if (conversation.pendingNavigationConfirm) {
      const lowerReply = query.toLowerCase().trim();
      const targetRoute = conversation.pendingNavigationConfirm;
      
      if (/yes|yep|sure|ok|go\s*ahead|please|do\s*it|y\b/i.test(lowerReply)) {
        conversation.pendingNavigationConfirm = null;
        saveConversation(convKey, conversation);
        
        return buildResponse({
          responseText: "Opening the settings page for you now.",
          reasoning: "User confirmed settings page navigation request.",
          intent: 'NAVIGATE',
          confidence: 1.0,
          actions: [],
          uiCommands: [{ type: 'navigate', payload: { route: targetRoute } }],
          conversationId: conversationId || 'default',
          awaitingInput: false,
          durationMs: Date.now() - startTime
        });
      } else if (/no|nope|dont|cancel|stop|n\b/i.test(lowerReply)) {
        conversation.pendingNavigationConfirm = null;
        saveConversation(convKey, conversation);
        
        return buildResponse({
          responseText: "Understood. Let me know if there's anything else I can do.",
          reasoning: "User declined settings navigation.",
          intent: 'QUESTION',
          confidence: 1.0,
          actions: [],
          uiCommands: [],
          conversationId: conversationId || 'default',
          awaitingInput: false,
          durationMs: Date.now() - startTime
        });
      }
    }

    // 3.5. Check if we're in a multi-step field collection flow
    if (conversation.pendingAction) {
      const result = await handlePendingAction(conversation, query, db, userId, context);
      saveConversation(convKey, conversation);
      return result;
    }

    // 4. Detect intent
    const intentResult = await detectIntent(query, context);
    console.log(`🧠 Intent: ${intentResult.intent} (${(intentResult.confidence * 100).toFixed(0)}%) Tool: ${intentResult.tool || 'none'}`);

    // Intercept Greetings with dynamic, computed responses
    if (intentResult.intent === 'GREETING') {
      const ownerName = context.business?.displayName || 'there';
      const today = new Date();
      
      let greeting = 'Good morning';
      const hours = today.getHours();
      if (hours >= 12 && hours < 17) greeting = 'Good afternoon';
      else if (hours >= 17) greeting = 'Good evening';
      
      const responseText = `${greeting}, ${ownerName}. Hope you're having a productive day. How can I help with your receivables today?`;
      
      conversation.messages.push({
        role: 'agent', content: responseText, timestamp: new Date().toISOString()
      });
      saveConversation(convKey, conversation);
      
      return buildResponse({
        responseText,
        reasoning: "Greeting intent handled naturally.",
        intent: 'GREETING',
        confidence: 0.99,
        actions: [],
        uiCommands: [],
        conversationId: conversationId || 'default',
        awaitingInput: false,
        durationMs: Date.now() - startTime
      });
    }

    // Intercept Out of Scope queries with intelligent context-aware responses
    if (intentResult.intent === 'OUT_OF_SCOPE') {
      const responseText = "I'm here to help manage your receivables and workspace. I can't answer general knowledge questions.";

      conversation.messages.push({ role: 'agent', content: responseText, timestamp: new Date().toISOString() });
      saveConversation(convKey, conversation);

      return buildResponse({
        responseText,
        reasoning: 'OUT_OF_SCOPE query intercepted. Politely declined.',
        intent: 'OUT_OF_SCOPE',
        confidence: 0.99,
        actions: [],
        uiCommands: [],
        conversationId: conversationId || 'default',
        awaitingInput: false,
        durationMs: Date.now() - startTime
      });
    }

    // Intercept Guidance/Settings navigation queries
    if (intentResult.intent === 'GUIDE_USER') {
      const lowerQ = query.toLowerCase();
      let responseText;
      let targetRoute = '/settings';

      if (/(?:change|update|reset|forgot).*password|password.*(?:change|update|reset)/.test(lowerQ)) {
        responseText = "To change your password:\n\n1. Go to **Settings** (sidebar or top nav)\n2. Select the **Account** tab\n3. Under **Security**, click **Change Password**\n4. Enter your current password, then your new password\n5. Click **Save Changes**\n\nWould you like me to open Settings now?";        
      } else if (/(?:change|edit|update).*(?:display)?name|name.*(?:change|edit|update)/.test(lowerQ)) {
        responseText = "To change your display name:\n\n1. Go to **Settings** → **Profile** → **Personal Information**\n2. Click on your **Display Name** field\n3. Enter your new name\n4. Click **Save Changes**\n\nWould you like me to open Settings now?";
      } else if (/(?:change|edit|update).*(?:studio|business|company|workspace).*name/.test(lowerQ)) {
        responseText = "To update your studio name:\n\n1. Go to **Settings** → **Workspace** tab\n2. Find **Studio Profile** section\n3. Edit the **Studio Name** field\n4. Click **Save Changes**\n\nWould you like me to open Settings now?";
      } else if (/logo|profile.*(?:photo|image|picture)/.test(lowerQ)) {
        responseText = "To update your profile or logo:\n\n1. Go to **Settings** → **Profile** tab\n2. Click on your avatar or the upload area\n3. Select your image file\n4. Click **Save Changes**\n\nWould you like me to open Settings now?";
      } else if (/tone|reminder.*style|communication.*style/.test(lowerQ)) {
        responseText = "To change AI communication tone:\n\n1. Go to **Settings** → **Workspace** tab\n2. Find **AI Behaviour** section\n3. Select your preferred tone: **Polite**, **Neutral**, or **Firm**\n4. Changes save automatically\n\nWould you like me to open Settings now?";
      } else if (/email.*(?:change|update|edit)|change.*email/.test(lowerQ)) {
        responseText = "To update your workspace email:\n\n1. Go to **Settings** → **Workspace** tab\n2. Find **Studio Profile** → **Owner Email**\n3. Enter the new email address\n4. Click **Save Changes**\n\nWould you like me to open Settings now?";
      } else {
        responseText = "You can adjust your profile, studio details, AI behaviour, and security settings from the **Settings** page. Would you like me to open it?";
      }

      conversation.pendingNavigationConfirm = targetRoute;
      conversation.messages.push({ role: 'agent', content: responseText, timestamp: new Date().toISOString() });
      saveConversation(convKey, conversation);

      return buildResponse({
        responseText,
        reasoning: 'GUIDE_USER intent: provided step-by-step navigation instructions. Awaiting confirmation to navigate.',
        intent: 'GUIDE_USER',
        confidence: 0.99,
        actions: [],
        uiCommands: [],
        conversationId: conversationId || 'default',
        awaitingInput: true,
        durationMs: Date.now() - startTime
      });
    }

    // 5. Check for missing required fields
    if (intentResult.requiresAction && intentResult.missingFields && intentResult.missingFields.length > 0) {
      // Start multi-step collection
      conversation.pendingAction = {
        intent: intentResult.intent,
        tool: intentResult.tool,
        entities: { ...intentResult.entities },
        missingFields: [...intentResult.missingFields],
        currentFieldIndex: 0
      };

      const nextField = intentResult.missingFields[0];
      const askMessage = getFieldPrompt(nextField, intentResult.entities, context);

      conversation.messages.push({
        role: 'agent', content: askMessage, timestamp: new Date().toISOString()
      });
      saveConversation(convKey, conversation);

      return buildResponse({
        responseText: askMessage,
        reasoning: `Detected intent ${intentResult.intent} but missing required field: ${nextField}. Asking user.`,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        actions: [],
        uiCommands: [],
        conversationId: conversationId || 'default',
        awaitingInput: true,
        awaitingField: nextField,
        durationMs: Date.now() - startTime
      });
    }

    // 6. Execute tool if action required
    let toolResult = null;
    let uiCommands = [];

    if (intentResult.requiresAction && intentResult.tool) {
      toolResult = await executeTool(intentResult.tool, db, userId, intentResult.entities, context);
      uiCommands = toolResult.uiCommands || [];

      // Re-fetch context if tool modified data
      if (toolResult.success) {
        // Context will be stale; the frontend will refresh via REFRESH_DATA command
      }
    }

    // 7. Generate final response with Gemini
    const responseText = await generateAgentResponse(
      query, intentResult, toolResult, context, conversation, userId
    );

    // 8. Store agent response in conversation
    conversation.messages.push({
      role: 'agent', content: responseText, timestamp: new Date().toISOString(),
      toolExecuted: intentResult.tool, toolSuccess: toolResult?.success
    });
    saveConversation(convKey, conversation);

    return buildResponse({
      responseText,
      reasoning: `Intent: ${intentResult.intent} (${(intentResult.confidence * 100).toFixed(0)}%). ${intentResult.tool ? `Executed tool: ${intentResult.tool}. Success: ${toolResult?.success}.` : 'No action required.'}`,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      actions: intentResult.tool ? [{
        tool: intentResult.tool,
        params: intentResult.entities,
        success: toolResult?.success || false,
        result: toolResult?.data || null,
        message: toolResult?.message || null
      }] : [],
      uiCommands,
      toolResult: toolResult?.data || null,
      conversationId: conversationId || 'default',
      awaitingInput: false,
      durationMs: Date.now() - startTime
    });

  } catch (error) {
    console.error('Agent Runtime error:', error);
    return buildErrorResponse(`Operational issue encountered: ${error.message}`);
  }
}

/**
 * Handle a reply in a multi-step field collection flow.
 */
async function handlePendingAction(conversation, userReply, db, userId, context) {
  const pending = conversation.pendingAction;
  const currentField = pending.missingFields[pending.currentFieldIndex];

  // Parse the user's reply into the current field
  const parsedValue = parseFieldValue(currentField, userReply, context);
  if (parsedValue !== null) {
    pending.entities[currentField] = parsedValue;
  } else {
    // Couldn't parse — store raw value
    pending.entities[currentField] = userReply.trim();
  }

  pending.currentFieldIndex++;

  // Check if more fields are needed
  if (pending.currentFieldIndex < pending.missingFields.length) {
    const nextField = pending.missingFields[pending.currentFieldIndex];
    const askMessage = getFieldPrompt(nextField, pending.entities, context);

    conversation.messages.push({
      role: 'agent', content: askMessage, timestamp: new Date().toISOString()
    });

    return buildResponse({
      responseText: askMessage,
      reasoning: `Collected ${currentField}=${pending.entities[currentField]}. Now asking for ${nextField}.`,
      intent: pending.intent,
      confidence: 0.95,
      actions: [],
      uiCommands: [],
      conversationId: 'default',
      awaitingInput: true,
      awaitingField: nextField,
      durationMs: 0
    });
  }

  // All fields collected — execute the tool
  console.log(`✅ All fields collected for ${pending.tool}:`, pending.entities);
  const toolResult = await executeTool(pending.tool, db, userId, pending.entities, context);

  // Clear pending action
  conversation.pendingAction = null;

  // Generate response
  const responseText = toolResult.success
    ? toolResult.message
    : `I encountered an issue: ${toolResult.message}`;

  conversation.messages.push({
    role: 'agent', content: responseText, timestamp: new Date().toISOString(),
    toolExecuted: pending.tool, toolSuccess: toolResult.success
  });

  return buildResponse({
    responseText,
    reasoning: `Multi-step collection complete. Executed ${pending.tool}. Success: ${toolResult.success}.`,
    intent: pending.intent,
    confidence: 0.98,
    actions: [{
      tool: pending.tool,
      params: pending.entities,
      success: toolResult.success,
      result: toolResult.data || null,
      message: toolResult.message
    }],
    uiCommands: toolResult.uiCommands || [],
    toolResult: toolResult.data || null,
    conversationId: 'default',
    awaitingInput: false,
    durationMs: 0
  });
}

/**
 * Generate the agent's natural language response using Gemini.
 */
async function generateAgentResponse(query, intentResult, toolResult, context, conversation, userId) {
  const ai = getGeminiClient();

  if (!ai) {
    if (toolResult?.success) return toolResult.message;
    return generateFallbackResponse(query, intentResult, toolResult, context);
  }

  try {
    const ownerName = context.business?.ownerEmail?.split('@')[0] || 'there';
    const recentMessages = conversation.messages.slice(-6).map(m =>
      `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`
    ).join('\n');

    const systemInstruction = `You are the CollectAI Autonomous Accounts Receivable Employee.
Persona: Senior Operations Manager. Confident. Fast. Professional. Action-oriented.
Owner: ${ownerName}. Studio: ${context.business?.name || 'CollectAI Studio'}.

=== PRODUCT KNOWLEDGE BASE ===

WHAT IS COLLECTAI:
CollectAI is a SaaS platform that acts as an autonomous AI employee for freelancers, agencies, and studios to recover unpaid invoices. It uses Google Gemini to reason about each invoice, determine the right communication strategy, draft personalised reminders, and execute the collection workflow — all without human intervention.

WHAT IS GEMINI:
Gemini is Google's state-of-the-art large language model. CollectAI uses Gemini for: (1) Intent classification — understanding what you want to do, (2) Risk assessment — evaluating each client's payment probability, (3) Message generation — drafting personalised, tone-appropriate payment reminders, (4) Business reasoning — analysing workspace health and making collection decisions.

WHAT IS FIRESTORE:
Firestore is Google's scalable cloud NoSQL database. CollectAI uses Firestore as its single source of truth — every invoice, client profile, agent action, payment record, and AI reasoning trace is persisted in Firestore. It enables real-time data sync, multi-user workspaces, and audit trails.

WHAT IS FIREBASE:
Firebase is Google's app development platform. CollectAI uses Firebase Authentication for secure login (email/password, Google Sign-In), and Firebase Firestore for data persistence.

WHAT IS CLOUD RUN:
Google Cloud Run is a serverless container platform. CollectAI's backend API and AI agent engine run on Cloud Run for scalable, pay-per-use execution.

WHAT IS VERTEX AI:
Vertex AI is Google's managed ML platform. CollectAI optionally uses Vertex AI for advanced payment prediction models.

HOW COLLECTIONS WORK:
1. You create an invoice for a client with an amount and due date.
2. The AI monitors the invoice status.
3. On a scheduled cycle (daily or manual trigger), the agent evaluates all open invoices.
4. For each invoice: AI reads client payment history → calculates risk score → calls Gemini to decide strategy (gentle reminder / firm nudge / escalate to owner).
5. Gemini drafts a personalised message based on client relationship and tone preference.
6. Message is sent via email or logged for WhatsApp.
7. All reasoning and actions are stored in Firestore for full audit trail.
8. Dashboard updates in real-time.

HOW TO NAVIGATE:
- Dashboard (Mission Control): Overview of all metrics, recent collections, AI observations. Route: /
- Clients: View and manage client profiles with risk scores. Route: /clients
- Collections (Pipeline): See all invoices with their collection status. Route: /collections
- Timeline: Audit log of all AI actions and decisions. Route: /timeline
- Insights: Analytics, trends, collection performance. Route: /insights
- Settings: Profile, workspace, AI behaviour, security. Route: /settings
- Add Invoice: Create a new invoice. Route: /add

HOW TO CHANGE SETTINGS:
- Display name: Settings → Profile → Personal Information → Display Name → Save
- Password: Settings → Account → Security → Change Password → Save
- Studio name: Settings → Workspace → Studio Profile → Studio Name → Save
- Owner email: Settings → Workspace → Studio Profile → Owner Email → Save
- AI tone: Settings → Workspace → AI Behaviour → Tone Preference → (auto-saves)
- Logo/profile photo: Settings → Profile → Avatar upload area

WHAT AI CAN DO (TOOLS AVAILABLE):
- Create invoices, update invoices, delete invoices, duplicate invoices
- Mark invoices as paid, record payments
- Search and filter invoices (by status, amount, client)
- Send payment reminders (email)
- Generate draft reminder messages
- Escalate overdue accounts
- Run the full collection cycle (scan all invoices)
- Search client profiles
- Generate business insights and analytics
- Navigate to any page in the app
- Summarize workspace health

WHAT AI CANNOT DO:
- Delete your Google account, Gmail, or any external account
- Access your bank account or financial institutions
- Modify Firebase console or Google Cloud settings
- Send WhatsApp messages directly (WhatsApp Business API integration pending)
- Access emails outside CollectAI
- Perform any action outside the CollectAI workspace

OWNER'S WORKSPACE STATS:
- Open invoices: ${context.liveMetrics.openInvoicesCount}
- Total outstanding: ₹${context.liveMetrics.totalOutstanding.toLocaleString('en-IN')}
- Total recovered: ₹${context.liveMetrics.totalRecovered.toLocaleString('en-IN')}
- Collection rate: ${context.liveMetrics.collectionRate}%
- Active clients: ${context.clients.length}

=== END KNOWLEDGE BASE ===

CRITICAL BEHAVIOURAL RULES:
1. NEVER say "As an AI", "I think", "I believe", "Maybe", "I'm not sure", or ChatGPT-style disclaimers.
2. NEVER describe what you COULD do. State what you HAVE done or ARE doing.
3. If a tool executed successfully, confirm the action completed with specific details (invoice ID, amount, client name).
4. If a tool failed, state the issue clearly and suggest next steps.
5. If the user asks a product question (what is CollectAI, how does X work, what is Gemini, what is Firestore), answer from the knowledge base above — confidently and completely.
6. If the user asks something impossible (delete Google account), politely decline and explain your scope.
7. Use ₹ for currency. Use Indian number formatting (en-IN).
8. Keep responses under 4 sentences unless explaining a multi-step process or answering a product question.
9. Address the owner by name when natural.
10. When no invoices exist, guide the user to create their first invoice.`;

    const prompt = `### CONVERSATION HISTORY:
${recentMessages}

### DETECTED INTENT: ${intentResult.intent} (${(intentResult.confidence * 100).toFixed(0)}%)
### TOOL EXECUTED: ${intentResult.tool || 'none'}
### TOOL RESULT: ${toolResult ? JSON.stringify(toolResult.message || toolResult.data, null, 2) : 'None'}

### USER MESSAGE: "${query}"

Respond as the AI employee. Reference real data from the knowledge base. Be concise, confident, and direct.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.2,
        maxOutputTokens: 400
      }
    });

    return response.text?.trim() || toolResult?.message || 'Action completed.';
  } catch (err) {
    console.warn('⚠️ Gemini response generation failed:', err.message);
    if (toolResult?.success) return toolResult.message;
    return generateFallbackResponse(query, intentResult, toolResult, context);
  }
}

/**
 * Fallback response when Gemini is unavailable.
 */
function generateFallbackResponse(query, intentResult, toolResult, context) {
  const m = context.liveMetrics;
  const ownerName = context.business?.ownerEmail?.split('@')[0] || 'there';

  if (toolResult?.success) return toolResult.message;

  switch (intentResult.intent) {
    case INTENTS.GREETING:
      return `Good day, ${ownerName}. ${m.openInvoicesCount} active collections totaling ₹${m.totalOutstanding.toLocaleString('en-IN')}. Collection rate: ${m.collectionRate}%. Ready to work.`;
    case INTENTS.SUMMARIZE_WORKSPACE:
      return `Workspace: ${m.openInvoicesCount} open invoices (₹${m.totalOutstanding.toLocaleString('en-IN')} outstanding), ₹${m.totalRecovered.toLocaleString('en-IN')} recovered. Health score: ${m.businessHealthScore}%.`;
    case INTENTS.SHOW_RISK: {
      const risky = context.clients.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))[0];
      return risky
        ? `Highest risk: ${risky.name} (Risk: ${risky.riskScore || 'N/A'}%, Outstanding: ₹${(risky.totalOutstanding || 0).toLocaleString('en-IN')}).`
        : 'All client accounts within healthy thresholds.';
    }
    case INTENTS.PREDICT_PAYMENT:
      return `Projected recovery: ₹${Math.round(m.totalOutstanding * 0.78).toLocaleString('en-IN')} expected within 7 days.`;
    default:
      return `${m.openInvoicesCount} open tasks totaling ₹${m.totalOutstanding.toLocaleString('en-IN')}. How should I proceed with recovery?`;
  }
}

/**
 * Get a natural-language prompt asking for a specific missing field.
 */
function getFieldPrompt(field, existingEntities, context) {
  const clientName = existingEntities.clientName;

  switch (field) {
    case 'clientName': {
      const knownClients = context?.clients?.map(c => c.name).slice(0, 5).join(', ');
      return knownClients
        ? `Which client is this invoice for? Known clients: ${knownClients}`
        : 'Which client is this invoice for?';
    }
    case 'amount':
      return clientName
        ? `Got it — ${clientName}. What's the invoice amount (₹)?`
        : 'What amount should I invoice?';
    case 'dueDate':
      return existingEntities.amount
        ? `₹${parseFloat(existingEntities.amount).toLocaleString('en-IN')} noted. When is payment due? (e.g., "next Friday", "2026-08-15")`
        : 'When is payment due?';
    case 'invoiceId':
      return 'Which invoice? Provide the invoice ID (e.g., INV-0001) or client name.';
    case 'description':
      return 'Brief description of the work or services?';
    case 'page':
      return 'Where should I navigate? (dashboard, clients, collections, timeline, insights, settings)';
    default:
      return `What is the ${field}?`;
  }
}

/**
 * Parse user reply into a typed value for a specific field.
 */
function parseFieldValue(field, reply, context) {
  const r = reply.trim();

  switch (field) {
    case 'amount': {
      const match = r.match(/(?:₹|rs\.?\s*)?(\d[\d,]*)(\.\d+)?\s*(k|lakh|lac)?/i);
      if (match) {
        let val = parseFloat(match[1].replace(/,/g, '') + (match[2] || ''));
        if (match[3]?.toLowerCase() === 'k') val *= 1000;
        else if (match[3]?.toLowerCase() === 'lakh' || match[3]?.toLowerCase() === 'lac') val *= 100000;
        return val;
      }
      return null;
    }
    case 'dueDate': {
      // Try parsing natural dates
      const lower = r.toLowerCase();
      const today = new Date();
      if (lower.includes('tomorrow')) {
        const d = new Date(today); d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
      }
      if (lower.includes('next week')) {
        const d = new Date(today); d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
      }
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      for (let i = 0; i < dayNames.length; i++) {
        if (lower.includes(dayNames[i])) {
          const d = new Date(today);
          d.setDate(d.getDate() + ((i + 7 - d.getDay()) % 7 || 7));
          return d.toISOString().split('T')[0];
        }
      }
      const dateMatch = r.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch) return dateMatch[0];
      return r;
    }
    case 'clientName': {
      // Try matching against known clients
      if (context?.clients) {
        for (const c of context.clients) {
          if (r.toLowerCase().includes(c.name.toLowerCase())) return c.name;
        }
      }
      return r.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    default:
      return r;
  }
}

// ────────────────────────────────────────────────
// Conversation memory management
// ────────────────────────────────────────────────

function getConversation(key) {
  if (conversationStore.has(key)) {
    const conv = conversationStore.get(key);
    // Check TTL
    if (Date.now() - conv.lastActivity > CONVERSATION_TTL_MS) {
      conversationStore.delete(key);
      return createConversation(key);
    }
    conv.lastActivity = Date.now();
    return conv;
  }
  return createConversation(key);
}

function createConversation(key) {
  const conv = {
    messages: [],
    pendingAction: null,
    lastActivity: Date.now(),
    createdAt: Date.now()
  };
  conversationStore.set(key, conv);
  return conv;
}

function saveConversation(key, conversation) {
  // Trim old messages
  if (conversation.messages.length > MAX_CONVERSATION_TURNS * 2) {
    conversation.messages = conversation.messages.slice(-MAX_CONVERSATION_TURNS * 2);
  }
  conversation.lastActivity = Date.now();
  conversationStore.set(key, conversation);
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, conv] of conversationStore.entries()) {
    if (now - conv.lastActivity > CONVERSATION_TTL_MS) {
      conversationStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ────────────────────────────────────────────────
// Response builder
// ────────────────────────────────────────────────

function buildResponse(data) {
  return {
    responseText: data.responseText,
    reasoning: data.reasoning,
    intent: data.intent,
    confidence: data.confidence,
    actions: data.actions || [],
    uiCommands: data.uiCommands || [],
    toolResult: data.toolResult || null,
    conversationId: data.conversationId || 'default',
    awaitingInput: data.awaitingInput || false,
    awaitingField: data.awaitingField || null,
    actionExecuted: (data.actions || []).some(a => a.success),
    executedToolName: data.actions?.[0]?.tool || null,
    durationMs: data.durationMs || 0,
    // Legacy compat fields
    evidence: data.reasoning,
    recommendation: '',
    suggestedActionCommand: data.uiCommands?.[0]?.type || 'none'
  };
}

function buildErrorResponse(message) {
  return {
    responseText: message,
    reasoning: 'Error fallback',
    intent: 'ERROR',
    confidence: 0,
    actions: [],
    uiCommands: [],
    toolResult: null,
    conversationId: 'default',
    awaitingInput: false,
    awaitingField: null,
    actionExecuted: false,
    executedToolName: null,
    durationMs: 0,
    evidence: '',
    recommendation: 'Retry or check system status.',
    suggestedActionCommand: 'none'
  };
}

// Legacy export name for backwards compatibility
const processCopilotQuery = processAgentMessage;

module.exports = { processAgentMessage, processCopilotQuery };
