// ============================================
// CollectAI — Business Memory Manager
// ============================================

const BUSINESS_MEMORY_COLLECTION = 'business_memories';

/**
 * Retrieve memory details for a business profile, scoped by userId.
 * Falls back to default policies if no record exists.
 */
async function getBusinessMemory(db, businessId, userId) {
  try {
    const docRef = db.collection(BUSINESS_MEMORY_COLLECTION).doc(businessId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return {
        businessId,
        userId,
        preferredCommunicationStyle: 'polite',
        workingHours: { start: '09:00', end: '18:00' },
        typicalInvoiceSize: 25000,
        industry: 'Professional Services',
        collectionStrategy: 'assertive_gradual',
        averageRecoveryTimeDays: 14,
        historicalSuccessRatePercent: 88,
        businessRules: [
          'No follow-ups on weekends',
          'Offer payment plan if invoice is past due for 30+ days'
        ],
        agentPreferences: {
          enableAutoPilot: true,
          checkFrequencyHours: 24
        },
        recoveryPolicies: {
          gracePeriodDays: 2,
          escalationIntervalDays: 7
        }
      };
    }

    const data = doc.data();
    return { businessId, ...data };
  } catch (error) {
    console.error('Error fetching business memory:', error);
    throw error;
  }
}

/**
 * Save or update business memory.
 */
async function updateBusinessMemory(db, businessId, updates) {
  try {
    const docRef = db.collection(BUSINESS_MEMORY_COLLECTION).doc(businessId);
    const doc = await docRef.get();

    const finalUpdates = {
      ...updates,
      updated_at: new Date()
    };

    if (!doc.exists) {
      await docRef.set({
        businessId,
        created_at: new Date(),
        ...finalUpdates
      });
    } else {
      await docRef.update(finalUpdates);
    }

    return { businessId, ...finalUpdates };
  } catch (error) {
    console.error('Error updating business memory:', error);
    throw error;
  }
}

module.exports = { getBusinessMemory, updateBusinessMemory };
