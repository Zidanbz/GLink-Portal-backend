require('dotenv').config();
const provider = process.env.DATA_PROVIDER || 'mysql';
if (!['mysql', 'firebase'].includes(provider)) throw new Error('DATA_PROVIDER harus mysql atau firebase.');
module.exports = provider === 'firebase'
  ? require('./firestore').createFirestoreRepository()
  : require('./mysql');
