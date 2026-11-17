# Backend Firebase Functions + frontend Vercel

Arsitektur: browser → Next.js di Vercel → Express di Firebase Functions generasi 2 → Firestore / Storage privat. Backend **tidak perlu di-deploy ke Vercel**.

MySQL lama, data, lampiran, dan service server lama tetap dipertahankan. `node server.js` masih memakai MySQL secara default. Hanya entrypoint `functions.js` yang memilih Firestore. Tidak ada migrasi atau sinkronisasi otomatis. Gunakan satu deployment untuk menerbitkan dokumen resmi agar nomor dari dua database tidak bertabrakan. Firebase baru dimulai dengan data kosong dan nomor dinas 0071/071.

Backend awal sudah di-deploy dan diuji: health terproteksi, pembacaan Firestore, dan preview PDF. URL aktif: `https://asia-southeast1-approval-9134e.cloudfunctions.net/api`. Artifact Registry memiliki cleanup policy untuk image yang lebih lama dari 7 hari. Pengujian cloud tidak membuat pengajuan atau mengambil nomor surat resmi.

## 1. Firebase yang sudah dibuat

- Project ID: `approval-9134e`.
- Database Firestore: `(default)`.
- Storage bucket: `approval-9134e.firebasestorage.app`.
- Rules privat: `firebase/firestore.rules` dan `firebase/storage.rules`.
- Paket Blaze aktif. Functions, Cloud Build, Artifact Registry, Secret Manager, serta Storage dapat menimbulkan biaya; gunakan budget alert. Alert bukan batas belanja otomatis.

Backend menggunakan Application Default Credentials dari service account runtime Functions. **Private key JSON tidak diperlukan**, dan kredensial Firebase tidak perlu dimasukkan ke Vercel. Jika sudah mengunduh key dan tidak digunakan di tempat lain, hapus key tersebut melalui Google Cloud IAM → Service Accounts → akun terkait → Keys.

Untuk akses minimum, service account runtime membutuhkan Cloud Datastore User pada project, Storage Object User pada bucket aplikasi, dan akses ke secret yang diikat ke function. Jangan memberikan Owner untuk mengatasi error izin. Akun yang menjalankan deploy juga membutuhkan izin deployment, mengaktifkan API, dan mengatur IAM sesuai pemeriksaan Firebase CLI. Pada project baru, role service account runtime dapat perlu diatur melalui Google Cloud IAM.

## 2. Persiapan lokal dan secret

Jalankan dari folder repository backend:

```sh
npm ci
firebase login
```

Firebase CLI harus sudah terpasang (`npm install -g firebase-tools` jika belum). Untuk deploy, gunakan Node.js 22 yang sesuai runtime. Node.js runtime ditetapkan ke **22**, region **asia-southeast1**, memory **2 GiB**, concurrency **1**, minInstances **0**, maxInstances **3**, dan timeout **60 detik**. Batas instance membatasi konkurensi; bukan hard cap biaya.

Buat secret sekali di terminal pribadi:

```sh
openssl rand -hex 32
firebase functions:secrets:set BACKEND_API_SECRET --project approval-9134e
```

Salin hasil random ke prompt secret. Simpan nilainya di password manager karena nilai yang sama akan digunakan pada environment **server frontend Vercel**. Jangan kirim ke chat atau commit ke Git. SDK mengikat secret melalui Secret Manager. Perubahan secret memerlukan deploy ulang function agar versi baru dipakai.

## 3. Deploy backend

```sh
npm run firebase:deploy -- --project approval-9134e
```

Script ini menyiapkan folder `.firebase-functions` dari daftar file yang diizinkan lalu menjalankan Firebase deploy untuk codebase `glink-api` saja. `package-lock.json` disertakan untuk instalasi konsisten. Folder tersebut diabaikan Git dan dibuat ulang setiap deploy. Jangan meletakkan file manual di sana.

`.env` MySQL, private key, folder uploads lokal, skrip server lama, `db.js`, dan repository MySQL tidak disertakan dalam source deploy. Identitas runtime mengakses Firestore secara langsung. `GLINK_STORAGE_BUCKET` adalah parameter non-secret dari `firebase/functions.env`, yang disalin sebagai `.env` khusus pada paket deploy. Jika deploy ke project berbeda, sesuaikan file konfigurasi ini sebelum menyiapkan paket. `.env` MySQL di root repository tidak pernah disalin.

Pada deploy pertama, Firebase CLI bisa meminta pengaktifan Cloud Functions, Cloud Run, Cloud Build, Artifact Registry, dan Secret Manager API. Jika Cloud Functions API masih disabled, aktifkan melalui console atau ikuti prompt deploy. Ikuti error IAM jika akun tidak memiliki izin; tidak perlu menginisialisasi ulang project dengan `firebase init`.

Untuk menerapkan rules yang sudah direview:

```sh
firebase deploy --only firestore:rules,storage --project approval-9134e
```

Function yang dihasilkan bernama **api**. Salin URL dari output deploy, misalnya:

```text
https://asia-southeast1-approval-9134e.cloudfunctions.net/api
```

Gunakan URL aktual dari CLI; URL Cloud Run juga dapat diberikan. Awalan `/api` pada URL function harus tetap disertakan. Karena route Express juga diawali `/api`, URL health berbentuk `...cloudfunctions.net/api/api/health`. Frontend menambahkan path aplikasi secara otomatis tanpa membuang path function.

Endpoint HTTP mengizinkan koneksi jaringan dari frontend Vercel, tetapi seluruh API dilindungi `BACKEND_API_SECRET`. Tanpa header secret mendapat 401; secret tidak terkonfigurasi mendapat 503. Rules Firestore/Storage tetap menolak SDK browser. Rules tidak menggantikan autentikasi API karena Admin SDK melewati rules dan memakai IAM.

## 4. Deploy frontend ke Vercel

Push perubahan backend dan frontend ke repository masing-masing. Import **repository frontend saja** ke Vercel:

- Framework: Next.js.
- Root Directory: `./` jika repository frontend terpisah; `GLink Portal-frontend` jika repository gabungan.
- Install: `npm ci`; Build: `npm run build`.
- Environment server berikut:

| Variable | Isi |
| --- | --- |
| `BACKEND_URL` | URL lengkap function dari output deploy, termasuk `/api` jika ada |
| `BACKEND_API_SECRET` | Sama persis dengan secret di Firebase |
| `APP_ACCESS_USER` | Username gerbang akses, tanpa `:` |
| `APP_ACCESS_PASSWORD` | Password acak minimal 16 karakter |

Jangan gunakan prefix `NEXT_PUBLIC_`. Tidak perlu `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, atau `DB_*` di Vercel. Redeploy frontend setelah environment berubah.

Gerbang username/password ini untuk akses bersama saat uji coba terbatas. Semua pemegang akses mempunyai kemampuan API yang sama, termasuk perubahan approval dan penghapusan. Sebelum dipakai dengan hak akses berbeda antara karyawan/atasan/HR, tambahkan akun dan pemeriksaan peran. Atur rate limit sesuai kebutuhan pada gateway/platform.

## 5. Verifikasi deployment

1. Pastikan frontend meminta login dan backend tanpa secret menolak akses.
2. Buat pengajuan menggunakan data uji; cek collection Firestore dan unduh PDF izin, dinas, cuti.
3. Upload lampiran maksimal **2 MB**, unduh ulang melalui aplikasi, dan pastikan akses Storage langsung tanpa otorisasi ditolak.
4. Periksa log Functions untuk cold start Chromium, memory, dan izin service account. Chromium serverless dijalankan pada cloud; emulator lokal memakai Chrome lokal.
5. Jangan menerbitkan surat resmi paralel pada MySQL dan Firebase. Data/nomor tidak otomatis tersinkron. Rencanakan impor read-only dari MySQL dan counter tertinggi secara terpisah jika data lama perlu ditampilkan.

Upload Functions Framework menyediakan `rawBody` karena stream telah dikonsumsi; middleware khusus memutar ulang multipart ke multer. Attachment dipersist ke Storage privat, bukan disk runtime. PDF lampiran dapat diunduh tetapi belum digabung sebagai halaman PDF surat.

Vercel frontend masih meneruskan API, sehingga batas request/response buffered sekitar **4,5 MB** tetap perlu diperhatikan walaupun backend ada di Firebase. Lampiran dibatasi 2 MB dan replay multipart 4 MB. Firestore memiliki batas dokumen 1 MiB; backend membatasi data terserialisasi 900 KiB. Untuk file besar, alur upload/download langsung ke storage privat memerlukan pengembangan terpisah.

API daftar menggunakan `limit` (default 100, maksimum 200) dan cursor `before`, serta `nextCursor` pada respons. Filter Firebase diterapkan pada halaman yang dibaca, bukan pencarian global; lanjutkan cursor meskipun hasil kosong. Statistik izin menggunakan aggregate count seluruh collection.

## 6. Pengujian lokal

```sh
npm test
npm run firebase:prepare
```

Unit test mencakup replay multipart dan entrypoint Functions tanpa koneksi MySQL. Integration Firestore/Storage dan MySQL opt-in; jangan jalankan pada data nyata.

Untuk emulator Functions, Firestore, dan Storage (Firebase CLI terbaru memerlukan Java 21+):

```sh
npm run firebase:emulators
```

Untuk mengirim request autentikasi lokal, sediakan secret emulator lewat environment lokal atau `.firebase-functions/.secret.local` **setelah** prepare; folder ini dibuat ulang oleh prepare. Jangan commit file secret. Selalu gunakan project `demo-glink-test`, tidak project production.

Untuk integration repository dengan emulator aktif:

```sh
GLINK_TEST_FIREBASE=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm test
```

## Referensi

- https://firebase.google.com/docs/functions/http-events
- https://firebase.google.com/docs/functions/manage-functions
- https://firebase.google.com/docs/functions/config-env
- https://firebase.google.com/docs/admin/setup
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
