import express from 'express';
import {
  getAllLeads,
  getLeadConversations,
  updateLeadStatus,
  updateLeadName,
  updateLeadNotes,
  recordMessage,
  getLeadStats
} from '../data/database.js';
import { requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/leads
 * Mengambil ringkasan statistik dan seluruh daftar lead (Khusus Super Admin)
 */
router.get('/', requireSuperAdmin, async (req, res) => {
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
 * Mengambil detail lead beserta riwayat transkrip percakapannya (Khusus Super Admin)
 */
router.get('/:sessionId', requireSuperAdmin, async (req, res) => {
  const { sessionId } = req.params;
  try {
    const conversations = await getLeadConversations(sessionId);
    const allLeads = await getAllLeads();
    const lead = allLeads.find(l => l.session_id === sessionId) || null;
    res.json({ sessionId, lead, conversations });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil transkrip percakapan: ' + err.message });
  }
});

/**
 * PATCH /api/leads/:sessionId
 * Memperbarui status lead atau nama lead (Khusus Super Admin)
 * Body: { status?: string, name?: string }
 */
router.patch('/:sessionId', requireSuperAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const { status, name } = req.body;

  if (!status && !name) {
    return res.status(400).json({ error: 'Bidang status atau name harus diisi.' });
  }

  try {
    if (status) {
      await updateLeadStatus(sessionId, status);
    }
    if (name) {
      await updateLeadName(sessionId, name);
    }
    res.json({ success: true, sessionId, status, name });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/leads/:sessionId/name
 * Memperbarui nama lead (Khusus Super Admin)
 * Body: { name: string }
 */
router.put('/:sessionId/name', requireSuperAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nama pelanggan tidak boleh kosong.' });
  }

  try {
    await updateLeadName(sessionId, name.trim());
    res.json({ success: true, sessionId, name: name.trim() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/leads/:sessionId/message
 * Mengirim pesan balasan (Human Agent / Fifi) ke sesi customer (Khusus Super Admin)
 */
router.post('/:sessionId/message', requireSuperAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const { message, sender = 'agent' } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
  }

  try {
    await recordMessage({
      sessionId,
      channel: 'admin',
      sender,
      message: message.trim()
    });
    res.json({ success: true, sessionId, message: message.trim(), sender });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/leads/:sessionId/notes
 * Memperbarui catatan internal CRM untuk lead (Khusus Super Admin)
 */
router.put('/:sessionId/notes', requireSuperAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const { notes } = req.body;

  try {
    await updateLeadNotes(sessionId, notes || '');
    res.json({ success: true, sessionId, notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
