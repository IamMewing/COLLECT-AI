// ============================================
// CollectAI — Client Memory Manager
// ============================================

const { getDb } = require('../../config/firebase');

const CLIENT_MEMORY_COLLECTION = 'client_memories';

/**
 * Retrieve memory details for a client, scoped by userId.
 * If no record exists, initializes a default profile.
 */
async function getClientMemory(db, clientName, userId) {
  try {
    const query = db.collection(CLIENT_MEMORY_COLLECTION)
      .where('clientName', '==', clientName)
      .where('userId', '==', userId)
      .limit(1);

    const snapshot = await query.get();
    
    if (snapshot.empty) {
      // Return default client memory template
      return {
        clientName,
        userId,
        email: '',
        phone: '',
        whatsapp: '',
        industry: 'Services',
        country: 'India',
        timezone: 'Asia/Kolkata',
        preferredLanguage: 'English',
        preferredChannel: 'email',
        communicationTone: 'polite',
        relationshipScore: 80, // Default 0-100 scale (80 = healthy start)
        trustScore: 80,
        riskScore: 20,
        paymentHistory: [],
        averagePaymentDelayDays: 0,
        totalInvoices: 0,
        paidInvoices: 0,
        lateInvoices: 0,
        ignoredReminders: 0,
        successfulReminders: 0,
        lastInteractionDate: null,
        conversationHistory: [],
        sentimentTrend: 'neutral',
        businessNotes: 'Initial memory workspace connection.',
        reflectionHistory: []
      };
    }

    let memoryData = null;
    snapshot.forEach(doc => {
      memoryData = { id: doc.id, ...doc.data() };
    });

    return memoryData;
  } catch (error) {
    console.error('Error fetching client memory:', error);
    throw error;
  }
}

/**
 * Create or update client memory details, scoped by userId.
 */
async function updateClientMemory(db, clientName, userId, updates) {
  try {
    const query = db.collection(CLIENT_MEMORY_COLLECTION)
      .where('clientName', '==', clientName)
      .where('userId', '==', userId)
      .limit(1);

    const snapshot = await query.get();

    if (snapshot.empty) {
      const defaultProfile = {
        clientName,
        userId,
        created_at: new Date(),
        ...updates
      };
      const docRef = await db.collection(CLIENT_MEMORY_COLLECTION).add(defaultProfile);
      return { id: docRef.id, ...defaultProfile };
    }

    let docId = null;
    let existingData = null;
    snapshot.forEach(doc => {
      docId = doc.id;
      existingData = doc.data();
    });

    const finalUpdates = {
      ...updates,
      updated_at: new Date()
    };

    await db.collection(CLIENT_MEMORY_COLLECTION).doc(docId).update(finalUpdates);
    return { id: docId, ...existingData, ...finalUpdates };
  } catch (error) {
    console.error('Error updating client memory:', error);
    throw error;
  }
}

module.exports = { getClientMemory, updateClientMemory };
