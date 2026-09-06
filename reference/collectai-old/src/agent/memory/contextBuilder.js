// ============================================
// CollectAI — Context Builder
// ============================================

const { getBusinessMemory } = require('./businessMemory');
const { getClientMemory } = require('./clientMemory');
const { COLLECTIONS } = require('../../config/firebase');

/**
 * Gathers business profiles, client memory states, transaction details, 
 * previous action timelines, and previous reflections to construct a unified 
 * structured context payload for Gemini.
 */
async function buildAgentContext(db, invoiceId, userId) {
  try {
    // 1. Fetch Invoice
    const invoiceDoc = await db.collection(COLLECTIONS.INVOICES).doc(invoiceId).get();
    if (!invoiceDoc.exists) {
      throw new Error(`Invoice #${invoiceId} not found`);
    }
    const invoice = { id: invoiceDoc.id, ...invoiceDoc.data() };

    if (invoice.userId !== userId) {
      throw new Error('Access forbidden: Unauthorized invoice access');
    }

    // 2. Fetch Business details and Memory
    const businessDoc = await db.collection(COLLECTIONS.BUSINESSES).doc(invoice.business_id).get();
    const business = businessDoc.exists ? businessDoc.data() : { name: 'Apex Studio' };
    const businessMemory = await getBusinessMemory(db, invoice.business_id, userId);

    // 3. Fetch Client Memory
    const clientMemory = await getClientMemory(db, invoice.client_name, userId);

    // 4. Fetch Previous Action Reminders
    const actionsSnapshot = await db.collection(COLLECTIONS.AGENT_ACTIONS)
      .where('invoice_id', 'in', [invoice.invoice_id, invoiceId])
      .where('userId', '==', userId)
      .get();

    const rawReminders = [];
    actionsSnapshot.forEach(doc => {
      const data = doc.data();
      rawReminders.push({
        actionId: doc.id,
        decision: data.decision,
        outcome: data.outcome,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
        reasoningSummary: data.reasoning_summary
      });
    });

    // Sort in-memory
    rawReminders.sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime();
      const tB = new Date(b.timestamp || 0).getTime();
      return tB - tA;
    });
    const previousReminders = rawReminders.slice(0, 10);

    // 5. Fetch Previous Reflections
    const reflectionsSnapshot = await db.collection('agent_reflections')
      .where('invoiceId', '==', invoiceId)
      .where('userId', '==', userId)
      .get();

    const rawReflections = [];
    reflectionsSnapshot.forEach(doc => {
      const data = doc.data();
      rawReflections.push({
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp
      });
    });

    // Sort in-memory
    rawReflections.sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime();
      const tB = new Date(b.timestamp || 0).getTime();
      return tB - tA;
    });
    const previousReflections = rawReflections.slice(0, 5);

    // 6. Compute days overdue
    const today = new Date();
    const dueDate = invoice.due_date?.toDate ? invoice.due_date.toDate() : new Date(invoice.due_date);
    const daysOverdue = Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));

    // 7. Combine into a highly structured Context Payload
    const context = {
      currentDate: today.toISOString().split('T')[0],
      daysOverdue,
      communicationTone: businessMemory.preferredCommunicationStyle || 'polite',
      invoice: {
        id: invoice.id,
        invoice_id: invoice.invoice_id,
        clientName: invoice.client_name,
        clientEmail: invoice.client_email,
        amount: invoice.amount,
        currency: invoice.currency || 'INR',
        dueDate: dueDate.toISOString().split('T')[0],
        status: invoice.status,
        escalationLevel: invoice.escalation_level || 0
      },
      business: {
        id: invoice.business_id,
        name: business.name,
        email: business.owner_email,
        contact: business.owner_contact || ''
      },
      businessMemory: {
        preferredStyle: businessMemory.preferredCommunicationStyle,
        rules: businessMemory.businessRules,
        strategy: businessMemory.collectionStrategy,
        gracePeriodDays: businessMemory.recoveryPolicies?.gracePeriodDays || 2
      },
      clientMemory: {
        relationshipScore: clientMemory.relationshipScore,
        trustScore: clientMemory.trustScore,
        riskScore: clientMemory.riskScore,
        avgPaymentDelayDays: clientMemory.averagePaymentDelayDays,
        totalInvoices: clientMemory.totalInvoices,
        paidInvoices: clientMemory.paidInvoices,
        lateInvoices: clientMemory.lateInvoices,
        ignoredReminders: clientMemory.ignoredReminders,
        successfulReminders: clientMemory.successfulReminders,
        sentimentTrend: clientMemory.sentimentTrend
      },
      previousReminders,
      previousReflections
    };

    return context;
  } catch (error) {
    console.error('Error building context:', error);
    throw error;
  }
}

module.exports = { buildAgentContext };
