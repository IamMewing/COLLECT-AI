// ============================================
// CollectAI — Express Server Entry Point
// ============================================

require('dotenv').config();

// ── Process-level safety net ────────────────────────────────────────────────
// These handlers log unexpected errors and keep the server alive.
// They are a SAFETY NET — root-cause bugs must still be fixed at the source.
process.on('uncaughtException', (err) => {
  console.error('🔴 [FATAL] Uncaught Exception — server continuing:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 [FATAL] Unhandled Promise Rejection — server continuing:');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
});

const { initializeFirebase } = require('./src/config/firebase');

try {
  initializeFirebase();
} catch (err) {
  console.error('❌ Failed to initialize Firebase on server startup:', err.message);
}

const express = require('express');
const cors = require('cors');
const path = require('path');

// Route imports
const businessesRouter = require('./src/routes/businesses');
const invoicesRouter = require('./src/routes/invoices');
const agentRouter = require('./src/routes/agent');
const paymentsRouter = require('./src/routes/payments');
const statsRouter = require('./src/routes/stats');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static files (dashboard) ───────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ─────────────────────────────────────
app.use('/api/businesses', businessesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/agent', agentRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/stats', statsRouter);

// ── Health check ───────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CollectAI',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ── SPA fallback (serve index.html for non-API routes) ──
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// ── Error handler ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ── Start server ───────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🤖 CollectAI server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
