const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { singleAttachment } = require('../multipart');

async function serve(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('upload tetap terbaca setelah Functions Framework mengonsumsi multipart stream', async () => {
  const app = express();
  app.use(express.raw({ type: () => true, limit: '5mb' }));
  app.use((req, res, next) => { req.rawBody = req.body; req.body = undefined; next(); });
  app.post('/upload', singleAttachment(multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })), (req, res) => {
    res.json({ nama: req.body.nama, file: req.file.buffer.toString(), type: req.file.mimetype });
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  await serve(app, async base => {
    const form = new FormData();
    form.set('nama', 'Test Functions');
    form.set('surat_dokter', new Blob(['test-file'], { type: 'image/png' }), 'note.png');
    const response = await fetch(base + '/upload', { method: 'POST', body: form });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { nama: 'Test Functions', file: 'test-file', type: 'image/png' });
    const large = new FormData();
    large.set('surat_dokter', new Blob([Buffer.alloc(4 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
    assert.equal((await fetch(base + '/upload', { method: 'POST', body: large })).status, 413);
  });
});

test('Firebase entrypoint memilih Firestore dan melindungi API tanpa koneksi MySQL', async () => {
  const secret = randomBytes(32).toString('hex');
  process.env.BACKEND_API_SECRET = secret;
  process.env.DATA_PROVIDER = 'mysql';
  const { api } = require('../functions');
  const outer = express();
  outer.use(api);
  await serve(outer, async base => {
    assert.equal((await fetch(base + '/api/health')).status, 401);
    const response = await fetch(base + '/api/health', { headers: { 'x-glink-secret': secret } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
    assert.equal(process.env.DATA_PROVIDER, 'firebase');
    assert.equal(require.cache[require.resolve('../db')], undefined);
  });
});
