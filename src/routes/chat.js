import express from 'express';
import { getGymSummary } from '../data/gym-data.js';
import {
  sendMessage,
  resetSession,
  isApiKeyConfigured,
  getActiveSessionCount
} from '../services/gemini.js';

const router = express.Router();

/**
 * GET /api/health
 * Memeriksa kesehatan server dan status kesiapan API key.
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'FitBot AI Backend',
    apiKeyConfigured: isApiKeyConfigured(),
    activeSessions: getActiveSessionCount(),
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/info
 * Mengembalikan ringkasan data operasional gym.
 */
router.get('/info', (req, res) => {
  try {
    const summary = getGymSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data informasi gym.' });
  }
});

/**
 * POST /api/chat
 * Mengirim pesan ke chatbot dan menerima respon.
 * Body: { sessionId: string, message: string }
 */
router.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  // Validasi format body
  if (typeof message !== 'string') {
    return res.status(400).json({
      error: 'Format permintaan tidak valid. Bidang "message" harus berupa string.'
    });
  }

  const trimmedMessage = message.trim();

  // Validasi: Pesan kosong (TC-05)
  if (trimmedMessage.length === 0) {
    return res.status(400).json({
      error: 'Pesan tidak boleh kosong atau hanya berisi spasi.'
    });
  }

  // Validasi: Batas panjang karakter maksimum 2.000 karakter (TC-06)
  if (trimmedMessage.length > 2000) {
    return res.status(400).json({
      error: 'Pesan terlalu panjang. Maksimum 2.000 karakter per pesan.'
    });
  }

  // Gunakan sessionId yang dikirimkan atau buat default fallback
  const validSessionId = (typeof sessionId === 'string' && sessionId.trim().length > 0)
    ? sessionId.trim()
    : 'default-session';

  try {
    const reply = await sendMessage(validSessionId, trimmedMessage);
    res.json({
      reply,
      sessionId: validSessionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Chat Route Error]:', error.message || error);
    res.status(500).json({
      reply: 'Terjadi kesalahan internal pada server chatbot. Silakan coba kembali sesaat lagi.',
      error: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * POST /api/chat/reset
 * Menghapus memori riwayat chat untuk sesi tertentu (TC-10).
 * Body: { sessionId: string }
 */
router.post('/chat/reset', (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'Parameter "sessionId" diperlukan.' });
  }

  const cleared = resetSession(sessionId.trim());
  res.json({
    success: true,
    message: cleared
      ? 'Riwayat sesi berhasil dibersihkan.'
      : 'Sesi baru telah disiapkan.',
    sessionId: sessionId.trim()
  });
});

export default router;
