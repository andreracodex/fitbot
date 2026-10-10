import express from 'express';
import {
  getAllLeads,
  getLeadConversations,
  updateLeadStatus,
  getLeadStats
} from '../data/database.js';

const router = express.Router();

/**
 * GET /api/leads
 * Mengambil ringkasan statistik dan seluruh daftar lead
 */
router.get('/', async (req, res) => {
  try {
    const stats = await getLeadStats();
    const leads = await getAllLeads();
    res.json({ stats, leads });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data leads: ' + err.message });
  }
});

/**
 * GET /api/leads/:sessionId
 * Mengambil detail lead beserta riwayat transkrip percakapannya
 */
router.get('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const conversations = await getLeadConversations(sessionId);
    res.json({ sessionId, conversations });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil transkrip percakapan: ' + err.message });
  }
});

/**
 * PATCH /api/leads/:sessionId
 * Memperbarui status lead (NEW | CONTACTED | FOLLOW_UP | CONVERTED)
 * Body: { status: string }
 */
router.patch('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Bidang status harus diisi.' });
  }

  try {
    await updateLeadStatus(sessionId, status.toUpperCase());
    res.json({ success: true, sessionId, status: status.toUpperCase() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
