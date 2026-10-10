import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { sendMessage } from '../services/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let sockInstance = null;

/**
 * Menjalankan bot WhatsApp via Baileys jika diaktifkan di .env
 */
export async function startWhatsAppBot() {
  const isEnabled = process.env.ENABLE_WHATSAPP === 'true';

  if (!isEnabled) {
    console.log('ℹ️  WhatsApp Bot: Dinonaktifkan (ENABLE_WHATSAPP=false)');
    return null;
  }

  const authDir = path.resolve(__dirname, '../../data/auth_info_baileys');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }) // Supaya console bersih
    });

    sockInstance = sock;

    // Menyimpan kredensial saat diperbarui
    sock.ev.on('creds.update', saveCreds);

    // Event pembaruan koneksi (QR Code & Status)
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n======================================================');
        console.log('📱 SCAN QR CODE BERIKUT DENGAN WHATSAPP DI HP ANDA:');
        console.log('   (Buka WA > Titik Tiga / Pengaturan > Perangkat Tertaut)');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('⚠️  Koneksi WhatsApp terputus, mencoba menghubungkan ulang:', shouldReconnect);
        if (shouldReconnect) {
          startWhatsAppBot();
        }
      } else if (connection === 'open') {
        console.log('======================================================');
        console.log('✅ WhatsApp Bot Fifi Berhasil Terhubung!');
        console.log('   Fifi kini siap membalas chat WhatsApp otomatis 24/7.');
        console.log('======================================================\n');
      }
    });

    // Menangani pesan masuk
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Abaikan pesan yang dikirim oleh bot sendiri
        if (msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!jid) continue;

        // Abaikan grup WhatsApp (hanya balas private chat)
        if (jid.endsWith('@g.us')) continue;

        // Ekstrak teks pesan
        const messageText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          '';

        if (!messageText || messageText.trim() === '') continue;

        const phone = jid.split('@')[0];
        const rawPushName = (msg.pushName || '').replace(/[\p{Extended_Pictographic}\u200d\uFE0F\uD800-\uDBFF\uDC00-\uDFFF]/gu, '').trim();
        const userName = (rawPushName && /[a-zA-Z0-9]/.test(rawPushName)) ? rawPushName : `Pelanggan WA (+${phone})`;
        const userContact = `+${phone}`;

        console.log(`📩 [WhatsApp] Pesan dari ${userName} (${userContact}): "${messageText}"`);

        try {
          // Kirim indikator mengetik (composing)
          await sock.sendPresenceUpdate('composing', jid);

          // Panggil Fifi AI
          const reply = await sendMessage(sessionId, messageText.trim(), {
            channel: 'whatsapp',
            userName,
            userContact
          });

          // Hentikan status mengetik
          await sock.sendPresenceUpdate('paused', jid);

          // Kirim balasan ke pengguna
          await sock.sendMessage(jid, { text: reply });
          console.log(`📤 [WhatsApp] Fifi membalas ke ${userName}: "${reply.substring(0, 60)}..."`);
        } catch (err) {
          console.error('[WhatsApp Error saat membalas]:', err.message);
        }
      }
    });

    return sock;
  } catch (err) {
    console.error('❌ Gagal menginisialisasi WhatsApp Bot:', err.message);
    return null;
  }
}

export function stopWhatsAppBot() {
  if (sockInstance) {
    try {
      sockInstance.end();
    } catch {}
    sockInstance = null;
  }
}
