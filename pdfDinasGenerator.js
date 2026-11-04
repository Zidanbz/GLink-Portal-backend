const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { browserOptions } = require('./browserOptions');
const dayjs = require('dayjs');
require('dayjs/locale/id');

dayjs.locale('id');

const headerImgBase64 = fs.readFileSync(path.join(__dirname, 'assets', 'header_new.png')).toString('base64');
const footerImgBase64 = fs.readFileSync(path.join(__dirname, 'assets', 'footer_new.png')).toString('base64');

function formatDateIndo(dateStr) {
  if (!dateStr) return dayjs().format('DD MMMM YYYY');
  const d = dayjs(dateStr);
  return d.isValid() ? d.format('DD MMMM YYYY') : dateStr;
}

function formatRupiah(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('id-ID');
}

function getRomanMonth(monthNum) {
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  return romans[monthNum - 1] || 'I';
}

function formatHariTanggalRange(startDate, endDate) {
  if (!startDate) return '';
  const s = dayjs(startDate);
  if (!s.isValid()) return startDate;
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const startDay = days[s.day()];

  if (!endDate || s.isSame(dayjs(endDate), 'day')) {
    return `${startDay}, ${s.format('DD MMMM YYYY')}`;
  }

  const e = dayjs(endDate);
  if (!e.isValid()) return `${startDay}, ${s.format('DD MMMM YYYY')}`;
  const endDay = days[e.day()];

  if (s.format('MMMM YYYY') === e.format('MMMM YYYY')) {
    return `${startDay} - ${endDay}, ${s.format('DD')} - ${e.format('DD MMMM YYYY')}`;
  }
  return `${startDay}, ${s.format('DD MMMM YYYY')} s/d ${endDay}, ${e.format('DD MMMM YYYY')}`;
}

function generateDinasHtmlTemplate(data) {
  const tanggalSuratObj = data.tanggal_surat ? dayjs(data.tanggal_surat) : dayjs();
  const tanggalSuratFormatted = tanggalSuratObj.isValid() ? tanggalSuratObj.format('DD MMMM YYYY') : dayjs().format('DD MMMM YYYY');
  const displayHariTanggal = data.hari_tanggal || formatHariTanggalRange(data.tanggal_mulai, data.tanggal_selesai) || tanggalSuratFormatted;

  // Anggaran items
  let anggaranList = [];
  if (Array.isArray(data.anggaran_items)) {
    anggaranList = data.anggaran_items;
  } else if (typeof data.anggaran_items === 'string') {
    try {
      anggaranList = JSON.parse(data.anggaran_items);
    } catch (e) {
      anggaranList = [];
    }
  }

  // Filter valid anggaran rows (having description or non-zero amount)
  anggaranList = (anggaranList || []).filter(item => item && (item.deskripsi?.trim() || Number(item.jumlah) > 0));

  // Itinerary items
  let itineraryList = [];
  if (Array.isArray(data.itinerary_items)) {
    itineraryList = data.itinerary_items;
  } else if (typeof data.itinerary_items === 'string') {
    try {
      itineraryList = JSON.parse(data.itinerary_items);
    } catch (e) {
      itineraryList = [];
    }
  }

  // Filter valid itinerary rows (having kegiatan or tempat or waktu)
  itineraryList = (itineraryList || []).filter(item => item && (item.kegiatan?.trim() || item.tempat?.trim() || item.waktu_kegiatan?.trim()));

  // Total Anggaran
  const totalAnggaran = anggaranList.reduce((acc, item) => {
    const qty = Number(item.qty) || 1;
    const harga = Number(item.harga_satuan) || 0;
    const itemTotal = item.jumlah !== undefined ? Number(item.jumlah) : (qty * harga);
    return acc + itemTotal;
  }, 0);

  const displayTotal = data.total_anggaran !== undefined && data.total_anggaran !== null ? Number(data.total_anggaran) : totalAnggaran;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Surat Tugas Dinas - ${data.penerima_tugas_nama || 'Karyawan'}</title>
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
      line-height: 1.3;
      color: #000;
    }
    .page-container {
      width: 100%;
      height: 100vh;
      min-height: 100vh;
      max-height: 100vh;
      page-break-after: always;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
    .page-container:last-child {
      page-break-after: auto;
    }
    .content-area {
      padding: 12mm 18mm 0 18mm;
      flex: 1;
    }
    .header-logo {
      width: 100%;
      display: flex;
      justify-content: flex-end;
      margin-bottom: 25px;
    }
    .header-logo img {
      height: 48px;
      width: auto;
      object-fit: contain;
    }
    .footer-banner {
      width: 100%;
      margin-top: auto;
      line-height: 0;
    }
    .footer-banner img {
      width: 100%;
      height: auto;
      display: block;
    }

    /* Page 1 Styles (Anggaran) */
    .meta-box-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 11pt;
    }
    .meta-box-table td {
      padding: 3px 0;
      vertical-align: top;
    }
    .meta-box-table td.label-col {
      width: 250px;
      font-weight: bold;
    }
    .meta-box-table td.colon-col {
      width: 20px;
      font-weight: bold;
    }

    .budget-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      margin-bottom: 30px;
      font-size: 10.5pt;
    }
    .budget-table th, .budget-table td {
      border: 1.5px solid #000;
      padding: 7px 10px;
      vertical-align: middle;
    }
    .budget-table th {
      font-weight: bold;
      font-style: italic;
      text-align: center;
      background-color: #fff;
    }
    .budget-table td.text-center {
      text-align: center;
    }
    .budget-table td.text-right {
      text-align: right;
    }
    .budget-table td.col-desc {
      font-style: italic;
      font-weight: bold;
    }
    .budget-table .total-row td {
      font-weight: bold;
      border: 1.5px solid #000;
    }

    .sig-section {
      width: 100%;
      margin-top: 15px;
    }
    .sig-date-right {
      text-align: right;
      font-size: 11pt;
      margin-bottom: 25px;
      padding-right: 25px;
    }
    .sig-grid-p1 {
      display: flex;
      justify-content: space-between;
      padding: 0 30px;
    }
    .sig-box-p1 {
      width: 240px;
      text-align: left;
    }
    .sig-img-container {
      height: 75px;
      display: flex;
      align-items: center;
      margin: 4px 0;
    }
    .sig-img-container img {
      max-height: 70px;
      max-width: 170px;
      object-fit: contain;
    }

    /* Page 2 Styles (Itinerary) */
    .itinerary-title {
      text-align: center;
      font-weight: bold;
      font-size: 13pt;
      margin-bottom: 25px;
      letter-spacing: 0.5px;
    }
    .itinerary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5pt;
    }
    .itinerary-table th, .itinerary-table td {
      border: 1.5px solid #000;
      padding: 8px 10px;
      vertical-align: top;
    }
    .itinerary-table th {
      text-align: center;
      font-weight: bold;
      background-color: #fff;
    }

    /* Page 3 Styles (Surat Tugas) */
    .st-title-box {
      text-align: center;
      margin-bottom: 25px;
    }
    .st-title-box .title {
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 0.5px;
    }
    .st-title-box .doc-no {
      font-size: 11pt;
      font-weight: bold;
      margin-top: 2px;
    }
    .st-section-title {
      font-weight: bold;
      margin-top: 15px;
      margin-bottom: 6px;
    }
    .st-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    .st-table td {
      padding: 2.5px 0;
      vertical-align: top;
    }
    .st-table td.col-lbl {
      width: 160px;
      font-weight: bold;
    }
    .st-table td.col-colon {
      width: 15px;
    }
    .st-paragraph {
      margin-top: 16px;
      line-height: 1.4;
      text-align: justify;
    }
    .st-closing-date {
      margin-top: 20px;
      font-size: 11pt;
    }
  </style>
</head>
<body>

  <!-- ================= HALAMAN 1: ANGGARAN OPERASIONAL DINAS ================= -->
  <div class="page-container">
    <div class="content-area">
      <div class="header-logo">
        <img src="data:image/png;base64,${headerImgBase64}" alt="Globallink">
      </div>

      <table class="meta-box-table">
        <tr>
          <td class="label-col">Nomor</td>
          <td class="colon-col">:</td>
          <td>${data.nomor_nota || '-'}</td>
        </tr>
        <tr>
          <td class="label-col">Kepada</td>
          <td class="colon-col">:</td>
          <td>Divisi Finance</td>
        </tr>
        <tr>
          <td class="label-col">Tujuan</td>
          <td class="colon-col">:</td>
          <td>${data.tujuan_dinas || '-'}</td>
        </tr>
      </table>

      <table class="budget-table">
        <thead>
          <tr>
            <th style="width: 45px;">No</th>
            <th>Deskripsi</th>
            <th style="width: 65px;">Qty</th>
            <th style="width: 140px;">Harga Satuan</th>
            <th style="width: 140px;">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          ${anggaranList.length > 0 ? anggaranList.map((item, idx) => {
            const itemQty = Number(item.qty) || 1;
            const itemHarga = Number(item.harga_satuan) || 0;
            const itemJumlah = item.jumlah !== undefined ? Number(item.jumlah) : (itemQty * itemHarga);
            return `
            <tr>
              <td class="text-center font-bold italic">${item.no !== undefined && item.no !== '' ? item.no : (idx + 1)}</td>
              <td class="col-desc">${item.deskripsi || '-'}</td>
              <td class="text-center font-bold italic">${itemQty}</td>
              <td>
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-style: italic;">
                  <span>Rp</span>
                  <span>${formatRupiah(itemHarga)}</span>
                </div>
              </td>
              <td>
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-style: italic;">
                  <span>Rp</span>
                  <span>${formatRupiah(itemJumlah)}</span>
                </div>
              </td>
            </tr>
            `;
          }).join('') : `
            <tr>
              <td class="text-center font-bold italic">1</td>
              <td class="col-desc">Biaya Operasional Dinas</td>
              <td class="text-center font-bold italic">1</td>
              <td>
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-style: italic;">
                  <span>Rp</span>
                  <span>0</span>
                </div>
              </td>
              <td>
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-style: italic;">
                  <span>Rp</span>
                  <span>0</span>
                </div>
              </td>
            </tr>
          `}
          <tr class="total-row">
            <td colspan="4" style="text-align: right; padding-right: 15px; font-style: italic; font-weight: bold;">TOTAL</td>
            <td>
              <div style="display: flex; justify-content: space-between; font-weight: bold; font-style: italic;">
                <span>Rp</span>
                <span>${formatRupiah(displayTotal)}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="sig-section">
        <div class="sig-date-right">
          Makassar, ${tanggalSuratFormatted}
        </div>
        <div class="sig-grid-p1">
          <div class="sig-box-p1">
            <div style="font-weight: 500;">Maker,</div>
            <div class="sig-img-container">
              ${data.maker_tanda_tangan ? `<img src="${data.maker_tanda_tangan}" alt="Maker Signature">` : '<div style="height: 50px;"></div>'}
            </div>
            <div style="font-weight: bold; font-size: 11pt;">${data.maker_nama || data.penerima_tugas_nama || '( .................................... )'}</div>
            <div style="font-size: 10pt; color: #333;">${data.maker_jabatan || data.penerima_tugas_jabatan || ''}</div>
          </div>

          <div class="sig-box-p1" style="text-align: left; padding-left: 20px;">
            <div style="font-weight: 500;">Acknowledge</div>
            <div class="sig-img-container">
              ${data.pemberi_tugas_tanda_tangan ? `<img src="${data.pemberi_tugas_tanda_tangan}" alt="Acknowledge Signature">` : '<div style="height: 50px;"></div>'}
            </div>
            <div style="font-weight: bold; font-size: 11pt;">${data.acknowledge_nama || data.pemberi_tugas_nama || '( .................................... )'}</div>
            <div style="font-size: 10pt; color: #333;">${data.acknowledge_jabatan || data.pemberi_tugas_jabatan || ''}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="footer-banner">
      <img src="data:image/png;base64,${footerImgBase64}" alt="Globallink Footer">
    </div>
  </div>


  <!-- ================= HALAMAN 2: LAMPIRAN KEGIATAN PERJALANAN ================= -->
  <div class="page-container">
    <div class="content-area">
      <div class="header-logo">
        <img src="data:image/png;base64,${headerImgBase64}" alt="Globallink">
      </div>

      <div class="itinerary-title">
        LAMPIRAN KEGIATAN PERJALANAN
      </div>

      <table class="itinerary-table">
        <thead>
          <tr>
            <th style="width: 50px;">NO</th>
            <th>KEGIATAN</th>
            <th style="width: 200px;">Tempat</th>
            <th style="width: 170px;">Waktu Kegiatan</th>
          </tr>
        </thead>
        <tbody>
          ${itineraryList.length > 0 ? itineraryList.map((item, idx) => `
            <tr>
              <td style="text-align: center; font-weight: bold;">${item.no !== undefined && item.no !== '' ? item.no : (idx + 1)}</td>
              <td>${item.kegiatan || '-'}</td>
              <td>${item.tempat || '-'}</td>
              <td>${item.waktu_kegiatan || '-'}</td>
            </tr>
          `).join('') : `
            <tr>
              <td style="text-align: center; font-weight: bold;">1</td>
              <td>${data.kegiatan || 'Pelaksanaan tugas dinas operasional'}</td>
              <td>${data.tujuan_dinas || '-'}</td>
              <td>${displayHariTanggal}</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>

    <div class="footer-banner">
      <img src="data:image/png;base64,${footerImgBase64}" alt="Globallink Footer">
    </div>
  </div>


  <!-- ================= HALAMAN 3: SURAT TUGAS DINAS RESMI ================= -->
  <div class="page-container">
    <div class="content-area">
      <div class="header-logo">
        <img src="data:image/png;base64,${headerImgBase64}" alt="Globallink">
      </div>

      <div class="st-title-box">
        <div class="title">SURAT TUGAS DINAS</div>
        <div class="doc-no">${data.nomor_surat || '—'}</div>
      </div>

      <div class="st-section-title">Yang bertandatangan di bawah ini :</div>
      <table class="st-table">
        <tr>
          <td class="col-lbl">Nama</td>
          <td class="col-colon">:</td>
          <td>${data.pemberi_tugas_nama || 'Muhajirin'}</td>
        </tr>
        <tr>
          <td class="col-lbl">Jabatan</td>
          <td class="col-colon">:</td>
          <td>${data.pemberi_tugas_jabatan || 'HRD Manager'}</td>
        </tr>
      </table>

      <div class="st-section-title">Menugaskan Kepada :</div>
      <table class="st-table">
        <tr>
          <td class="col-lbl">Nama</td>
          <td class="col-colon">:</td>
          <td>${data.penerima_tugas_nama || '-'}</td>
        </tr>
        <tr>
          <td class="col-lbl">Jabatan</td>
          <td class="col-colon">:</td>
          <td>${data.penerima_tugas_jabatan || '-'}</td>
        </tr>
      </table>

      <div class="st-section-title">Untuk Melaksanakan pekerjaan sebagai berikut :</div>
      <table class="st-table">
        <tr>
          <td class="col-lbl">Kegiatan</td>
          <td class="col-colon">:</td>
          <td style="white-space: pre-line; line-height: 1.45;">${data.kegiatan || '-'}</td>
        </tr>
        <tr>
          <td class="col-lbl">Tempat</td>
          <td class="col-colon">:</td>
          <td>${data.tujuan_dinas || '-'}</td>
        </tr>
        <tr>
          <td class="col-lbl">Hari & Tanggal</td>
          <td class="col-colon">:</td>
          <td>${displayHariTanggal}</td>
        </tr>
      </table>

      <div class="st-paragraph">
        Demikian surat tugas ini kami berikan untuk dilaksanakan dengan baik dan penuh tanggung jawab.
        Setelah kegiatan berakhir diharapkan untuk membuat laporan tertulis.
      </div>

      <div class="st-closing-date">
        Makassar, ${tanggalSuratFormatted}
      </div>

      <div style="margin-top: 10px; margin-bottom: 25px;">
        <div class="sig-img-container" style="height: 70px;">
          ${data.pemberi_tugas_tanda_tangan ? `<img src="${data.pemberi_tugas_tanda_tangan}" alt="Tanda Tangan Pemberi Tugas">` : '<div style="height: 50px;"></div>'}
        </div>
        <div style="font-weight: bold; font-size: 11pt; margin-top: 4px;">
          ${data.pemberi_tugas_nama || '( .................................... )'}
        </div>
      </div>
    </div>

    <div class="footer-banner">
      <img src="data:image/png;base64,${footerImgBase64}" alt="Globallink Footer">
    </div>
  </div>

</body>
</html>`;
}

async function generateDinasPdfFromData(data) {
  const htmlContent = generateDinasHtmlTemplate(data);
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
  generateDinasHtmlTemplate,
  generateDinasPdfFromData
};
