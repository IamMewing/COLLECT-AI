// ============================================
// CollectAI — Live Agent Status Service
// ============================================

/**
 * Valid Agent States:
 * - 'Idle'
 * - 'Scanning'
 * - 'Thinking'
 * - 'Consulting Memory'
 * - 'Reasoning'
 * - 'Generating Strategy'
 * - 'Preparing Actions'
 * - 'Executing'
 * - 'Reflecting'
 * - 'Updating Memory'
 * - 'Ready'
 */
let currentAgentState = 'Ready';

function getAgentStatus() {
  return currentAgentState;
}

function setAgentStatus(state) {
  const validStates = [
    'Idle', 'Scanning', 'Thinking', 'Consulting Memory', 'Reasoning',
    'Generating Strategy', 'Preparing Actions', 'Executing', 'Reflecting',
    'Updating Memory', 'Ready'
  ];

  if (validStates.includes(state)) {
    currentAgentState = state;
    console.log(`🤖 [AGENT STATE SHIFT] -> ${state.toUpperCase()}`);
  } else {
    console.warn(`⚠️ Invalid agent state transition attempted: ${state}`);
  }
}

module.exports = { getAgentStatus, setAgentStatus };
