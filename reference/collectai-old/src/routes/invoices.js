const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb, COLLECTIONS } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');

// Apply authentication middleware
router.use(requireAuth);

/**
 * POST /api/invoices — Create a new invoice scoped by userId
 */
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const { business_id, client_name, client_email, client_contact, amount, currency, due_date, description } = req.body;

    if (!business_id || !client_name || !amount || !due_date) {
      return res.status(400).json({
        error: 'business_id, client_name, amount, and due_date are required'
      });
    }

    // Verify business exists and belongs to the active user
    const bizDoc = await db.collection(COLLECTIONS.BUSINESSES).doc(business_id).get();
    if (!bizDoc.exists) {
      return res.status(404).json({ error: 'Business not found' });
    }
    const businessData = bizDoc.data();
    if (businessData.userId !== req.userId) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized business selected' });
    }

    // Generate a human-readable invoice ID
    const invoiceCount = (await db.collection(COLLECTIONS.INVOICES)
      .where('business_id', '==', business_id)
      .where('userId', '==', req.userId)
      .count().get()).data().count;
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, '0')}`;

    const invoice = {
      invoice_id: invoiceNumber,
      business_id,
      userId: req.userId,
      client_name,
      client_email: client_email || '',
      client_contact: client_contact || '',
      amount: parseFloat(amount),
      currency: currency || 'INR',
      due_date: new Date(due_date),
      description: description || '',
      status: 'open', // open | paid | escalated | closed
      escalation_level: 0,
      created_at: new Date(),
      last_action_at: null,
      next_check_date: null
    };

    const docRef = await db.collection(COLLECTIONS.INVOICES).add(invoice);
    invoice.id = docRef.id;

    console.log(`📄 Invoice created for user ${req.userId}: ${invoice.invoice_id} — ₹${invoice.amount}`);
    res.status(201).json(invoice);
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices — List invoices scoped by userId
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    let query = db.collection(COLLECTIONS.INVOICES).where('userId', '==', req.userId);

    if (req.query.business_id) {
      query = query.where('business_id', '==', req.query.business_id);
    }
    if (req.query.status) {
      query = query.where('status', '==', req.query.status);
    }

    const snapshot = await query.get();
    const invoices = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      invoices.push({
        id: doc.id,
        ...data,
        due_date: data.due_date?.toDate ? data.due_date.toDate().toISOString() : data.due_date,
        created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at,
        last_action_at: data.last_action_at?.toDate ? data.last_action_at.toDate().toISOString() : data.last_action_at,
        next_check_date: data.next_check_date?.toDate ? data.next_check_date.toDate().toISOString() : data.next_check_date
      });
    });

    // Sort in memory to avoid requiring a Firestore composite index
    invoices.sort((a, b) => {
      const tA = new Date(a.created_at || 0).getTime();
      const tB = new Date(b.created_at || 0).getTime();
      return tB - tA;
    });

    res.json(invoices);
  } catch (error) {
    console.error('Error listing invoices:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices/:id — Get a single invoice scoped by userId
 */
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const doc = await db.collection(COLLECTIONS.INVOICES).doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const data = doc.data();
    if (data.userId !== req.userId) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized invoice access' });
    }

    // Get action history scoped by userId
    const actionsSnapshot = await db.collection(COLLECTIONS.AGENT_ACTIONS)
      .where('invoice_id', 'in', [data.invoice_id, req.params.id])
      .where('userId', '==', req.userId)
      .get();

    const actions = [];
    actionsSnapshot.forEach(actionDoc => {
      const actionData = actionDoc.data();
      actions.push({
        ...actionData,
        timestamp: actionData.timestamp?.toDate ? actionData.timestamp.toDate().toISOString() : actionData.timestamp
      });
    });

    // Sort in memory to avoid requiring a Firestore composite index
    actions.sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime();
      const tB = new Date(b.timestamp || 0).getTime();
      return tB - tA;
    });

    res.json({
      id: doc.id,
      ...data,
      due_date: data.due_date?.toDate ? data.due_date.toDate().toISOString() : data.due_date,
      created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at,
      last_action_at: data.last_action_at?.toDate ? data.last_action_at.toDate().toISOString() : data.last_action_at,
      next_check_date: data.next_check_date?.toDate ? data.next_check_date.toDate().toISOString() : data.next_check_date,
      actions
    });
  } catch (error) {
    console.error('Error getting invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/invoices/:id — Update an invoice scoped by userId
 */
router.patch('/:id', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const docRef = db.collection(COLLECTIONS.INVOICES).doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const data = doc.data();
    if (data.userId !== req.userId) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized invoice update' });
    }

    const allowedFields = ['client_name', 'client_email', 'client_contact', 'amount', 'currency', 'due_date', 'status', 'description'];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'due_date') {
          updates[field] = new Date(req.body[field]);
        } else if (field === 'amount') {
          updates[field] = parseFloat(req.body[field]);
        } else {
          updates[field] = req.body[field];
        }
      }
    }

    updates.updated_at = new Date();

    await docRef.update(updates);

    const updated = await docRef.get();
    const updatedData = updated.data();

    res.json({
      id: updated.id,
      ...updatedData,
      due_date: updatedData.due_date?.toDate ? updatedData.due_date.toDate().toISOString() : updatedData.due_date,
      created_at: updatedData.created_at?.toDate ? updatedData.created_at.toDate().toISOString() : updatedData.created_at
    });
  } catch (error) {
    console.error('Error updating invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
