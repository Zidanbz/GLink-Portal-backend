#!/usr/bin/env bash
# Root: backup konsisten dengan menghentikan penulisan sebentar.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'Jalankan sebagai root.' >&2; exit 1; }
exec 9>/var/lock/glink-deploy.lock
flock -n 9 || { echo 'Deploy/backup lain sedang berjalan.' >&2; exit 1; }
BASE=/srv/glink-portal
DEST="/var/backups/glink-portal/$(date -u +%Y%m%dT%H%M%SZ)-$$"
[[ -f "$BASE/database/compose.yml" ]] || { echo 'Konfigurasi database GLink belum tersedia.' >&2; exit 1; }
install -d -m 700 "$DEST"
BACKEND_ACTIVE=0
FRONTEND_ACTIVE=0
systemctl is-active --quiet glink-backend && BACKEND_ACTIVE=1
systemctl is-active --quiet glink-frontend && FRONTEND_ACTIVE=1
restore_services() {
  if [[ "$BACKEND_ACTIVE" == 1 ]]; then systemctl start glink-backend; fi
  if [[ "$FRONTEND_ACTIVE" == 1 ]]; then systemctl start glink-frontend; fi
}
trap restore_services EXIT
systemctl stop glink-frontend glink-backend
docker compose -f "$BASE/database/compose.yml" exec -T db sh -c '
  export MYSQL_PWD="$(cat /run/secrets/db_root_password)"
  exec mariadb-dump -u root --single-transaction --no-tablespaces globallink_approval
' > "$DEST/database.sql"
tar -czf "$DEST/shared.tar.gz" -C "$BASE" shared database
readlink -f "$BASE/current" > "$DEST/release.txt"
printf 'Backup selesai: %s\n' "$DEST"
printf 'Salin terenkripsi ke lokasi di luar server. Backup berisi data pribadi dan secret.\n'
