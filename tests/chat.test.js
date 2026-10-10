import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/server.js';
import { getGymData, getGymSummary, getFormattedGymContext, getFormattedGymContextAsync } from '../src/data/gym-data.js';
import { closeDatabase } from '../src/data/database.js';

let testServer;
let baseUrl;

describe('FitBot AI Test Suite', () => {
  before(async () => {
    // Jalankan server di port acak (0) untuk pengujian
    await new Promise((resolve) => {
      testServer = app.listen(0, () => {
        const port = testServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (testServer) {
      if (typeof testServer.closeAllConnections === 'function') {
        testServer.closeAllConnections();
      }
      await new Promise((resolve) => testServer.close(resolve));
    }
    await closeDatabase();
  });

  // --- Modul Data Gym ---
  describe('Modul Data Gym (src/data/gym-data.js)', () => {
    test('getGymData() memuat struktur data gym dengan lengkap', () => {
      const data = getGymData();
      assert.ok(data.gymInfo, 'gymInfo harus ada');
      assert.ok(Array.isArray(data.branches), 'branches harus berupa array');
      assert.ok(data.branches.length > 0, 'harus memiliki minimal satu cabang');
      assert.ok(Array.isArray(data.facilities), 'facilities harus berupa array');
      assert.ok(Array.isArray(data.memberships), 'memberships harus berupa array');
      assert.ok(Array.isArray(data.faqs), 'faqs harus berupa array');
    });

    test('getGymSummary() mengembalikan ringkasan publik tanpa data internal berlebih', () => {
      const summary = getGymSummary();
      assert.equal(typeof summary.gymName, 'string');
      assert.equal(typeof summary.totalBranches, 'number');
      assert.ok(summary.branches.length > 0);
      assert.ok(summary.availableMemberships.length > 0);
    });

    test('getFormattedGymContext() menghasilkan teks grounding yang kaya konteks', () => {
      const context = getFormattedGymContext();
      assert.ok(context.includes('DATA GYM RESMI'), 'Harus menyertakan header konteks');
      assert.ok(context.includes('Senopati'), 'Harus memuat nama cabang');
      assert.ok(context.includes('Sauna'), 'Harus memuat fasilitas');
      assert.ok(context.includes('Single Club Membership'), 'Harus memuat nama paket');
    });

    test('getFormattedGymContextAsync() memuat konteks dinamis langsung dari database', async () => {
      const context = await getFormattedGymContextAsync();
      assert.ok(typeof context === 'string');
      assert.ok(context.includes('DATA GYM RESMI'), 'Harus menyertakan header konteks');
      assert.ok(context.includes('Senopati'), 'Harus memuat cabang dari database');
      assert.ok(context.includes('FAQ (TANYA JAWAB UMUM)'), 'Harus memuat FAQ dinamis');
    });
  });

  // --- Endpoint HTTP API ---
  describe('API Endpoints (src/routes/chat.js)', () => {
    test('GET /api/health mengembalikan status 200 dan status ok', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.status, 'ok');
      assert.equal(typeof json.apiKeyConfigured, 'boolean');
      assert.ok(json.timestamp);
    });

    test('GET /api/info mengembalikan informasi gym', async () => {
      const res = await fetch(`${baseUrl}/api/info`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.gymName, 'FitLife Arena');
      assert.ok(json.branches.length >= 3);
    });

    test('TC-05: POST /api/chat menolak pesan kosong dengan status 400', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'test-sess', message: '   ' })
      });
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.ok(json.error.includes('Pesan tidak boleh kosong'));
    });

    test('TC-06: POST /api/chat menolak pesan melebihi 2.000 karakter dengan status 400', async () => {
      const longMessage = 'A'.repeat(2001);
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'test-sess', message: longMessage })
      });
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.ok(json.error.includes('terlalu panjang'));
    });

    test('TC-08: POST /api/chat menangani ketiadaan API key secara aman tanpa crash server', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'test-sess-1', message: 'Halo FitBot' })
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.reply, 'Harus ada bidang reply');
      assert.equal(typeof json.reply, 'string');
      // Tidak boleh mengekspos exception rahasia / stack trace
      assert.ok(!json.reply.includes('at Module.'), 'Tidak boleh membocorkan stack trace');
    });

    test('TC-10: POST /api/chat/reset mereset sesi percakapan', async () => {
      const res = await fetch(`${baseUrl}/api/chat/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'test-sess-1' })
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.sessionId, 'test-sess-1');
    });

    test('POST /api/chat/stream mengembalikan format SSE dengan benar', async () => {
      const res = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'test-stream-sess', message: 'Halo FitBot' })
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/event-stream'));
      const text = await res.text();
      assert.ok(text.includes('data: '));
      assert.ok(text.includes('"done":true'));
    });

    test('POST /api/chat/stream menolak pesan kosong dengan status 400', async () => {
      const res = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'test-stream-sess', message: '' })
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.ok(json.error);
    });

    test('GET endpoint tidak dikenal mengembalikan 404', async () => {
      const res = await fetch(`${baseUrl}/api/endpoint-yang-tidak-ada`);
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.ok(json.error);
    });

    // --- Leads CRM Endpoints ---
    test('GET /api/leads mengembalikan statistik dan daftar leads', async () => {
      const res = await fetch(`${baseUrl}/api/leads`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.ok(json.stats, 'Harus memiliki objek stats');
      assert.ok(typeof json.stats.total === 'number');
      assert.ok(Array.isArray(json.leads), 'Harus memiliki array leads');
    });

    test('PATCH /api/leads/:sessionId memperbarui status lead', async () => {
      // Pastikan ada lead yang tersimpan dari test sebelumnya
      const res = await fetch(`${baseUrl}/api/leads/test-sess-1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CONTACTED' })
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'CONTACTED');
    });

    test('GET /api/leads/:sessionId mengembalikan transkrip percakapan', async () => {
      const res = await fetch(`${baseUrl}/api/leads/test-sess-1`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.sessionId, 'test-sess-1');
      assert.ok(Array.isArray(json.conversations));
    });

    // --- Knowledge Base Endpoints ---
    describe('Knowledge Base Endpoints (src/routes/knowledge.js)', () => {
      let createdFaqId = null;

      test('GET /api/knowledge/faqs mengembalikan daftar FAQ dari database', async () => {
        const res = await fetch(`${baseUrl}/api/knowledge/faqs`);
        assert.equal(res.status, 200);

        const json = await res.json();
        assert.equal(json.success, true);
        assert.ok(Array.isArray(json.data));
        assert.ok(json.data.length > 0, 'Harus memiliki FAQ hasil seeding');
      });

      test('POST /api/knowledge/faqs menolak input tanpa pertanyaan/jawaban', async () => {
        const res = await fetch(`${baseUrl}/api/knowledge/faqs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: '' })
        });
        assert.equal(res.status, 400);
      });

      test('POST /api/knowledge/faqs berhasil menambahkan FAQ baru', async () => {
        const res = await fetch(`${baseUrl}/api/knowledge/faqs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'Fasilitas',
            question: 'Apakah tersedia Wi-Fi gratis di lounge?',
            answer: 'Ya, seluruh area lounge dilengkapi Wi-Fi berkecepatan tinggi.'
          })
        });
        assert.equal(res.status, 201);

        const json = await res.json();
        assert.equal(json.success, true);
        assert.ok(json.data.id);
        createdFaqId = json.data.id;
      });

      test('PUT /api/knowledge/faqs/:id memperbarui FAQ', async () => {
        assert.ok(createdFaqId, 'ID FAQ baru harus tersedia');
        const res = await fetch(`${baseUrl}/api/knowledge/faqs/${createdFaqId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 'Apakah ada Wi-Fi di lounge & gym area?',
            answer: 'Ya, Wi-Fi berkecepatan tinggi tersedia di semua sudut gym.'
          })
        });
        assert.equal(res.status, 200);

        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.question, 'Apakah ada Wi-Fi di lounge & gym area?');
      });

      test('DELETE /api/knowledge/faqs/:id menghapus FAQ', async () => {
        assert.ok(createdFaqId, 'ID FAQ baru harus tersedia');
        const res = await fetch(`${baseUrl}/api/knowledge/faqs/${createdFaqId}`, {
          method: 'DELETE'
        });
        assert.equal(res.status, 200);

        const json = await res.json();
        assert.equal(json.success, true);
      });

      test('GET /api/knowledge/full mengembalikan struktur knowledge lengkap dari DB', async () => {
        const res = await fetch(`${baseUrl}/api/knowledge/full`);
        assert.equal(res.status, 200);

        const json = await res.json();
        assert.equal(json.success, true);
        assert.ok(json.data.gymInfo);
        assert.ok(Array.isArray(json.data.branches));
        assert.ok(Array.isArray(json.data.faqs));
      });
    });
  });
});
