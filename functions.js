const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');

const backendSecret = defineSecret('BACKEND_API_SECRET');
const storageBucket = defineString('GLINK_STORAGE_BUCKET', {
  default: 'approval-9134e.firebasestorage.app',
  description: 'Nama bucket aplikasi tanpa gs://.',
});
let app;

exports.api = onRequest({
  region: 'asia-southeast1',
  memory: '2GiB',
  cpu: 1,
  concurrency: 1, // One Chromium render per instance avoids memory spikes.
  minInstances: 0,
  maxInstances: 3,
  timeoutSeconds: 60,
  invoker: 'public', // Application middleware verifies the server-to-server secret.
  cors: false,
  secrets: [backendSecret],
}, (req, res) => {
  // Only this entrypoint selects Firebase. The old node server.js keeps MySQL.
  process.env.DATA_PROVIDER = 'firebase';
  process.env.FIREBASE_STORAGE_BUCKET = storageBucket.value();
  app ||= require('./server');
  return app(req, res);
});
