const statuses = new Set(['Menunggu Persetujuan', 'Disetujui', 'Ditangguhkan', 'Ditolak']);
const jsonArrays = new Set(['anggaran_items', 'itinerary_items']);
function validateRequest(req, res, next) {
  if (!req.body) return next(); // Multipart is validated after multer.
  try {
    if (typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('Body harus berupa object.');
    for (const [key, value] of Object.entries(req.body)) {
      if (value === null || value === '') continue;
      if (jsonArrays.has(key)) {
        let rows;
        try { rows = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw new Error('Rincian dinas tidak valid.'); }
        if (!Array.isArray(rows) || rows.length > 300 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(item => typeof item !== 'string' && typeof item !== 'number' && item !== null))) {
          throw new Error('Rincian dinas harus berupa array object, maksimal 300 baris.');
        }
        continue;
      }
      if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Field ${key} tidak valid.`);
      if (key.includes('tanda_tangan') || key === 'paraf_hrd') {
        if (typeof value !== 'string' || value.length > 400 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
          throw new Error('Tanda tangan harus berupa gambar yang valid, maksimal 400 KiB.');
        }
      } else if (typeof value === 'string' && value.length > 20000) {
        throw new Error(`Field ${key} terlalu panjang.`);
      }
      if (['tanggal_mulai', 'tanggal_selesai', 'tanggal_surat', 'masuk_kembali_tanggal', 'ditangguhkan_mulai', 'ditangguhkan_selesai'].includes(key)) {
        const timestamp = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + 'T00:00:00Z') : NaN;
        if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error(`Field ${key} harus tanggal YYYY-MM-DD yang valid.`);
      }
      if (key === 'status_persetujuan' && !statuses.has(value)) throw new Error('Status persetujuan tidak valid.');
    }
    if (req.body.tanggal_mulai && req.body.tanggal_selesai && req.body.tanggal_selesai < req.body.tanggal_mulai) throw new Error('Tanggal selesai harus sama atau setelah tanggal mulai.');
    next();
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
module.exports = { validateRequest };
