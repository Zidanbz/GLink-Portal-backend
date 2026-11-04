const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { browserOptions } = require('./browserOptions');
const dayjs = require('dayjs');
require('dayjs/locale/id');

dayjs.locale('id');

const headerImgBase64 = fs.readFileSync(path.join(__dirname, 'assets', 'header.png')).toString('base64');
const footerImgBase64 = fs.readFileSync(path.join(__dirname, 'assets', 'footer.png')).toString('base64');

function formatDateIndo(dateStr) {
  if (!dateStr) return '';
  const d = dayjs(dateStr);
  return d.isValid() ? d.format('DD MMMM YYYY') : dateStr;
}

function formatDateRange(startDate, endDate) {
  if (!startDate) return '';
  const s = dayjs(startDate);
  const e = dayjs(endDate);
  if (!s.isValid()) return startDate;
  if (!e.isValid() || s.isSame(e, 'day')) {
    return s.format('DD MMMM YYYY');
  }
  if (s.format('MMMM YYYY') === e.format('MMMM YYYY')) {
    return `${s.format('DD')} s.d. ${e.format('DD MMMM YYYY')}`;
  }
  return `${s.format('DD MMMM YYYY')} s.d. ${e.format('DD MMMM YYYY')}`;
}

function generateHtmlTemplate(data) {
  const isSakit = data.jenis_izin === 'Izin Sakit';
  const lampiranJudul = isSakit ? 'LAMPIRAN: SURAT KETERANGAN DOKTER' : 'LAMPIRAN: SURAT KETERANGAN';
  const isUpah = data.jenis_izin === 'Izin tidak masuk kerja' || data.jenis_izin === 'Izin tidak masuk kerja dengan menerimah upah';

  const isApproved = data.status_persetujuan === 'Disetujui';
  const isPostponed = data.status_persetujuan === 'Ditangguhkan';
  const isRejected = data.status_persetujuan === 'Ditolak';

  let ditangguhkanText = 'Ditangguhkan menjadi tanggal ……….. S.d……………';
  if (isPostponed && data.ditangguhkan_mulai && data.ditangguhkan_selesai) {
    ditangguhkanText = `Ditangguhkan menjadi tanggal ${formatDateIndo(data.ditangguhkan_mulai)} S.d ${formatDateIndo(data.ditangguhkan_selesai)}`;
  }

  const tanggalIzinFormatted = formatDateRange(data.tanggal_mulai, data.tanggal_selesai);
  const masukKembaliFormatted = formatDateIndo(data.masuk_kembali_tanggal);
  const tanggalSuratObj = data.tanggal_surat ? dayjs(data.tanggal_surat) : dayjs();
  const tanggalSuratFormatted = tanggalSuratObj.isValid() ? tanggalSuratObj.format('DD MMMM YYYY') : dayjs().format('DD MMMM YYYY');

  let suratDokterSrc = null;
  if (data.surat_dokter_base64) {
    suratDokterSrc = data.surat_dokter_base64;
  } else if (data.surat_dokter_url) {
    if (data.surat_dokter_url.startsWith('data:')) {
      suratDokterSrc = data.surat_dokter_url;
    } else {
      const filename = path.basename(data.surat_dokter_url);
      const localUploadPath = path.join(__dirname, 'uploads', filename);
      if (fs.existsSync(localUploadPath)) {
        const ext = path.extname(filename).toLowerCase().replace('.', '');
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        const fileData = fs.readFileSync(localUploadPath).toString('base64');
        suratDokterSrc = `data:${mime};base64,${fileData}`;
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Surat Ijin - ${data.nama || 'Formulir'}</title>
  <style>
    @page {
      size: letter;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #fff;
      font-family: 'Calibri', 'Arial', sans-serif;
      font-size: 10.5pt;
      line-height: 1.25;
      color: #000;
    }
    .page-container {
      width: 100%;
      height: 100vh;
      min-height: 100vh;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    .content-area {
      padding: 10mm 15mm 0 15mm;
      flex: 1;
    }
    .header-banner {
      width: 100%;
      text-align: right;
      margin-bottom: 10px;
    }
    .header-banner img {
      height: 48px;
      width: auto;
      object-fit: contain;
      display: inline-block;
    }
    .doc-title {
      text-align: center;
      font-size: 15pt;
      font-weight: bold;
      letter-spacing: 0.5px;
      margin-top: 4px;
      margin-bottom: 12px;
      text-transform: uppercase;
    }
    
    /* Table matching Word layout */
    .form-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 6px;
    }
    .form-table td {
      padding: 2.5px 3px;
      vertical-align: top;
      font-size: 10.5pt;
    }
    .label-col {
      width: 220px;
      font-weight: bold;
    }
    .sep-col {
      width: 18px;
      text-align: center;
      font-weight: bold;
    }
    .val-col {
      border-bottom: 1px solid #000;
      min-height: 18px;
      padding-left: 4px;
      font-weight: normal;
    }
    .checkbox-box {
      width: 15px;
      height: 15px;
      border: 1.2px solid #000;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: bold;
      margin-right: 8px;
      vertical-align: middle;
      background-color: #fff;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      margin-bottom: 3.5px;
    }
    .checkbox-label {
      font-size: 10.5pt;
    }

    /* Rules Guideline Table */
    .rules-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      margin-bottom: 10px;
    }
    .rules-table th, .rules-table td {
      border: 1px solid #000;
      padding: 3px 6px;
      font-size: 9.8pt;
    }
    .rules-table th {
      font-weight: bold;
      text-align: center;
      background-color: #f7f7f7;
    }
    .rules-table th.col-alasan {
      width: 70%;
      text-align: center;
    }
    .rules-table th.col-izin {
      width: 30%;
      text-align: center;
    }
    .rules-table td.col-izin {
      text-align: center;
    }

    /* Approval Section */
    .approval-section {
      margin-top: 6px;
      font-size: 10pt;
    }
    .approval-header {
      font-size: 10pt;
      margin-bottom: 6px;
    }
    .approval-table {
      width: 100%;
      border-collapse: collapse;
    }
    .approval-table td {
      padding: 2px 3px;
      vertical-align: top;
      font-size: 10pt;
    }
    .alasan-atasan-line {
      border-bottom: 1px solid #000;
      min-height: 18px;
      display: inline-block;
      width: 75%;
      margin-left: 6px;
      padding-left: 6px;
    }

    .note-text {
      font-size: 8.5pt;
      font-style: normal;
      margin-top: 8px;
      margin-bottom: 10px;
      line-height: 1.3;
    }

    /* Signatures Section */
    .signature-area {
      width: 100%;
      margin-top: 6px;
      margin-bottom: 10px;
    }
    .date-row {
      text-align: right;
      padding-right: 35px;
      font-size: 10pt;
      margin-bottom: 4px;
    }
    .sign-table {
      width: 100%;
      border-collapse: collapse;
    }
    .sign-table td {
      vertical-align: top;
      font-size: 10pt;
      text-align: center;
    }
    .sign-col-1 {
      width: 50%;
    }
    .sign-col-2 {
      width: 50%;
    }
    .sign-space {
      height: 75px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sign-space img {
      max-height: 70px;
      max-width: 220px;
      object-fit: contain;
    }
    .sign-name {
      border-bottom: 1px solid #000;
      display: inline-block;
      min-width: 180px;
      font-weight: bold;
      padding: 0 5px;
    }

    /* Footer Banner - flush at bottom edge-to-edge */
    .footer-banner {
      width: 100%;
      margin: 0;
      padding: 0;
      line-height: 0;
    }
    .footer-banner img {
      width: 100%;
      height: auto;
      display: block;
      margin: 0;
      padding: 0;
    }

    /* Page 2 - Lampiran Surat Dokter */
    .page-break {
      page-break-before: always;
      break-before: page;
    }
    .lampiran-meta {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 6px 12px;
      margin-bottom: 12px;
    }
    .lampiran-frame {
      width: 100%;
      height: 640px;
      max-height: 640px;
      border: 1px dashed #94a3b8;
      border-radius: 6px;
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      box-sizing: border-box;
      overflow: hidden;
    }
    .lampiran-img {
      max-width: 100%;
      max-height: 620px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="page-container">
    <div class="content-area">
      <!-- Header Banner -->
      <div class="header-banner">
        <img src="data:image/png;base64,${headerImgBase64}" alt="Globallink Header">
      </div>

      <!-- Title -->
      <div class="doc-title">FORMULIR PENGAJUAN IZIN</div>

      <!-- Main Form Fields -->
      <table class="form-table">
        <tr>
          <td class="label-col">NAMA</td>
          <td class="sep-col">:</td>
          <td class="val-col">${data.nama || ''}</td>
        </tr>
        <tr>
          <td class="label-col">ID KARYAWAN</td>
          <td class="sep-col">:</td>
          <td class="val-col">${data.id_karyawan || ''}</td>
        </tr>
        <tr>
          <td class="label-col">JABATAN</td>
          <td class="sep-col">:</td>
          <td class="val-col">${data.jabatan || ''}</td>
        </tr>
        <tr>
          <td style="padding: 2px;"></td>
          <td></td>
          <td></td>
        </tr>
        <tr>
          <td class="label-col">
            JENIS IZIN<br>
            <span style="font-weight: normal; font-size: 9.5pt; color: #111;">( Diisi oleh Atasan Langsung )</span>
          </td>
          <td class="sep-col">:</td>
          <td>
            <div class="checkbox-row">
              <span class="checkbox-box">${isSakit ? '✓' : ''}</span>
              <span class="checkbox-label">Izin Sakit</span>
            </div>
            <div class="checkbox-row">
              <span class="checkbox-box">${isUpah ? '✓' : ''}</span>
              <span class="checkbox-label">Izin tidak masuk kerja</span>
            </div>
          </td>
        </tr>
        <tr>
          <td class="label-col">ALASAN</td>
          <td class="sep-col">:</td>
          <td class="val-col">${data.alasan || ''}</td>
        </tr>
        <tr>
          <td class="label-col">TANGGAL</td>
          <td class="sep-col">:</td>
          <td class="val-col">${tanggalIzinFormatted}</td>
        </tr>
        <tr>
          <td class="label-col">MASUK KEMBALI TANGGAL</td>
          <td class="sep-col">:</td>
          <td class="val-col">${masukKembaliFormatted}</td>
        </tr>
      </table>

      <!-- Guidelines Table -->
      <table class="rules-table">
        <thead>
          <tr>
            <th class="col-alasan">Alasan</th>
            <th class="col-izin">Izin</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>a. Pernikahan Karyawan</td><td class="col-izin">3 Hari</td></tr>
          <tr><td>b. Pernikahan anak Karyawan</td><td class="col-izin">2 Hari</td></tr>
          <tr><td>c. Khitanan/aqiqah/membaptis anak Karyawan</td><td class="col-izin">2 Hari</td></tr>
          <tr><td>d. Istri Karyawan Melahirkan</td><td class="col-izin">2 Hari</td></tr>
          <tr><td>e. Istri/Suami/anak Karyawan meninggal dunia</td><td class="col-izin">2 Hari</td></tr>
          <tr><td>f. Orang tua/mertua Karyawan meninggal dunia</td><td class="col-izin">2 Hari</td></tr>
          <tr><td>g. Saudara kandung meninggal dunia</td><td class="col-izin">2 Hari</td></tr>
          <tr><td>h. Kakek/nenek/cucu/menantu/ipar/orang serumah Karyawan meninggal dunia</td><td class="col-izin">2 Hari</td></tr>
          <tr><td>i. Ibadah Umroh</td><td class="col-izin">12 Hari</td></tr>
          <tr><td>j. Kejadian Force Majeure</td><td class="col-izin">Disesuaikan</td></tr>
        </tbody>
      </table>

      <!-- Persetujuan Atasan -->
      <div class="approval-section">
        <div class="approval-header">
          <strong>Persetujuan Atasan</strong> ( Diisi oleh Atasan Langsung )
        </div>
        <table class="approval-table">
          <tr>
            <td style="width: 220px;">Disetujui / Ditolak</td>
            <td style="width: 18px; text-align: center;">:</td>
            <td>
              <div class="checkbox-row">
                <span class="checkbox-box">${isApproved ? '✓' : ''}</span>
                <span class="checkbox-label">Disetujui</span>
              </div>
              <div class="checkbox-row">
                <span class="checkbox-box">${isPostponed ? '✓' : ''}</span>
                <span class="checkbox-label">${ditangguhkanText}</span>
              </div>
              <div class="checkbox-row">
                <span class="checkbox-box">${isRejected ? '✓' : ''}</span>
                <span class="checkbox-label">Ditolak</span>
              </div>
              <div style="margin-top: 4px;">
                <span>Alasan &nbsp;:</span>
                <span class="alasan-atasan-line">${data.alasan_atasan || ''}</span>
              </div>
            </td>
          </tr>
        </table>
      </div>

      <!-- Note -->
      <div class="note-text">
        <strong>Note:</strong> &nbsp;Apabila sakit formulir diisi setelah karyawan tersebut masuk kembali dengan melampirkan surat keterangan sakit dari dokter
      </div>

      <!-- Signatures Section -->
      <div class="signature-area">
        <div class="date-row">
          Makassar, ${tanggalSuratFormatted}
        </div>
        <table class="sign-table">
          <tr>
            <td class="sign-col-1">
              <div>Diajukan Oleh,</div>
              <div class="sign-space">
                ${data.tanda_tangan_pemohon ? `<img src="${data.tanda_tangan_pemohon}" alt="Ttd Pemohon" />` : ''}
              </div>
              <div class="sign-name">( ${data.nama || '................................'} )</div>
            </td>
            <td class="sign-col-2">
              <div>Disetujui Oleh,</div>
              <div class="sign-space">
                ${data.tanda_tangan_atasan ? `<img src="${data.tanda_tangan_atasan}" alt="Ttd Atasan" />` : ''}
              </div>
              <div class="sign-name">( ${data.nama_atasan || '................................'} )</div>
            </td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Footer Banner: Flush at the absolute bottom, edge to edge (pas kiri kanan dan paling bawah) -->
    <div class="footer-banner">
      <img src="data:image/png;base64,${footerImgBase64}" alt="Globallink Footer">
    </div>
  </div>

  ${suratDokterSrc ? `
  <!-- Page 2: Lampiran Surat Keterangan Dokter -->
  <div class="page-container page-break">
    <div class="content-area">
      <div class="header-banner">
        <img src="data:image/png;base64,${headerImgBase64}" alt="Globallink Header">
      </div>
      <div class="doc-title" style="margin-top: 10px; margin-bottom: 8px;">
        ${lampiranJudul}
      </div>
      <div class="lampiran-meta">
        <table style="width: 100%; border-collapse: collapse; font-size: 10pt;">
          <tr>
            <td style="width: 120px; font-weight: bold; padding: 2px 0;">Nama Karyawan</td>
            <td style="width: 12px; padding: 2px 0;">:</td>
            <td style="padding: 2px 0;">${data.nama || '-'}</td>
            <td style="width: 120px; font-weight: bold; padding: 2px 0;">ID Karyawan</td>
            <td style="width: 12px; padding: 2px 0;">:</td>
            <td style="padding: 2px 0;">${data.id_karyawan || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 2px 0;">Tanggal Izin</td>
            <td style="padding: 2px 0;">:</td>
            <td style="padding: 2px 0;">${tanggalIzinFormatted}</td>
            <td style="font-weight: bold; padding: 2px 0;">Jabatan</td>
            <td style="padding: 2px 0;">:</td>
            <td style="padding: 2px 0;">${data.jabatan || '-'}</td>
          </tr>
        </table>
      </div>
      <div class="lampiran-frame">
        <img src="${suratDokterSrc}" alt="Lampiran Surat Dokter" class="lampiran-img">
      </div>
    </div>
    <div class="footer-banner">
      <img src="data:image/png;base64,${footerImgBase64}" alt="Globallink Footer">
    </div>
  </div>
  ` : ''}
</body>
</html>`;
}

async function generatePdfFromData(data) {
  const htmlContent = generateHtmlTemplate(data);
  const browser = await puppeteer.launch(browserOptions());

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0'
      }
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = {
  generateHtmlTemplate,
  generatePdfFromData
};
