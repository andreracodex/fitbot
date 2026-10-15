import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { sendMessage } from '../services/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSIONS_META_FILE = path.resolve(__dirname, '../../data/whatsapp_sessions.json');
const AUTH_BASE_DIR = path.resolve(__dirname, '../../data/auth_info_baileys');
const SESSIONS_DIR = path.resolve(__dirname, '../../data/auth_sessions');

// Map in-memory untuk menyimpan seluruh socket & state sesi aktif
// Key: sessionId (string) -> { sock, id, name, description, status, phoneNumber, qr, qrDataUrl, lastConnectedAt, lastMessageAt }
const activeSessions = new Map();

/**
 * Membaca metadata sesi tersimpan dari file JSON
 */
export function loadSessionsMeta() {
  if (fs.existsSync(SESSIONS_META_FILE)) {
    try {
      const content = fs.readFileSync(SESSIONS_META_FILE, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.warn('Gagal membaca data/whatsapp_sessions.json:', e.message);
    }
  }

  // Default: Sesi utama (backward-compatible dengan auth_info_baileys yang sudah ada)
  const defaultMeta = {
    default: {
      id: 'default',
      name: 'Nomor CS Utama (Pusat)',
      description: 'Koneksi WhatsApp resmi utama FitBot Gym',
      createdAt: new Date().toISOString()
    }
  };
  saveSessionsMeta(defaultMeta);
  return defaultMeta;
}

/**
 * Menyimpan metadata sesi ke file JSON
 */
export function saveSessionsMeta(meta) {
  try {
    const dataDir = path.dirname(SESSIONS_META_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(SESSIONS_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
  } catch (e) {
    console.error('Gagal menulis data/whatsapp_sessions.json:', e.message);
  }
}

/**
 * Mendapatkan direktori penyimpanan kredensial Baileys untuk sesi tertentu
 */
export function getSessionAuthDir(sessionId) {
  if (sessionId === 'default') {
    return AUTH_BASE_DIR;
  }
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.resolve(SESSIONS_DIR, safeId);
}

/**
 * Memulai satu sesi WhatsApp tertentu
 * @param {string} sessionId
 * @param {string} [name]
 * @param {string} [description]
 */
export async function startWhatsAppSession(sessionId = 'default', name = null, description = null) {
  const isEnabled = process.env.ENABLE_WHATSAPP === 'true';
  if (!isEnabled) {
    console.log(`ℹ️  WhatsApp Bot [${sessionId}]: Dinonaktifkan (ENABLE_WHATSAPP=false di .env)`);
    return null;
  }

  const meta = loadSessionsMeta();
  if (!meta[sessionId]) {
    meta[sessionId] = {
      id: sessionId,
      name: name || (sessionId === 'default' ? 'Nomor CS Utama' : `Sesi WA ${sessionId}`),
      description: description || '',
      createdAt: new Date().toISOString()
    };
    saveSessionsMeta(meta);
  } else if (name) {
    meta[sessionId].name = name;
    if (description !== null) meta[sessionId].description = description;
    saveSessionsMeta(meta);
  }

  const sessionMeta = meta[sessionId];

  // Jika sesi sudah berjalan dan terhubung, kembalikan instance yang ada
  const existing = activeSessions.get(sessionId);
  if (existing && existing.sock && existing.status === 'CONNECTED') {
    return existing;
  }

  const authDir = getSessionAuthDir(sessionId);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const sessionObj = existing || {
    id: sessionId,
    name: sessionMeta.name,
    description: sessionMeta.description,
    status: 'CONNECTING',
    phoneNumber: null,
    qr: null,
    qrDataUrl: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    sock: null
  };
  activeSessions.set(sessionId, sessionObj);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' })
    });

    sessionObj.sock = sock;

    // Simpan kredensial saat diperbarui
    sock.ev.on('creds.update', saveCreds);

    // Event perubahan status koneksi & QR code
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessionObj.qr = qr;
        sessionObj.status = 'SCAN_QR';
        try {
          sessionObj.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
        } catch (err) {
          console.error(`[WA ${sessionId}] Gagal generate QR base64:`, err.message);
        }

        console.log(`\n======================================================`);
        console.log(`📱 SCAN QR WHATSAPP UNTUK SESI: [${sessionObj.name}] (${sessionId})`);
        console.log(`   (Buka WA di HP > Titik Tiga / Pengaturan > Perangkat Tertaut)`);
        console.log(`======================================================\n`);
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`⚠️  [WA ${sessionId}] Koneksi terputus (status: ${statusCode}), reconnect: ${shouldReconnect}`);

        sessionObj.status = shouldReconnect ? 'CONNECTING' : 'DISCONNECTED';
        sessionObj.sock = null;

        if (shouldReconnect) {
          setTimeout(() => {
            startWhatsAppSession(sessionId, sessionObj.name).catch(() => {});
          }, 5000);
        } else {
          sessionObj.qr = null;
          sessionObj.qrDataUrl = null;
          sessionObj.phoneNumber = null;
        }
      } else if (connection === 'open') {
        sessionObj.status = 'CONNECTED';
        sessionObj.qr = null;
        sessionObj.qrDataUrl = null;
        sessionObj.lastConnectedAt = new Date().toISOString();

        const rawId = sock.user?.id || '';
        const phone = rawId.split(':')[0] || rawId.split('@')[0];
        sessionObj.phoneNumber = phone ? `+${phone}` : 'Terhubung';

        console.log(`======================================================`);
        console.log(`✅ WhatsApp Bot FitBot [${sessionObj.name}] Berhasil Terhubung!`);
        console.log(`   ID Sesi: ${sessionId} | Nomor: ${sessionObj.phoneNumber}`);
        console.log(`======================================================\n`);
      }
    });

    // Menangani pesan masuk per sesi WhatsApp
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!jid || jid.endsWith('@g.us')) continue; // Abaikan pesan grup

        const messageText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          '';

        if (!messageText || messageText.trim() === '') continue;

        const phone = jid.split('@')[0];
        const rawPushName = (msg.pushName || '').replace(/[\p{Extended_Pictographic}\u200d\uFE0F\uD800-\uDBFF\uDC00-\uDFFF]/gu, '').trim();
        const userName = (rawPushName && /[a-zA-Z0-9]/.test(rawPushName)) ? rawPushName : `Pelanggan WA (+${phone})`;
        const userContact = `+${phone}`;

        // Isolasi sesi obrolan per nomor pengguna dan per sesi bot
        const chatSessionId = (sessionId === 'default')
          ? `wa_${phone}`
          : `wa_${sessionId}_${phone}`;

        sessionObj.lastMessageAt = new Date().toISOString();

        console.log(`📩 [WA ${sessionObj.name}] Pesan dari ${userName} (${userContact}): "${messageText}"`);

        try {
          await sock.sendPresenceUpdate('composing', jid);

          const reply = await sendMessage(chatSessionId, messageText.trim(), {
            channel: 'whatsapp',
            userName,
            userContact,
            whatsappSession: sessionId,
            sessionName: sessionObj.name
          });

          await sock.sendPresenceUpdate('paused', jid);
          await sock.sendMessage(jid, { text: reply });

          console.log(`📤 [WA ${sessionObj.name}] Membalas ke ${userName}: "${reply.substring(0, 60)}..."`);
        } catch (err) {
          console.error(`[WA ${sessionId} Error balasan]:`, err.message);
        }
      }
    });

    return sessionObj;
  } catch (err) {
    console.error(`❌ Gagal inisialisasi sesi WhatsApp [${sessionId}]:`, err.message);
    sessionObj.status = 'ERROR';
    return null;
  }
}

/**
 * Menghentikan sesi WhatsApp tertentu tanpa menghapus data auth
 */
export async function stopWhatsAppSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session && session.sock) {
    try {
      session.sock.end();
    } catch {}
    session.sock = null;
    session.status = 'DISCONNECTED';
    session.qr = null;
    session.qrDataUrl = null;
  }
  return true;
}

/**
 * Menghapus sesi WhatsApp dan folder auth-nya
 */
export async function deleteWhatsAppSession(sessionId) {
  await stopWhatsAppSession(sessionId);
  activeSessions.delete(sessionId);

  // Hapus dari metadata
  const meta = loadSessionsMeta();
  delete meta[sessionId];
  saveSessionsMeta(meta);

  // Hapus folder auth jika bukan default
  if (sessionId !== 'default') {
    const dir = getSessionAuthDir(sessionId);
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Gagal menghapus direktori auth sesi ${sessionId}:`, err.message);
      }
    }
  } else {
    // Untuk default: hapus creds jika pengguna sengaja ingin logout
    const credsFile = path.join(AUTH_BASE_DIR, 'creds.json');
    if (fs.existsSync(credsFile)) {
      try {
        fs.unlinkSync(credsFile);
      } catch {}
    }
  }

  return true;
}

/**
 * Mengambil ringkasan seluruh sesi WhatsApp (untuk API & Dashboard)
 */
export function getAllWhatsAppSessions() {
  const meta = loadSessionsMeta();
  const list = [];

  for (const id of Object.keys(meta)) {
    const m = meta[id];
    const active = activeSessions.get(id);

    list.push({
      id,
      name: m.name,
      description: m.description || '',
      status: active ? active.status : 'DISCONNECTED',
      phoneNumber: active?.phoneNumber || null,
      hasQr: Boolean(active?.qrDataUrl),
      qrDataUrl: active?.qrDataUrl || null,
      createdAt: m.createdAt,
      lastConnectedAt: active?.lastConnectedAt || null,
      lastMessageAt: active?.lastMessageAt || null
    });
  }

  return list;
}

/**
 * Mengambil detail satu sesi WhatsApp
 */
export function getWhatsAppSession(sessionId) {
  const meta = loadSessionsMeta();
  if (!meta[sessionId]) return null;

  const m = meta[sessionId];
  const active = activeSessions.get(sessionId);

  return {
    id: sessionId,
    name: m.name,
    description: m.description || '',
    status: active ? active.status : 'DISCONNECTED',
    phoneNumber: active?.phoneNumber || null,
    hasQr: Boolean(active?.qrDataUrl),
    qrDataUrl: active?.qrDataUrl || null,
    createdAt: m.createdAt,
    lastConnectedAt: active?.lastConnectedAt || null,
    lastMessageAt: active?.lastMessageAt || null
  };
}

/**
 * Entry point server: Inisialisasi seluruh sesi WhatsApp yang terdaftar
 */
export async function startWhatsAppBot() {
  const isEnabled = process.env.ENABLE_WHATSAPP === 'true';
  if (!isEnabled) {
    console.log('ℹ️  WhatsApp Bot: Dinonaktifkan (ENABLE_WHATSAPP=false)');
    return null;
  }

  const meta = loadSessionsMeta();
  const sessionIds = Object.keys(meta);

  console.log(`🤖 Memulai Multi-Session WhatsApp (${sessionIds.length} sesi terdaftar)...`);

  for (const id of sessionIds) {
    try {
      await startWhatsAppSession(id, meta[id].name, meta[id].description);
    } catch (err) {
      console.error(`Gagal memulai sesi WA [${id}]:`, err.message);
    }
  }

  return activeSessions;
}

/**
 * Menghentikan seluruh sesi WhatsApp (saat graceful shutdown)
 */
export function stopWhatsAppBot() {
  for (const [id, session] of activeSessions.entries()) {
    if (session && session.sock) {
      try {
        session.sock.end();
      } catch {}
      session.sock = null;
      session.status = 'DISCONNECTED';
    }
  }
}
