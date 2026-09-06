// ============================================
// CollectAI — Decision Engine
// ============================================

const { buildAgentContext } = require('../memory/contextBuilder');
const { runGeminiReasoning } = require('./geminiReasoning');

/**
 * Orchestrates the full invoice evaluation:
 * Consolidates context details -> invokes Gemini -> yields structured plan parameters.
 */
async function evaluateInvoiceDecision(db, invoiceId, userId) {
  try {
    // 1. Compile client history context
    const context = await buildAgentContext(db, invoiceId, userId);

    // 2. Query Gemini reasoning predictions
    const reasoningResult = await runGeminiReasoning(context);

    return {
      invoiceId,
      userId,
      context,
      reasoning: reasoningResult
    };
  } catch (error) {
    console.error(`Error evaluating invoice decision #${invoiceId}:`, error);
    throw error;
  }
}

module.exports = { evaluateInvoiceDecision };
