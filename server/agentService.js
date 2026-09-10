/**
 * AgentService: Node.js wrapper that invokes the Python Strands Agent bridge.
 * Captures stdout and stderr to guarantee transparent, debuggable error reporting.
 */

const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_SCRIPT = path.join(__dirname, 'agent_bridge.py');
// Use python from environment (or PYTHON_PATH if configured)
const PYTHON_CMD = process.env.PYTHON_PATH || 'python';

/**
 * Execute an action against the Python agent bridge.
 *
 * @param {string} action - 'sweep' | 'approve'
 * @param {object} payload - Action parameters
 * @returns {Promise<object>} Parsed JSON response from agent bridge
 */
function callAgentBridge(action, payload) {
  return new Promise((resolve, reject) => {
    const childEnv = {
      ...process.env,
      MODEL_PROVIDER: process.env.MODEL_PROVIDER || 'gemini',
      ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
      ...(process.env.USE_MOCK !== undefined ? { USE_MOCK: process.env.USE_MOCK } : {}),
      ...(process.env.COLLECT_AI_MOCK !== undefined ? { COLLECT_AI_MOCK: process.env.COLLECT_AI_MOCK } : {}),
    };

    const child = spawn(PYTHON_CMD, [BRIDGE_SCRIPT], {
      cwd: __dirname,
      env: childEnv,
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('error', (err) => {
      reject({
        status: 500,
        error: `Failed to spawn Python process: ${err.message}`,
        details: 'Check that Python is installed and accessible via PATH.',
        stderr: stderrData.trim() || err.message,
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const errorSummary = stderrData.trim() || `Python process exited with code ${code}`;
        console.error(`🔴 [AgentService] Error in action '${action}':\n`, errorSummary);

        return reject({
          status: 500,
          error: `Strands Agent execution failed (exit code ${code})`,
          details: errorSummary,
          stderr: stderrData.trim(),
          action,
        });
      }

      try {
        const parsed = JSON.parse(stdoutData.trim());
        resolve(parsed);
      } catch (parseErr) {
        console.error('🔴 [AgentService] Failed to parse Python stdout as JSON:', stdoutData);
        reject({
          status: 500,
          error: 'Invalid JSON response from Strands Agent bridge',
          details: parseErr.message,
          stdout: stdoutData,
          stderr: stderrData.trim(),
        });
      }
    });

    // Write input request to Python stdin
    const inputMessage = JSON.stringify({ action, payload });
    child.stdin.write(inputMessage);
    child.stdin.end();
  });
}

/**
 * Run risk assessment, probability prediction, and sweep on an invoice.
 * @param {object} invoice
 */
async function runSweep(invoice) {
  return callAgentBridge('sweep', { invoice });
}

/**
 * Execute approval decision on a drafted message.
 * @param {object} draft - { subject, body, channel }
 * @param {boolean} approved
 * @param {string|null} editedBody - Optional human-edited body
 * @param {string|null} clientName - Optional client name
 */
async function approveAndExecute(draft, approved, editedBody = null, clientName = null, invoice = null) {
  return callAgentBridge('approve', {
    draft,
    approved,
    edited_body: editedBody,
    client_name: clientName,
    invoice,
  });
}

module.exports = {
  runSweep,
  approveAndExecute,
};
