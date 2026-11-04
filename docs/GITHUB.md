# Deploy dari dua repository GitHub

Backend: `https://github.com/Zidanbz/GLink-Portal-backend.git`.
Frontend: `https://github.com/Zidanbz/GLink-Portal-frontend.git`.

Repository backend menyimpan `deploy/` serta dokumentasi. Kedua checkout harus berdampingan dengan nama persis berikut:

```text
/home/globallink/glink-source/
  GLink Portal-Backend/
    deploy/
    docs/
  GLink Portal-frontend/
```

Server: Debian 13 amd64, SSH `103.164.21.52:2243`. Company profile tetap memakai port 3000/5001/3307. GLink Portal memakai 3100/5101/3308; tidak mengubah container company profile.

## Sebelum push

Commit backend awal sudah memuat `.env`, uploads, dan node_modules. Penghapusan dari commit terbaru saja tidak menghapus riwayat sebelumnya. Rotasi kredensial yang pernah disimpan pada `.env`, batasi visibility repository, dan koordinasikan pembersihan history sebelum dibagikan. Jangan melakukan force push tanpa persetujuan pemilik dan backup repository. Jika history dibersihkan, collaborator harus mengikuti prosedur clone ulang agar commit lama tidak masuk kembali.

## Laptop: commit dan push perubahan berikutnya

Periksa `git status` dan `git diff --cached` sebelum commit. Jangan masukkan data karyawan atau secret.

```bash
cd "GLink Portal-Backend"
git add .
git diff --cached --stat
git commit -m "Describe backend changes"
git push origin main
cd "../GLink Portal-frontend"
git add .
git diff --cached --stat
git commit -m "Describe frontend changes"
git push origin main
```

Repository terpisah tidak memiliki satu commit bersama. Catat SHA kedua repository untuk setiap deployment agar pasangan versi dapat ditelusuri. Jangan menyimpan password/token pada URL remote.

## Server: akses GitHub untuk repo private

Gunakan SSH deploy key read-only. Sebagai user `globallink` (bukan root):

```bash
install -d -m 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/glink_backend_deploy -C "webgloballink backend read-only"
ssh-keygen -t ed25519 -f ~/.ssh/glink_frontend_deploy -C "webgloballink frontend read-only"
cat ~/.ssh/glink_backend_deploy.pub
cat ~/.ssh/glink_frontend_deploy.pub
```

Pasang masing-masing public key di GitHub repository terkait: Settings → Deploy keys → Add deploy key. Biarkan **Allow write access** tidak dicentang. Private key tetap di server; jangan kirim ke chat atau GitHub. Public key kedua repository berbeda karena deploy key terikat ke repository.

Tambahkan blok berikut ke `~/.ssh/config` tanpa menimpa konfigurasi lain:

```sshconfig
Host github-glink-backend
    HostName github.com
    User git
    IdentityFile ~/.ssh/glink_backend_deploy
    IdentitiesOnly yes

Host github-glink-frontend
    HostName github.com
    User git
    IdentityFile ~/.ssh/glink_frontend_deploy
    IdentitiesOnly yes
```

```bash
chmod 600 ~/.ssh/config
ssh -T github-glink-backend
ssh -T github-glink-frontend
```

Verifikasi fingerprint host GitHub lewat dokumentasi resminya sebelum menerima host key. Pesan authenticated tetapi tidak menyediakan shell normal; `ssh -T` bisa keluar dengan status 1 walaupun autentikasi berhasil.

## Clone pertama

Sebagai `globallink`:

```bash
mkdir -p ~/glink-source
cd ~/glink-source
git clone git@github-glink-backend:Zidanbz/GLink-Portal-backend.git "GLink Portal-Backend"
git clone git@github-glink-frontend:Zidanbz/GLink-Portal-frontend.git "GLink Portal-frontend"
git -C "GLink Portal-Backend" rev-parse HEAD
git -C "GLink Portal-frontend" rev-parse HEAD
```

Jangan jalankan script dari branch atau pull request yang belum dipercaya. Pastikan commit persiapan deploy sudah tersedia: backend harus punya `deploy/setup-database.sh`, frontend harus mengarah ke port backend 5101.

Lanjutkan panduan [DEPLOYMENT.md](DEPLOYMENT.md), dengan path script di:

```text
/home/globallink/glink-source/GLink Portal-Backend/deploy/
```

Semua path mengandung spasi, sehingga wajib diberi tanda kutip pada command. Contoh tahap sesudah user aplikasi/dependency dibuat dan port 3308 dipastikan kosong:

```bash
# Sebagai root, SETUP DATABASE HANYA SEKALI:
bash "/home/globallink/glink-source/GLink Portal-Backend/deploy/setup-database.sh"
docker compose -f /srv/glink-portal/database/compose.yml up -d --wait --wait-timeout 180
```

Setup runtime Node, Chrome, user `glink`, uploads shared, serta instalasi unit systemd tetap mengikuti DEPLOYMENT.md. Jangan menjalankan release.sh sebelum prasyarat itu selesai.

## Update di server

Jalankan pull sebagai `globallink` agar checkout tidak menjadi milik root:

```bash
cd ~/glink-source
git -C "GLink Portal-Backend" status --short
git -C "GLink Portal-frontend" status --short
# Jika ada perubahan lokal, hentikan proses dan review; jangan reset --hard.
git -C "GLink Portal-Backend" pull --ff-only origin main
git -C "GLink Portal-frontend" pull --ff-only origin main
git -C "GLink Portal-Backend" rev-parse HEAD
git -C "GLink Portal-frontend" rev-parse HEAD
```

`--ff-only` menolak divergensi alih-alih membuat merge otomatis. Jika salah satu pull gagal, hentikan deployment. Setelah kedua checkout sesuai versi yang dituju, sebagai root:

```bash
bash "/home/globallink/glink-source/GLink Portal-Backend/deploy/backup.sh"
# Lanjut hanya jika backup sukses, lalu:
bash "/home/globallink/glink-source/GLink Portal-Backend/deploy/release.sh"
```

Release script membangun dari dua checkout ke direktori release baru sebelum pergantian layanan. Jangan pull source ketika build berlangsung. Pembaruan file systemd/Nginx dan migrasi database harus direview dan diterapkan terpisah; tidak otomatis oleh pull/release. Jangan menjalankan setup database berulang.

Akses dari laptop:

```bash
ssh -p 2243 -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8088:127.0.0.1:3100 globallink@103.164.21.52
```

Buka http://127.0.0.1:8088. Uji PDF izin/cuti/dinas, data, lampiran, dan website company profile. Tutup tunnel dengan Ctrl+C.
