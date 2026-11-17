# Firebase + Vercel, tanpa menghapus MySQL

Konfigurasi ini menyiapkan **deployment baru**. Database, data, lampiran, dan service di server lama tidak diubah atau dihapus. `DATA_PROVIDER` default tetap `mysql`; hanya deployment dengan `DATA_PROVIDER=firebase` memakai Firestore. Jangan mengubah `.env` server lama untuk mencoba Vercel.

Firebase baru mulai dengan data kosong. Tidak ada migrasi atau sinkronisasi otomatis dari MySQL. Pilih satu deployment untuk menerbitkan dokumen resmi; dua database terpisah bisa menerbitkan nomor yang sama. Nomor dinas Firebase baru mulai dari 0071/071. Sebelum dipakai resmi, rencanakan impor data/counter tertinggi dari MySQL atau tetapkan awal nomor yang disepakati; jangan mengedit counter ketika aplikasi sedang menerima pengajuan.

## 1. Membuat Firebase

1. Buka https://console.firebase.google.com/ dan pilih **Create a project**. Analytics tidak diperlukan untuk aplikasi ini. Catat **Project ID**.
2. Buat **Cloud Firestore**, pilih **Standard / Native mode**, database `(default)`, dan lokasi dekat pengguna/server, misalnya Singapore jika tersedia. Pilih production mode; jangan membuka akses dengan test rules.
3. Aktifkan **Cloud Storage** untuk lampiran. Firebase Storage memerlukan paket **Blaze** dan billing aktif. Kuota tanpa biaya bukan jaminan semua penggunaan gratis. Pasang budget alert; alert bukan pembatas pengeluaran otomatis. Catat bucket persis dari console, misalnya `PROJECT_ID.firebasestorage.app` (tanpa `gs://`).
4. Untuk akses backend, gunakan service account khusus. Di Google Cloud IAM, berikan **Cloud Datastore User** pada project dan **Storage Object User** hanya pada bucket aplikasi. Buat JSON key untuk akun itu dan simpan secara privat di luar repository. Backend hanya memerlukan `project_id`, `client_email`, dan `private_key` dari key tersebut. Jangan kirim key lewat chat atau memasukkannya ke frontend/Git.
5. Terapkan rules di `firebase/firestore.rules` dan `firebase/storage.rules` lewat tab Rules di console. Alternatif dari folder backend, setelah Firebase CLI terpasang:

   ```sh
   firebase login
   firebase deploy --only firestore:rules,storage --project PROJECT_ID
   ```

Rules menolak seluruh akses SDK browser. Admin SDK backend mengakses lewat IAM, sehingga rules bukan pengganti autentikasi pada API. Tidak perlu memasang Firebase web SDK atau public API key di frontend.

## 2. Deploy backend ke Vercel

Gunakan dua project Vercel agar kedua repository yang sudah ada tetap dapat dideploy sendiri.

- Import repository backend. Jika memakai repository gabungan, Root Directory: `GLink Portal-Backend`.
- Framework: **Other**. `vercel.json` menetapkan `framework: null` dan route ke `api/index.js`.
- Build Command: kosong, Output Directory: default; jangan gunakan script packaging/systemd server lama.
- Gunakan Node.js **24.x** di Project Settings. Install Command: `npm ci`.
- Isi environment variable berikut untuk Production dan lingkungan Preview yang memang akan dipakai:

| Variable | Isi |
| --- | --- |
| `DATA_PROVIDER` | `firebase` |
| `FIREBASE_PROJECT_ID` | Project ID Firebase |
| `FIREBASE_CLIENT_EMAIL` | `client_email` dari service account |
| `FIREBASE_PRIVATE_KEY` | `private_key`, termasuk BEGIN/END; menerima newline asli atau literal `\n` |
| `FIREBASE_STORAGE_BUCKET` | Nama bucket, tanpa `gs://` |
| `BACKEND_API_SECRET` | Secret acak minimal 32 karakter |
| `TZ` | `Asia/Makassar` |

Generate `BACKEND_API_SECRET` di perangkatmu: `openssl rand -hex 32`. Simpan hasilnya di environment Vercel; jangan commit nilainya. `DB_*`, `UPLOAD_DIR`, `HOST`, dan `CHROME_EXECUTABLE_PATH` tidak dibutuhkan untuk deployment Vercel ini.

Deploy lalu catat URL HTTPS backend. Mengaksesnya langsung tanpa secret memang mendapat 401; jika secret belum dikonfigurasi, mendapat 503. Ini disengaja agar URL backend tidak membuka data karyawan.

## 3. Deploy frontend ke Vercel

- Import repository frontend. Jika repository gabungan, Root Directory: `GLink Portal-frontend`.
- Framework: **Next.js**, Node.js **24.x**, Install: `npm ci`, Build: `npm run build`.
- Isi environment server berikut:

| Variable | Isi |
| --- | --- |
| `BACKEND_URL` | Origin HTTPS backend, misalnya `https://nama-backend.vercel.app`, tanpa `/api` |
| `BACKEND_API_SECRET` | Sama persis dengan secret backend |
| `APP_ACCESS_USER` | Username akses sementara, tanpa karakter `:` |
| `APP_ACCESS_PASSWORD` | Password acak minimal 16 karakter; misalnya buat dengan `openssl rand -hex 24` |

Jangan beri prefix `NEXT_PUBLIC_` pada variable di atas. Secret backend ditambahkan oleh server Next.js, bukan dikirim ke JavaScript browser. Setelah environment berubah, redeploy project terkait.

Pengunjung frontend diminta username/password oleh browser. Gerbang bersama ini cocok untuk uji coba terbatas, **bukan otorisasi per karyawan, atasan, atau HR**. Semua pemegang akses bersama memiliki akses API yang sama, termasuk perubahan persetujuan dan penghapusan. Untuk penggunaan operasional dengan hak akses berbeda, tambahkan akun pengguna dan pemeriksaan peran terlebih dahulu. Atur rate limit di Vercel Firewall sesuai pengguna/paket yang tersedia.

Jika Vercel Deployment Protection memblokir request antardua project, pastikan URL backend production mengizinkan koneksi server frontend, atau konfigurasi bypass deployment protection secara server-only. Jangan membuka secret aplikasi ke browser untuk menyiasatinya.

## 4. Verifikasi setelah deploy

1. Buka URL frontend: tanpa login harus mendapat prompt akses.
2. Buat pengajuan izin, cuti, dan dinas dengan data uji; pastikan data masuk ke collection Firebase yang sesuai dan PDF bisa diunduh.
3. Upload gambar maksimal **2 MB**, lalu unduh ulang lampiran/PDF. Lampiran tersimpan privat di Storage melalui API `/uploads/...`, tanpa download token publik. PDF lampiran dapat diunduh, tetapi tidak digabung sebagai halaman gambar ke PDF surat.
4. Pastikan request langsung ke backend tanpa secret ditolak dan akses langsung ke Firestore/Storage dari SDK browser ditolak oleh rules.
5. Periksa log Vercel untuk cold start Chromium, durasi PDF, dan ukuran bundle. PDF lokal sudah dapat diuji, tetapi binary Linux/serverless tetap perlu smoke test pada deployment nyata.
6. Jika ingin memakai MySQL lagi, gunakan deployment server lama dengan konfigurasi lamanya. Data baru Firebase tidak otomatis masuk kembali ke MySQL.

## Batasan dan alur data

- Vercel Functions membatasi request/response buffered sekitar **4,5 MB**. Lampiran dibatasi 2 MB agar ada ruang untuk form dan tanda tangan; total request tetap harus di bawah batas platform. PDF yang terlalu besar perlu dikompres atau nantinya diunduh langsung dari storage privat lewat URL sementara.
- Firestore membatasi dokumen **1 MiB**; backend membatasi data terserialisasi 900 KiB. Lampiran disimpan di Storage, bukan sebagai base64 di Firestore. Tanda tangan tetap berupa data URL pada dokumen seperti struktur lama.
- Penomoran izin Firebase menggunakan transaksi counter; nomor yang sudah dipesan dapat terlewati jika penyimpanan selanjutnya gagal. Nomor tidak dipakai ulang. Nomor dinas dan data disimpan atomik setelah PDF berhasil dibuat. Jika ada benturan nomor dinas, PDF dirender ulang dengan nomor baru; setelah lima benturan request mendapat 409 untuk dicoba lagi.
- API daftar menggunakan `?limit=100&before=ID`, maksimal 200 per halaman, serta `nextCursor` pada respons. Pada Firebase, filter substring/status/jenis diterapkan **pada halaman yang dibaca**, bukan pencarian global. Lanjutkan cursor meskipun hasil filter kosong. Statistik izin menggunakan aggregate count untuk seluruh collection. Untuk dashboard besar, tambahkan pencarian khusus dan UI pagination.
- Frontend dan API memakai origin yang sama bagi browser; server frontend meneruskan request ke backend. Tidak ada penulisan ganda ke MySQL dan Firebase.
- Preview/development sebaiknya memakai project Firebase terpisah dari production agar percobaan tidak menerbitkan nomor atau menyimpan data ke production.

## Pengujian lokal

`npm test` di backend menjalankan unit test; pengujian MySQL dan Firebase integration bersifat opt-in.

Untuk integration Firebase, gunakan project emulator `demo-glink-test` saja (bukan project nyata):

```sh
firebase emulators:start --only firestore,storage --project demo-glink-test
```

Di terminal lain, dari folder backend:

```sh
GLINK_TEST_FIREBASE=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm test
```

CLI Firebase terbaru memerlukan Java 21+. Test membersihkan collection pada **emulator demo lokal** sebelum berjalan dan tidak membuka koneksi MySQL. Jangan mengatur variable emulator di deployment production.

## Referensi

- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/security/insecure-rules
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://vercel.com/docs/functions/limitations
- https://github.com/Sparticuz/chromium
