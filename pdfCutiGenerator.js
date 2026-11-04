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
    return `${s.format('DD')} s/d ${e.format('DD MMMM YYYY')}`;
  }
  return `${s.format('DD MMMM YYYY')} s/d ${e.format('DD MMMM YYYY')}`;
}

function generateCutiHtmlTemplate(data) {
  const isCutiTahunan = !data.jenis_cuti || data.jenis_cuti === 'Cuti Tahunan';
  const isCutiMelahirkan = data.jenis_cuti === 'Cuti Melahirkan';
  const isCutiLainnya = data.jenis_cuti === 'Cuti Lainnya';

  const isApproved = data.status_persetujuan === 'Disetujui';
  const isPostponed = data.status_persetujuan === 'Ditangguhkan';
  const isRejected = data.status_persetujuan === 'Ditolak';

  const tanggalCutiFormatted = data.hari_tanggal || formatDateRange(data.tanggal_mulai, data.tanggal_selesai);
  const masukKembaliFormatted = formatDateIndo(data.masuk_kembali_tanggal);
  const tanggalSuratObj = data.tanggal_surat ? dayjs(data.tanggal_surat) : dayjs();
  const tanggalSuratFormatted = tanggalSuratObj.isValid() ? tanggalSuratObj.format('DD MMMM YYYY') : dayjs().format('DD MMMM YYYY');

  const hakCuti = data.hak_cuti !== undefined ? data.hak_cuti : 12;
  const cutiSudah = data.cuti_sudah_diambil !== undefined ? data.cuti_sudah_diambil : 0;
  const cutiBelum = data.cuti_belum_diambil !== undefined ? data.cuti_belum_diambil : (hakCuti - cutiSudah);
  const cutiAkan = data.cuti_akan_diambil !== undefined ? data.cuti_akan_diambil : 1;
  const sisaCuti = data.sisa_cuti !== undefined ? data.sisa_cuti : (cutiBelum - cutiAkan);

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Formulir Pengajuan Cuti - ${data.nama || 'Karyawan'}</title>
  <style>
    @page {
      size: A4;
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
      font-size: 11pt;
      line-height: 1.35;
      color: #000;
    }
    .page-container {
      width: 210mm;
      height: 297mm;
      min-height: 297mm;
      max-height: 297mm;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-sizing: border-box;
      margin: 0 auto;
      padding: 0;
      page-break-after: always;
      background: #fff;
      overflow: hidden;
    }
    .page-container:last-child {
      page-break-after: avoid;
    }
    .content-area {
      padding: 16mm 20mm 0 20mm;
      flex: 1;
    }
    .header-logo {
      text-align: right;
      margin-bottom: 12px;
    }
    .header-logo img {
      height: 46px;
      width: auto;
      object-fit: contain;
      display: inline-block;
    }
    .doc-title {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 0.5px;
      margin-top: 6px;
      margin-bottom: 22px;
      text-transform: uppercase;
      color: #000;
    }

    /* Data fields table with bottom underlines */
    .field-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
    }
    .field-table td {
      padding: 4px 0;
      vertical-align: top;
      font-size: 11pt;
    }
    .lbl-col {
      width: 195px;
      font-weight: bold;
      letter-spacing: 0.2px;
    }
    .colon-col {
      width: 16px;
      text-align: center;
      font-weight: bold;
    }
    .val-cell {
      border-bottom: 1px solid #000;
      padding-bottom: 2px;
      font-size: 11pt;
      color: #000;
    }

    /* Checkbox list */
    .checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding-top: 2px;
    }
    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 10.5pt;
      font-weight: 500;
    }
    .box {
      width: 17px;
      height: 17px;
      border: 1.5px solid #000;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11pt;
      font-weight: bold;
      background: #fff;
      line-height: 1;
    }

    /* Administrasi Karyawan Table - Bordered box with row underlines and spacing for manual filling */
    .admin-section {
      margin-top: 18px;
      margin-bottom: 18px;
      width: 100%;
    }
    .admin-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #000;
      font-size: 10.5pt;
    }
    .admin-table th {
      border: none;
      border-bottom: 1px solid #000;
      padding: 6px 12px;
      text-align: left;
      font-size: 10.5pt;
      font-weight: bold;
      background-color: #fff;
    }
    .admin-table td {
      border: none;
      border-bottom: 1px solid #000;
      padding: 5px 12px;
      font-size: 10pt;
    }
    .admin-table tr:last-child td {
      border-bottom: none;
    }
    .admin-table td.col-lbl {
      width: 45%;
    }
    .admin-table td.col-sep {
      width: 25px;
      text-align: center;
    }
    .admin-table td.col-space {
      width: 130px;
      text-align: center;
    }
    .admin-table td.col-space .val-akan {
      font-weight: bold;
      font-size: 10.5pt;
    }
    .admin-table td.col-unit {
      text-align: left;
      padding-left: 10px;
    }

    /* Persetujuan Atasan */
    .approval-section {
      margin-top: 14px;
      font-size: 10.5pt;
    }
    .approval-title {
      font-weight: normal;
      margin-bottom: 8px;
    }

    /* Signatures Section */
    .sig-section {
      width: 100%;
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
    }
    .sig-col {
      width: 230px;
      text-align: left;
    }
    .sig-col-right {
      width: 230px;
      text-align: left;
    }
    .sig-space {
      height: 70px;
      display: flex;
      align-items: flex-end;
      margin-bottom: 4px;
    }
    .sig-space img {
      max-height: 65px;
      max-width: 180px;
      object-fit: contain;
    }
    .sig-name {
      border-bottom: 1px solid #000;
      font-weight: 500;
      padding-bottom: 2px;
      display: inline-block;
      min-width: 180px;
    }

    /* Lampiran Page Specific */
    .lampiran-intro {
      font-size: 11pt;
      line-height: 1.5;
      margin-top: 22px;
      margin-bottom: 18px;
      text-align: justify;
    }

    /* Footer Banner pinned bottom */
    .footer-banner {
      width: 100%;
      line-height: 0;
      margin: 0;
      padding: 0;
    }
    .footer-banner img {
      width: 100%;
      height: auto;
      display: block;
    }
  </style>
</head>
<body>

  <!-- ================= HALAMAN 1: FORMULIR PENGAJUAN CUTI ================= -->
  <div class="page-container">
    <div class="content-area">
      <div class="header-logo">
        <img src="data:image/png;base64,${headerImgBase64}" alt="Globallink">
      </div>

      <div class="doc-title">
        FORMULIR PENGAJUAN CUTI
      </div>

      <table class="field-table">
        <tr>
          <td class="lbl-col">NAMA</td>
          <td class="colon-col">:</td>
          <td class="val-cell"><b>${data.nama || ''}</b></td>
        </tr>
        <tr>
          <td class="lbl-col">ID KARYAWAN</td>
          <td class="colon-col">:</td>
          <td class="val-cell"><b>${String(data.id_karyawan || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])}</b></td>
        </tr>
        <tr>
          <td class="lbl-col">JABATAN</td>
          <td class="colon-col">:</td>
          <td class="val-cell"><b>${data.jabatan || ''}</b></td>
        </tr>
        <tr>
          <td class="lbl-col" style="padding-top: 10px;">JENIS CUTI</td>
          <td class="colon-col" style="padding-top: 10px;">:</td>
          <td style="padding-top: 8px; padding-bottom: 10px;">
            <div class="checkbox-group">
              <div class="checkbox-item">
                <span class="box">${isCutiTahunan ? '✓' : ''}</span>
                <span>CUTI TAHUNAN</span>
              </div>
              <div class="checkbox-item">
                <span class="box">${isCutiMelahirkan ? '✓' : ''}</span>
                <span>CUTI MELAHIRKAN</span>
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td class="lbl-col">ALASAN</td>
          <td class="colon-col">:</td>
          <td class="val-cell">${data.alasan || ''}</td>
        </tr>
        <tr>
          <td class="lbl-col">TANGGAL</td>
          <td class="colon-col">:</td>
          <td class="val-cell">${tanggalCutiFormatted}</td>
        </tr>
        <tr>
          <td class="lbl-col">MASUK KEMBALI TANGGAL</td>
          <td class="colon-col">:</td>
          <td class="val-cell">${masukKembaliFormatted}</td>
        </tr>
      </table>

      <!-- Diisi Administrasi Karyawan (Sesuai Permintaan User: Hanya Akan Diambil yang terisi, baris lain berjarak untuk diisi manual) -->
      <div class="admin-section">
        <table class="admin-table">
          <thead>
            <tr>
              <th colspan="4">Diisi Administrasi Karyawan</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="col-lbl">Hak Cuti</td>
              <td class="col-sep">:</td>
              <td class="col-space"></td>
              <td class="col-unit">Hari</td>
            </tr>
            <tr>
              <td class="col-lbl">Cuti Yang Sudah Diambil</td>
              <td class="col-sep">:</td>
              <td class="col-space"></td>
              <td class="col-unit">Hari</td>
            </tr>
            <tr>
              <td class="col-lbl">Cuti Yang Belum Diambil</td>
              <td class="col-sep">:</td>
              <td class="col-space"></td>
              <td class="col-unit">Hari</td>
            </tr>
            <tr>
              <td class="col-lbl">Cuti Yang Akan Diambil</td>
              <td class="col-sep">:</td>
              <td class="col-space"><span class="val-akan">${data.cuti_akan_diambil || ''}</span></td>
              <td class="col-unit">Hari</td>
            </tr>
            <tr>
              <td class="col-lbl">Sisa Cuti</td>
              <td class="col-sep">:</td>
              <td class="col-space"></td>
              <td class="col-unit">Hari</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Persetujuan Atasan -->
      <div class="approval-section">
        <div class="approval-title">Persetujuan Atasan ( Diisi oleh Atasan Langsung )</div>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="width: 140px; vertical-align: top; font-weight: normal;">Disetujui / Ditolak</td>
            <td style="width: 16px; text-align: center; vertical-align: top;">:</td>
            <td style="vertical-align: top;">
              <div style="display: flex; flex-direction: column; gap: 7px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span class="box">${isApproved ? '✓' : ''}</span>
                  <span>Disetujui</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span class="box">${isPostponed ? '✓' : ''}</span>
                  <span>Ditangguhkan menjadi tanggal ${data.ditangguhkan_mulai ? formatDateIndo(data.ditangguhkan_mulai) : '...........'} S.d ${data.ditangguhkan_selesai ? formatDateIndo(data.ditangguhkan_selesai) : '...........'}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span class="box">${isRejected ? '✓' : ''}</span>
                  <span>Ditolak</span>
                </div>
                <div style="padding-left: 27px; font-size: 10pt; color: #333;">
                  Alasan : ${data.alasan_atasan || '................................................................................................'}
                </div>
              </div>
            </td>
          </tr>
        </table>
      </div>

      <!-- Area Tanda Tangan Halaman 1 -->
      <div class="sig-section">
        <div class="sig-col">
          <div>Diajukan Oleh,</div>
          <div class="sig-space">
            ${data.tanda_tangan_pemohon ? `<img src="${data.tanda_tangan_pemohon}" alt="TTD Pemohon">` : ''}
          </div>
          <div class="sig-name">${data.nama || '( .................................... )'}</div>
        </div>

        <div class="sig-col-right">
          <div>Disetujui Oleh,</div>
          <div class="sig-space">
            ${data.tanda_tangan_atasan ? `<img src="${data.tanda_tangan_atasan}" alt="TTD Atasan">` : ''}
          </div>
          <div class="sig-name">${data.nama_atasan || '( .................................... )'}</div>
        </div>
      </div>
    </div>

    <!-- Footer Banner Halaman 1 -->
    <div class="footer-banner">
      <img src="data:image/png;base64,${footerImgBase64}" alt="Globallink Footer">
    </div>
  </div>

  <!-- ================= HALAMAN 2: LAMPIRAN PENGAJUAN CUTI ================= -->
  <div class="page-container">
    <div class="content-area">
      <div class="header-logo">
        <img src="data:image/png;base64,${headerImgBase64}" alt="Globallink">
      </div>

      <div class="doc-title">
        LAMPIRAN PENGAJUAN CUTI
      </div>

      <table class="field-table" style="margin-bottom: 20px;">
        <tr>
          <td class="lbl-col" style="width: 140px;">Nama</td>
          <td class="colon-col">:</td>
          <td class="val-cell"><b>${data.nama || ''}</b></td>
        </tr>
        <tr>
          <td class="lbl-col" style="width: 140px;">Jabatan</td>
          <td class="colon-col">:</td>
          <td class="val-cell"><b>${data.jabatan || ''}</b></td>
        </tr>
        <tr>
          <td class="lbl-col" style="width: 140px;">Jadwal Cuti</td>
          <td class="colon-col">:</td>
          <td class="val-cell">${tanggalCutiFormatted}</td>
        </tr>
      </table>

      <div class="lampiran-intro">
        Sehubung dengan pengajuan cuti saya yang telah dilampirkan bersama ini, saya bermaksud memberikan tanggung jawab dan amanah saya, selama masa cuti saya kepada :
      </div>

      <table class="field-table" style="margin-bottom: 30px;">
        <tr>
          <td class="lbl-col" style="width: 140px;">Nama</td>
          <td class="colon-col">:</td>
          <td class="val-cell">${data.penerima_amanah_nama || ''}</td>
        </tr>
        <tr>
          <td class="lbl-col" style="width: 140px;">Jabatan</td>
          <td class="colon-col">:</td>
          <td class="val-cell">${data.penerima_amanah_jabatan || ''}</td>
        </tr>
      </table>

      <!-- Area Tanda Tangan Halaman 2 -->
      <div class="sig-section" style="margin-top: 40px;">
        <div class="sig-col">
          <div>Yang mengajukan cuti,</div>
          <div class="sig-space">
            ${data.tanda_tangan_pemohon ? `<img src="${data.tanda_tangan_pemohon}" alt="TTD Pemohon">` : ''}
          </div>
          <div class="sig-name">${data.nama || '( .................................... )'}</div>
        </div>

        <div class="sig-col-right">
          <div>Makassar, ${tanggalSuratFormatted}</div>
          <div style="margin-top: 4px;">Yang menerima amanah,</div>
          <div class="sig-space"></div>
          <div class="sig-name">${data.penerima_amanah_nama ? `( ${data.penerima_amanah_nama} )` : '( .................................... )'}</div>
        </div>
      </div>
    </div>

    <!-- Footer Banner Halaman 2 -->
    <div class="footer-banner">
      <img src="data:image/png;base64,${footerImgBase64}" alt="Globallink Footer">
    </div>
  </div>

</body>
</html>`;
}

async function generateCutiPdfFromData(data) {
  const htmlContent = generateCutiHtmlTemplate(data);
  const browser = await puppeteer.launch(browserOptions());

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
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
  generateCutiHtmlTemplate,
  generateCutiPdfFromData
};
