// ============================================
// CollectAI — Businesses API Routes
// ============================================

const express = require('express');
const router = express.Router();
const { getDb, COLLECTIONS } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');

// Apply authentication middleware to all endpoints
router.use(requireAuth);

/**
 * POST /api/businesses — Create or update business profile for user
 */
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const { name, owner_email, owner_contact, preferred_channel, tone_preference, timezone } = req.body;

    if (!name || !owner_email) {
      return res.status(400).json({ error: 'name and owner_email are required' });
    }

    const business = {
      business_id: req.userId, // Primary identifier is userId
      userId: req.userId,
      name,
      owner_email,
      owner_contact: owner_contact || '',
      preferred_channel: preferred_channel || 'email',
      tone_preference: tone_preference || 'polite', // polite | neutral | firm
      timezone: timezone || 'Asia/Kolkata',
      updated_at: new Date()
    };

    // Upsert the single user workspace
    await db.collection(COLLECTIONS.BUSINESSES).doc(req.userId).set(business, { merge: true });

    console.log(`📊 Business workspace configured for user ${req.userId}: ${business.name}`);
    res.status(200).json(business);
  } catch (error) {
    console.error('Error configuring business:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/businesses — Get the single business scoped by userId (one source of truth)
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const doc = await db.collection(COLLECTIONS.BUSINESSES).doc(req.userId).get();

    if (!doc.exists) {
      // Return empty list so client knows no workspace exists yet
      return res.json([]);
    }

    res.json([doc.data()]);
  } catch (error) {
    console.error('Error listing businesses:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/businesses/:id — Get business profile (validates authorization)
 */
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    // Enforce req.userId check
    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized business access' });
    }

    const doc = await db.collection(COLLECTIONS.BUSINESSES).doc(req.userId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json(doc.data());
  } catch (error) {
    console.error('Error getting business:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/businesses/:id — Update the existing business profile scoped by userId
 */
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized business edit' });
    }

    const docRef = db.collection(COLLECTIONS.BUSINESSES).doc(req.userId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const { name, owner_email, owner_contact, preferred_channel, tone_preference, timezone } = req.body;
    const updates = {};

    if (name) updates.name = name;
    if (owner_email) updates.owner_email = owner_email;
    if (owner_contact !== undefined) updates.owner_contact = owner_contact;
    if (preferred_channel) updates.preferred_channel = preferred_channel;
    if (tone_preference) updates.tone_preference = tone_preference;
    if (timezone) updates.timezone = timezone;

    updates.updated_at = new Date();

    await docRef.update(updates);

    const updated = await docRef.get();
    res.json(updated.data());
  } catch (error) {
    console.error('Error updating business:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
