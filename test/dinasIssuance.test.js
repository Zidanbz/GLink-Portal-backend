const { test } = require('node:test');
const assert = require('node:assert/strict');
const { issuanceDate, previewDinasNumbers, issueDinas } = require('../dinasIssuance');

test('tanggal penerbitan mengikuti Makassar saat pergantian bulan dan tahun', async () => {
  assert.equal(issuanceDate(new Date('2026-10-31T15:59:59Z')), '2026-10-31');
  assert.equal(issuanceDate(new Date('2026-10-31T16:00:00Z')), '2026-11-01');
  assert.equal(issuanceDate(new Date('2026-12-31T16:00:00Z')), '2027-01-01');
  const connection = { query: async () => [[{ nomor_surat: 'STD/0071/GL/X/2026', nomor_nota: '071/GL-HRGA/PJN/X/2026' }]] };
  const november = await previewDinasNumbers(connection, new Date('2026-10-31T16:00:00Z'));
  assert.equal(november.nomor_surat, 'STD/0072/GL/XI/2026');
  const january = await previewDinasNumbers(connection, new Date('2026-12-31T16:00:00Z'));
  assert.equal(january.nomor_surat, 'STD/0072/GL/I/2027');
  assert.equal(january.nomor_nota, '072/GL-HRGA/PJN/I/2027');
});

test('penerbitan MySQL: urutan, paralel, preview, rollback, dan PDF', { skip: process.env.DINAS_TEST_MYSQL !== '1' }, async () => {
  const source = require('../db');
  const mysql = require('mysql2/promise');
  const database = `dinas_test_${process.pid}_${Date.now()}`;
  let isolated;
  try {
    // Only copy the schema; never insert test documents into the application database.
    await source.query(`CREATE DATABASE \`${database}\``);
    const [[{ current_database }]] = await source.query('SELECT DATABASE() AS current_database');
    await source.query(`CREATE TABLE \`${database}\`.pengajuan_dinas LIKE \`${current_database.replaceAll('`', '``')}\`.pengajuan_dinas`);
    isolated = mysql.createPool({
      host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '', database, connectionLimit: 5
    });
    const staleInput = { nomor_surat: 'STD/0001/GL/X/2020', nomor_nota: '001/GL-HRGA/PJN/X/2020', tanggal_surat: '2020-10-01' };
    const initial = await previewDinasNumbers(isolated);
    assert.match(initial.nomor_surat, /^STD\/0071\//);
    assert.deepEqual(await previewDinasNumbers(isolated), initial);
    const first = await issueDinas(isolated, staleInput);
    assert.equal(first.data.nomor_surat, initial.nomor_surat);
    assert.equal(first.data.tanggal_surat, issuanceDate());
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => issueDinas(isolated, staleInput)));
    assert.deepEqual(concurrent.map(item => Number(item.data.nomor_surat.split('/')[1])).sort(), [72, 73, 74]);
    const beforeFailure = await previewDinasNumbers(isolated);
    await assert.rejects(issueDinas(isolated, staleInput, async () => { throw new Error('PDF gagal'); }), /PDF gagal/);
    assert.deepEqual(await previewDinasNumbers(isolated), beforeFailure);
    await assert.rejects(issueDinas(isolated, { tanggal_mulai: 'invalid-date' }));
    assert.deepEqual(await previewDinasNumbers(isolated), beforeFailure);
    const { generateDinasPdfFromData } = require('../pdfDinasGenerator');
    const pdf = await issueDinas(isolated, { ...staleInput, penerima_tugas_nama: 'Pengujian' }, generateDinasPdfFromData);
    assert.equal(Buffer.from(pdf.pdfBuffer).subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.data.nomor_surat, /^STD\/0075\//);
    const [[{ count }]] = await isolated.query('SELECT COUNT(*) AS count FROM pengajuan_dinas');
    assert.equal(count, 5);
  } finally {
    if (isolated) await isolated.end();
    await source.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await source.end();
  }
});
