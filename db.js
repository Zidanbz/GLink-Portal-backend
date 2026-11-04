const mysql = require('mysql2/promise');
require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  for (const key of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!process.env[key] || process.env[key] === 'REPLACE_ON_SERVER') {
      throw new Error(`Konfigurasi production ${key} wajib diisi.`);
    }
  }
  if (process.env.DB_USER === 'root') throw new Error('Gunakan user database khusus aplikasi untuk production.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'globallink_approval',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
