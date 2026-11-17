const { Readable } = require('node:stream');

function singleAttachment(upload) {
  const parse = upload.single('surat_dokter');
  return (req, res, next) => {
    if (!Buffer.isBuffer(req.rawBody) || !req.is('multipart/form-data')) return parse(req, res, next);
    // Functions Framework has already consumed the socket stream. Replay only
    // multipart bytes to multer; JSON bodies are already parsed by the framework.
    if (req.rawBody.length > 4 * 1024 * 1024) {
      return next(Object.assign(new Error('Total ukuran formulir maksimal 4 MB.'), { status: 413 }));
    }
    const replay = Readable.from([req.rawBody]);
    replay.headers = req.headers;
    replay.method = req.method;
    parse(replay, res, error => {
      req.body = replay.body;
      req.file = replay.file;
      next(error);
    });
  };
}
module.exports = { singleAttachment };
