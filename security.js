const { createHash, timingSafeEqual } = require('crypto');
function sameSecret(actual, expected) {
  return typeof actual === 'string' && timingSafeEqual(
    createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest(),
  );
}
function backendAccess(req, res, next) {
  const secret = process.env.BACKEND_API_SECRET;
  // Never publish the existing unauthenticated API merely by selecting Firebase.
  if ((process.env.VERCEL || process.env.DATA_PROVIDER === 'firebase') && (!secret || secret.length < 32)) {
    return res.status(503).json({ success: false, message: 'BACKEND_API_SECRET minimal 32 karakter wajib dikonfigurasi.' });
  }
  if (secret && !sameSecret(req.get('x-glink-secret'), secret)) {
    return res.status(401).json({ success: false, message: 'Akses tidak diizinkan.' });
  }
  next();
}
module.exports = { backendAccess, sameSecret };
