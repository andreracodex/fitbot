import { verifyToken } from '../services/auth.js';

/**
 * Middleware untuk memproteksi endpoint mutasi Knowledge Base.
 * Hanya mengizinkan request yang membawa Bearer Token Super Admin yang sah.
 */
export function requireSuperAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Akses ditolak. Header Authorization Bearer diperlukan untuk tindakan ini.'
    });
  }

  const token = authHeader.slice(7).trim();
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'Sesi login tidak valid atau telah kedaluwarsa. Silakan login kembali.'
    });
  }

  if (decoded.role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      error: 'Akses terlarang. Hanya Super Admin yang memiliki wewenang untuk mengubah basis pengetahuan.'
    });
  }

  req.user = decoded;
  next();
}
