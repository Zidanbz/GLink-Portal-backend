const { getApps, initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

function firebaseApp() {
  if (getApps().length) return getApps()[0];
  const config = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || config.projectId;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID wajib diisi.');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!!clientEmail !== !!privateKey) throw new Error('Isi FIREBASE_CLIENT_EMAIL dan FIREBASE_PRIVATE_KEY bersama.');
  const credential = clientEmail ? cert({ projectId, clientEmail, privateKey }) : applicationDefault();
  return initializeApp({ projectId, credential, storageBucket: process.env.FIREBASE_STORAGE_BUCKET });
}

module.exports = {
  firestore: () => getFirestore(firebaseApp()),
  bucket: () => {
    if (!process.env.FIREBASE_STORAGE_BUCKET) throw new Error('FIREBASE_STORAGE_BUCKET wajib diisi untuk lampiran.');
    return getStorage(firebaseApp()).bucket();
  },
};
