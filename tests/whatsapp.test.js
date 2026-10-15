import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/server.js';
import { generateToken } from '../src/services/auth.js';
import { closeDatabase } from '../src/data/database.js';
import {
  loadSessionsMeta,
  getAllWhatsAppSessions,
  getWhatsAppSession,
  getSessionAuthDir
} from '../src/channels/whatsapp.js';

let testServer;
let baseUrl;
let adminToken;

describe('WhatsApp Multi-Session Test Suite', () => {
  before(async () => {
    adminToken = generateToken({ username: 'superadmin', role: 'superadmin' });
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

  describe('Session Manager Core Functions', () => {
    test('loadSessionsMeta() memuat minimal sesi default', () => {
      const meta = loadSessionsMeta();
      assert.ok(meta, 'Metadata sesi harus ada');
      assert.ok(meta.default, 'Sesi default harus terdaftar');
      assert.equal(meta.default.id, 'default');
    });

    test('getSessionAuthDir() mengembalikan path yang benar untuk default dan multi-session', () => {
      const defaultDir = getSessionAuthDir('default');
      assert.ok(defaultDir.includes('auth_info_baileys'), 'Default dir harus menggunakan folder bawaan');

      const branchDir = getSessionAuthDir('cabang_senopati');
      assert.ok(branchDir.includes('auth_sessions'), 'Branch dir harus berada di folder auth_sessions');
      assert.ok(branchDir.includes('cabang_senopati'), 'Branch dir harus memuat ID cabang');
    });

    test('getAllWhatsAppSessions() mengembalikan array daftar sesi terdaftar', () => {
      const sessions = getAllWhatsAppSessions();
      assert.ok(Array.isArray(sessions), 'Harus berupa array');
      assert.ok(sessions.length >= 1, 'Minimal ada sesi default');
      const def = sessions.find((s) => s.id === 'default');
      assert.ok(def, 'Sesi default harus ada');
      assert.ok(['CONNECTED', 'CONNECTING', 'SCAN_QR', 'DISCONNECTED'].includes(def.status));
    });

    test('getWhatsAppSession() mengembalikan detail satu sesi', () => {
      const def = getWhatsAppSession('default');
      assert.ok(def, 'Sesi default harus ditemukan');
      assert.equal(def.id, 'default');

      const nonExistent = getWhatsAppSession('tidak_ada_xyz_123');
      assert.equal(nonExistent, null);
    });
  });

  describe('API Endpoints (src/routes/whatsapp.js)', () => {
    test('GET /api/whatsapp/sessions menolak akses tanpa token dengan 401', async () => {
      const res = await fetch(`${baseUrl}/api/whatsapp/sessions`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
    });

    test('GET /api/whatsapp/sessions berhasil mengembalikan daftar sesi dengan token Super Admin', async () => {
      const res = await fetch(`${baseUrl}/api/whatsapp/sessions`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.sessions));
      assert.ok(data.total >= 1);
    });

    test('GET /api/whatsapp/sessions/:sessionId mengembalikan 404 untuk sesi yang tidak ada', async () => {
      const res = await fetch(`${baseUrl}/api/whatsapp/sessions/non_existent_session_999`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.success, false);
    });

    test('POST /api/whatsapp/sessions menolak input tanpa sessionId dengan 400', async () => {
      const res = await fetch(`${baseUrl}/api/whatsapp/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({})
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.success, false);
    });
  });
});
