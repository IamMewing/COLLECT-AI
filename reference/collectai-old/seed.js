// ============================================
// CollectAI — Demo Data Seed Script
// Writes realistic invoices to the REAL Firestore database.
// Run: node seed.js <userId>
// Example: node seed.js Dosskl1l3BWzLVEHWQqGUbu789R2
// ============================================

require('dotenv').config();
const { initializeFirebase, getDb } = require('./src/config/firebase');

const userId = process.argv[2];
if (!userId) {
  console.error('❌ Usage: node seed.js <userId>');
  console.error('   Get your userId from the Firebase Auth console or browser network tab.');
  process.exit(1);
}

const today = new Date();
today.setHours(0, 0, 0, 0);

function daysAgo(n) {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n) {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
}

async function seed() {
  initializeFirebase();
  const db = getDb();
  console.log(`\n🌱 Seeding demo data for userId: ${userId}\n`);

  // ── Create two businesses ─────────────────────────────────────────────────
  console.log('Creating businesses...');

  const biz1Ref = db.collection('workspaces').doc();
  const biz1Id = biz1Ref.id;
  await biz1Ref.set({
    uid: biz1Id,
    userId,
    displayName: 'Dharma Bairy',
    studioName: 'Monarch Studios',
    name: 'Monarch Studios',
    profession: 'Photography',
    businessSize: '1-5',
    country: 'India',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    language: 'English',
    phone: '+91-9876543210',
    reminderTone: 'professional',
    invoicePrefix: 'MON',
    ownerEmail: 'demo@monarchstudios.in',
    recoveryGoal: '₹5,00,000',
    preferredContactMethod: 'email',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`  ✅ Business 1: Monarch Studios (${biz1Id})`);

  const biz2Ref = db.collection('workspaces').doc();
  const biz2Id = biz2Ref.id;
  await biz2Ref.set({
    uid: biz2Id,
    userId,
    displayName: 'Dharma Bairy',
    studioName: 'Lens & Light Creative',
    name: 'Lens & Light Creative',
    profession: 'Videography',
    businessSize: '1-5',
    country: 'India',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    language: 'English',
    phone: '+91-9876543211',
    reminderTone: 'polite',
    invoicePrefix: 'LLC',
    ownerEmail: 'demo@lensandlight.in',
    recoveryGoal: '₹2,00,000',
    preferredContactMethod: 'email',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`  ✅ Business 2: Lens & Light Creative (${biz2Id})`);

  // ── Create invoices ───────────────────────────────────────────────────────
  console.log('\nCreating invoices...');

  const invoices = [
    // 1. Not yet due — new booking
    {
      invoice_id: 'MON-0001',
      business_id: biz1Id,
      userId,
      client_name: 'Priya Sharma',
      client_email: 'priya.sharma@example.com',
      client_contact: '+91-9812345678',
      amount: 45000,
      currency: 'INR',
      due_date: daysFromNow(12),
      description: 'Wedding Photography Package — Full Day',
      status: 'open',
      escalation_level: 0,
      created_at: new Date(),
      last_action_at: null,
      next_check_date: null,
    },
    // 2. Recently overdue — escalation level 1
    {
      invoice_id: 'MON-0002',
      business_id: biz1Id,
      userId,
      client_name: 'Rahul Mehta',
      client_email: 'rahul.mehta@example.com',
      client_contact: '+91-9823456789',
      amount: 22000,
      currency: 'INR',
      due_date: daysAgo(5),
      description: 'Corporate Event Photography — Half Day',
      status: 'open',
      escalation_level: 1,
      created_at: daysAgo(30),
      last_action_at: daysAgo(5),
      next_check_date: today,
    },
    // 3. Significantly overdue — escalation level 2
    {
      invoice_id: 'MON-0003',
      business_id: biz1Id,
      userId,
      client_name: 'Kavya Nair',
      client_email: 'kavya.nair@example.com',
      client_contact: '+91-9834567890',
      amount: 67500,
      currency: 'INR',
      due_date: daysAgo(18),
      description: 'Pre-Wedding Shoot + Album Design',
      status: 'open',
      escalation_level: 2,
      created_at: daysAgo(60),
      last_action_at: daysAgo(10),
      next_check_date: today,
    },
    // 4. Escalated — level 3 (severely overdue)
    {
      invoice_id: 'MON-0004',
      business_id: biz1Id,
      userId,
      client_name: 'Arjun Verma',
      client_email: 'arjun.verma@example.com',
      client_contact: '+91-9845678901',
      amount: 35000,
      currency: 'INR',
      due_date: daysAgo(42),
      description: 'Destination Wedding Photography — 3 Days',
      status: 'escalated',
      escalation_level: 3,
      created_at: daysAgo(90),
      last_action_at: daysAgo(3),
      next_check_date: today,
    },
    // 5. Already paid
    {
      invoice_id: 'MON-0005',
      business_id: biz1Id,
      userId,
      client_name: 'Sneha Patel',
      client_email: 'sneha.patel@example.com',
      client_contact: '+91-9856789012',
      amount: 18000,
      currency: 'INR',
      due_date: daysAgo(30),
      description: 'Portrait Session — Studio 2 Hours',
      status: 'paid',
      escalation_level: 0,
      created_at: daysAgo(45),
      last_action_at: daysAgo(28),
      next_check_date: null,
    },
    // 6. Lens & Light — overdue invoice (different business)
    {
      invoice_id: 'LLC-0001',
      business_id: biz2Id,
      userId,
      client_name: 'Ananya Krishnan',
      client_email: 'ananya.k@example.com',
      client_contact: '+91-9867890123',
      amount: 55000,
      currency: 'INR',
      due_date: daysAgo(9),
      description: 'Brand Video Production — 2 Min Reel',
      status: 'open',
      escalation_level: 1,
      created_at: daysAgo(40),
      last_action_at: daysAgo(7),
      next_check_date: today,
    },
  ];

  let invoiceCount = 0;
  for (const inv of invoices) {
    const ref = await db.collection('invoices').add(inv);
    console.log(`  ✅ ${inv.invoice_id} | ${inv.client_name} | ₹${inv.amount.toLocaleString('en-IN')} | Status: ${inv.status} | Escalation: L${inv.escalation_level} | (${ref.id})`);
    invoiceCount++;
  }

  console.log(`\n✅ Seed complete: 2 businesses, ${invoiceCount} invoices written to real Firestore.`);
  console.log('   Restart the server and open the UI to verify the data appears.\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
