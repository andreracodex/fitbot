import express from 'express';
import { getAdminByUsername, updateAdminLastLogin } from '../data/database.js';
import { verifyPassword, generateToken, verifyToken } from '../services/auth.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Autentikasi Super Admin dan penerbitan Bearer Token
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username dan password wajib diisi.'
      });
    }

    const admin = await getAdminByUsername(username.trim());
    if (!admin) {
      return res.status(401).json({
        success: false,
        error: 'Username atau password tidak valid.'
      });
    }

    const isMatch = verifyPassword(password, admin.password_hash, admin.salt);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Username atau password tidak valid.'
      });
    }

    // Catat waktu login
    await updateAdminLastLogin(admin.id);

    // Buat token autentikasi
    const token = generateToken({
      id: admin.id,
      username: admin.username,
      role: admin.role || 'superadmin'
    });

    return res.json({
      success: true,
      message: 'Login Super Admin berhasil.',
      token,
      user: {
        id: admin.id,
        username: admin.username,
        role: admin.role || 'superadmin'
      }
    });
  } catch (err) {
    console.error('[Auth Login Error]:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan sistem saat proses login.'
    });
  }
});

/**
 * GET /api/auth/me
 * Memeriksa status sesi login saat ini
 */
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Belum login.'
    });
  }

  const token = authHeader.slice(7).trim();
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Sesi tidak valid atau telah kedaluwarsa.'
    });
  }

  return res.json({
    success: true,
    authenticated: true,
    user: decoded
  });
});

/**
 * POST /api/auth/logout
 * Mengakhiri sesi pengguna
 */
router.post('/logout', (req, res) => {
  return res.json({
    success: true,
    message: 'Logout berhasil.'
  });
});

export default router;
