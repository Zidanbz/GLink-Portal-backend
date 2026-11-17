const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { createFirestoreRepository } = require('../repositories/firestore');
const { safeTemplateData } = require('../pdfSafety');
const { backendAccess } = require('../security');

test('template PDF mengamankan teks dan menolak signature dari URL eksternal', () => {
  const result = safeTemplateData({ nama: '<script>alert(1)</script>', tanda_tangan_pemohon: 'http://169.254.169.254/', anggaran_items: '[{"deskripsi":"<img src=x>"}]' });
  assert.equal(result.nama, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(result.tanda_tangan_pemohon, '');
  assert.equal(result.anggaran_items[0].deskripsi, '&lt;img src=x&gt;');
});

test('backend Firebase gagal tertutup tanpa konfigurasi secret', () => {
  const previous = { provider: process.env.DATA_PROVIDER, secret: process.env.BACKEND_API_SECRET };
  process.env.DATA_PROVIDER = 'firebase';
  delete process.env.BACKEND_API_SECRET;
  let status;
  backendAccess({}, { status(value) { status = value; return this; }, json() {} }, () => assert.fail('Tidak boleh melewati autentikasi'));
  assert.equal(status, 503);
  for (const [key, value] of [['DATA_PROVIDER', previous.provider], ['BACKEND_API_SECRET', previous.secret]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('Firestore emulator: API, transaksi paralel, rollback PDF dan pagination', { skip: process.env.GLINK_TEST_FIREBASE !== '1' }, async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Pengujian wajib memakai emulator lokal.');
  const { Firestore } = require('firebase-admin/firestore');
  // All writes use a demo emulator project, never the user's Firebase project.
  const db = new Firestore({ projectId: 'demo-glink-test', host, ssl: false });
  const store = createFirestoreRepository(() => db);
  let server;
  try {
    for (const name of ['pengajuan_izin', 'pengajuan_dinas', 'pengajuan_cuti', '_counters']) await db.recursiveDelete(db.collection(name));
    const initial = await store.previewDinasNumbers();
    assert.match(initial.nomor_surat, /^STD\/0071\//);
    const issued = await Promise.all(Array.from({ length: 4 }, () => store.issueDinas({ penerima_tugas_nama: 'Test' }, async () => Buffer.from('%PDF-test'))));
    assert.deepEqual(issued.map(item => item.id).sort(), [1, 2, 3, 4]);
    assert.deepEqual(issued.map(item => Number(item.data.nomor_surat.split('/')[1])).sort(), [71, 72, 73, 74]);
    const beforeFailure = await store.previewDinasNumbers();
    await assert.rejects(store.issueDinas({}, async () => { throw new Error('PDF gagal'); }), /PDF gagal/);
    assert.deepEqual(await store.previewDinasNumbers(), beforeFailure);
    await assert.rejects(store.issueDinas({ tanggal_mulai: '2026-02-31' }));
    assert.deepEqual(await store.previewDinasNumbers(), beforeFailure);
    const numbers = await Promise.all(Array.from({ length: 8 }, () => store.nextIzinNumber('IZN/2026/11')));
    assert.equal(new Set(numbers).size, 8);
    const records = await Promise.all(Array.from({ length: 3 }, (_, i) => store.insert('pengajuan_cuti', ['nama'], [`Test ${i}`])));
    assert.deepEqual(records.map(row => row.insertId).sort(), [1, 2, 3]);
    const page = await store.list('pengajuan_cuti', { limit: 2 });
    assert.deepEqual(page.rows.map(row => row.id), [3, 2]);
    assert.deepEqual((await store.list('pengajuan_cuti', { limit: 2, before: page.nextCursor })).rows.map(row => row.id), [1]);
    await assert.rejects(store.get('pengajuan_cuti', '../invalid'));
    await assert.rejects(store.insert('pengajuan_cuti', ['nama'], ['x'.repeat(950 * 1024)]), /terlalu besar/);

    process.env.DATA_PROVIDER = 'firebase';
    process.env.FIREBASE_PROJECT_ID = 'demo-glink-test';
    // Ensure a developer's local MySQL/Firebase env file cannot change the target.
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    process.env.FIREBASE_STORAGE_BUCKET = 'demo-glink-test.appspot.com';
    process.env.BACKEND_API_SECRET = randomBytes(32).toString('hex');
    const app = require('../server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'content-type': 'application/json', 'x-glink-secret': process.env.BACKEND_API_SECRET };
    assert.equal((await fetch(base + '/api/pengajuan')).status, 401);
    const izin = { nama: 'Pengujian', jabatan: 'Staff', jenis_izin: 'Izin Sakit', alasan: 'Test', tanggal_mulai: '2026-11-16', tanggal_selesai: '2026-11-16', masuk_kembali_tanggal: '2026-11-17' };
    assert.equal((await fetch(base + '/api/pengajuan', { method: 'POST', headers, body: JSON.stringify({ ...izin, tanggal_mulai: '2026-02-31' }) })).status, 400);
    const created = await fetch(base + '/api/pengajuan', { method: 'POST', headers, body: JSON.stringify(izin) });
    assert.equal(created.status, 201, await created.clone().text());
    const { data } = await created.json();
    assert.equal(typeof data.id, 'number');
    let detail = await (await fetch(base + `/api/pengajuan/${data.id}`, { headers })).json();
    assert.equal(detail.data.status_persetujuan, 'Menunggu Persetujuan');
    const approved = await fetch(base + `/api/pengajuan/${data.id}/approval`, { method: 'PUT', headers, body: JSON.stringify({ status_persetujuan: 'Disetujui' }) });
    assert.equal(approved.status, 200);
    const listing = await (await fetch(base + '/api/pengajuan', { headers })).json();
    assert.equal(listing.stats.disetujui, 1);
    assert.equal((await fetch(base + '/api/pengajuan?limit=0', { headers })).status, 400);
    const cuti = await fetch(base + '/api/pengajuan-cuti', { method: 'POST', headers, body: JSON.stringify({ id_karyawan: 'TEST', nama: 'Test', tanggal_mulai: '2026-11-16', tanggal_selesai: '2026-11-18', masuk_kembali_tanggal: '2026-11-19' }) });
    assert.equal(cuti.status, 200, await cuti.clone().text());
    const cutiId = (await cuti.json()).id;
    detail = await (await fetch(base + `/api/pengajuan-cuti/${cutiId}`, { headers })).json();
    assert.equal(detail.data.cuti_akan_diambil, 3);
    assert.equal((await fetch(base + `/api/pengajuan/${data.id}`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(base + `/api/pengajuan/${data.id}`, { headers })).status, 404);
    if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
      assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz0AAAAASUVORK5CYII=', 'base64');
      const form = new FormData();
      for (const [key, value] of Object.entries(izin)) form.set(key, value);
      form.set('surat_dokter', new Blob([png], { type: 'image/png' }), 'test.png');
      const uploaded = await fetch(base + '/api/pengajuan', { method: 'POST', headers: { 'x-glink-secret': process.env.BACKEND_API_SECRET }, body: form });
      assert.equal(uploaded.status, 201, await uploaded.clone().text());
      const id = (await uploaded.json()).data.id;
      const detail = await (await fetch(base + `/api/pengajuan/${id}`, { headers })).json();
      const fileUrl = detail.data.surat_dokter_url;
      assert.equal((await fetch(base + fileUrl)).status, 401);
      const downloaded = await fetch(base + fileUrl, { headers });
      assert.equal(downloaded.status, 200);
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
      const hydrated = await require('../attachments').hydrate(detail.data);
      assert.match(hydrated.surat_dokter_base64, /^data:image\/png;base64,/);
      const direct = await fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/demo-glink-test.appspot.com/o/${encodeURIComponent(fileUrl.slice(1))}?alt=media`);
      assert.ok([401, 403].includes(direct.status));
      await fetch(base + `/api/pengajuan/${id}`, { method: 'DELETE', headers });
      assert.equal((await fetch(base + fileUrl, { headers })).status, 404);
    }
    // Loading Firebase mode never imports or connects to the old MySQL database.
    assert.equal(require.cache[require.resolve('../db')], undefined);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.terminate();
    const { getApps, deleteApp } = require('firebase-admin/app');
    await Promise.all(getApps().map(deleteApp));
  }
});
