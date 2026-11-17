const pool = require('../db');
const tables = new Set(['pengajuan_izin', 'pengajuan_cuti', 'pengajuan_dinas']);
function tableName(table) {
  if (!tables.has(table)) throw new Error('Tabel tidak didukung.');
  return table;
}

module.exports = {
  provider: 'mysql',
  pool,
  async list(table, { search, status, jenis, limit = 100, before } = {}) {
    let sql = `SELECT * FROM ${tableName(table)} WHERE 1=1`;
    const params = [];
    if (before) { sql += ' AND id < ?'; params.push(before); }
    if (table === 'pengajuan_izin') {
      if (search) {
        sql += ' AND (nama LIKE ? OR jabatan LIKE ? OR nomor_surat LIKE ? OR alasan LIKE ?)';
        params.push(...Array(4).fill(`%${search}%`));
      }
      if (status && status !== 'Semua') { sql += ' AND status_persetujuan = ?'; params.push(status); }
      if (jenis && jenis !== 'Semua') { sql += ' AND jenis_izin = ?'; params.push(jenis); }
    }
    params.push(limit);
    const [rows] = await pool.query(sql + ' ORDER BY id DESC LIMIT ?', params);
    return { rows, nextCursor: rows.length === limit ? rows.at(-1).id : null };
  },
  async get(table, id) {
    const [rows] = await pool.query(`SELECT * FROM ${tableName(table)} WHERE id = ?`, [id]);
    return rows[0] || null;
  },
  async insert(table, columns, values) {
    if (!columns.every(column => /^[a-z_]+$/.test(column))) throw new Error('Kolom tidak valid.');
    const [result] = await pool.query(`INSERT INTO ${tableName(table)} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
    return result;
  },
  async updateApproval(id, data) {
    const entries = Object.entries(data).filter(([key, value]) => !['tanda_tangan_atasan', 'paraf_hrd'].includes(key) || value);
    await pool.query(`UPDATE pengajuan_izin SET ${entries.map(([key]) => `${key} = ?`).join(',')} WHERE id = ?`, [...entries.map(([, value]) => value), id]);
  },
  async remove(table, id) { await pool.query(`DELETE FROM ${tableName(table)} WHERE id = ?`, [id]); },
  async nextIzinNumber(prefix) {
    const [rows] = await pool.query('SELECT nomor_surat FROM pengajuan_izin WHERE nomor_surat LIKE ? ORDER BY id DESC LIMIT 1', [`${prefix}/%`]);
    return `${prefix}/${String((Number(rows[0]?.nomor_surat.split('/').pop()) || 0) + 1).padStart(3, '0')}`;
  },
  async stats() {
    const [[stats]] = await pool.query(`SELECT COUNT(*) AS total,
      SUM(status_persetujuan = 'Menunggu Persetujuan') AS pending,
      SUM(status_persetujuan = 'Disetujui') AS disetujui,
      SUM(status_persetujuan = 'Ditangguhkan') AS ditangguhkan,
      SUM(status_persetujuan = 'Ditolak') AS ditolak FROM pengajuan_izin`);
    return stats;
  },
};
