import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/server.js';
import { getGymData, getGymSummary, getFormattedGymContext } from '../src/data/gym-data.js';

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

    test('GET endpoint tidak dikenal mengembalikan 404', async () => {
      const res = await fetch(`${baseUrl}/api/endpoint-yang-tidak-ada`);
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.ok(json.error);
    });
  });
});
