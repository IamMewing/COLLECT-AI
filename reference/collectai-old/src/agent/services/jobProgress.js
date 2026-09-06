// ============================================
// CollectAI — SSE Job Progress Store
// Manages real-time stage events for "Watch AI Work"
// ============================================

const { EventEmitter } = require('events');

// In-memory job store — maps jobId → { emitter, stages, status, createdAt }
const jobStore = new Map();

// Stage definitions — these are the real backend stages
const COLLECTION_STAGES = [
  { id: 'init',          label: 'Starting Collection Cycle',       icon: '⚡' },
  { id: 'fetch',         label: 'Fetching Overdue Invoices',       icon: '📋' },
  { id: 'client',        label: 'Loading Client Profiles',         icon: '👤' },
  { id: 'history',       label: 'Reading Payment History',         icon: '📖' },
  { id: 'risk',          label: 'Calculating Risk Scores',         icon: '📊' },
  { id: 'evaluate',      label: 'Evaluating Collection Strategy',  icon: '🎯' },
  { id: 'gemini',        label: 'Calling Gemini AI',               icon: '🧠' },
  { id: 'draft',         label: 'Generating Reminder Messages',    icon: '✍️'  },
  { id: 'save',          label: 'Saving AI Reasoning',             icon: '💾' },
  { id: 'update',        label: 'Updating Firestore',              icon: '🔄' },
  { id: 'complete',      label: 'Collection Cycle Complete',       icon: '✅' },
];

/**
 * Create a new job and return its ID.
 */
function createJob() {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(5);

  jobStore.set(jobId, {
    emitter,
    stages: COLLECTION_STAGES.map(s => ({ ...s, status: 'pending', startedAt: null, completedAt: null })),
    currentStageIndex: -1,
    status: 'queued', // queued | running | done | error
    result: null,
    createdAt: Date.now(),
    _terminated: false, // guard: prevents double terminal-event emission
  });

  // Auto-cleanup after 10 minutes
  setTimeout(() => {
    const job = jobStore.get(jobId);
    if (job) {
      job.emitter.removeAllListeners();
      jobStore.delete(jobId);
    }
  }, 10 * 60 * 1000);

  return jobId;
}

/**
 * Get a job by ID.
 */
function getJob(jobId) {
  return jobStore.get(jobId) || null;
}

/**
 * Emit a stage transition event. Updates job state and notifies SSE clients.
 * @param {string} jobId
 * @param {string} stageId - One of COLLECTION_STAGES[].id
 * @param {'executing'|'done'|'error'} status
 * @param {object} [data] - Optional extra payload
 */
function emitStage(jobId, stageId, status, data = {}) {
  const job = jobStore.get(jobId);
  if (!job) return;
  // Do not emit stage events after a terminal event has already fired
  if (job._terminated) return;

  const stageIndex = job.stages.findIndex(s => s.id === stageId);
  if (stageIndex === -1) return;

  const stage = job.stages[stageIndex];
  stage.status = status;

  if (status === 'executing') {
    stage.startedAt = Date.now();
    job.currentStageIndex = stageIndex;
    job.status = 'running';
  } else if (status === 'done' || status === 'error') {
    stage.completedAt = Date.now();
  }

  const event = {
    type: 'stage',
    jobId,
    stage: {
      id: stageId,
      label: stage.label,
      icon: stage.icon,
      status,
      stageIndex,
      totalStages: job.stages.length,
    },
    timestamp: new Date().toISOString(),
    ...data,
  };

  job.emitter.emit('stage', event);
}

/**
 * Emit the final completion event with results.
 * Guaranteed to fire at most once per job.
 */
function emitComplete(jobId, result) {
  const job = jobStore.get(jobId);
  if (!job) return;
  // Idempotency guard — never emit a terminal event twice
  if (job._terminated) return;
  job._terminated = true;

  job.status = 'done';
  job.result = result;

  // Mark the last stage done
  const lastStage = job.stages[job.stages.length - 1];
  lastStage.status = 'done';
  lastStage.completedAt = Date.now();

  const event = {
    type: 'complete',
    jobId,
    result,
    stages: job.stages,
    timestamp: new Date().toISOString(),
  };

  // Emit 'complete' ONCE — no secondary 'stage' emit.
  // The complete event already carries the full stages array so the client has all state.
  job.emitter.emit('complete', event);

  // Tear down all listeners immediately after the terminal event fires.
  // This prevents any subsequent emitStage calls (which already check _terminated)
  // from reaching a handler whose res has already been ended.
  job.emitter.removeAllListeners();
}

/**
 * Emit an error event.
 * Guaranteed to fire at most once per job.
 */
function emitError(jobId, errorMessage) {
  const job = jobStore.get(jobId);
  if (!job) return;
  // Idempotency guard — never emit a terminal event twice
  if (job._terminated) return;
  job._terminated = true;

  job.status = 'error';

  const event = {
    type: 'error',
    jobId,
    error: errorMessage,
    stages: job.stages,
    timestamp: new Date().toISOString(),
  };

  job.emitter.emit('error', event);

  // Tear down all listeners immediately after the terminal event fires.
  job.emitter.removeAllListeners();
}

module.exports = {
  COLLECTION_STAGES,
  createJob,
  getJob,
  emitStage,
  emitComplete,
  emitError,
};
