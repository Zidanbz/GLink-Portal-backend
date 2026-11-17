const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { singleAttachment } = require('./multipart');
const store = require('./repositories');
const attachments = require('./attachments');
const { backendAccess } = require('./security');
const { validateRequest } = require('./validation');
const { generatePdfFromData, generateHtmlTemplate } = require('./pdfGenerator');
const { generateDinasPdfFromData, generateDinasHtmlTemplate } = require('./pdfDinasGenerator');
const { generateCutiPdfFromData, generateCutiHtmlTemplate } = require('./pdfCutiGenerator');
const { previewDinasNumbers, issueDinas } = require('./dinasIssuance');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5101;
const HOST = process.env.HOST || '127.0.0.1';

// Memory uploads are persisted to Storage, never to Vercel's deployment disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 40, fieldSize: 900 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) {
      return cb(Object.assign(new Error('Lampiran harus JPG, PNG, WEBP, atau PDF.'), { status: 400 }));
    }
    cb(null, true);
  },
});
app.disable('x-powered-by');
app.use(backendAccess);
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(cors({ origin: false, exposedHeaders: ['Content-Disposition', 'X-Nomor-Surat', 'X-Nomor-Nota'] }));
app.use(express.json({ limit: process.env.VERCEL ? '4mb' : '50mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.VERCEL ? '4mb' : '50mb' }));
app.use(validateRequest);

app.get('/uploads/:filename', async (req, res, next) => {
  try {
    const file = await attachments.read(req.params.filename);
    res.type(file.contentType).send(file.buffer);
  } catch (error) { next(error); }
});
app.use('/assets', express.static(path.join(__dirname, 'assets')));

async function generateNomorSurat() {
  const { issuanceDate } = require('./dinasIssuance');
  const [year, month] = issuanceDate().split('-');
  return store.nextIzinNumber(`IZN/${year}/${month}`);
}
function pageOptions(query) {
  const limit = Number(query.limit || 100);
  const before = query.before;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 ||
      (before !== undefined && (!/^\d+$/.test(String(before)) || !Number.isSafeInteger(Number(before)) || Number(before) < 1))) {
    throw Object.assign(new Error('Parameter pagination tidak valid.'), { status: 400 });
  }
  for (const key of ['search', 'status', 'jenis']) {
    if (query[key] !== undefined && (typeof query[key] !== 'string' || query[key].length > 200)) {
      throw Object.assign(new Error('Filter tidak valid.'), { status: 400 });
    }
  }
  return { search: query.search, status: query.status, jenis: query.jenis, limit, before };
}

// --- ROUTES ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// GET all submissions with search, filter, and summary stats
app.get('/api/pengajuan', async (req, res) => {
  try {
    const [{ rows, nextCursor }, stats] = await Promise.all([
      store.list('pengajuan_izin', pageOptions(req.query)), store.stats(),
    ]);
    res.json({ success: true, data: rows, stats, nextCursor });
  } catch (error) {
    console.error('Error fetching pengajuan:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// GET single submission
app.get('/api/pengajuan/:id', async (req, res) => {
  try {
    const item = await store.get('pengajuan_izin', req.params.id);
    const rows = item ? [item] : [];
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data pengajuan tidak ditemukan' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching detail pengajuan:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// POST new submission (Form submission)
app.post('/api/pengajuan', singleAttachment(upload), validateRequest, async (req, res) => {
  try {
    const {
      nama,
      id_karyawan,
      jabatan,
      jenis_izin,
      kategori_alasan,
      alasan,
      tanggal_mulai,
      tanggal_selesai,
      masuk_kembali_tanggal,
      tanda_tangan_pemohon,
      tanggal_surat
    } = req.body;

    if (!nama || !jabatan || !jenis_izin || !alasan || !tanggal_mulai || !tanggal_selesai || !masuk_kembali_tanggal) {
      return res.status(400).json({ success: false, message: 'Harap lengkapi semua field yang wajib diisi.' });
    }

    const nomor_surat = await generateNomorSurat();
    const surat_dokter_url = req.file ? await attachments.save(req.file) : null;
    const finalTanggalSurat = tanggal_surat || new Date().toISOString().split('T')[0];

    const result = await store.insert('pengajuan_izin', ['nomor_surat', 'nama', 'id_karyawan', 'jabatan', 'jenis_izin', 'kategori_alasan', 'alasan', 'tanggal_mulai', 'tanggal_selesai', 'masuk_kembali_tanggal', 'surat_dokter_url', 'tanda_tangan_pemohon', 'tanggal_surat', 'status_persetujuan'],
      [
        nomor_surat,
        nama,
        id_karyawan || null,
        jabatan,
        jenis_izin,
        kategori_alasan || null,
        alasan,
        tanggal_mulai,
        tanggal_selesai,
        masuk_kembali_tanggal,
        surat_dokter_url,
        tanda_tangan_pemohon || null,
        finalTanggalSurat,
        'Menunggu Persetujuan'
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Pengajuan izin berhasil dibuat',
      data: {
        id: result.insertId,
        nomor_surat
      }
    });
  } catch (error) {
    console.error('Error creating pengajuan:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// POST generate PDF directly from form data, save to MySQL, and trigger immediate download
app.post('/api/generate-pdf', singleAttachment(upload), validateRequest, async (req, res) => {
  try {
    const {
      nama,
      id_karyawan,
      jabatan,
      jenis_izin,
      kategori_alasan,
      alasan,
      tanggal_mulai,
      tanggal_selesai,
      masuk_kembali_tanggal,
      tanda_tangan_pemohon,
      tanggal_surat,
      status_persetujuan,
      nama_atasan,
      tanda_tangan_atasan,
      nama_hrd,
      paraf_hrd,
      alasan_atasan
    } = req.body;

    if (!nama || !jabatan || !jenis_izin || !alasan || !tanggal_mulai || !tanggal_selesai || !masuk_kembali_tanggal) {
      return res.status(400).json({ success: false, message: 'Harap lengkapi semua field yang wajib diisi.' });
    }

    const nomor_surat = await generateNomorSurat();
    const surat_dokter_url = req.file ? await attachments.save(req.file) : null;
    let suratDokterBase64 = null;
    if (req.file && req.file.mimetype.startsWith('image/')) {
      try {
        const fileBuffer = req.file.buffer;
        const mime = req.file.mimetype || 'image/jpeg';
        suratDokterBase64 = `data:${mime};base64,${fileBuffer.toString('base64')}`;
      } catch (err) {
        console.error('Error reading uploaded doctor note:', err);
      }
    }

    const finalTanggalSurat = tanggal_surat || new Date().toISOString().split('T')[0];
    const finalStatus = status_persetujuan || 'Menunggu Persetujuan';

    const result = await store.insert('pengajuan_izin', ['nomor_surat', 'nama', 'id_karyawan', 'jabatan', 'jenis_izin', 'kategori_alasan', 'alasan', 'tanggal_mulai', 'tanggal_selesai', 'masuk_kembali_tanggal', 'surat_dokter_url', 'tanda_tangan_pemohon', 'status_persetujuan', 'tanggal_surat', 'nama_atasan', 'tanda_tangan_atasan', 'nama_hrd', 'paraf_hrd', 'alasan_atasan'],
      [
        nomor_surat,
        nama,
        id_karyawan || null,
        jabatan,
        jenis_izin,
        kategori_alasan || null,
        alasan,
        tanggal_mulai,
        tanggal_selesai,
        masuk_kembali_tanggal,
        surat_dokter_url,
        tanda_tangan_pemohon || null,
        finalStatus,
        finalTanggalSurat,
        nama_atasan || null,
        tanda_tangan_atasan || null,
        nama_hrd || 'HRD',
        paraf_hrd || null,
        alasan_atasan || null
      ]
    );

    const docData = {
      id: result.insertId,
      nomor_surat,
      nama,
      id_karyawan: id_karyawan || null,
      jabatan,
      jenis_izin,
      kategori_alasan,
      alasan,
      tanggal_mulai,
      tanggal_selesai,
      masuk_kembali_tanggal,
      tanda_tangan_pemohon,
      status_persetujuan: finalStatus,
      tanggal_surat: finalTanggalSurat,
      nama_atasan,
      tanda_tangan_atasan,
      nama_hrd: nama_hrd || 'HRD',
      paraf_hrd,
      alasan_atasan,
      surat_dokter_url,
      surat_dokter_base64: suratDokterBase64
    };

    const pdfBuffer = await generatePdfFromData(docData);

    const safeName = (nama || 'karyawan').replace(/[^a-zA-Z0-9]/g, '_');
    const safeNomor = nomor_surat.replace(/[^a-zA-Z0-9]/g, '-');
    const filename = `Surat_Izin_${safeName}_${safeNomor}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Nomor-Surat, X-Submission-Id');
    res.setHeader('X-Nomor-Surat', nomor_surat);
    res.setHeader('X-Submission-Id', result.insertId);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});


// PUT Approval action (Persetujuan Atasan & HRD)
app.put('/api/pengajuan/:id/approval', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status_persetujuan,
      ditangguhkan_mulai,
      ditangguhkan_selesai,
      alasan_atasan,
      nama_atasan,
      tanda_tangan_atasan,
      nama_hrd,
      paraf_hrd
    } = req.body;

    if (!status_persetujuan) {
      return res.status(400).json({ success: false, message: 'Status persetujuan wajib ditentukan.' });
    }

    const item = await store.get('pengajuan_izin', id);
    const existing = item ? [item] : [];
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan.' });
    }

    if (!['Menunggu Persetujuan', 'Disetujui', 'Ditangguhkan', 'Ditolak'].includes(status_persetujuan)) {
      return res.status(400).json({ success: false, message: 'Status persetujuan tidak valid.' });
    }
    await store.updateApproval(id, {
      status_persetujuan,
      ditangguhkan_mulai: ditangguhkan_mulai || null,
      ditangguhkan_selesai: ditangguhkan_selesai || null,
      alasan_atasan: alasan_atasan || null,
      nama_atasan: nama_atasan || null,
      tanda_tangan_atasan: tanda_tangan_atasan || null,
      nama_hrd: nama_hrd || 'HRD',
      paraf_hrd: paraf_hrd || null,
    });

    res.json({ success: true, message: 'Status persetujuan berhasil diperbarui.' });
  } catch (error) {
    console.error('Error updating approval:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// DELETE submission
app.delete('/api/pengajuan/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await store.get('pengajuan_izin', id);
    const existing = item ? [item] : [];
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan.' });
    }

    if (existing[0].surat_dokter_url) await attachments.remove(existing[0].surat_dokter_url);
    await store.remove('pengajuan_izin', id);
    res.json({ success: true, message: 'Pengajuan izin berhasil dihapus.' });
  } catch (error) {
    console.error('Error deleting pengajuan:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// GET PDF generation
app.get('/api/pengajuan/:id/pdf', async (req, res) => {
  try {
    const item = await store.get('pengajuan_izin', req.params.id);
    const rows = item ? [item] : [];
    if (rows.length === 0) {
      return res.status(404).send('Data tidak ditemukan');
    }

    const docData = await attachments.hydrate(rows[0]);
    const pdfBuffer = await generatePdfFromData(docData);

    const filename = `Surat_Izin_${(docData.nama || 'karyawan').replace(/\s+/g, '_')}_${docData.nomor_surat.replace(/\//g, '-')}.pdf`;
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(error.status || 500).send(error.status ? error.message : 'Gagal membuat PDF: Silakan coba lagi.');
  }
});

// GET HTML Preview
app.get('/api/pengajuan/:id/preview-html', async (req, res) => {
  try {
    const item = await store.get('pengajuan_izin', req.params.id);
    const rows = item ? [item] : [];
    if (rows.length === 0) {
      return res.status(404).send('Data tidak ditemukan');
    }

    const html = generateHtmlTemplate(await attachments.hydrate(rows[0]));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error generating HTML preview:', error);
    res.status(error.status || 500).send(error.status ? error.message : 'Gagal memuat preview: Silakan coba lagi.');
  }
});

// ==========================================
// PENGAJUAN DINAS ENDPOINTS & HELPERS
// ==========================================

// GET all pengajuan dinas
app.get('/api/pengajuan-dinas', async (req, res) => {
  try {
    const { rows, nextCursor } = await store.list('pengajuan_dinas', pageOptions(req.query));
    res.json({ success: true, data: rows, nextCursor });
  } catch (error) {
    console.error('Error fetching pengajuan dinas:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// GET next document numbers for dinas
app.get('/api/pengajuan-dinas/nomor-terbaru', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...await previewDinasNumbers(store.provider === 'mysql' ? store.pool : store) });
  } catch (error) {
    console.error('Error generating latest dinas numbers:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// GET single pengajuan dinas
app.get('/api/pengajuan-dinas/:id', async (req, res) => {
  try {
    const item = await store.get('pengajuan_dinas', req.params.id);
    const rows = item ? [item] : [];
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching single dinas:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// POST create / save pengajuan dinas
app.post('/api/pengajuan-dinas', async (req, res) => {
  try {
    const { data, id } = await issueDinas(store, req.body);
    const { nomor_surat, nomor_nota } = data;

    res.json({
      success: true,
      message: 'Pengajuan dinas berhasil disimpan.',
      id,
      nomor_surat,
      nomor_nota
    });
  } catch (error) {
    console.error('Error saving pengajuan dinas:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});



// POST generate PDF for download (on the fly from form body)
app.post('/api/pengajuan-dinas/generate-pdf', async (req, res) => {
  try {
    const { data, pdfBuffer } = await issueDinas(store, req.body, generateDinasPdfFromData);
    const safeName = (data.penerima_tugas_nama || 'karyawan').replace(/\s+/g, '_');
    const safeDoc = (data.nomor_surat || 'STD').replace(/\//g, '-');
    const filename = `Surat_Tugas_Dinas_${safeName}_${safeDoc}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error generating dinas PDF:', error);
    res.status(error.status || 500).send(error.status ? error.message : 'Gagal membuat PDF: Silakan coba lagi.');
  }
});

// POST preview PDF (stream inline on the fly from form body)
app.post('/api/pengajuan-dinas/preview-pdf', async (req, res) => {
  try {
    const data = { ...req.body, ...await previewDinasNumbers(store.provider === 'mysql' ? store.pool : store) };

    const pdfBuffer = await generateDinasPdfFromData(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview_dinas.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error previewing dinas PDF:', error);
    res.status(error.status || 500).send(error.status ? error.message : 'Gagal membuat preview PDF: Silakan coba lagi.');
  }
});

// ==========================================
// PENGAJUAN CUTI ROUTES
// ==========================================

// GET all pengajuan cuti
app.get('/api/pengajuan-cuti', async (req, res) => {
  try {
    const { rows, nextCursor } = await store.list('pengajuan_cuti', pageOptions(req.query));
    res.json({ success: true, data: rows, nextCursor });
  } catch (error) {
    console.error('Error fetching pengajuan cuti:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// GET single pengajuan cuti
app.get('/api/pengajuan-cuti/:id', async (req, res) => {
  try {
    const item = await store.get('pengajuan_cuti', req.params.id);
    const rows = item ? [item] : [];
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching single cuti:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// Validate every cuti write/PDF request and derive duration from calendar dates.
function validateCutiRequest(req, res, next) {
  const data = req.body;
  if (!data || typeof data.id_karyawan !== 'string' || !data.id_karyawan.trim()) {
    return res.status(400).json({ success: false, message: 'ID Karyawan wajib diisi.' });
  }
  const parseDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const timestamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
  };
  const start = parseDate(data.tanggal_mulai);
  const end = parseDate(data.tanggal_selesai);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return res.status(400).json({ success: false, message: 'Rentang tanggal cuti tidak valid.' });
  }
  data.id_karyawan = data.id_karyawan.trim();
  data.cuti_akan_diambil = (end - start) / 86400000 + 1;
  data.sisa_cuti = Math.max(0, (Number(data.cuti_belum_diambil) || 0) - data.cuti_akan_diambil);
  next();
}

// POST save pengajuan cuti
app.post('/api/pengajuan-cuti', validateCutiRequest, async (req, res) => {
  try {
    const data = req.body;
    const result = await store.insert('pengajuan_cuti', ['nomor_surat', 'nama', 'id_karyawan', 'jabatan', 'jenis_cuti', 'alasan', 'tanggal_mulai', 'tanggal_selesai', 'hari_tanggal', 'masuk_kembali_tanggal', 'hak_cuti', 'cuti_sudah_diambil', 'cuti_belum_diambil', 'cuti_akan_diambil', 'sisa_cuti', 'penerima_amanah_nama', 'penerima_amanah_jabatan', 'nama_atasan', 'jabatan_atasan', 'tanda_tangan_pemohon', 'tanda_tangan_atasan', 'status_persetujuan', 'tanggal_surat'],
      [
        data.nomor_surat || null,
        data.nama || '',
        data.id_karyawan || null,
        data.jabatan || '',
        data.jenis_cuti || 'Cuti Tahunan',
        data.alasan || '',
        data.tanggal_mulai,
        data.tanggal_selesai,
        data.hari_tanggal || null,
        data.masuk_kembali_tanggal,
        data.hak_cuti !== undefined ? data.hak_cuti : 12,
        data.cuti_sudah_diambil !== undefined ? data.cuti_sudah_diambil : 0,
        data.cuti_belum_diambil !== undefined ? data.cuti_belum_diambil : 12,
        data.cuti_akan_diambil !== undefined ? data.cuti_akan_diambil : 1,
        data.sisa_cuti !== undefined ? data.sisa_cuti : 11,
        data.penerima_amanah_nama || null,
        data.penerima_amanah_jabatan || null,
        data.nama_atasan || null,
        data.jabatan_atasan || null,
        data.tanda_tangan_pemohon || null,
        data.tanda_tangan_atasan || null,
        data.status_persetujuan || 'Menunggu Persetujuan',
        data.tanggal_surat || new Date().toISOString().split('T')[0]
      ]
    );

    res.json({
      success: true,
      message: 'Pengajuan cuti berhasil disimpan.',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error saving pengajuan cuti:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Operasi gagal. Silakan coba lagi.' });
  }
});

// POST generate PDF for download (on the fly)
app.post('/api/pengajuan-cuti/generate-pdf', validateCutiRequest, async (req, res) => {
  try {
    const data = req.body;
    const pdfBuffer = await generateCutiPdfFromData(data);
    const safeName = (data.nama || 'karyawan').replace(/\s+/g, '_');
    const filename = `Formulir_Pengajuan_Cuti_${safeName}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error generating cuti PDF:', error);
    res.status(error.status || 500).send(error.status ? error.message : 'Gagal membuat PDF: Silakan coba lagi.');
  }
});

// POST preview PDF (stream inline on the fly)
app.post('/api/pengajuan-cuti/preview-pdf', validateCutiRequest, async (req, res) => {
  try {
    const data = req.body;
    const pdfBuffer = await generateCutiPdfFromData(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview_cuti.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error previewing cuti PDF:', error);
    res.status(error.status || 500).send(error.status ? error.message : 'Gagal membuat preview PDF: Silakan coba lagi.');
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = ['LIMIT_FILE_SIZE', 'LIMIT_FIELD_VALUE'].includes(error.code) ? 413 : error.status || (error.code === 404 ? 404 : 500);
  console.error('Request failed:', error.code || error.name);
  res.status(status).json({ success: false, message: status === 413 ? 'Ukuran upload/data terlalu besar. Lampiran maksimal 2 MB.' : status < 500 ? error.message : 'Operasi gagal. Silakan coba lagi.' });
});
if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, HOST, () => console.log(`Backend server running on http://${HOST}:${PORT}`));
}
module.exports = app;
