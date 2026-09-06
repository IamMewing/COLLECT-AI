// ============================================
// CollectAI — Reusable Agent APIs
// ============================================

const { getDb } = require('../../config/firebase');
const { buildAgentContext } = require('../memory/contextBuilder');
const { evaluateInvoiceDecision } = require('../decision/decisionEngine');
const { generateActionPlan } = require('../planner/actionPlanner');
const { executeActionPlan } = require('../executor/executionEngine');
const { writeAgentReflection } = require('../reflection/reflectionEngine');
const { calculateRiskScore } = require('../risk/riskEngine');
const { predictPaymentProbability } = require('../risk/probabilityEngine');
const { getClientMemory, updateClientMemory } = require('../memory/clientMemory');
const { setAgentStatus } = require('./liveStatus');

/**
 * Consolidates context records for a single invoice.
 */
async function buildContext(invoiceId, userId) {
  setAgentStatus('Consulting Memory');
  const db = getDb();
  return await buildAgentContext(db, invoiceId, userId);
}

/**
 * Calculates risk indexes for an invoice.
 */
async function calculateRisk(invoiceId, userId) {
  setAgentStatus('Thinking');
  const context = await buildContext(invoiceId, userId);
  const result = calculateRiskScore(
    context.daysOverdue,
    context.invoice.amount,
    context.clientMemory.ignoredReminders,
    context.clientMemory.relationshipScore
  );
  setAgentStatus('Ready');
  return result;
}

/**
 * Computes payment probabilities.
 */
async function predictPayment(invoiceId, userId) {
  setAgentStatus('Thinking');
  const context = await buildContext(invoiceId, userId);
  const result = predictPaymentProbability(context.invoice, context.clientMemory);
  setAgentStatus('Ready');
  return result;
}

/**
 * Generates an action strategy plan for an invoice.
 */
async function generateStrategy(invoiceId, userId) {
  setAgentStatus('Reasoning');
  const db = getDb();
  const evalResult = await evaluateInvoiceDecision(db, invoiceId, userId);
  
  setAgentStatus('Generating Strategy');
  const plan = generateActionPlan(evalResult.reasoning, invoiceId, userId);
  
  setAgentStatus('Ready');
  return { plan, context: evalResult.context };
}

/**
 * Executes a generated action plan.
 */
async function executePlan(actionPlan, context) {
  setAgentStatus('Executing');
  const db = getDb();
  const result = await executeActionPlan(db, actionPlan, context);
  setAgentStatus('Ready');
  return result;
}

/**
 * Log reflections manually.
 */
async function reflect(actionLog, reasoning, userId) {
  setAgentStatus('Reflecting');
  const db = getDb();
  const result = await writeAgentReflection(db, actionLog, reasoning, userId);
  setAgentStatus('Ready');
  return result;
}

module.exports = {
  buildContext,
  calculateRisk,
  predictPayment,
  generateStrategy,
  executePlan,
  reflect
};
