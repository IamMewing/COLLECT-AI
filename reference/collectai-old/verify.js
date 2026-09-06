require('dotenv').config();
const { initializeFirebase, getDb } = require('./src/config/firebase');

async function verify() {
  initializeFirebase();
  const db = getDb();

  // Check invoices for seed user
  const userId = 'Dosskl1l3BWzLVEHWQqGUbu789R2';
  
  console.log('\n=== FIRESTORE DATA VERIFICATION ===\n');
  
  // Check businesses
  const bizSnap = await db.collection('workspaces').where('userId', '==', userId).get();
  console.log(`Businesses: ${bizSnap.size}`);
  bizSnap.forEach(d => {
    const v = d.data();
    console.log(`  - ${v.name || v.studioName} (${d.id})`);
  });

  // Check invoices
  const invSnap = await db.collection('invoices').where('userId', '==', userId).get();
  console.log(`\nInvoices: ${invSnap.size}`);
  invSnap.forEach(d => {
    const v = d.data();
    const due = v.due_date?.toDate ? v.due_date.toDate().toISOString().split('T')[0] : String(v.due_date);
    console.log(`  - ${v.invoice_id} | ${v.client_name} | ₹${v.amount.toLocaleString('en-IN')} | ${v.status} | L${v.escalation_level} | due: ${due}`);
  });

  console.log('\n=== GEMINI CONFIG ===');
  const { GEMINI_MODEL } = require('./src/config/gemini');
  console.log(`  GEMINI_MODEL: ${GEMINI_MODEL}`);
  
  console.log('\n=== SSE GUARD CHECK ===');
  const { createJob, getJob, emitComplete, emitStage } = require('./src/agent/services/jobProgress');
  const jobId = createJob();
  const job = getJob(jobId);
  emitStage(jobId, 'init', 'executing');
  emitComplete(jobId, { test: true });
  emitComplete(jobId, { test: 'SHOULD BE BLOCKED' }); // must be ignored
  emitStage(jobId, 'fetch', 'done'); // must be ignored
  console.log(`  _terminated guard: ${job._terminated === true ? '✅ working' : '❌ NOT working'}`);
  console.log(`  No listener crash after terminal: ✅`);

  console.log('\n=== .FIREBASERC ===');
  const fs = require('fs');
  const rc = JSON.parse(fs.readFileSync('.firebaserc', 'utf8'));
  console.log(`  default project: ${rc.projects.default}`);
  const correct = rc.projects.default === 'my-project-939a2';
  console.log(`  Correct project ID: ${correct ? '✅' : '❌'}`);

  console.log('\n=== STRAY CLIENT/CLIENT/.ENV ===');
  const strayExists = fs.existsSync('client/client/.env');
  console.log(`  client/client/.env exists: ${strayExists ? '❌ still there!' : '✅ deleted'}`);

  console.log('\n=== ALL CHECKS COMPLETE ===\n');
  process.exit(0);
}

verify().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
