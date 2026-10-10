import mysql from 'mysql2/promise';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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
    if (checkFaq && checkFaq.count > 0) {
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
  `);

  sqliteDb = db;
  activeEngine = 'sqlite';
  seedKnowledgeSqlite(db);
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

    mysqlPool = pool;
    activeEngine = 'mysql';
    console.log(`🐬 [Database] Berhasil terhubung ke MySQL: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);

    // Auto-seed knowledge dari gym-data.json jika tabel kosong
    await seedKnowledgeMysql(pool);

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
    if (count > 0) {
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

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      // 1. Simpan percakapan ke MySQL
      await mysqlPool.query(
        `INSERT INTO conversations (session_id, channel, sender, message, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [sessionId, channel, sender, message]
      );

      // 2. Periksa lead yang sudah ada di MySQL
      const [leads] = await mysqlPool.query(
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

        await mysqlPool.query(
          `UPDATE leads SET 
             message_count = message_count + 1,
             last_contact = NOW(),
             name = COALESCE(?, name),
             phone_or_handle = COALESCE(?, phone_or_handle),
             interest = ?
           WHERE session_id = ?`,
          [userName, userContact, updatedInterest, sessionId]
        );
      } else {
        await mysqlPool.query(
          `INSERT INTO leads (
             session_id, channel, name, phone_or_handle, interest, status, message_count, first_contact, last_contact
           ) VALUES (?, ?, ?, ?, ?, 'NEW', 1, NOW(), NOW())`,
          [
            sessionId,
            channel,
            userName || (channel === 'web' ? 'Web Visitor' : 'Lead ' + channel),
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
      updateLead.run(userName, userContact, updatedInterest, sessionId);
    } else {
      const insertLead = db.prepare(`
        INSERT INTO leads (
          session_id, channel, name, phone_or_handle, interest, status, message_count, first_contact, last_contact
        ) VALUES (?, ?, ?, ?, ?, 'NEW', 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `);
      insertLead.run(
        sessionId,
        channel,
        userName || (channel === 'web' ? 'Web Visitor' : 'Lead ' + channel),
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
  if (activeEngine === 'mysql' && mysqlPool) {
    const [rows] = await mysqlPool.query(
      `SELECT * FROM leads ORDER BY last_contact DESC`
    );
    return rows;
  }
  const db = initSqlite();
  return db.prepare(`SELECT * FROM leads ORDER BY last_contact DESC`).all();
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
  const validStatus = ['NEW', 'FOLLOW_UP', 'CONTACTED', 'CONVERTED'];
  if (!validStatus.includes(status)) {
    throw new Error('Status lead tidak valid.');
  }

  if (activeEngine === 'mysql' && mysqlPool) {
    await mysqlPool.query(
      `UPDATE leads SET status = ? WHERE session_id = ?`,
      [status, sessionId]
    );
    return;
  }
  const db = initSqlite();
  db.prepare(`UPDATE leads SET status = ? WHERE session_id = ?`).run(status, sessionId);
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
    const [[{ converted }]] = await mysqlPool.query(`SELECT COUNT(*) as converted FROM leads WHERE status = 'CONVERTED'`);
    const [[{ newLeads }]] = await mysqlPool.query(`SELECT COUNT(*) as newLeads FROM leads WHERE status = 'NEW'`);

    return {
      total,
      byChannel: { web, telegram, whatsapp },
      byStatus: { new: newLeads, converted },
      engine: 'MySQL'
    };
  }

  const db = initSqlite();
  const total = db.prepare(`SELECT COUNT(*) as count FROM leads`).get().count;
  const web = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE channel = 'web'`).get().count;
  const telegram = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE channel = 'telegram'`).get().count;
  const whatsapp = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE channel = 'whatsapp'`).get().count;
  const converted = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'CONVERTED'`).get().count;
  const newLeads = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'NEW'`).get().count;

  return {
    total,
    byChannel: { web, telegram, whatsapp },
    byStatus: { new: newLeads, converted },
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
    } catch {}
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
export async function updateFaq(id, { category, question, answer, is_active = 1 }) {
  if (!id) throw new Error('ID FAQ tidak valid.');

  if (activeEngine === 'mysql' && mysqlPool) {
    await mysqlPool.query(
      'UPDATE gym_faqs SET category = COALESCE(?, category), question = COALESCE(?, question), answer = COALESCE(?, answer), is_active = COALESCE(?, is_active) WHERE id = ?',
      [category, question, answer, is_active, id]
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
  `).run(category, question, answer, is_active, id);

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

