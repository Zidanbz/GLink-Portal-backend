const { firestore } = require('../firebase/admin');
const { issuanceDate, formatDinasNumbers } = require('../dinasIssuance');
const collections = new Set(['pengajuan_izin', 'pengajuan_cuti', 'pengajuan_dinas']);

function collection(db, name) {
  if (!collections.has(name)) throw new Error('Collection tidak didukung.');
  return db.collection(name);
}
function numericId(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    const error = new Error('ID tidak valid.'); error.status = 400; throw error;
  }
  return String(value);
}
function checkDocumentSize(data) {
  // Firestore documents have a 1 MiB ceiling. Leave room for field metadata.
  if (Buffer.byteLength(JSON.stringify(data)) > 900 * 1024) {
    const error = new Error('Data terlalu besar. Kurangi ukuran tanda tangan atau rincian pengajuan.');
    error.status = 413; throw error;
  }
}

// The injectable DB is used only by the emulator integration tests.
function createFirestoreRepository(getDb = firestore) {
  return {
    provider: 'firebase',
    async list(table, { search, status, jenis, limit = 100, before } = {}) {
      let query = collection(getDb(), table).orderBy('id', 'desc');
      if (before) query = query.startAfter(Number(numericId(before)));
      const snapshot = await query.limit(limit).get();
      let rows = snapshot.docs.map(doc => doc.data());
      const nextCursor = rows.length === limit ? rows.at(-1).id : null;
      // Substring search is applied to this bounded page. The cursor always refers
      // to the unfiltered page so clients can continue even when it has no matches.
      if (table === 'pengajuan_izin') {
        if (status && status !== 'Semua') rows = rows.filter(row => row.status_persetujuan === status);
        if (jenis && jenis !== 'Semua') rows = rows.filter(row => row.jenis_izin === jenis);
        if (search) rows = rows.filter(row => ['nama', 'jabatan', 'nomor_surat', 'alasan'].some(key => String(row[key] || '').toLocaleLowerCase('id').includes(search.toLocaleLowerCase('id'))));
      }
      return { rows, nextCursor };
    },
    async get(table, id) {
      const doc = await collection(getDb(), table).doc(numericId(id)).get();
      return doc.exists ? doc.data() : null;
    },
    async insert(table, columns, values) {
      const db = getDb();
      const records = collection(db, table);
      const counter = db.collection('_counters').doc(table);
      const data = Object.fromEntries(columns.map((key, i) => [key, values[i] ?? null]));
      checkDocumentSize(data);
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(counter);
        const id = (snapshot.data()?.lastId || 0) + 1;
        const now = new Date().toISOString();
        tx.create(records.doc(String(id)), { ...data, id, created_at: now, updated_at: now });
        tx.set(counter, { lastId: id }, { merge: true });
        return { insertId: id };
      });
    },
    async updateApproval(id, data) {
      const entries = Object.entries(data).filter(([key, value]) => !['tanda_tangan_atasan', 'paraf_hrd'].includes(key) || value);
      const update = { ...Object.fromEntries(entries), updated_at: new Date().toISOString() };
      checkDocumentSize(update);
      await getDb().collection('pengajuan_izin').doc(numericId(id)).update(update);
    },
    async remove(table, id) { await collection(getDb(), table).doc(numericId(id)).delete(); },
    async nextIzinNumber(prefix) {
      const db = getDb();
      const counter = db.collection('_counters').doc(prefix.replaceAll('/', '-'));
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(counter);
        const sequence = (snapshot.data()?.sequence || 0) + 1;
        tx.set(counter, { sequence });
        return `${prefix}/${String(sequence).padStart(3, '0')}`;
      });
    },
    async stats() {
      const records = getDb().collection('pengajuan_izin');
      const labels = { pending: 'Menunggu Persetujuan', disetujui: 'Disetujui', ditangguhkan: 'Ditangguhkan', ditolak: 'Ditolak' };
      const entries = await Promise.all(Object.entries(labels).map(async ([key, status]) => [key, (await records.where('status_persetujuan', '==', status).count().get()).data().count]));
      return { total: (await records.count().get()).data().count, ...Object.fromEntries(entries) };
    },
    async previewDinasNumbers(now = new Date()) {
      const snapshot = await getDb().collection('_counters').doc('pengajuan_dinas').get();
      const counter = snapshot.data() || {};
      return formatDinasNumbers(counter.surat || 70, counter.nota || 70, now);
    },
    async issueDinas(input, renderPdf) {
      const db = getDb();
      const counterRef = db.collection('_counters').doc('pengajuan_dinas');
      const recordRef = db.collection('pengajuan_dinas');
      // Render BEFORE the short transaction. A concurrent issue changes revision,
      // so render again with fresh numbers. PDF failure writes no counter or data.
      for (let attempt = 0; attempt < 5; attempt++) {
        const snapshot = await counterRef.get();
        const counter = snapshot.data() || {};
        const numbers = formatDinasNumbers(counter.surat || 70, counter.nota || 70);
        const data = normalizeDinas({ ...input, ...numbers });
        checkDocumentSize(data);
        const pdfBuffer = renderPdf ? await renderPdf(data) : undefined;
        const result = await db.runTransaction(async tx => {
          const latest = await tx.get(counterRef);
          if ((latest.data()?.lastId || 0) !== (counter.lastId || 0)) return null;
          const id = (counter.lastId || 0) + 1;
          const now = new Date().toISOString();
          tx.create(recordRef.doc(String(id)), { ...data, id, created_at: now, updated_at: now });
          tx.set(counterRef, { lastId: id, surat: Number(numbers.nomor_surat.split('/')[1]), nota: Number(numbers.nomor_nota.split('/')[0]) });
          return { data, id, pdfBuffer };
        });
        if (result) return result;
      }
      const error = new Error('Penerbitan sedang sibuk. Silakan coba lagi.'); error.status = 409; throw error;
    },
  };
}

function normalizeDinas(input) {
  const defaults = {
    pemberi_tugas_nama: 'Muhajirin', pemberi_tugas_jabatan: 'HRD Manager',
    penerima_tugas_nama: '', penerima_tugas_id_karyawan: '', penerima_tugas_jabatan: '',
    kendaraan_operasional: '', tujuan_dinas: '', kegiatan: '', hari_tanggal: '',
    tanggal_mulai: null, tanggal_selesai: null,
    maker_nama: 'Inggrid Pramesti Regita', maker_jabatan: 'General Affair', maker_tanda_tangan: '',
    acknowledge_nama: 'Muhajirin', acknowledge_jabatan: 'HRD Manager', pemberi_tugas_tanda_tangan: '',
    anggaran_items: '[]', itinerary_items: '[]', total_anggaran: 0, status: 'Selesai',
    nomor_surat: '', nomor_nota: '', tanggal_surat: issuanceDate(),
  };
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    let value = input[key] || fallback;
    if (key === 'anggaran_items' || key === 'itinerary_items') {
      value = typeof value === 'string' ? value : JSON.stringify(value);
      if (!Array.isArray(JSON.parse(value))) throw Object.assign(new Error('Rincian dinas harus berupa array.'), { status: 400 });
    }
    if (['tanggal_mulai', 'tanggal_selesai', 'tanggal_surat'].includes(key) && value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
        throw Object.assign(new Error('Tanggal dinas tidak valid.'), { status: 400 });
      }
    }
    return [key, value];
  }));
}

module.exports = { createFirestoreRepository, checkDocumentSize };
