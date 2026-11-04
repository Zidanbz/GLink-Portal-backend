# GLink Portal Backend

Express, MySQL/MariaDB, dan generator PDF izin, cuti, serta dinas.

## Development

```bash
npm ci
cp .env.example .env
# Sesuaikan database, Chrome dan UPLOAD_DIR untuk komputer lokal.
npm run dev
```

Gunakan port 5101 agar sesuai proxy frontend. File contoh production memakai DB_PORT=3308 dan upload server; ubah menjadi port database dan direktori upload lokal saat development. Jangan commit `.env`, uploads, atau node_modules.

## Deployment

Mulai dari [panduan GitHub](docs/GITHUB.md). Panduan server, backup, dan rollback ada di [DEPLOYMENT.md](docs/DEPLOYMENT.md). Script dan konfigurasi server ada di `deploy/`.

```bash
npm test
```

Akses awal production hanya melalui SSH tunnel. Autentikasi dan otorisasi aplikasi belum tersedia. Backend mendengarkan loopback secara default.
