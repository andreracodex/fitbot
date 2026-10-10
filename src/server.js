import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import chatRouter from './routes/chat.js';
import leadsRouter from './routes/leads.js';
import knowledgeRouter from './routes/knowledge.js';
import { startTelegramBot } from './channels/telegram.js';
import { startWhatsAppBot } from './channels/whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Keamanan: HTTP Headers dengan Helmet
app.use(
  helmet({
    contentSecurityPolicy: false // Memberikan fleksibilitas untuk UI statis & icon web lokal
  })
);

// Pembatasan Laju Request (Rate Limiting) untuk pencegahan spam/DDoS
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 100, // Maksimal 100 permintaan per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Terlalu banyak permintaan dari IP ini, silakan coba lagi setelah 15 menit.'
  }
});

// Parsing JSON body dengan limit ukuran aman
app.use(express.json({ limit: '20kb' }));

// Static file hosting untuk frontend web di direktori public/
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Mount route API
app.use('/api/leads', limiter, leadsRouter);
app.use('/api/knowledge', limiter, knowledgeRouter);
app.use('/api', limiter, chatRouter);

// Fallback route 404 untuk endpoint API yang tidak dikenal
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err.message || err);
  res.status(err.status || 500).json({
    error: 'Terjadi kesalahan pada server aplikasi.'
  });
});

let server = null;

// Hanya jalankan listener jika file dieksekusi secara langsung
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  server = app.listen(PORT, async () => {
    console.log(`===============================================`);
    console.log(`🚀 FitBot AI Server aktif di http://localhost:${PORT}`);
    console.log(`   Health Check: http://localhost:${PORT}/api/health`);
    console.log(`   Gym Info:    http://localhost:${PORT}/api/info`);
    console.log(`   Leads CRM:   http://localhost:${PORT}/leads.html`);
    console.log(`===============================================`);

    // Inisialisasi channel eksternal jika diaktifkan di .env
    await startTelegramBot();
    await startWhatsAppBot();
  });
}

export { app, server };
