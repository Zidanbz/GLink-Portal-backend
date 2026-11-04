const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('./db');
const { generatePdfFromData, generateHtmlTemplate } = require('./pdfGenerator');
const { generateDinasPdfFromData, generateDinasHtmlTemplate } = require('./pdfDinasGenerator');
const { generateCutiPdfFromData, generateCutiHtmlTemplate } = require('./pdfCutiGenerator');
const { previewDinasNumbers, issueDinas } = require('./dinasIssuance');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5101;
const HOST = process.env.HOST || '127.0.0.1';

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration for file uploads (Surat Dokter / Bukti)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'lampiran-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.use(cors({ exposedHeaders: ['Content-Disposition', 'X-Nomor-Surat', 'X-Nomor-Nota'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Helper to generate nomor surat
async function generateNomorSurat() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `IZN/${year}/${month}`;

  const [rows] = await pool.query(
    'SELECT nomor_surat FROM pengajuan_izin WHERE nomor_surat LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}/%`]
  );

  let seq = 1;
  if (rows.length > 0) {
    const lastNum = rows[0].nomor_surat.split('/').pop();
    const parsed = parseInt(lastNum, 10);
    if (!isNaN(parsed)) {
      seq = parsed + 1;
    }
  }

  return `${prefix}/${String(seq).padStart(3, '0')}`;
}

// --- ROUTES ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// GET all submissions with search, filter, and summary stats
app.get('/api/pengajuan', async (req, res) => {
  try {
    const { search, status, jenis } = req.query;
    let query = 'SELECT * FROM pengajuan_izin WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (nama LIKE ? OR jabatan LIKE ? OR nomor_surat LIKE ? OR alasan LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    if (status && status !== 'Semua') {
      query += ' AND status_persetujuan = ?';
      params.push(status);
    }

    if (jenis && jenis !== 'Semua') {
      query += ' AND jenis_izin = ?';
      params.push(jenis);
    }

    query += ' ORDER BY id DESC';

    const [rows] = await pool.query(query, params);

    // Calculate stats
    const [statsRows] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status_persetujuan = 'Menunggu Persetujuan' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status_persetujuan = 'Disetujui' THEN 1 ELSE 0 END) as disetujui,
        SUM(CASE WHEN status_persetujuan = 'Ditangguhkan' THEN 1 ELSE 0 END) as ditangguhkan,
        SUM(CASE WHEN status_persetujuan = 'Ditolak' THEN 1 ELSE 0 END) as ditolak
      FROM pengajuan_izin
    `);

    res.json({
      success: true,
      data: rows,
      stats: statsRows[0] || { total: 0, pending: 0, disetujui: 0, ditangguhkan: 0, ditolak: 0 }
    });
  } catch (error) {
    console.error('Error fetching pengajuan:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single submission
app.get('/api/pengajuan/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pengajuan_izin WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data pengajuan tidak ditemukan' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching detail pengajuan:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST new submission (Form submission)
app.post('/api/pengajuan', upload.single('surat_dokter'), async (req, res) => {
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
    const surat_dokter_url = req.file ? `/uploads/${req.file.filename}` : null;
    const finalTanggalSurat = tanggal_surat || new Date().toISOString().split('T')[0];

    const [result] = await pool.query(
      `INSERT INTO pengajuan_izin (
        nomor_surat, nama, id_karyawan, jabatan, jenis_izin, kategori_alasan, alasan,
        tanggal_mulai, tanggal_selesai, masuk_kembali_tanggal,
        surat_dokter_url, tanda_tangan_pemohon, status_persetujuan, tanggal_surat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Menunggu Persetujuan', ?)`,
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
        finalTanggalSurat
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
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST generate PDF directly from form data, save to MySQL, and trigger immediate download
app.post('/api/generate-pdf', upload.single('surat_dokter'), async (req, res) => {
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
    const surat_dokter_url = req.file ? `/uploads/${req.file.filename}` : null;
    let suratDokterBase64 = null;
    if (req.file) {
      try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const mime = req.file.mimetype || 'image/jpeg';
        suratDokterBase64 = `data:${mime};base64,${fileBuffer.toString('base64')}`;
      } catch (err) {
        console.error('Error reading uploaded doctor note:', err);
      }
    }

    const finalTanggalSurat = tanggal_surat || new Date().toISOString().split('T')[0];
    const finalStatus = status_persetujuan || 'Menunggu Persetujuan';

    const [result] = await pool.query(
      `INSERT INTO pengajuan_izin (
        nomor_surat, nama, id_karyawan, jabatan, jenis_izin, kategori_alasan, alasan,
        tanggal_mulai, tanggal_selesai, masuk_kembali_tanggal,
        surat_dokter_url, tanda_tangan_pemohon, status_persetujuan, tanggal_surat,
        nama_atasan, tanda_tangan_atasan, nama_hrd, paraf_hrd, alasan_atasan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ success: false, message: error.message });
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

    const [existing] = await pool.query('SELECT * FROM pengajuan_izin WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan.' });
    }

    await pool.query(
      `UPDATE pengajuan_izin SET 
        status_persetujuan = ?,
        ditangguhkan_mulai = ?,
        ditangguhkan_selesai = ?,
        alasan_atasan = ?,
        nama_atasan = ?,
        tanda_tangan_atasan = COALESCE(?, tanda_tangan_atasan),
        nama_hrd = ?,
        paraf_hrd = COALESCE(?, paraf_hrd)
      WHERE id = ?`,
      [
        status_persetujuan,
        ditangguhkan_mulai || null,
        ditangguhkan_selesai || null,
        alasan_atasan || null,
        nama_atasan || null,
        tanda_tangan_atasan || null,
        nama_hrd || 'HRD',
        paraf_hrd || null,
        id
      ]
    );

    res.json({ success: true, message: 'Status persetujuan berhasil diperbarui.' });
  } catch (error) {
    console.error('Error updating approval:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE submission
app.delete('/api/pengajuan/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM pengajuan_izin WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan.' });
    }

    if (existing[0].surat_dokter_url) {
      const filePath = path.join(__dirname, existing[0].surat_dokter_url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await pool.query('DELETE FROM pengajuan_izin WHERE id = ?', [id]);
    res.json({ success: true, message: 'Pengajuan izin berhasil dihapus.' });
  } catch (error) {
    console.error('Error deleting pengajuan:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET PDF generation
app.get('/api/pengajuan/:id/pdf', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pengajuan_izin WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).send('Data tidak ditemukan');
    }

    const item = rows[0];
    const pdfBuffer = await generatePdfFromData(item);

    const filename = `Surat_Izin_${(item.nama || 'karyawan').replace(/\s+/g, '_')}_${item.nomor_surat.replace(/\//g, '-')}.pdf`;
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send('Gagal membuat PDF: ' + error.message);
  }
});

// GET HTML Preview
app.get('/api/pengajuan/:id/preview-html', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pengajuan_izin WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).send('Data tidak ditemukan');
    }

    const html = generateHtmlTemplate(rows[0]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error generating HTML preview:', error);
    res.status(500).send('Gagal memuat preview: ' + error.message);
  }
});

// ==========================================
// PENGAJUAN DINAS ENDPOINTS & HELPERS
// ==========================================

// GET all pengajuan dinas
app.get('/api/pengajuan-dinas', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pengajuan_dinas ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching pengajuan dinas:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET next document numbers for dinas
app.get('/api/pengajuan-dinas/nomor-terbaru', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...await previewDinasNumbers(pool) });
  } catch (error) {
    console.error('Error generating latest dinas numbers:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single pengajuan dinas
app.get('/api/pengajuan-dinas/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pengajuan_dinas WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching single dinas:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create / save pengajuan dinas
app.post('/api/pengajuan-dinas', async (req, res) => {
  try {
    const { data, id } = await issueDinas(pool, req.body);
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
    res.status(500).json({ success: false, message: error.message });
  }
});



// POST generate PDF for download (on the fly from form body)
app.post('/api/pengajuan-dinas/generate-pdf', async (req, res) => {
  try {
    const { data, pdfBuffer } = await issueDinas(pool, req.body, generateDinasPdfFromData);
    const safeName = (data.penerima_tugas_nama || 'karyawan').replace(/\s+/g, '_');
    const safeDoc = (data.nomor_surat || 'STD').replace(/\//g, '-');
    const filename = `Surat_Tugas_Dinas_${safeName}_${safeDoc}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating dinas PDF:', error);
    res.status(500).send('Gagal membuat PDF: ' + error.message);
  }
});

// POST preview PDF (stream inline on the fly from form body)
app.post('/api/pengajuan-dinas/preview-pdf', async (req, res) => {
  try {
    const data = { ...req.body, ...await previewDinasNumbers(pool) };

    const pdfBuffer = await generateDinasPdfFromData(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview_dinas.pdf"');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error previewing dinas PDF:', error);
    res.status(500).send('Gagal membuat preview PDF: ' + error.message);
  }
});

// ==========================================
// PENGAJUAN CUTI ROUTES
// ==========================================

// GET all pengajuan cuti
app.get('/api/pengajuan-cuti', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pengajuan_cuti ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching pengajuan cuti:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single pengajuan cuti
app.get('/api/pengajuan-cuti/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pengajuan_cuti WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching single cuti:', error);
    res.status(500).json({ success: false, message: error.message });
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
    const [result] = await pool.query(
      `INSERT INTO pengajuan_cuti (
        nomor_surat, nama, id_karyawan, jabatan, jenis_cuti,
        alasan, tanggal_mulai, tanggal_selesai, hari_tanggal, masuk_kembali_tanggal,
        hak_cuti, cuti_sudah_diambil, cuti_belum_diambil, cuti_akan_diambil, sisa_cuti,
        penerima_amanah_nama, penerima_amanah_jabatan, nama_atasan, jabatan_atasan,
        tanda_tangan_pemohon, tanda_tangan_atasan, status_persetujuan, tanggal_surat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    res.status(500).json({ success: false, message: error.message });
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
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating cuti PDF:', error);
    res.status(500).send('Gagal membuat PDF: ' + error.message);
  }
});

// POST preview PDF (stream inline on the fly)
app.post('/api/pengajuan-cuti/preview-pdf', validateCutiRequest, async (req, res) => {
  try {
    const data = req.body;
    const pdfBuffer = await generateCutiPdfFromData(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview_cuti.pdf"');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error previewing cuti PDF:', error);
    res.status(500).send('Gagal membuat preview PDF: ' + error.message);
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Backend server running on http://${HOST}:${PORT}`);
});
