// ============================================
// CollectAI Copilot — RAG Context Retriever
// ============================================

const { COLLECTIONS } = require('../../config/firebase');
const { v4: uuidv4 } = require('uuid');

/**
 * Gathers complete workspace context (business profile, owner details, live statistics,
 * all invoices, all client profiles, recent action history, and stored AI reflections).
 * 
 * Ensures every LLM query is fully grounded in real, active workspace data.
 */
async function getWorkspaceContext(db, userId, businessId = null) {
  try {
    if (!db) return null;

    // 1. Business Profile
    const activeId = businessId || userId;
    const businessDoc = await db.collection(COLLECTIONS.BUSINESSES).doc(activeId).get();
    
    let business = null;
    if (businessDoc.exists) {
      business = { id: businessDoc.id, ...businessDoc.data() };
    } else {
      // Return null context so caller knows no workspace is configured
      return null;
    }

    // 2. Invoices
    const invoicesSnapshot = await db.collection(COLLECTIONS.INVOICES)
      .where('userId', '==', userId)
      .get();

    const today = new Date();
    const invoices = [];
    let totalOutstanding = 0;
    let totalRecovered = 0;
    let openCount = 0;
    let paidCount = 0;

    invoicesSnapshot.forEach(doc => {
      const data = doc.data();
      const dueDate = data.due_date?.toDate ? data.due_date.toDate() : new Date(data.due_date);
      const daysOverdue = Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));

      const inv = {
        id: doc.id,
        invoice_id: data.invoice_id,
        business_id: data.business_id,
        client_name: data.client_name,
        client_email: data.client_email || '',
        amount: data.amount || 0,
        due_date: dueDate.toISOString().split('T')[0],
        days_overdue: daysOverdue,
        status: data.status || 'open',
        escalation_level: data.escalation_level || 0,
        description: data.description || '',
        last_action_at: data.last_action_at ? (data.last_action_at.toDate ? data.last_action_at.toDate().toISOString() : data.last_action_at) : null
      };

      invoices.push(inv);

      if (inv.status === 'paid') {
        totalRecovered += inv.amount;
        paidCount++;
      } else {
        totalOutstanding += inv.amount;
        openCount++;
      }
    });

    const collectionRate = (invoices.length > 0) ? Math.round((paidCount / invoices.length) * 100) : 100;
    const businessHealth = Math.min(100, Math.max(20, collectionRate + 10 - (openCount * 2)));

    // 3. Client Memory Profiles
    const clientMemoriesSnapshot = await db.collection('client_memories')
      .where('userId', '==', userId)
      .get();

    const clientMemories = [];
    clientMemoriesSnapshot.forEach(doc => {
      clientMemories.push({ id: doc.id, ...doc.data() });
    });

    // Derive client summary list
    const clientMap = {};
    invoices.forEach(inv => {
      if (!clientMap[inv.client_name]) {
        const mem = clientMemories.find(m => m.clientName === inv.client_name);
        clientMap[inv.client_name] = {
          name: inv.client_name,
          email: inv.client_email,
          totalInvoices: 0,
          totalOutstanding: 0,
          totalPaid: 0,
          maxDaysOverdue: 0,
          riskScore: mem ? mem.riskScore : (inv.status === 'escalated' ? 75 : 20),
          trustScore: mem ? mem.trustScore : 85,
          avgDelayDays: mem ? mem.averagePaymentDelayDays : 4,
          notes: mem ? mem.businessNotes : 'Standard client contract.'
        };
      }
      clientMap[inv.client_name].totalInvoices++;
      if (inv.status === 'paid') {
        clientMap[inv.client_name].totalPaid += inv.amount;
      } else {
        clientMap[inv.client_name].totalOutstanding += inv.amount;
        if (inv.days_overdue > clientMap[inv.client_name].maxDaysOverdue) {
          clientMap[inv.client_name].maxDaysOverdue = inv.days_overdue;
        }
      }
    });

    const clients = Object.values(clientMap);

    // 4. Recent Agent Actions (Reminders & Escalate events)
    const actionsSnapshot = await db.collection(COLLECTIONS.AGENT_ACTIONS)
      .where('userId', '==', userId)
      .get();

    const rawRecentActions = [];
    actionsSnapshot.forEach(doc => {
      const data = doc.data();
      rawRecentActions.push({
        action_id: doc.id,
        invoice_id: data.invoice_id,
        decision: data.decision,
        reasoning_summary: data.reasoning_summary,
        channel: data.channel || 'email',
        outcome: data.outcome || 'sent',
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp
      });
    });

    // Sort in-memory
    rawRecentActions.sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime();
      const tB = new Date(b.timestamp || 0).getTime();
      return tB - tA;
    });
    const recentActions = rawRecentActions.slice(0, 15);

    // 5. Stored Reflections
    const reflectionsSnapshot = await db.collection('agent_reflections')
      .where('userId', '==', userId)
      .get();

    const rawRecentReflections = [];
    reflectionsSnapshot.forEach(doc => {
      const data = doc.data();
      rawRecentReflections.push({
        id: doc.id,
        invoiceId: data.invoiceId,
        actionDecision: data.actionDecision,
        reflectionSummary: data.reflectionSummary,
        wasBestDecision: data.wasBestDecision,
        suggestedToneShift: data.suggestedToneShift,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp
      });
    });

    // Sort in-memory
    rawRecentReflections.sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime();
      const tB = new Date(b.timestamp || 0).getTime();
      return tB - tA;
    });
    const recentReflections = rawRecentReflections.slice(0, 10);

    return {
      currentDate: today.toISOString().split('T')[0],
      currentTime: today.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      business: {
        id: business.business_id || business.id,
        business_id: business.business_id || business.id,
        name: business.name || 'Apex Studio',
        ownerEmail: business.owner_email || userId,
        ownerContact: business.owner_contact || '',
        tonePreference: business.tone_preference || 'polite',
        timezone: business.timezone || 'Asia/Kolkata'
      },
      liveMetrics: {
        totalInvoices: invoices.length,
        openInvoicesCount: openCount,
        paidInvoicesCount: paidCount,
        totalOutstanding,
        totalRecovered,
        collectionRate,
        businessHealthScore: businessHealth,
        estimatedHoursSaved: Math.round(invoices.length * 1.8 * 10) / 10
      },
      invoices,
      clients,
      recentActions,
      recentReflections
    };

  } catch (error) {
    console.error('Error fetching RAG workspace context:', error);
    return null;
  }
}

module.exports = { getWorkspaceContext };
