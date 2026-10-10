import mysql from 'mysql2/promise';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../services/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Deteksi konfigurasi database dari .env
const DB_TYPE = (process.env.DB_TYPE || 'mysql').toLowerCase();
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT) || 3308; // Default Laragon port pada sistem ini
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'fitbot_db';

let mysqlPool = null;
let sqliteDb = null;
let activeEngine = 'sqlite';

/**
 * Deteksi minat (interest) calon pelanggan dari teks pesan
 */
function detectInterest(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const interests = [];

  if (lower.includes('harga') || lower.includes('biaya') || lower.includes('paket') || lower.includes('membership')) {
    interests.push('Membership & Harga');
  }
  if (lower.includes('trial') || lower.includes('coba gratis') || lower.includes('free trial')) {
    interests.push('Free Trial');
  }
  if (lower.includes('pt') || lower.includes('personal trainer') || lower.includes('pelatih')) {
    interests.push('Personal Trainer');
  }
  if (lower.includes('cabang') || lower.includes('senopati') || lower.includes('puri') || lower.includes('sudirman')) {
    interests.push('Lokasi Cabang');
  }
  if (lower.includes('jadwal') || lower.includes('kelas') || lower.includes('yoga') || lower.includes('jam')) {
    interests.push('Jadwal & Kelas');
  }

  return interests.length > 0 ? interests.join(', ') : null;
}

/**
 * Membaca data referensi awal dari data/gym-data.json untuk seeder database
 */
function readSeedJson() {
  const jsonPath = path.resolve(__dirname, '../../data/gym-data.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.warn('Gagal membaca data/gym-data.json untuk seeder:', e.message);
    }
  }
  return null;
}

/**
 * Seeding data knowledge ke SQLite jika tabel gym_faqs masih kosong
 */
function seedKnowledgeSqlite(db) {
  try {
    const checkFaq = db.prepare('SELECT COUNT(*) as count FROM gym_faqs').get();
    if (checkFaq && checkFaq.count >= 10) {
      return;
    }

    const data = readSeedJson();
    if (!data) return;

    if (data.gymInfo) {
      db.prepare(`
        INSERT INTO gym_info (name, tagline, phone, email, instagram, customer_service_hours, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.gymInfo.name,
        data.gymInfo.tagline,
        data.gymInfo.contact?.phone || null,
        data.gymInfo.contact?.email || null,
        data.gymInfo.contact?.instagram || null,
        data.gymInfo.contact?.customerServiceHours || null,
        data.gymInfo.note || null
      );
    }

    if (Array.isArray(data.branches)) {
      const insertBranch = db.prepare(`
        INSERT INTO gym_branches (branch_id, name, address, phone, facilities_highlight)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const b of data.branches) {
        insertBranch.run(
          b.id,
          b.name,
          b.address,
          b.phone,
          JSON.stringify(b.facilitiesHighlight || [])
        );
      }
    }

    if (data.operatingHours) {
      db.prepare(`
        INSERT INTO gym_operating_hours (weekdays, weekends, holidays)
        VALUES (?, ?, ?)
      `).run(
        data.operatingHours.weekdays,
        data.operatingHours.weekends,
        data.operatingHours.holidays
      );
    }

    if (Array.isArray(data.facilities)) {
      const insertFacility = db.prepare(`
        INSERT INTO gym_facilities (category, items)
        VALUES (?, ?)
      `);
      for (const f of data.facilities) {
        insertFacility.run(f.category, JSON.stringify(f.items || []));
      }
    }

    if (Array.isArray(data.memberships)) {
      const insertMembership = db.prepare(`
        INSERT INTO gym_memberships (name, description, benefits, pricing_note)
        VALUES (?, ?, ?, ?)
      `);
      for (const m of data.memberships) {
        insertMembership.run(
          m.name,
          m.description,
          JSON.stringify(m.benefits || []),
          m.pricingNote
        );
      }
    }

    if (Array.isArray(data.faqs)) {
      const insertFaq = db.prepare(`
        INSERT INTO gym_faqs (category, question, answer, is_active)
        VALUES (?, ?, ?, 1)
      `);
      for (const faq of data.faqs) {
        insertFaq.run(faq.category || 'Umum', faq.question, faq.answer);
      }
    }

    console.log('🌱 [Database] Auto-seeding knowledge base ke SQLite berhasil.');
  } catch (err) {
    console.error('[SQLite Seed Error]:', err.message);
  }
}

/**
 * Seeding akun Super Admin default ke SQLite jika tabel admin_users kosong
 */
function seedSuperAdminSqlite(db) {
  try {
    const check = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
    if (check && check.count > 0) return;

    const username = process.env.ADMIN_USERNAME || 'superadmin';
    const password = process.env.ADMIN_PASSWORD || 'superadmin123';
    const { hash, salt } = hashPassword(password);

    db.prepare(`
      INSERT INTO admin_users (username, password_hash, salt, role)
      VALUES (?, ?, ?, 'superadmin')
    `).run(username, hash, salt);

    console.log(`🔐 [Auth] Akun Super Admin default (${username}) siap di SQLite.`);
  } catch (err) {
    console.error('[SQLite Admin Seed Error]:', err.message);
  }
}

/**
 * Data Seed Percakapan & Leads Omnichannel Default
 */
const SAMPLE_LEADS = [
  {
    sessionId: 'lead-sarah-johnson',
    name: 'Sarah Johnson',
    phone: '+62 812 3456 7890',
    channel: 'whatsapp',
    status: 'IN_PROGRESS',
    interest: 'Membership Options & Pricing (Canggu Branch)',
    notes: 'Tertarik paket membership 6 bulan atau 1 tahun di Cabang Canggu Bali. Meminta info jadwal tur gym.',
    time: '10:24 AM',
    conversations: [
      { sender: 'user', message: 'Hi, can you tell me about the membership options?' },
      { sender: 'bot', message: "Hi! I'm Fifi, your AI assistant from Fitness Plus Gym. I'd be happy to help you with our membership options.\n\nWe offer 1 Month, 3 Months, 6 Months, and 1 Year memberships.\n\nFor the latest pricing and promotions, I'll be happy to connect you with our branch consultant. Which branch are you interested in?" },
      { sender: 'user', message: "I'm interested in the Canggu branch. Is there a current promotion?" },
      { sender: 'bot', message: "Great! The Canggu branch has a special promotion right now. I'll forward your inquiry to our branch consultant so you can get the most up-to-date pricing and details.\n\nWould you like to choose a membership duration: 1 Month, 3 Months, 6 Months, or 1 Year?" }
    ]
  },
  {
    sessionId: 'lead-michael-tan',
    name: 'Michael Tan',
    phone: '+62 811 2233 4455',
    channel: 'whatsapp',
    status: 'RESOLVED',
    interest: 'Trial Class & Free Pass',
    notes: 'Klaim Free Trial 3 Hari di Senopati. Mau coba kelas BodyPump Sabtu.',
    time: '09:12 AM',
    conversations: [
      { sender: 'user', message: 'Do you have a trial class?' },
      { sender: 'bot', message: 'Halo Michael! Ya, kami menyediakan Free Trial 3 Hari di seluruh cabang Fitness Plus. Anda bisa menikmati akses gym dan seluruh kelas Les Mills maupun Yoga.' },
      { sender: 'user', message: 'Boleh, cabang Senopati ya.' },
      { sender: 'bot', message: 'Siap! Sesi trial Anda di Fitness Plus Senopati sudah tercatat. Tim kami akan mengirimkan QR access melalui WhatsApp ini.' }
    ]
  },
  {
    sessionId: 'lead-jessica-lee',
    name: 'Jessica Lee',
    phone: '+62 811 9876 3210',
    channel: 'instagram',
    status: 'IN_PROGRESS',
    interest: 'Dry Sauna & Wellness Hours',
    notes: 'Tanya jam operasional sauna di Canggu.',
    time: '08:47 AM',
    conversations: [
      { sender: 'user', message: 'What are the sauna hours?' },
      { sender: 'bot', message: 'Hi Jessica! Dry Sauna di Fitness Plus Canggu dan Senopati beroperasi setiap hari dari jam 06:00 sampai 21:30 WITA. Sauna tersedia gratis untuk seluruh anggota aktif!' }
    ]
  },
  {
    sessionId: 'lead-daniel-kim',
    name: 'Daniel Kim',
    phone: '+62 813 7765 4321',
    channel: 'whatsapp',
    status: 'RESOLVED',
    interest: 'Paket 6 Bulan & Personal Trainer',
    notes: 'Sudah mendaftar paket 6 bulan via transfer bank.',
    time: 'Yesterday',
    conversations: [
      { sender: 'user', message: 'How much is the membership for 6 months?' },
      { sender: 'bot', message: 'Halo Daniel! Paket 6 bulan saat ini sedang ada promo hemat 20% plus bonus 2 sesi Personal Trainer dan analisis InBody gratis!' }
    ]
  },
  {
    sessionId: 'lead-emily-carter',
    name: 'Emily Carter',
    phone: '+62 812 6600 1122',
    channel: 'instagram',
    status: 'RESOLVED',
    interest: 'Promosi Pasangan & Sahabat',
    notes: 'Tertarik promo berdua diskon 25%.',
    time: 'Yesterday',
    conversations: [
      { sender: 'user', message: 'Is there a promotion right now?' },
      { sender: 'bot', message: 'Hi Emily! Kami saat ini ada promo potongan 25% untuk pendaftaran paket berdua (Sahabat/Pasangan) serta voucher merchandise eksklusif.' }
    ]
  },
  {
    sessionId: 'lead-ryan-park',
    name: 'Ryan Park',
    phone: '+62 818 3344 5566',
    channel: 'whatsapp',
    status: 'IN_PROGRESS',
    interest: 'Jadwal Kelas Les Mills & Yoga',
    notes: 'Meminta jadwal kelas PDF cabang Ubud.',
    time: 'Yesterday',
    conversations: [
      { sender: 'user', message: 'Can I check the class schedule?' },
      { sender: 'bot', message: 'Halo Ryan! Jadwal kelas mingguan (BodyPump, Yoga, Spinning, Zumba) bisa dicek langsung di aplikasi FitBot atau saya kirimkan jadwal PDF cabang Ubud.' }
    ]
  },
  {
    sessionId: 'lead-samantha-wilson',
    name: 'Samantha Wilson',
    phone: '+62 817 9988 7766',
    channel: 'whatsapp',
    status: 'RESOLVED',
    interest: 'Lokasi & Valet Cabang Canggu',
    notes: 'Sudah berkunjung ke Canggu hari ini.',
    time: 'Oct 15',
    conversations: [
      { sender: 'user', message: 'Where is the Canggu branch located?' },
      { sender: 'bot', message: 'Hi Samantha! Cabang Canggu beralamat di Jl. Pantai Batu Bolong No. 88, Canggu, Badung, Bali. Parkir luas dengan valet service gratis untuk member!' }
    ]
  },
  {
    sessionId: 'lead-kevin-lim',
    name: 'Kevin Lim',
    phone: '+62 813 6677 8899',
    channel: 'instagram',
    status: 'RESOLVED',
    interest: 'InBody Body Composition Scan',
    notes: 'Jadwal tes InBody scan Kamis pagi bersama Nutritionist.',
    time: 'Oct 15',
    conversations: [
      { sender: 'user', message: 'Do you offer body composition check?' },
      { sender: 'bot', message: 'Halo Kevin! Ya, setiap member baru mendapatkan pemeriksaan komposisi tubuh gratis dengan InBody 570 dan konsultasi analisa bersama nutritionist kami.' }
    ]
  },
  {
    sessionId: 'lead-olivia-davis',
    name: 'Olivia Davis',
    phone: '+62 812 4444 7788',
    channel: 'whatsapp',
    status: 'RESOLVED',
    interest: 'Pilihan Paket Membership',
    notes: 'Memilih paket Annual VIP All-Club Pass.',
    time: 'Oct 14',
    conversations: [
      { sender: 'user', message: 'What are the available membership plans?' },
      { sender: 'bot', message: 'Hi Olivia! Kami memiliki 4 pilihan: Single Club, All-Club Passport, Annual VIP, dan Student Flex. Semuanya termasuk akses loker dan fasilitas shower air panas.' }
    ]
  },
  {
    sessionId: 'lead-lucas-martin',
    name: 'Lucas Martin',
    phone: '+62 819 5555 6677',
    channel: 'whatsapp',
    status: 'ESCALATED',
    interest: 'Pembatalan / Freeze Keanggotaan',
    notes: 'Perlu konfirmasi freeze membership selama 1 bulan karena dinas ke luar kota. Tiket diteruskan ke Supervisor.',
    time: 'Oct 14',
    conversations: [
      { sender: 'user', message: 'How can I cancel my membership?' },
      { sender: 'bot', message: 'Halo Lucas, untuk proses pembatalan atau freeze akun, mohon isi formulir permohonan 14 hari sebelum siklus billing berikutnya atau hubungi tim Membership Support kami di support@fitnessplus.demo. Saya sudah meneruskan tiket ini ke Supervisor Concierge kami untuk pendampingan langsung.' }
    ]
  }
];

/**
 * Seeding data conversation leads ke SQLite
 */
function seedLeadsSqlite(db) {
  try {
    const check = db.prepare('SELECT COUNT(*) as count FROM leads').get();
    if (check && check.count >= 5) return;

    for (const item of SAMPLE_LEADS) {
      const existing = db.prepare('SELECT id FROM leads WHERE session_id = ?').get(item.sessionId);
      if (!existing) {
        db.prepare(`
          INSERT INTO leads (
            session_id, channel, name, phone_or_handle, interest, status, message_count, first_contact, last_contact, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 days'), datetime('now', 'localtime'), ?)
        `).run(
          item.sessionId,
          item.channel,
          item.name,
          item.phone,
          item.interest,
          item.status,
          item.conversations.length,
          item.notes || null
        );

        const insertConv = db.prepare(`
          INSERT INTO conversations (session_id, channel, sender, message, created_at)
          VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
        `);
        for (const msg of item.conversations) {
          insertConv.run(item.sessionId, item.channel, msg.sender, msg.message);
        }
      }
    }
    console.log('🌱 [Database] Auto-seeding conversations & leads ke SQLite berhasil.');
  } catch (err) {
    console.error('[SQLite Seed Leads Error]:', err.message);
  }
}

/**
 * Inisialisasi Database SQLite
 */
function initSqlite() {
  if (sqliteDb) return sqliteDb;

  const dataDir = path.resolve(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.resolve(dataDir, 'fitbot.db');
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      channel TEXT NOT NULL DEFAULT 'web',
      name TEXT,
      phone_or_handle TEXT,
      interest TEXT DEFAULT 'Umum',
      status TEXT DEFAULT 'NEW',
      message_count INTEGER DEFAULT 1,
      first_contact DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_contact DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'web',
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
    CREATE INDEX IF NOT EXISTS idx_leads_channel ON leads(channel);

    -- Knowledge Base Tables
    CREATE TABLE IF NOT EXISTS gym_faqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT DEFAULT 'Umum',
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS gym_branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id TEXT UNIQUE,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT,
      facilities_highlight TEXT
    );

    CREATE TABLE IF NOT EXISTS gym_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      benefits TEXT,
      pricing_note TEXT
    );

    CREATE TABLE IF NOT EXISTS gym_facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      items TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gym_operating_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weekdays TEXT,
      weekends TEXT,
      holidays TEXT
    );

    CREATE TABLE IF NOT EXISTS gym_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      tagline TEXT,
      phone TEXT,
      email TEXT,
      instagram TEXT,
      customer_service_hours TEXT,
      note TEXT
    );

    -- Admin & Authentication Tables
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT DEFAULT 'superadmin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );
  `);

  try {
    db.exec(`ALTER TABLE leads ADD COLUMN notes TEXT;`);
  } catch (_) { }

  try {
    db.exec(`UPDATE leads SET name = 'Ruski' WHERE session_id = 'wa_246626266443955' AND (name LIKE '%😊%' OR name LIKE 'Pelanggan WA%')`);
    db.exec(`UPDATE leads SET name = 'Pelanggan WhatsApp' WHERE name = '😊' OR name LIKE '%😊%'`);
  } catch (_) { }

  sqliteDb = db;
  activeEngine = 'sqlite';
  seedKnowledgeSqlite(db);
  seedSuperAdminSqlite(db);
  seedLeadsSqlite(db);
  return sqliteDb;
}

/**
 * Inisialisasi Database MySQL
 */
async function initMysql() {
  try {
    // 1. Buat koneksi awal untuk memastikan database fitbot_db sudah ada
    const tempConn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD
    });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
    await tempConn.end();

    // 2. Buat Connection Pool ke database tujuan
    const pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // 3. Buat skema tabel MySQL jika belum ada
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(191) UNIQUE NOT NULL,
        channel VARCHAR(50) NOT NULL DEFAULT 'web',
        name VARCHAR(255),
        phone_or_handle VARCHAR(255),
        interest TEXT,
        status VARCHAR(50) DEFAULT 'NEW',
        message_count INT DEFAULT 1,
        first_contact DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_contact DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_leads_channel (channel)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(191) NOT NULL,
        channel VARCHAR(50) NOT NULL DEFAULT 'web',
        sender VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_conversations_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Knowledge Base Tables di MySQL
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_faqs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category VARCHAR(100) DEFAULT 'Umum',
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        is_active TINYINT DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_branches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id VARCHAR(50) UNIQUE,
        name VARCHAR(150) NOT NULL,
        address TEXT NOT NULL,
        phone VARCHAR(50),
        facilities_highlight TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_memberships (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        benefits TEXT,
        pricing_note TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_facilities (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        items TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_operating_hours (
        id INT AUTO_INCREMENT PRIMARY KEY,
        weekdays TEXT,
        weekends TEXT,
        holidays TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_info (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150),
        tagline VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(100),
        instagram VARCHAR(100),
        customer_service_hours VARCHAR(150),
        note TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Admin & Authentication Tables di MySQL
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(64) NOT NULL,
        role VARCHAR(50) DEFAULT 'superadmin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    try {
      await pool.query(`ALTER TABLE leads ADD COLUMN notes TEXT;`);
    } catch (_) { }

    try {
      await pool.query(`UPDATE leads SET name = 'Ruski' WHERE session_id = 'wa_246626266443955' AND (name LIKE '%😊%' OR name LIKE 'Pelanggan WA%')`);
      await pool.query(`UPDATE leads SET name = 'Pelanggan WhatsApp' WHERE name = '😊' OR name LIKE '%😊%'`);
    } catch (_) { }

    mysqlPool = pool;
    activeEngine = 'mysql';
    console.log(`🐬 [Database] Berhasil terhubung ke MySQL: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);

    // Auto-seed knowledge dari gym-data.json jika tabel kosong
    await seedKnowledgeMysql(pool);
    await seedSuperAdminMysql(pool);
    await seedLeadsMysql(pool);

    return mysqlPool;
  } catch (err) {
    console.warn(`⚠️  [Database Warning] Gagal terhubung ke MySQL (${err.message}).`);
    console.warn(`   Beralih otomatis ke SQLite lokal (data/fitbot.db) agar aplikasi tetap berjalan normal.\n`);
    return initSqlite();
  }
}

/**
 * Seeding data knowledge ke MySQL jika tabel gym_faqs masih kosong
 */
async function seedKnowledgeMysql(pool) {
  try {
    const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM gym_faqs');
    if (count >= 10) {
      return;
    }

    const data = readSeedJson();
    if (!data) return;

    if (data.gymInfo) {
      await pool.query(
        `INSERT INTO gym_info (name, tagline, phone, email, instagram, customer_service_hours, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.gymInfo.name,
          data.gymInfo.tagline,
          data.gymInfo.contact?.phone || null,
          data.gymInfo.contact?.email || null,
          data.gymInfo.contact?.instagram || null,
          data.gymInfo.contact?.customerServiceHours || null,
          data.gymInfo.note || null
        ]
      );
    }

    if (Array.isArray(data.branches)) {
      for (const b of data.branches) {
        await pool.query(
          `INSERT INTO gym_branches (branch_id, name, address, phone, facilities_highlight)
           VALUES (?, ?, ?, ?, ?)`,
          [b.id, b.name, b.address, b.phone, JSON.stringify(b.facilitiesHighlight || [])]
        );
      }
    }

    if (data.operatingHours) {
      await pool.query(
        `INSERT INTO gym_operating_hours (weekdays, weekends, holidays)
         VALUES (?, ?, ?)`,
        [data.operatingHours.weekdays, data.operatingHours.weekends, data.operatingHours.holidays]
      );
    }

    if (Array.isArray(data.facilities)) {
      for (const f of data.facilities) {
        await pool.query(
          `INSERT INTO gym_facilities (category, items)
           VALUES (?, ?)`,
          [f.category, JSON.stringify(f.items || [])]
        );
      }
    }

    if (Array.isArray(data.memberships)) {
      for (const m of data.memberships) {
        await pool.query(
          `INSERT INTO gym_memberships (name, description, benefits, pricing_note)
           VALUES (?, ?, ?, ?)`,
          [m.name, m.description, JSON.stringify(m.benefits || []), m.pricingNote]
        );
      }
    }

    if (Array.isArray(data.faqs)) {
      for (const faq of data.faqs) {
        await pool.query(
          `INSERT INTO gym_faqs (category, question, answer, is_active)
           VALUES (?, ?, ?, 1)`,
          [faq.category || 'Umum', faq.question, faq.answer]
        );
      }
    }

    console.log('🌱 [Database] Auto-seeding knowledge base ke MySQL berhasil.');
  } catch (err) {
    console.error('[MySQL Seed Error]:', err.message);
  }
}

/**
 * Seeding akun Super Admin default ke MySQL jika tabel admin_users kosong
 */
async function seedSuperAdminMysql(pool) {
  try {
    const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM admin_users');
    if (count > 0) return;

    const username = process.env.ADMIN_USERNAME || 'superadmin';
    const password = process.env.ADMIN_PASSWORD || 'superadmin123';
    const { hash, salt } = hashPassword(password);

    await pool.query(
      `INSERT INTO admin_users (username, password_hash, salt, role)
       VALUES (?, ?, ?, 'superadmin')`,
      [username, hash, salt]
    );

    console.log(`🔐 [Auth] Akun Super Admin default (${username}) siap di MySQL.`);
  } catch (err) {
    console.error('[MySQL Admin Seed Error]:', err.message);
  }
}

/**
 * Seeding data conversation leads ke MySQL
 */
async function seedLeadsMysql(pool) {
  try {
    const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM leads');
    if (count >= 5) return;

    for (const item of SAMPLE_LEADS) {
      const [existing] = await pool.query('SELECT id FROM leads WHERE session_id = ?', [item.sessionId]);
      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO leads (
            session_id, channel, name, phone_or_handle, interest, status, message_count, first_contact, last_contact, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 2 DAY), NOW(), ?)`,
          [
            item.sessionId,
            item.channel,
            item.name,
            item.phone,
            item.interest,
            item.status,
            item.conversations.length,
            item.notes || null
          ]
        );

        for (const msg of item.conversations) {
          await pool.query(
            `INSERT INTO conversations (session_id, channel, sender, message, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [item.sessionId, item.channel, msg.sender, msg.message]
          );
        }
      }
    }
    console.log('🌱 [Database] Auto-seeding conversations & leads ke MySQL berhasil.');
  } catch (err) {
    console.error('[MySQL Seed Leads Error]:', err.message);
  }
}

// Inisialisasi awal saat modul dimuat
if (DB_TYPE === 'mysql' && process.env.NODE_ENV !== 'test') {
  initMysql().catch(() => initSqlite());
} else {
  initSqlite();
}

/**
 * Mencatat pesan percakapan dan memperbarui data lead (Multi-database support)
 */
export async function recordMessage({
  sessionId,
  channel = 'web',
  sender,
  message,
  userName = null,
  userContact = null
}) {
  const detectedInterest = detectInterest(message);
  const pool = mysqlPool;

  let cleanUserName = userName;
  if (cleanUserName) {
    cleanUserName = cleanUserName.replace(/[\p{Extended_Pictographic}\u200d\uFE0F\uD800-\uDBFF\uDC00-\uDFFF]/gu, '').trim();
    if (!cleanUserName || !/[a-zA-Z0-9]/.test(cleanUserName)) {
      cleanUserName = (userContact && userContact !== 'Sesi Web' && userContact !== 'null')
        ? `Pelanggan WA (${userContact})`
        : (channel === 'whatsapp' ? 'Pelanggan WhatsApp' : 'Customer');
    }
  }

  if (activeEngine === 'mysql' && pool) {
    try {
      // 1. Simpan percakapan ke MySQL
      await pool.query(
        `INSERT INTO conversations (session_id, channel, sender, message, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [sessionId, channel, sender, message]
      );

      // 2. Periksa lead yang sudah ada di MySQL
      const [leads] = await pool.query(
        `SELECT * FROM leads WHERE session_id = ?`,
        [sessionId]
      );

      if (leads.length > 0) {
        const existing = leads[0];
        let updatedInterest = existing.interest || 'Umum';
        if (detectedInterest && !updatedInterest.includes(detectedInterest)) {
          updatedInterest = updatedInterest === 'Umum'
            ? detectedInterest
            : `${updatedInterest}, ${detectedInterest}`;
        }

        await pool.query(
          `UPDATE leads SET 
             message_count = message_count + 1,
             last_contact = NOW(),
             name = COALESCE(?, name),
             phone_or_handle = COALESCE(?, phone_or_handle),
             interest = ?
           WHERE session_id = ?`,
          [cleanUserName, userContact, updatedInterest, sessionId]
        );
      } else {
        await pool.query(
          `INSERT INTO leads (
             session_id, channel, name, phone_or_handle, interest, status, message_count, first_contact, last_contact
           ) VALUES (?, ?, ?, ?, ?, 'NEW', 1, NOW(), NOW())`,
          [
            sessionId,
            channel,
            cleanUserName || (channel === 'web' ? 'Web Visitor' : 'Lead ' + channel),
            userContact || (channel === 'web' ? 'Sesi Web' : sessionId),
            detectedInterest || 'Umum'
          ]
        );
      }
      return;
    } catch (err) {
      console.error('[MySQL Error] Gagal mencatat pesan:', err.message);
    }
  }

  // Fallback ke SQLite
  try {
    const db = initSqlite();
    const insertConv = db.prepare(`
      INSERT INTO conversations (session_id, channel, sender, message, created_at)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    `);
    insertConv.run(sessionId, channel, sender, message);

    const checkLead = db.prepare(`SELECT * FROM leads WHERE session_id = ?`);
    const existing = checkLead.get(sessionId);

    if (existing) {
      let updatedInterest = existing.interest || 'Umum';
      if (detectedInterest && !updatedInterest.includes(detectedInterest)) {
        updatedInterest = updatedInterest === 'Umum'
          ? detectedInterest
          : `${updatedInterest}, ${detectedInterest}`;
      }

      const updateLead = db.prepare(`
        UPDATE leads
        SET 
          message_count = message_count + 1,
          last_contact = datetime('now', 'localtime'),
          name = COALESCE(?, name),
          phone_or_handle = COALESCE(?, phone_or_handle),
          interest = ?
        WHERE session_id = ?
      `);
      updateLead.run(cleanUserName ?? null, userContact ?? null, updatedInterest, sessionId);
    } else {
      const insertLead = db.prepare(`
        INSERT INTO leads (
          session_id, channel, name, phone_or_handle, interest, status, message_count, first_contact, last_contact
        ) VALUES (?, ?, ?, ?, ?, 'NEW', 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `);
      insertLead.run(
        sessionId,
        channel,
        cleanUserName || (channel === 'web' ? 'Web Visitor' : 'Lead ' + channel),
        userContact || (channel === 'web' ? 'Sesi Web' : sessionId),
        detectedInterest || 'Umum'
      );
    }
  } catch (err) {
    console.error('[SQLite Error] Gagal mencatat pesan:', err.message);
  }
}

/**
 * Mengambil daftar seluruh leads
 */
export async function getAllLeads() {
  const query = `
    SELECT l.*,
      (SELECT c.message FROM conversations c WHERE c.session_id = l.session_id ORDER BY c.id DESC LIMIT 1) as last_message,
      (SELECT c.created_at FROM conversations c WHERE c.session_id = l.session_id ORDER BY c.id DESC LIMIT 1) as last_message_time
    FROM leads l
    ORDER BY l.last_contact DESC
  `;
  let rows;
  if (activeEngine === 'mysql' && mysqlPool) {
    const [result] = await mysqlPool.query(query);
    rows = result;
  } else {
    const db = initSqlite();
    rows = db.prepare(query).all();
  }

  return rows.map(l => {
    let cleanName = (l.name || '').replace(/[\p{Extended_Pictographic}\u200d\uFE0F\uD800-\uDBFF\uDC00-\uDFFF]/gu, '').trim();
    if (!cleanName || !/[a-zA-Z0-9]/.test(cleanName) || cleanName.startsWith('Pelanggan WA (+')) {
      cleanName = (l.session_id === 'wa_246626266443955' || (l.phone_or_handle && l.phone_or_handle.includes('246626266443955')))
        ? 'Ruski'
        : (l.channel === 'whatsapp' ? 'Pelanggan WhatsApp' : (l.channel === 'web' ? 'Web Visitor' : 'Customer'));
    }
    return { ...l, name: cleanName };
  });
}

/**
 * Memperbarui nama pelanggan lead
 */
export async function updateLeadName(sessionId, name) {
  const cleanName = (name || '').trim();
  if (!cleanName) {
    throw new Error('Nama pelanggan tidak boleh kosong.');
  }
  if (activeEngine === 'mysql' && mysqlPool) {
    await mysqlPool.query(
      `UPDATE leads SET name = ? WHERE session_id = ?`,
      [cleanName, sessionId]
    );
    return;
  }
  const db = initSqlite();
  db.prepare(`UPDATE leads SET name = ? WHERE session_id = ?`).run(cleanName, sessionId);
}

/**
 * Mengambil riwayat percakapan untuk session tertentu
 */
export async function getLeadConversations(sessionId) {
  if (activeEngine === 'mysql' && mysqlPool) {
    const [rows] = await mysqlPool.query(
      `SELECT sender, message, created_at FROM conversations WHERE session_id = ? ORDER BY id ASC`,
      [sessionId]
    );
    return rows;
  }
  const db = initSqlite();
  return db.prepare(
    `SELECT sender, message, created_at FROM conversations WHERE session_id = ? ORDER BY id ASC`
  ).all(sessionId);
}

/**
 * Memperbarui status lead
 */
export async function updateLeadStatus(sessionId, status) {
  const cleanStatus = (status || '').trim();
  const normalized = cleanStatus.toUpperCase().replace(/\s+/g, '_');
  const validStatus = [
    'NEW', 'FOLLOW_UP', 'CONTACTED', 'CONVERTED',
    'IN_PROGRESS', 'IN PROGRESS', 'RESOLVED', 'ESCALATED'
  ];
  if (!validStatus.includes(cleanStatus.toUpperCase()) && !validStatus.includes(normalized)) {
    throw new Error('Status lead tidak valid.');
  }

  const finalStatus = (normalized === 'IN_PROGRESS' || normalized === 'IN PROGRESS')
    ? 'IN_PROGRESS'
    : (normalized === 'RESOLVED' ? 'RESOLVED' : (normalized === 'ESCALATED' ? 'ESCALATED' : cleanStatus.toUpperCase()));

  if (activeEngine === 'mysql' && mysqlPool) {
    await mysqlPool.query(
      `UPDATE leads SET status = ? WHERE session_id = ?`,
      [finalStatus, sessionId]
    );
    return;
  }
  const db = initSqlite();
  db.prepare(`UPDATE leads SET status = ? WHERE session_id = ?`).run(finalStatus, sessionId);
}

/**
 * Memperbarui catatan internal lead
 */
export async function updateLeadNotes(sessionId, notes) {
  if (activeEngine === 'mysql' && mysqlPool) {
    await mysqlPool.query(`UPDATE leads SET notes = ? WHERE session_id = ?`, [notes, sessionId]);
    return;
  }
  const db = initSqlite();
  db.prepare(`UPDATE leads SET notes = ? WHERE session_id = ?`).run(notes, sessionId);
}

/**
 * Mengambil ringkasan statistik Leads
 */
export async function getLeadStats() {
  if (activeEngine === 'mysql' && mysqlPool) {
    const [[{ total }]] = await mysqlPool.query(`SELECT COUNT(*) as total FROM leads`);
    const [[{ web }]] = await mysqlPool.query(`SELECT COUNT(*) as web FROM leads WHERE channel = 'web'`);
    const [[{ telegram }]] = await mysqlPool.query(`SELECT COUNT(*) as telegram FROM leads WHERE channel = 'telegram'`);
    const [[{ whatsapp }]] = await mysqlPool.query(`SELECT COUNT(*) as whatsapp FROM leads WHERE channel = 'whatsapp'`);
    const [[{ tiktok }]] = await mysqlPool.query(`SELECT COUNT(*) as tiktok FROM leads WHERE channel = 'tiktok'`);
    const [[{ instagram }]] = await mysqlPool.query(`SELECT COUNT(*) as instagram FROM leads WHERE channel = 'instagram'`);
    const [[{ converted }]] = await mysqlPool.query(`SELECT COUNT(*) as converted FROM leads WHERE status IN ('CONVERTED', 'RESOLVED')`);
    const [[{ inProgress }]] = await mysqlPool.query(`SELECT COUNT(*) as inProgress FROM leads WHERE status IN ('IN_PROGRESS', 'IN PROGRESS', 'NEW', 'FOLLOW_UP')`);
    const [[{ escalated }]] = await mysqlPool.query(`SELECT COUNT(*) as escalated FROM leads WHERE status = 'ESCALATED'`);
    const [[{ newLeads }]] = await mysqlPool.query(`SELECT COUNT(*) as newLeads FROM leads WHERE status = 'NEW'`);

    return {
      total,
      byChannel: { web, telegram, whatsapp, tiktok, instagram },
      byStatus: { new: newLeads, inProgress, resolved: converted, escalated, converted },
      engine: 'MySQL'
    };
  }

  const db = initSqlite();
  const total = db.prepare(`SELECT COUNT(*) as count FROM leads`).get().count;
  const web = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE channel = 'web'`).get().count;
  const telegram = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE channel = 'telegram'`).get().count;
  const whatsapp = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE channel = 'whatsapp'`).get().count;
  const tiktok = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE channel = 'tiktok'`).get().count;
  const instagram = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE channel = 'instagram'`).get().count;
  const converted = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status IN ('CONVERTED', 'RESOLVED')`).get().count;
  const inProgress = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status IN ('IN_PROGRESS', 'IN PROGRESS', 'NEW', 'FOLLOW_UP')`).get().count;
  const escalated = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'ESCALATED'`).get().count;
  const newLeads = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'NEW'`).get().count;

  return {
    total,
    byChannel: { web, telegram, whatsapp, tiktok, instagram },
    byStatus: { new: newLeads, inProgress, resolved: converted, escalated, converted },
    engine: 'SQLite'
  };
}

/**
 * Mengetahui database engine yang sedang aktif
 */
export function getActiveEngine() {
  return activeEngine;
}

/**
 * Menutup koneksi database (untuk testing teardown)
 */
export async function closeDatabase() {
  if (mysqlPool) {
    try {
      await mysqlPool.end();
    } catch { }
    mysqlPool = null;
  }
}

function parseJsonSafe(val, fallback = []) {
  if (!val) return fallback;
  if (Array.isArray(val) || typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function formatKnowledgeObject(info, branches, hours, facilities, memberships, faqs) {
  return {
    gymInfo: info ? {
      name: info.name,
      tagline: info.tagline,
      contact: {
        phone: info.phone,
        email: info.email,
        instagram: info.instagram,
        customerServiceHours: info.customer_service_hours
      },
      note: info.note
    } : null,
    branches: (branches || []).map((b) => ({
      id: b.branch_id,
      name: b.name,
      address: b.address,
      phone: b.phone,
      facilitiesHighlight: parseJsonSafe(b.facilities_highlight)
    })),
    operatingHours: hours ? {
      weekdays: hours.weekdays,
      weekends: hours.weekends,
      holidays: hours.holidays
    } : {},
    facilities: (facilities || []).map((f) => ({
      category: f.category,
      items: parseJsonSafe(f.items)
    })),
    memberships: (memberships || []).map((m) => ({
      name: m.name,
      description: m.description,
      benefits: parseJsonSafe(m.benefits),
      pricingNote: m.pricing_note
    })),
    classSchedules: {
      status: 'Jadwal kelas mingguan berganti setiap periode dan dipublikasikan via papan pengumuman cabang atau Instagram resmi.',
      popularClasses: ['Vinyasa Yoga', 'Les Mills Body Combat', 'Spinning Rush', 'Core & HIIT Blast', 'Zumba Dance'],
      scheduleNote: 'Untuk jadwal jam kelas harian yang terperinci dan booking sesi, silakan hubungi tim resepsionis cabang terkait atau Customer Service.'
    },
    faqs: (faqs || []).map((faq) => ({
      id: faq.id,
      category: faq.category || 'Umum',
      question: faq.question,
      answer: faq.answer,
      isActive: Boolean(faq.is_active)
    }))
  };
}

/**
 * Mengambil seluruh data gym dari database (MySQL / SQLite)
 */
export async function getKnowledgeFromDB() {
  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      const [[infoRow]] = await mysqlPool.query('SELECT * FROM gym_info LIMIT 1');
      const [branchesRows] = await mysqlPool.query('SELECT * FROM gym_branches ORDER BY id ASC');
      const [[hoursRow]] = await mysqlPool.query('SELECT * FROM gym_operating_hours LIMIT 1');
      const [facilitiesRows] = await mysqlPool.query('SELECT * FROM gym_facilities ORDER BY id ASC');
      const [membershipsRows] = await mysqlPool.query('SELECT * FROM gym_memberships ORDER BY id ASC');
      const [faqsRows] = await mysqlPool.query('SELECT * FROM gym_faqs WHERE is_active = 1 ORDER BY id ASC');

      if (infoRow || (faqsRows && faqsRows.length > 0)) {
        return formatKnowledgeObject(infoRow, branchesRows, hoursRow, facilitiesRows, membershipsRows, faqsRows);
      }
    } catch (err) {
      console.warn('[MySQL getKnowledgeFromDB Error]:', err.message);
    }
  }

  // Fallback SQLite
  try {
    const db = initSqlite();
    const infoRow = db.prepare('SELECT * FROM gym_info LIMIT 1').get();
    const branchesRows = db.prepare('SELECT * FROM gym_branches ORDER BY id ASC').all();
    const hoursRow = db.prepare('SELECT * FROM gym_operating_hours LIMIT 1').get();
    const facilitiesRows = db.prepare('SELECT * FROM gym_facilities ORDER BY id ASC').all();
    const membershipsRows = db.prepare('SELECT * FROM gym_memberships ORDER BY id ASC').all();
    const faqsRows = db.prepare('SELECT * FROM gym_faqs WHERE is_active = 1 ORDER BY id ASC').all();

    if (infoRow || (faqsRows && faqsRows.length > 0)) {
      return formatKnowledgeObject(infoRow, branchesRows, hoursRow, facilitiesRows, membershipsRows, faqsRows);
    }
  } catch (err) {
    console.warn('[SQLite getKnowledgeFromDB Error]:', err.message);
  }

  return null;
}

/**
 * Mengambil daftar seluruh FAQ untuk manajemen admin
 */
export async function getAllFaqs() {
  if (activeEngine === 'mysql' && mysqlPool) {
    const [rows] = await mysqlPool.query('SELECT * FROM gym_faqs ORDER BY id DESC');
    return rows;
  }
  const db = initSqlite();
  return db.prepare('SELECT * FROM gym_faqs ORDER BY id DESC').all();
}

/**
 * Menambahkan FAQ baru
 */
export async function createFaq({ category = 'Umum', question, answer }) {
  if (!question || !answer) {
    throw new Error('Pertanyaan dan jawaban wajib diisi.');
  }

  if (activeEngine === 'mysql' && mysqlPool) {
    const [result] = await mysqlPool.query(
      'INSERT INTO gym_faqs (category, question, answer, is_active) VALUES (?, ?, ?, 1)',
      [category || 'Umum', question, answer]
    );
    return { id: result.insertId, category, question, answer, is_active: 1 };
  }

  const db = initSqlite();
  const info = db.prepare(
    'INSERT INTO gym_faqs (category, question, answer, is_active) VALUES (?, ?, ?, 1)'
  ).run(category || 'Umum', question, answer);

  return { id: Number(info.lastInsertRowid), category, question, answer, is_active: 1 };
}

/**
 * Memperbarui FAQ
 */
export async function updateFaq(id, { category, question, answer, is_active } = {}) {
  if (!id) throw new Error('ID FAQ tidak valid.');

  const catVal = category !== undefined ? category : null;
  const qVal = question !== undefined ? question : null;
  const aVal = answer !== undefined ? answer : null;
  const activeVal = is_active !== undefined ? (is_active ? 1 : 0) : null;

  if (activeEngine === 'mysql' && mysqlPool) {
    await mysqlPool.query(
      'UPDATE gym_faqs SET category = COALESCE(?, category), question = COALESCE(?, question), answer = COALESCE(?, answer), is_active = COALESCE(?, is_active) WHERE id = ?',
      [catVal, qVal, aVal, activeVal, id]
    );
    return { id: Number(id), category, question, answer, is_active };
  }

  const db = initSqlite();
  db.prepare(`
    UPDATE gym_faqs
    SET 
      category = COALESCE(?, category),
      question = COALESCE(?, question),
      answer = COALESCE(?, answer),
      is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(catVal, qVal, aVal, activeVal, id);

  return { id: Number(id), category, question, answer, is_active };
}

/**
 * Menghapus FAQ
 */
export async function deleteFaq(id) {
  if (!id) throw new Error('ID FAQ tidak valid.');

  if (activeEngine === 'mysql' && mysqlPool) {
    await mysqlPool.query('DELETE FROM gym_faqs WHERE id = ?', [id]);
    return true;
  }

  const db = initSqlite();
  db.prepare('DELETE FROM gym_faqs WHERE id = ?').run(id);
  return true;
}

/**
 * Mengambil data admin berdasarkan username untuk proses autentikasi
 */
export async function getAdminByUsername(username) {
  if (!username) return null;

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(
        'SELECT * FROM admin_users WHERE username = ? LIMIT 1',
        [username]
      );
      return rows[0] || null;
    } catch (err) {
      console.warn('[MySQL getAdminByUsername Error]:', err.message);
    }
  }

  try {
    const db = initSqlite();
    return db.prepare('SELECT * FROM admin_users WHERE username = ? LIMIT 1').get(username) || null;
  } catch (err) {
    console.warn('[SQLite getAdminByUsername Error]:', err.message);
    return null;
  }
}

/**
 * Memperbarui timestamp login terakhir akun admin
 */
export async function updateAdminLastLogin(id) {
  if (!id) return;

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      await mysqlPool.query('UPDATE admin_users SET last_login = NOW() WHERE id = ?', [id]);
      return;
    } catch { }
  }

  try {
    const db = initSqlite();
    db.prepare("UPDATE admin_users SET last_login = datetime('now', 'localtime') WHERE id = ?").run(id);
  } catch { }
}


