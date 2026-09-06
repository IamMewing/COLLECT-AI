const express = require('express');
const router = express.Router();
const { getDb, COLLECTIONS } = require('../config/firebase');
const { runAgentCycle } = require('../agent/engine');
const { requireAuth } = require('../middleware/auth');
const { createJob, getJob, COLLECTION_STAGES } = require('../agent/services/jobProgress');

// Apply authentication middleware
router.use(requireAuth);

/**
 * GET /api/agent/status — Retrieve live status of the autonomous agent
 */
router.get('/status', (req, res) => {
  const { getAgentStatus } = require('../agent/services/liveStatus');
  res.json({ status: getAgentStatus() });
});

/**
 * POST /api/agent/run — Trigger the agent evaluation cycle scoped by userId.
 * Returns a jobId immediately. Client opens SSE stream to watch progress.
 */
router.post('/run', async (req, res) => {
  try {
    console.log(`\n🚀 Agent run triggered by user ${req.userId}`);

    const businessId = req.body?.business_id || null;

    // Create a job and return its ID immediately so client can open SSE
    const jobId = createJob();
    res.json({ jobId, status: 'queued' });

    // Run the agent cycle asynchronously — do NOT await before responding
    setImmediate(async () => {
      try {
        const result = await runAgentCycle(businessId, req.userId, jobId);
        // result is already handled inside runAgentCycle via emitComplete
      } catch (error) {
        const { emitError } = require('../agent/services/jobProgress');
        emitError(jobId, error.message);
        console.error('Agent run failed:', error);
      }
    });

  } catch (error) {
    console.error('Agent run setup failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/stream/:jobId — SSE endpoint for real-time stage events.
 * The client opens this as an EventSource after receiving a jobId from /run.
 */
router.get('/stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found or expired' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Send a heartbeat comment immediately
  res.write(': connected\n\n');

  // Send current stages snapshot so client can render existing state
  const initEvent = {
    type: 'init',
    jobId,
    stages: job.stages,
    status: job.status,
    timestamp: new Date().toISOString(),
  };
  res.write(`data: ${JSON.stringify(initEvent)}\n\n`);

  // If the job is already done, send final state and close
  if (job.status === 'done' || job.status === 'error') {
    const finalEvent = {
      type: job.status === 'done' ? 'complete' : 'error',
      jobId,
      result: job.result,
      stages: job.stages,
      timestamp: new Date().toISOString(),
    };
    res.write(`data: ${JSON.stringify(finalEvent)}\n\n`);
    res.end();
    return;
  }

  const cleanup = () => {
    clearInterval(keepalive);
    job.emitter.off('stage', onStage);
    job.emitter.off('complete', onComplete);
    job.emitter.off('error', onError);
  };

  // Listen for stage events
  const onStage = (event) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch { cleanup(); }
  };

  const onComplete = (event) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
    } catch { /* client disconnected */ }
    finally { cleanup(); }
  };

  const onError = (event) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
    } catch { /* client disconnected */ }
    finally { cleanup(); }
  };

  job.emitter.on('stage', onStage);
  job.emitter.on('complete', onComplete);
  job.emitter.on('error', onError);

  // Keepalive ping every 15 seconds
  const keepalive = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(keepalive);
      return;
    }
    try {
      res.write(': ping\n\n');
    } catch {
      cleanup();
    }
  }, 15000);

  // Cleanup on client disconnect
  req.on('close', () => {
    cleanup();
  });
});

/**
 * GET /api/agent/actions — Get agent action history scoped by userId
 */
router.get('/actions', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    let query = db.collection(COLLECTIONS.AGENT_ACTIONS).where('userId', '==', req.userId);

    if (req.query.invoice_id) {
      query = query.where('invoice_id', '==', req.query.invoice_id);
    }
    if (req.query.business_id) {
      query = query.where('business_id', '==', req.query.business_id);
    }

    const snapshot = await query.get();
    const actions = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      actions.push({
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp
      });
    });

    // Sort in memory to avoid requiring a Firestore composite index
    actions.sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime();
      const tB = new Date(b.timestamp || 0).getTime();
      return tB - tA;
    });

    const limit = parseInt(req.query.limit) || 50;
    const limitedActions = actions.slice(0, limit);

    res.json(limitedActions);
  } catch (error) {
    console.error('Error listing actions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/actions/:id — Get a single agent action scoped by userId
 */
router.get('/actions/:id', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const doc = await db.collection(COLLECTIONS.AGENT_ACTIONS).doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const data = doc.data();
    if (data.userId !== req.userId) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized action log access' });
    }

    res.json({
      ...data,
      timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp
    });
  } catch (error) {
    console.error('Error getting action:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/copilot — Agent Runtime: multi-turn AI employee with tool calling
 */
router.post('/copilot', async (req, res) => {
  try {
    const { query, business_id, conversation_id } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const { processAgentMessage } = require('../agent/copilot/copilotEngine');
    const result = await processAgentMessage(
      query,
      req.userId,
      business_id || null,
      conversation_id || null
    );

    res.json(result);
  } catch (error) {
    console.error('Agent Runtime error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
