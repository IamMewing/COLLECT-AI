const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb, COLLECTIONS } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');

// Apply authentication middleware
router.use(requireAuth);

/**
 * POST /api/payments — Mark an invoice as paid
 */
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const { invoice_id, amount_recorded, marked_by } = req.body;

    if (!invoice_id) {
      return res.status(400).json({ error: 'invoice_id is required' });
    }

    let invoiceDoc;
    let invoiceDocId;

    // Try doc ID first
    const directDoc = await db.collection(COLLECTIONS.INVOICES).doc(invoice_id).get();
    if (directDoc.exists) {
      invoiceDoc = directDoc;
      invoiceDocId = invoice_id;
    } else {
      // Search by invoice_id field
      const snapshot = await db.collection(COLLECTIONS.INVOICES)
        .where('invoice_id', '==', invoice_id)
        .where('userId', '==', req.userId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      snapshot.forEach(doc => {
        invoiceDoc = doc;
        invoiceDocId = doc.id;
      });
    }

    const invoiceData = invoiceDoc.data();
    if (invoiceData.userId !== req.userId) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized invoice target' });
    }

    // Create payment record
    const payment = {
      payment_id: uuidv4(),
      userId: req.userId,
      invoice_id: invoiceData.invoice_id || invoice_id,
      invoice_doc_id: invoiceDocId,
      business_id: invoiceData.business_id,
      amount_recorded: parseFloat(amount_recorded) || invoiceData.amount,
      marked_paid_at: new Date(),
      marked_by: marked_by || 'owner'
    };

    await db.collection(COLLECTIONS.PAYMENTS).doc(payment.payment_id).set(payment);

    // Update invoice status to 'paid'
    await db.collection(COLLECTIONS.INVOICES).doc(invoiceDocId).update({
      status: 'paid',
      paid_at: new Date(),
      updated_at: new Date()
    });

    console.log(`💰 Payment recorded for user ${req.userId}: ${invoiceData.invoice_id} — ₹${payment.amount_recorded}`);
    res.status(201).json(payment);
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/payments — List payments scoped by userId
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    let query = db.collection(COLLECTIONS.PAYMENTS).where('userId', '==', req.userId);

    if (req.query.invoice_id) {
      query = query.where('invoice_id', '==', req.query.invoice_id);
    }
    if (req.query.business_id) {
      query = query.where('business_id', '==', req.query.business_id);
    }

    const snapshot = await query.get();
    const payments = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      payments.push({
        ...data,
        marked_paid_at: data.marked_paid_at?.toDate ? data.marked_paid_at.toDate().toISOString() : data.marked_paid_at
      });
    });

    // Sort in memory to avoid requiring a Firestore composite index
    payments.sort((a, b) => {
      const tA = new Date(a.marked_paid_at || 0).getTime();
      const tB = new Date(b.marked_paid_at || 0).getTime();
      return tB - tA;
    });

    res.json(payments);
  } catch (error) {
    console.error('Error listing payments:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/payments/:id — Undo a payment scoped by userId
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const docRef = db.collection(COLLECTIONS.PAYMENTS).doc(req.params.id);
    const paymentDoc = await docRef.get();
    if (!paymentDoc.exists) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const paymentData = paymentDoc.data();
    if (paymentData.userId !== req.userId) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized payment action' });
    }

    // Reopen the invoice
    if (paymentData.invoice_doc_id) {
      const invoiceRef = db.collection(COLLECTIONS.INVOICES).doc(paymentData.invoice_doc_id);
      const invoiceDoc = await invoiceRef.get();
      if (invoiceDoc.exists && invoiceDoc.data().userId === req.userId) {
        await invoiceRef.update({
          status: 'open',
          paid_at: null,
          updated_at: new Date()
        });
      }
    }

    // Delete the payment record
    await docRef.delete();

    console.log(`↩️  Payment undone by user ${req.userId}: ${paymentData.invoice_id}`);
    res.json({ message: 'Payment undone, invoice reopened' });
  } catch (error) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
