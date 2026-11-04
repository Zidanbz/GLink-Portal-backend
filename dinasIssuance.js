const LOCK_NAME = 'globallink:dinas:issuance';

function issuanceDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function previewDinasNumbers(connection, now = new Date()) {
  const tanggal_surat = issuanceDate(now);
  const [rows] = await connection.query('SELECT nomor_surat, nomor_nota FROM pengajuan_dinas');
  let surat = 70;
  let nota = 70;
  for (const row of rows) {
    const suratMatch = /^STD\/(\d+)\//.exec(row.nomor_surat || '');
    const notaMatch = /^(\d+)\/GL-HRGA\/PJN\//.exec(row.nomor_nota || '');
    if (suratMatch) surat = Math.max(surat, Number(suratMatch[1]));
    if (notaMatch) nota = Math.max(nota, Number(notaMatch[1]));
  }
  const [year, month] = tanggal_surat.split('-');
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][Number(month) - 1];
  return {
    tanggal_surat,
    nomor_surat: `STD/${String(surat + 1).padStart(4, '0')}/GL/${roman}/${year}`,
    nomor_nota: `${String(nota + 1).padStart(3, '0')}/GL-HRGA/PJN/${roman}/${year}`
  };
}

async function insertDinas(connection, data) {
  const { nomor_surat, nomor_nota, tanggal_surat } = data;
  const anggaran_items_json = typeof data.anggaran_items === 'string' ? data.anggaran_items : JSON.stringify(data.anggaran_items || []);
  const itinerary_items_json = typeof data.itinerary_items === 'string' ? data.itinerary_items : JSON.stringify(data.itinerary_items || []);

  const [result] = await connection.query(
    `INSERT INTO pengajuan_dinas (
      nomor_surat, nomor_nota, tanggal_surat,
      pemberi_tugas_nama, pemberi_tugas_jabatan,
      penerima_tugas_nama, penerima_tugas_id_karyawan, penerima_tugas_jabatan,
      kendaraan_operasional, tujuan_dinas, kegiatan, hari_tanggal,
      tanggal_mulai, tanggal_selesai,
      maker_nama, maker_jabatan, maker_tanda_tangan,
      acknowledge_nama, acknowledge_jabatan, pemberi_tugas_tanda_tangan,
      anggaran_items, total_anggaran, itinerary_items, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nomor_surat,
      nomor_nota,
      tanggal_surat,
      data.pemberi_tugas_nama || 'Muhajirin',
      data.pemberi_tugas_jabatan || 'HRD Manager',
      data.penerima_tugas_nama || '',
      data.penerima_tugas_id_karyawan || '',
      data.penerima_tugas_jabatan || '',
      data.kendaraan_operasional || '',
      data.tujuan_dinas || '',
      data.kegiatan || '',
      data.hari_tanggal || '',
      data.tanggal_mulai || null,
      data.tanggal_selesai || null,
      data.maker_nama || 'Inggrid Pramesti Regita',
      data.maker_jabatan || 'General Affair',
      data.maker_tanda_tangan || '',
      data.acknowledge_nama || 'Muhajirin',
      data.acknowledge_jabatan || 'HRD Manager',
      data.pemberi_tugas_tanda_tangan || '',
      anggaran_items_json,
      data.total_anggaran || 0,
      itinerary_items_json,
      data.status || 'Selesai'
    ]
  );

  return result.insertId;
}

// Use a database-wide lock on the same connection as the transaction so separate
// server processes cannot issue the same number. Preview never reserves a number.
async function issueDinas(pool, input, renderPdf) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 60) AS acquired', [LOCK_NAME]);
    if (Number(lock.acquired) !== 1) throw new Error('Penerbitan surat sedang sibuk. Silakan coba lagi.');
    locked = true;
    await connection.beginTransaction();
    const data = { ...input, ...await previewDinasNumbers(connection) };
    const id = await insertDinas(connection, data);
    const pdfBuffer = renderPdf ? await renderPdf(data) : undefined;
    await connection.commit();
    return { data, id, pdfBuffer };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    try {
      if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    } finally {
      connection.release();
    }
  }
}

module.exports = { issuanceDate, previewDinasNumbers, issueDinas };
