import express from 'express';
import { requireSuperAdmin } from '../middleware/auth.js';
import {
  getAllWhatsAppSessions,
  getWhatsAppSession,
  startWhatsAppSession,
  stopWhatsAppSession,
  deleteWhatsAppSession
} from '../channels/whatsapp.js';

const router = express.Router();

/**
 * GET /api/whatsapp/sessions
 * Mengambil daftar seluruh sesi WhatsApp aktif & tersimpan
 */
router.get('/sessions', requireSuperAdmin, (req, res) => {
  try {
    const sessions = getAllWhatsAppSessions();
    res.json({
      success: true,
      sessions,
      total: sessions.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal memuat sesi WhatsApp: ' + err.message });
  }
});

/**
 * POST /api/whatsapp/sessions
 * Mendaftarkan dan memulai sesi WhatsApp baru (menghasilkan QR code baru)
 * Body: { sessionId, name, description }
 */
router.post('/sessions', requireSuperAdmin, async (req, res) => {
  try {
    const { sessionId, name, description } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Parameter "sessionId" wajib diisi (contoh: cabang_senopati, cs_2).'
      });
    }

    const cleanId = sessionId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!cleanId) {
      return res.status(400).json({
        success: false,
        error: 'ID Sesi hanya boleh memuat huruf kecil, angka, garis bawah (_), atau strip (-).'
      });
    }

    const sessionName = (name && typeof name === 'string' && name.trim()) ? name.trim() : `Sesi WA ${cleanId}`;
    const sessionDesc = (description && typeof description === 'string') ? description.trim() : '';

    // Mulai inisialisasi sesi Baileys secara asynchronous
    const session = await startWhatsAppSession(cleanId, sessionName, sessionDesc);

    res.status(201).json({
      success: true,
      message: `Sesi WhatsApp [${cleanId}] berhasil diinisialisasi. Silakan scan QR code.`,
      session: getWhatsAppSession(cleanId)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal membuat sesi WhatsApp: ' + err.message });
  }
});

/**
 * GET /api/whatsapp/sessions/:sessionId
 * Mengambil status realtime dan gambar QR Code dari sesi tertentu
 */
router.get('/sessions/:sessionId', requireSuperAdmin, (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = getWhatsAppSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: `Sesi WhatsApp "${sessionId}" tidak ditemukan.`
      });
    }

    res.json({
      success: true,
      session
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal mengambil detail sesi: ' + err.message });
  }
});

/**
 * POST /api/whatsapp/sessions/:sessionId/reconnect
 * Menghubungkan ulang sesi yang terputus atau meminta QR baru
 */
router.post('/sessions/:sessionId/reconnect', requireSuperAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionMeta = getWhatsAppSession(sessionId);

    if (!sessionMeta) {
      return res.status(404).json({
        success: false,
        error: `Sesi WhatsApp "${sessionId}" tidak ditemukan.`
      });
    }

    await startWhatsAppSession(sessionId, sessionMeta.name, sessionMeta.description);

    res.json({
      success: true,
      message: `Memulai ulang sesi [${sessionId}]...`,
      session: getWhatsAppSession(sessionId)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal menghubungkan ulang: ' + err.message });
  }
});

/**
 * POST /api/whatsapp/sessions/:sessionId/stop
 * Menghentikan sesi aktif
 */
router.post('/sessions/:sessionId/stop', requireSuperAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    await stopWhatsAppSession(sessionId);

    res.json({
      success: true,
      message: `Sesi [${sessionId}] berhasil dihentikan.`,
      session: getWhatsAppSession(sessionId)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal menghentikan sesi: ' + err.message });
  }
});

/**
 * DELETE /api/whatsapp/sessions/:sessionId
 * Menghapus sesi dan kredensial login
 */
router.delete('/sessions/:sessionId', requireSuperAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    await deleteWhatsAppSession(sessionId);

    res.json({
      success: true,
      message: `Sesi [${sessionId}] berhasil dihapus.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal menghapus sesi: ' + err.message });
  }
});

export default router;
