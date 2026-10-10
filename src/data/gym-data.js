import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKnowledgeFromDB } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to data/gym-data.json (relatif dari src/data ke data/gym-data.json)
const DATA_PATH = path.resolve(__dirname, '../../data/gym-data.json');

let cachedData = null;
let dynamicKnowledgeCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30000; // 30 detik in-memory cache

/**
 * Membaca data gym dari file JSON statis.
 */
export function getGymData() {
  if (!cachedData) {
    try {
      const raw = fs.readFileSync(DATA_PATH, 'utf-8');
      cachedData = JSON.parse(raw);
    } catch (err) {
      console.error('[Data Error] Gagal membaca gym-data.json:', err.message);
      throw new Error('Database data gym tidak dapat dimuat.');
    }
  }
  return cachedData;
}

/**
 * Membatalkan cache knowledge dinamis saat admin mengubah FAQ / data gym
 */
export function invalidateKnowledgeCache() {
  dynamicKnowledgeCache = null;
  lastCacheTime = 0;
}

/**
 * Membaca data gym secara asinkron dari Database (MySQL / SQLite),
 * dengan fallback otomatis ke gym-data.json.
 */
export async function getKnowledgeDataAsync() {
  const now = Date.now();
  if (dynamicKnowledgeCache && (now - lastCacheTime) < CACHE_TTL_MS) {
    return dynamicKnowledgeCache;
  }

  try {
    const dbData = await getKnowledgeFromDB();
    if (dbData && dbData.gymInfo) {
      dynamicKnowledgeCache = dbData;
      lastCacheTime = now;
      return dynamicKnowledgeCache;
    }
  } catch (err) {
    console.warn('[GymData Warning] Gagal memuat knowledge dari database, menggunakan fallback JSON:', err.message);
  }

  return getGymData();
}

/**
 * Mengembalikan ringkasan umum gym untuk endpoint GET /api/info
 */
export function getGymSummary() {
  const data = getGymData();
  return {
    gymName: data.gymInfo?.name,
    tagline: data.gymInfo?.tagline,
    contact: data.gymInfo?.contact,
    totalBranches: data.branches?.length || 0,
    branches: data.branches?.map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      phone: b.phone
    })),
    operatingHours: data.operatingHours,
    availableMemberships: data.memberships?.map((m) => m.name),
    note: data.gymInfo?.note
  };
}

/**
 * Memformat objek data gym menjadi teks string terstruktur
 */
export function formatGymContextFromData(data) {
  if (!data || !data.gymInfo) return '';

  let context = `=== DATA GYM RESMI (${data.gymInfo.name}) ===\n`;
  context += `Informasi Umum: ${data.gymInfo.name} - ${data.gymInfo.tagline || ''}\n`;
  if (data.gymInfo.contact) {
    context += `Kontak CS: Telepon/WA: ${data.gymInfo.contact.phone || '-'}, Email: ${data.gymInfo.contact.email || '-'}, IG: ${data.gymInfo.contact.instagram || '-'}\n`;
    context += `Jam Layanan CS: ${data.gymInfo.contact.customerServiceHours || '-'}\n\n`;
  }

  if (data.operatingHours) {
    context += `--- JAM OPERASIONAL ---\n`;
    context += `Hari Kerja: ${data.operatingHours.weekdays || '-'}\n`;
    context += `Akhir Pekan: ${data.operatingHours.weekends || '-'}\n`;
    context += `Hari Libur: ${data.operatingHours.holidays || '-'}\n\n`;
  }

  if (Array.isArray(data.branches) && data.branches.length > 0) {
    context += `--- DAFTAR CABANG ---\n`;
    data.branches.forEach((b, idx) => {
      const hl = Array.isArray(b.facilitiesHighlight) ? b.facilitiesHighlight.join(', ') : (b.facilitiesHighlight || '-');
      context += `${idx + 1}. ${b.name}\n   Alamat: ${b.address}\n   Kontak: ${b.phone || '-'}\n   Fasilitas Unggulan: ${hl}\n`;
    });
    context += '\n';
  }

  if (Array.isArray(data.facilities) && data.facilities.length > 0) {
    context += `--- FASILITAS LENGKAP ---\n`;
    data.facilities.forEach((f) => {
      context += `[${f.category}]\n`;
      if (Array.isArray(f.items)) {
        f.items.forEach((item) => {
          context += ` - ${item}\n`;
        });
      }
    });
    context += '\n';
  }

  if (Array.isArray(data.memberships) && data.memberships.length > 0) {
    context += `--- PAKET MEMBERSHIP ---\n`;
    data.memberships.forEach((m) => {
      const benefits = Array.isArray(m.benefits) ? m.benefits.join('; ') : (m.benefits || '-');
      context += `* Paket: ${m.name}\n  Deskripsi: ${m.description || '-'}\n  Keuntungan: ${benefits}\n  Catatan Tarif: ${m.pricingNote || '-'}\n`;
    });
    context += '\n';
  }

  if (data.classSchedules) {
    context += `--- JADWAL KELAS ---\n`;
    context += `Status: ${data.classSchedules.status || '-'}\n`;
    const popular = Array.isArray(data.classSchedules.popularClasses) ? data.classSchedules.popularClasses.join(', ') : (data.classSchedules.popularClasses || '-');
    context += `Kelas Populer: ${popular}\n`;
    context += `Catatan: ${data.classSchedules.scheduleNote || '-'}\n\n`;
  }

  if (Array.isArray(data.faqs) && data.faqs.length > 0) {
    context += `--- FAQ (TANYA JAWAB UMUM) ---\n`;
    data.faqs.forEach((faq, idx) => {
      context += `Q${idx + 1}: ${faq.question}\nA${idx + 1}: ${faq.answer}\n`;
    });
  }

  return context;
}

/**
 * Memformat seluruh data gym menjadi teks grounding sinkron
 */
export function getFormattedGymContext() {
  const data = getGymData();
  return formatGymContextFromData(data);
}

/**
 * Memformat seluruh data gym menjadi teks grounding asinkron dari Database
 */
export async function getFormattedGymContextAsync() {
  const data = await getKnowledgeDataAsync();
  return formatGymContextFromData(data);
}

