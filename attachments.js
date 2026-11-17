const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const { bucket } = require('./firebase/admin');
const useFirebase = () => process.env.DATA_PROVIDER === 'firebase';
const localDirectory = () => process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };
function filename(value) {
  const name = value.replace(/^\/uploads\//, '');
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$/.test(name)) {
    throw Object.assign(new Error('Lampiran tidak ditemukan.'), { status: 404 });
  }
  return name;
}
function detectType(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return '.pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return '.jpg';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return '.webp';
  throw Object.assign(new Error('Isi lampiran bukan JPG, PNG, WEBP, atau PDF yang valid.'), { status: 400 });
}
async function read(value) {
  const name = filename(value);
  let buffer;
  try {
    if (useFirebase()) [buffer] = await bucket().file(`uploads/${name}`).download();
    else buffer = await fs.readFile(path.join(localDirectory(), name));
  } catch (error) {
    if (error.code === 404 || error.code === 'ENOENT') throw Object.assign(new Error('Lampiran tidak ditemukan.'), { status: 404 });
    throw error;
  }
  return { buffer, contentType: types[path.extname(name)] };
}
module.exports = {
  read,
  async save(file) {
    const ext = detectType(file.buffer);
    const name = `lampiran-${randomUUID()}${ext}`;
    if (useFirebase()) {
      await bucket().file(`uploads/${name}`).save(file.buffer, {
        resumable: false, metadata: { contentType: types[ext], cacheControl: 'private, no-store' },
      });
    } else {
      await fs.mkdir(localDirectory(), { recursive: true });
      await fs.writeFile(path.join(localDirectory(), name), file.buffer, { flag: 'wx', mode: 0o600 });
    }
    return `/uploads/${name}`;
  },
  async remove(value) {
    const name = filename(value);
    if (useFirebase()) await bucket().file(`uploads/${name}`).delete({ ignoreNotFound: true });
    else await fs.rm(path.join(localDirectory(), name), { force: true });
  },
  async hydrate(data) {
    if (!data.surat_dokter_url) return data;
    const file = await read(data.surat_dokter_url);
    // PDFs are downloadable attachments; the existing template embeds images only.
    if (!file.contentType.startsWith('image/')) return data;
    return { ...data, surat_dokter_base64: `data:${file.contentType};base64,${file.buffer.toString('base64')}` };
  },
};
