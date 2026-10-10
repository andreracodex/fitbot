import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to data/gym-data.json (relatif dari src/data ke data/gym-data.json)
const DATA_PATH = path.resolve(__dirname, '../../data/gym-data.json');

let cachedData = null;

/**
 * Membaca data gym dari file JSON.
 * Melakukan caching di memory untuk efisiensi.
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
 * Memformat seluruh data gym menjadi teks terstruktur dan ringkas untuk
 * disisipkan ke dalam System Instruction Gemini (Grounding Data).
 */
export function getFormattedGymContext() {
  const data = getGymData();

  let context = `=== DATA GYM RESMI (${data.gymInfo.name}) ===\n`;
  context += `Informasi Umum: ${data.gymInfo.name} - ${data.gymInfo.tagline}\n`;
  context += `Kontak CS: Telepon/WA: ${data.gymInfo.contact.phone}, Email: ${data.gymInfo.contact.email}, IG: ${data.gymInfo.contact.instagram}\n`;
  context += `Jam Layanan CS: ${data.gymInfo.contact.customerServiceHours}\n\n`;

  context += `--- JAM OPERASIONAL ---\n`;
  context += `Hari Kerja: ${data.operatingHours.weekdays}\n`;
  context += `Akhir Pekan: ${data.operatingHours.weekends}\n`;
  context += `Hari Libur: ${data.operatingHours.holidays}\n\n`;

  context += `--- DAFTAR CABANG ---\n`;
  data.branches.forEach((b, idx) => {
    context += `${idx + 1}. ${b.name}\n   Alamat: ${b.address}\n   Kontak: ${b.phone}\n   Fasilitas Unggulan: ${b.facilitiesHighlight.join(', ')}\n`;
  });
  context += '\n';

  context += `--- FASILITAS LENGKAP ---\n`;
  data.facilities.forEach((f) => {
    context += `[${f.category}]\n`;
    f.items.forEach((item) => {
      context += ` - ${item}\n`;
    });
  });
  context += '\n';

  context += `--- PAKET MEMBERSHIP ---\n`;
  data.memberships.forEach((m) => {
    context += `* Paket: ${m.name}\n  Deskripsi: ${m.description}\n  Keuntungan: ${m.benefits.join('; ')}\n  Catatan Tarif: ${m.pricingNote}\n`;
  });
  context += '\n';

  context += `--- JADWAL KELAS ---\n`;
  context += `Status: ${data.classSchedules.status}\n`;
  context += `Kelas Populer: ${data.classSchedules.popularClasses.join(', ')}\n`;
  context += `Catatan: ${data.classSchedules.scheduleNote}\n\n`;

  context += `--- FAQ (TANYA JAWAB UMUM) ---\n`;
  data.faqs.forEach((faq, idx) => {
    context += `Q${idx + 1}: ${faq.question}\nA${idx + 1}: ${faq.answer}\n`;
  });

  return context;
}
