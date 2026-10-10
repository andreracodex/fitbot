import crypto from 'node:crypto';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_SECRET || 'fitbot_super_secret_jwt_key_2026';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // Masa berlaku 24 jam

/**
 * Hash password dengan salt acak menggunakan crypto.scryptSync
 * @param {string} password
 * @returns {{ hash: string, salt: string }}
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/**
 * Verifikasi kecocokan password dengan hash & salt yang tersimpan
 * Aman terhadap timing attack.
 * @param {string} password
 * @param {string} storedHash
 * @param {string} storedSalt
 * @returns {boolean}
 */
export function verifyPassword(password, storedHash, storedSalt) {
  try {
    const hash = crypto.scryptSync(password, storedSalt, 64).toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (hashBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, storedBuf);
  } catch {
    return false;
  }
}

/**
 * Menghasilkan Token Sesi bertanda tangan digital (HMAC-SHA256)
 * @param {object} payload
 * @returns {string} token
 */
export function generateToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Date.now() + TOKEN_EXPIRY_MS;
  const fullPayload = { ...payload, exp };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Memverifikasi keaslian dan masa berlaku Token Sesi
 * @param {string} token
 * @returns {object|null} payload jika valid, null jika tidak valid/kedaluwarsa
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;

  // Verifikasi signature secara aman
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expSigBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
    return null;
  }

  // Parse payload dan cek expired
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null; // Token kedaluwarsa
    }
    return payload;
  } catch {
    return null;
  }
}
