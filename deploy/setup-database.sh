#!/usr/bin/env bash
# Persiapan pertama saja. Tidak menjalankan atau mengubah container existing.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'Jalankan sebagai root.' >&2; exit 1; }
ROOT=$(cd "$(dirname "$0")" && pwd)
BASE=/srv/glink-portal
[[ ! -e "$BASE/database" && ! -e "$BASE/shared/backend.env" ]] || {
  echo 'Konfigurasi sudah ada; setup dihentikan agar password/data tidak tertimpa.' >&2; exit 1;
}
command -v openssl >/dev/null
getent group glink >/dev/null
umask 077
install -d -m 755 "$BASE"
install -d -m 750 -o root -g glink "$BASE/shared"
install -d -m 700 "$BASE/database" "$BASE/database/secrets"
for file in schema.sql runtime-grants.sql; do install -m 600 "$ROOT/$file" "$BASE/database/$file"; done
install -m 600 "$ROOT/database.compose.yml" "$BASE/database/compose.yml"
openssl rand -hex 32 > "$BASE/database/secrets/db-root-password"
openssl rand -hex 32 > "$BASE/database/secrets/db-app-password"
DB_APP_PASSWORD=$(cat "$BASE/database/secrets/db-app-password")
sed "s/REPLACE_ON_SERVER/$DB_APP_PASSWORD/" "$ROOT/backend.env.example" > "$BASE/shared/backend.env"
chmod 600 "$BASE/shared/backend.env"
echo 'Konfigurasi dan password acak siap; nilainya tidak ditampilkan.'
echo 'Periksa port 3308, lalu ikuti panduan untuk menyalakan database khusus GLink.'
