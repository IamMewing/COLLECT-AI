// ============================================
// CollectAI — Payment Probability Engine
// ============================================

/**
 * Predicts the chance of invoice recovery (0% to 100%) and provides 
 * a professional structural explanation of the projection.
 */
function predictPaymentProbability(invoice, clientMemory) {
  const daysOverdue = invoice.daysOverdue || 0;
  const trust = clientMemory.trustScore || 80;
  const ignored = clientMemory.ignoredReminders || 0;

  let probability = 95; // Start with healthy optimism

  // 1. Overdue decay
  if (daysOverdue > 30) {
    probability -= 40;
  } else if (daysOverdue > 14) {
    probability -= 20;
  } else if (daysOverdue > 7) {
    probability -= 10;
  }

  // 2. Client history penalties
  probability -= Math.min(30, ignored * 10);

  // 3. Trust offset
  const trustImpact = Math.round((100 - trust) * 0.35);
  probability -= trustImpact;

  // Clamp limits (5% to 98%)
  probability = Math.min(98, Math.max(5, probability));

  // Determine explanation
  let explanation = 'Invoice has a high probability of timely settlement based on healthy client relationship scores.';

  if (probability < 30) {
    explanation = `Critical payment probability (${probability}%). Payment is overdue by ${daysOverdue} days with multiple ignored reminders. Immediate owner escalation advised.`;
  } else if (probability < 65) {
    explanation = `Moderate collection probability (${probability}%). Overdue interval is expanding; client trust parameters indicate possible scheduling delays.`;
  }

  return {
    probability,
    explanation
  };
}

module.exports = { predictPaymentProbability };
