> Untuk deployment dari dua repository GitHub, mulai dari [GITHUB.md](GITHUB.md). Panduan ini juga mencakup jalur paket tar yang disiapkan sebelumnya; path staging menyesuaikan lokasi checkout.

# Deploy GLink Portal — Ubuntu / Debian

Panduan untuk server `103.164.21.52`, SSH port `2243`, user `globallink`.
Server sudah memiliki website lain dan belum ada domain GLink Portal. Tahap awal menggunakan SSH tunnel; tidak perlu membuka port publik tambahan atau mengganti konfigurasi website lama.

**Status:** konfigurasi lokal disesuaikan dengan hasil pemeriksaan server. Belum ada perubahan server oleh assistant. Server Debian 13 amd64, RAM 3,8 GiB (available sekitar 2,6 GiB saat diperiksa), disk kosong sekitar 22 GiB. Company profile berjalan di project Docker `company-profile-globallink`, dengan frontend 3000, backend 5001, MariaDB 3307, dan Nginx publik 80/443. Jangan ubah container, volume, atau konfigurasi site company profile.

GLink Portal memakai frontend **3100**, backend **5101**, reverse proxy opsional **8088**, dan database Docker terpisah di **3308**, semuanya loopback. Port 3100/5101/8088 sudah diperiksa kosong; port 3308 masih perlu diperiksa sebelum database dibuat. Penggunaan database terpisah dipilih agar tidak mengubah database company profile; pantau RAM saat build dan penggunaan Chrome.

## 1. Masuk melalui Terminal

Dari Terminal laptop:

```bash
ssh -p 2243 globallink@103.164.21.52
```

Pada koneksi pertama, cocokkan fingerprint host dengan admin server sebelum menerima. Masukkan password user melalui prompt; karakter password memang tidak terlihat. Jangan menulis password di command, dokumentasi, atau Git.

Untuk menjadi root di dalam server:

```bash
su -
whoami
```

Masukkan password root pada prompt. Hasil `whoami` harus `root`. `exit` satu kali keluar dari root ke user biasa; `exit` berikutnya menutup SSH.

Password yang pernah dibagikan di chat sebaiknya diganti secara terkoordinasi dengan admin. Dari root gunakan `passwd globallink` dan `passwd root`. Simpan di password manager. Pertahankan sesi SSH aktif dan uji login di terminal kedua sebelum menutupnya. Jangan menonaktifkan login password sebelum SSH key teruji.

Opsional, buat SSH key **di laptop**, lalu pasang ke user biasa:

```bash
ssh-keygen -t ed25519 -C "glink-deploy"
ssh-copy-id -p 2243 globallink@103.164.21.52
```

Di macOS jika `ssh-copy-id` belum tersedia, minta admin memasang public key `~/.ssh/id_ed25519.pub` ke `~/.ssh/authorized_keys` user server. Private key tetap di laptop.

## 2. Periksa server sebelum instalasi

Di server sebagai root:

```bash
cat /etc/os-release
uname -m
free -h
df -h
ss -lntp
systemctl --type=service --state=running
command -v nginx
command -v apache2
command -v mysql
command -v mariadb
```

Pastikan `127.0.0.1:3100`, `127.0.0.1:5101`, dan opsional `127.0.0.1:8088` belum dipakai. Jika sudah dipakai, pilih port lain dan sesuaikan `backend.env`, frontend rewrites di `next.config.ts`, unit frontend, Nginx, dan health check di `release.sh` **sebelum build**. Jangan mematikan proses pemilik port.

Build Next.js dan Chrome membutuhkan RAM; target awal praktis RAM 4 GB dengan ruang disk untuk dependency, beberapa release, dan backup. Sesuaikan dengan beban website lain. Jangan menjalankan full OS upgrade, mengubah firewall, mengganti MySQL/MariaDB, atau mengganti Node global sebagai bagian deploy ini.

## Catatan repository sebelum push

Pemeriksaan menemukan `.env` dan isi `uploads/` backend sudah pernah masuk tracking Git. `.gitignore` baru tidak otomatis menghapus file yang sudah tracked. Paket deploy yang disediakan tetap mengecualikan keduanya, sehingga jalur deploy panduan ini tidak mengunggahnya.

Sebelum membagikan/push repository: keluarkan secret dan lampiran dari tracking dengan review perubahan terlebih dahulu, rotasi kredensial yang pernah terpublikasi, dan koordinasikan pembersihan riwayat jika diperlukan. Jangan mengandalkan penghapusan file pada commit terbaru untuk menghapus secret dari riwayat. File lokal tidak perlu dihapus. Persiapan GitHub telah mengeluarkan `.env`, `uploads`, dan `node_modules` dari index backend tanpa menghapus file lokal. Riwayat commit lama belum diubah; penghapusan dari index tidak menghapus versi lama yang sudah ada di GitHub.

## 3. Buat paket source di laptop

Jalankan dari root proyek yang berisi dua folder aplikasi dan folder `deploy`:

```bash
bash deploy/package.sh /tmp/glink-portal-source.tar.gz
scp -P 2243 /tmp/glink-portal-source.tar.gz globallink@103.164.21.52:~/glink-portal-source.tar.gz
```

`ssh` memakai `-p` kecil, sedangkan `scp` memakai `-P` besar. Paket mengecualikan `.git`, `node_modules`, `.next`, file `.env*`, dan `uploads`. Konfigurasi contoh tersedia di `deploy/backend.env.example`. Paket tidak memindahkan data lokal atau dokumen karyawan.

Di server sebagai **globallink**, ekstrak ke folder staging baru setiap upload:

```bash
mkdir -p ~/glink-staging
STAGING="$HOME/glink-staging/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$STAGING"
tar -xzf ~/glink-portal-source.tar.gz -C "$STAGING"
printf '%s\n' "$STAGING"
```

Catat path yang dicetak. Contoh selanjutnya menggunakan `/home/globallink/glink-staging/RELEASE_ID`; ganti `RELEASE_ID` dengan nilai sebenarnya.

## 4. Dependency server dan user aplikasi

Kembali menjadi root dengan `su -`. Instal hanya paket yang belum tersedia:

```bash
apt-get update
apt-get install -y ca-certificates curl xz-utils rsync fonts-liberation openssl
adduser --system --group --home /var/lib/glink --no-create-home glink
install -d -o glink -g glink -m 750 /var/lib/glink
install -d -m 755 /srv/glink-portal /srv/glink-portal/releases
install -d -m 750 -o root -g glink /srv/glink-portal/shared
install -d -m 700 -o glink -g glink /srv/glink-portal/shared/uploads
```

Jika user `glink` sudah ada, cek `id glink` dan gunakan hanya jika memang user aplikasi ini. Untuk instalasi pertama, jalankan script Node berikut. Script memasang patch terbaru Node 22 dari nodejs.org dengan pemeriksaan SHA-256, di `/opt/glink-node`; tidak mengubah `/usr/bin/node` atau Node website lain. Dependency Puppeteer proyek mensyaratkan Node minimal 22.12.

```bash
bash /home/globallink/glink-staging/RELEASE_ID/deploy/install-node.sh
/opt/glink-node/current/bin/node --version
```

Tidak perlu mengulang instalasi Node setiap update aplikasi. Perubahan versi Node tetap perlu diuji sebelum mengganti runtime release aktif.

### Chrome untuk PDF

Untuk server **amd64/x86_64**:

```bash
curl -fSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/glink-chrome.deb
apt-get install -y /tmp/glink-chrome.deb
/usr/bin/google-chrome-stable --version
```

Untuk arsitektur lain, gunakan paket Chrome/Chromium resmi yang sesuai OS/CPU dan ubah `CHROME_EXECUTABLE_PATH`. Jangan memasang paket amd64 di ARM. Chrome dijalankan sebagai user `glink`, dengan sandbox tetap aktif. Jika gagal dengan error sandbox/AppArmor, periksa dokumentasi Puppeteer dan kebijakan OS; jangan langsung menambah `--no-sandbox` atau menjalankan aplikasi sebagai root.

### Database

Gunakan container MariaDB khusus GLink Portal. Docker sudah tersedia; tidak perlu memasang MySQL/MariaDB di host atau mengubah container `globallink_mysql`. Project database baru bernama `glink-portal-db`, dengan volume `glink-portal-db_data` terpisah dari `mysql_data` company profile.

## 5. Siapkan database dan konfigurasi rahasia

Sebagai root, periksa port database terlebih dahulu:

```bash
ss -lntp | grep -E ':(3308)\b'
```

Tidak ada output berarti belum ada listener pada port tersebut. Jika terpakai, berhenti dan sesuaikan port Compose serta `DB_PORT` sebelum melanjutkan. Periksa juga `docker compose ls` dan `docker volume ls` agar nama project/volume baru belum digunakan aplikasi lain.

Jalankan setup **satu kali**:

```bash
bash /home/globallink/glink-staging/RELEASE_ID/deploy/setup-database.sh
docker compose -f /srv/glink-portal/database/compose.yml up -d --wait --wait-timeout 180
docker compose -f /srv/glink-portal/database/compose.yml ps
```

Setup membuat password acak root dan aplikasi langsung di server, tanpa mencetak nilainya. File secret berada di `/srv/glink-portal/database/secrets/`, permission root-only. Password aplikasi yang sama otomatis ditulis ke `/srv/glink-portal/shared/backend.env` dengan `DB_PORT=3308`. Setup menolak dijalankan ulang jika konfigurasi telah ada agar password tidak tertimpa.

Image database menginisialisasi schema hanya pada volume kosong, lalu membatasi user `glink_app` ke SELECT/INSERT/UPDATE/DELETE. Schema berisi tiga tabel tanpa record; collation diseragamkan ke `utf8mb4_unicode_ci`. Ini adalah database baru, tidak otomatis memindahkan data pengembangan.

**Jangan menghapus volume atau menjalankan `down -v`.** Pada update rutin, jangan menjalankan setup ulang, import ulang schema, atau mengganti image database sekaligus update aplikasi. File init SQL tidak berlaku lagi pada volume yang sudah berisi data; migrasi berikutnya harus dirancang terpisah.

Periksa inisialisasi tanpa menampilkan secret:

```bash
docker compose -f /srv/glink-portal/database/compose.yml logs --tail=50 db
docker compose -f /srv/glink-portal/database/compose.yml exec -T db sh -c '
  export MYSQL_PWD="$(cat /run/secrets/db_app_password)"
  exec mariadb -u glink_app globallink_approval -e "SHOW TABLES; SHOW GRANTS FOR CURRENT_USER;"
'
```

Pastikan tabel izin/cuti/dinas ada dan user aplikasi tidak memiliki hak CREATE/DROP/ALTER. Jangan membagikan log jika berisi data sensitif. Konfigurasi environment dibaca systemd sebagai root; jangan melakukan `source backend.env` di shell atau mengirim isinya ke chat.

## 6. Instal layanan dan lakukan deploy pertama

Sebagai root:

```bash
install -m 644 /home/globallink/glink-staging/RELEASE_ID/deploy/glink-backend.service /etc/systemd/system/glink-backend.service
install -m 644 /home/globallink/glink-staging/RELEASE_ID/deploy/glink-frontend.service /etc/systemd/system/glink-frontend.service
systemctl daemon-reload
bash /home/globallink/glink-staging/RELEASE_ID/deploy/release.sh
systemctl enable glink-backend glink-frontend
systemctl status glink-backend glink-frontend --no-pager
```

Script membuat release baru, menjalankan `npm ci` dan build sebagai user `glink`, lalu mengganti symlink `current`. Build gagal tidak menyentuh release aktif. Ada jeda singkat saat pergantian layanan. Jika startup/health gagal, script mengembalikan release sebelumnya jika ada. Health check hanya memeriksa HTTP, belum menjamin database/PDF bekerja.

Struktur server:

```text
/opt/glink-node/current                     runtime Node khusus aplikasi
/srv/glink-portal/current                   symlink ke release aktif
/srv/glink-portal/releases/<release>/        source + dependency + build
/srv/glink-portal/shared/backend.env         konfigurasi rahasia
/srv/glink-portal/shared/uploads/            lampiran permanen lintas update
```

## 7. Buka aplikasi tanpa domain dan tanpa mengganggu website lama

Di **terminal laptop baru**:

```bash
ssh -p 2243 -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8088:127.0.0.1:3100 globallink@103.164.21.52
```

Biarkan terminal terbuka, lalu buka `http://127.0.0.1:8088` di browser laptop. `Ctrl+C` menutup tunnel. Jika port laptop 8088 terpakai, ganti angka pertama misalnya `8099`, lalu buka URL dengan port tersebut.

Frontend dan API memakai origin yang sama. Untuk akses tunnel langsung, Next.js meneruskan `/api/*` dan `/uploads/*` ke backend internal. Port 3100 dan 5101 hanya bind ke loopback server. Tidak perlu membuka keduanya di firewall.

### Opsional: Nginx jika sudah tersedia

`deploy/nginx.conf` menyediakan reverse proxy di **127.0.0.1:8088**, dengan batas body 50 MB dan timeout PDF 180 detik. Jika Nginx server memakai layout standar Debian/Ubuntu dan port 8088 belum dipakai:

```bash
install -m 644 /home/globallink/glink-staging/RELEASE_ID/deploy/nginx.conf /etc/nginx/sites-available/glink-portal
ln -s /etc/nginx/sites-available/glink-portal /etc/nginx/sites-enabled/glink-portal
nginx -t
systemctl reload nginx
```

Lakukan reload **hanya jika `nginx -t` berhasil**. Jangan menghapus default site atau mengubah konfigurasi website lain. Jika server memakai Apache, panel hosting, atau layout Nginx lain, tetap gunakan tunnel langsung ke 3100 sampai integrasi diperiksa admin; jangan menginstal/mengambil alih port 80/443.

Untuk memakai Nginx, ubah tujuan tunnel menjadi `127.0.0.1:8088`:

```bash
ssh -p 2243 -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8088:127.0.0.1:8088 globallink@103.164.21.52
```

### Sebelum akses publik

Aplikasi saat ini belum memiliki autentikasi dan otorisasi per pengguna. Endpoint daftar/detail, approval, hapus, dan lampiran dapat diakses oleh siapa pun yang memiliki akses jaringan ke aplikasi. Tanda tangan pada canvas bukan bukti identitas pengguna yang terautentikasi. Template PDF juga masih menyisipkan input ke HTML tanpa escaping menyeluruh, sehingga input berbahaya berisiko memicu injeksi HTML/resource request dari Chrome.

Karena itu, penggunaan awal melalui tunnel ditujukan untuk pengujian oleh operator tepercaya dengan data dummy. Sebelum dipakai umum/perusahaan, implementasikan login dan role karyawan/atasan/HRD, otorisasi setiap record/lampiran, validasi status approval di server, escaping template, pembatasan request Chrome dan rate limit. Saldo cuti juga perlu diverifikasi server; jangan menjadikan nilai kiriman browser sebagai sumber kebenaran HR.

Setelah ada domain/subdomain, buat virtual host tersendiri dengan HTTPS dan pembatasan akses VPN/allowlist atau gerbang autentikasi. Basic Auth bisa menjadi lapisan tambahan sementara untuk operator, tetapi bukan pengganti role dan otorisasi data. Jangan membuka HTTP publik untuk data karyawan. Konfigurasi publik final harus mengikuti web server yang sudah ada; contoh di repo sengaja hanya listen loopback.

## 8. Pengujian deploy pertama

Di server:

```bash
curl -fsS http://127.0.0.1:5101/api/health
curl -I http://127.0.0.1:3100
journalctl -u glink-backend -u glink-frontend -n 100 --no-pager
```

Di browser melalui tunnel, gunakan data dummy untuk menguji izin + lampiran, cuti, preview dan Generate PDF dinas. Pastikan file PDF benar, data tersimpan, lampiran bisa dibuka, nomor dinas berurutan, dan data/lampiran tetap tersedia setelah restart layanan. Pemeriksaan ini menulis data uji: gunakan database pengujian atau identitas dummy yang disepakati HR.

Uji sebelum dan sesudah reload bahwa website lama tetap normal. Jangan menganggap build sukses sama dengan seluruh workflow production teruji.

## 9. Backup sebelum update

Script backup memakai `mariadb-dump` dari container khusus GLink dan membaca secret root dari file yang sudah dipasang saat setup. Tidak perlu menginstal database client di host atau menulis password pada command. Container database harus sehat sebelum backup.

Jalankan script dari source staging yang sudah diverifikasi:

```bash
bash /home/globallink/glink-staging/RELEASE_ID/deploy/backup.sh
```

Script menghentikan layanan GLink sementara, membuat dump DB dan arsip `shared` serta konfigurasi/secret database agar lampiran konsisten, lalu menyalakan layanan yang sebelumnya aktif, termasuk saat backup gagal. Hasil di `/var/backups/glink-portal/<waktu>/`: `database.sql`, `shared.tar.gz`, dan `release.txt`.

Backup berisi data pribadi dan secret. Simpan terenkripsi di luar server dengan akses terbatas, tentukan retensi dan backup terjadwal, lalu uji restore di lingkungan terpisah. File yang masih berada di server yang sama bukan perlindungan terhadap kehilangan server.

## 10. Ketika ada update aplikasi

1. Di laptop: uji perubahan, jalankan `npm test` di backend dan `npm run build` di frontend.
2. Buat paket dan upload seperti langkah 3, lalu ekstrak ke staging baru. Jangan menyalin `.env`, `.next`, `node_modules` macOS, atau uploads lokal ke release server.
3. Di server: jalankan backup langkah 9 dan pastikan berhasil.
4. Jika ada migrasi database, review SQL dan kompatibilitas rollback terlebih dahulu. Script deploy tidak menjalankan migrasi otomatis. Jangan import ulang `schema.sql` atau restore DB lokal ke production.
5. Sebagai root jalankan script release dari staging baru:

```bash
bash /home/globallink/glink-staging/RELEASE_ID_BARU/deploy/release.sh
```

6. Uji workflow di langkah 8. Periksa log dan website lain. Jika unit systemd berubah, review lalu instal ulang unit dan jalankan `systemctl daemon-reload` sebelum restart; file unit tidak diperbarui otomatis oleh `release.sh`.

Upload lama tetap berada di `shared/uploads`; DB dan konfigurasi production tidak ditimpa. Simpan beberapa release terakhir untuk rollback. Jangan menghapus target `current` atau release yang masih dibutuhkan backup/rollback. Perubahan environment backend memerlukan `systemctl restart glink-backend`; perubahan frontend rewrites memerlukan build release baru.

## 11. Rollback aplikasi

Sebagai root, lihat release dan baca `release.txt` dari backup sebelum update:

```bash
readlink -f /srv/glink-portal/current
ls -1 /srv/glink-portal/releases
cat /var/backups/glink-portal/BACKUP_ID/release.txt
```

Jika database masih kompatibel, arahkan ke **path release sebelumnya yang sudah diverifikasi**:

```bash
systemctl stop glink-frontend glink-backend
ln -s /srv/glink-portal/releases/RELEASE_SEBELUMNYA /srv/glink-portal/current.rollback
mv -Tf /srv/glink-portal/current.rollback /srv/glink-portal/current
systemctl start glink-backend glink-frontend
```

Jangan menjalankan rollback bersamaan dengan deploy/backup. Rollback source tidak mengembalikan database atau membatalkan surat yang telah diterbitkan. Jika migrasi mengubah schema, gunakan migrasi balik yang diuji; restore backup berpotensi menghilangkan transaksi terbaru dan perlu koordinasi pemilik data.

### Restore darurat database/lampiran

Utamakan uji restore ke database dan direktori terpisah dahulu. Untuk pemulihan production yang sudah disepakati: hentikan kedua layanan, buat backup kondisi terkini, import dump ke **database pemulihan baru**, ekstrak arsip shared ke direktori pemulihan dengan permission asli, lalu arahkan `DB_NAME` dan `UPLOAD_DIR` di environment ke hasil pemulihan. Jangan menimpa environment aktif dari arsip secara membabi buta. Pilih source release yang sesuai schema, nyalakan layanan, dan uji workflow. Cara ini mempertahankan database/lampiran lama untuk investigasi dan menghindari overwrite langsung.

## 12. Troubleshooting

| Gejala | Pemeriksaan |
|---|---|
| SSH refused/timeout | VPN/jaringan, port 2243, firewall existing; jangan mengganti konfigurasi SSH tanpa akses cadangan. |
| Halaman tampil, API gagal | Browser harus memanggil `/api/...` pada origin yang sama; cek backend, database, dan rewrites/Nginx. |
| 502 setelah reload Nginx | `systemctl status glink-backend glink-frontend`; cek port upstream. |
| DB access denied | Samakan user, host `127.0.0.1`, password, grant, dan `backend.env`. |
| PDF gagal | Path Chrome, dependency OS, sandbox/AppArmor, RAM, `journalctl -u glink-backend`. |
| Build di server gagal | Runtime Node khusus, lockfile, RAM/disk, dan internet untuk dependency serta font Google saat build. |
| Upload hilang setelah update | `UPLOAD_DIR` harus menunjuk `shared/uploads`, bukan folder release. |
| Body terlalu besar/413 | Batas upload Multer 10 MB/file, limit JSON backend 50 MB; periksa limit reverse proxy. |

## Referensi

- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets)
- [Environment image resmi MariaDB](https://mariadb.com/docs/server/server-management/automated-mariadb-deployment-and-administration/docker-and-mariadb/mariadb-server-docker-official-image-environment-variables)

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Distribusi resmi Node 22](https://nodejs.org/dist/latest-v22.x/)
- [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Puppeteer troubleshooting dan sandbox Linux](https://pptr.dev/troubleshooting)
- [Chrome untuk Linux](https://support.google.com/chrome/a/answer/9025926)
- [systemd EnvironmentFile dan WorkingDirectory](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
