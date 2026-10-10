import express from 'express';
import { sendMessage } from '../services/gemini.js';

const router = express.Router();

/**
 * =========================================================================
 * 1. TIKTOK DIRECT WEBHOOK ENDPOINT
 * =========================================================================
 * Dokumentasi: TikTok for Developers / TikTok Shop Messaging API
 */

// Verifikasi Handshake Webhook TikTok (challenge parameter)
router.get('/tiktok', (req, res) => {
  const challenge = req.query.challenge || req.query['hub.challenge'];
  if (challenge) {
    return res.status(200).send(challenge);
  }
  return res.json({ status: 'active', channel: 'tiktok', timestamp: new Date().toISOString() });
});

// Penerima Pesan Masuk Direct Message TikTok
router.post('/tiktok', async (req, res) => {
  try {
    const payload = req.body || {};

    // Standard format TikTok webhook event
    // Event type: im_chat_message / message_receive
    const event = payload.event || payload.type || 'message';
    const messageData = payload.data || payload.entry?.[0]?.messaging?.[0] || payload;

    const senderId = messageData.sender_id || messageData.from_user_id || messageData.user_id || payload.sender_id;
    const text = messageData.content || messageData.text || messageData.message?.text || payload.message;
    const senderName = messageData.sender_nickname || messageData.user_name || payload.user_name || 'TikTok User';

    if (!text || !senderId) {
      // Return 200 agar TikTok tidak melakukan retry berulang
      return res.status(200).json({ status: 'ignored', reason: 'Payload tidak memuat teks pesan atau ID pengirim' });
    }

    const sessionId = `tiktok_${senderId}`;

    // Jalankan asisten Fifi & catat otomatis ke database leads MySQL
    const fifiReply = await sendMessage(sessionId, text, {
      channel: 'tiktok',
      userName: senderName,
      userContact: `@${senderId}`
    });

    // TODO: Jika terhubung ke TikTok Shop Open API, kirim pesan balasan via HTTP POST:
    // await sendTiktokReply(senderId, fifiReply);

    return res.status(200).json({
      status: 'success',
      reply: fifiReply,
      channel: 'tiktok',
      sessionId
    });
  } catch (err) {
    console.error('[TikTok Webhook Error]:', err.message);
    return res.status(200).json({ status: 'error', message: err.message });
  }
});

/**
 * =========================================================================
 * 2. INSTAGRAM / META DIRECT WEBHOOK ENDPOINT
 * =========================================================================
 * Dokumentasi: Meta Graph API (Instagram Messaging Webhook)
 */
router.get('/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.META_VERIFY_TOKEN || 'fitbot_meta_verify_token';

  if (mode === 'subscribe' && token === expectedToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: 'Verifikasi token Meta/Instagram tidak cocok.' });
});

router.post('/instagram', async (req, res) => {
  try {
    const body = req.body;
    if (body.object === 'instagram' || body.object === 'page') {
      const entry = body.entry?.[0];
      const messaging = entry?.messaging?.[0];

      if (messaging && messaging.message && messaging.message.text) {
        const senderId = messaging.sender.id;
        const text = messaging.message.text;
        const sessionId = `ig_${senderId}`;

        const fifiReply = await sendMessage(sessionId, text, {
          channel: 'instagram',
          userName: `IG User ${senderId.slice(-4)}`,
          userContact: `ID: ${senderId}`
        });

        return res.status(200).json({ status: 'success', reply: fifiReply });
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('[Instagram Webhook Error]:', err.message);
    return res.status(200).send('EVENT_RECEIVED');
  }
});

/**
 * =========================================================================
 * 3. UNIVERSAL OMNICHANNEL GATEWAY (Untuk Aggregator / BSP / n8n / ManyChat / Mekari Qontak)
 * =========================================================================
 * Siapapun platform omnichannel aggregator-nya, cukup tembak endpoint ini:
 * POST /api/webhooks/omnichannel
 * Body: { channel: 'tiktok'|'instagram'|'whatsapp'|'line'|'telegram', sessionId, message, userName, userContact }
 */
router.post('/omnichannel', async (req, res) => {
  try {
    const {
      channel = 'omnichannel',
      sessionId,
      message,
      userName = null,
      userContact = null
    } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Field "message" wajib diisi.' });
    }

    const activeSessionId = sessionId || `${channel}_${Date.now()}`;

    // Hubungkan dengan kecerdasan Fifi & simpan ke Leads CRM MySQL
    const fifiReply = await sendMessage(activeSessionId, message.trim(), {
      channel: channel.toLowerCase(),
      userName,
      userContact
    });

    return res.json({
      success: true,
      channel,
      sessionId: activeSessionId,
      reply: fifiReply,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Omnichannel Gateway Error]:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Gagal memproses pesan omnichannel.'
    });
  }
});

export default router;
