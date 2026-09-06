// ============================================
// CollectAI — Risk Engine
// ============================================

/**
 * Procedural credit risk calculations.
 * Returns a score from 0-100 and a category label: Low, Medium, High, Critical.
 */
function calculateRiskScore(daysOverdue, amount, ignoredReminders, relationshipScore) {
  let score = 10; // Base risk score

  // 1. Days overdue impacts
  if (daysOverdue > 30) {
    score += 35;
  } else if (daysOverdue > 14) {
    score += 20;
  } else if (daysOverdue > 7) {
    score += 10;
  }

  // 2. High amount factors
  if (amount > 100000) {
    score += 15;
  } else if (amount > 50000) {
    score += 10;
  }

  // 3. Ignored followups impacts
  score += Math.min(25, (ignoredReminders || 0) * 8);

  // 4. Low relationship score increases risk
  const relInverted = Math.max(0, 100 - (relationshipScore || 80));
  score += Math.round(relInverted * 0.2);

  // Bounds check (0-100)
  score = Math.min(100, Math.max(0, score));

  let category = 'Low';
  if (score > 80) {
    category = 'Critical';
  } else if (score > 60) {
    category = 'High';
  } else if (score > 30) {
    category = 'Medium';
  }

  return {
    score,
    category
  };
}

module.exports = { calculateRiskScore };
