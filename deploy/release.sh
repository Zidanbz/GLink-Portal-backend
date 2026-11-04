#!/usr/bin/env bash
# Jalankan sebagai root SETELAH backup, dari source yang diunggah ke server.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'Jalankan melalui su - terlebih dahulu.' >&2; exit 1; }
exec 9>/var/lock/glink-deploy.lock
flock -n 9 || { echo 'Deploy lain sedang berjalan.' >&2; exit 1; }
SOURCE=$(cd "$(dirname "$0")/.." && pwd)
if [[ -f "$SOURCE/server.js" ]]; then
  ROOT=$(cd "$SOURCE/.." && pwd)
else
  ROOT="$SOURCE"
fi
BASE=/srv/glink-portal
RELEASE="$BASE/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
[[ -f "$BASE/shared/backend.env" ]] || { echo 'backend.env belum tersedia.' >&2; exit 1; }
[[ -d "$BASE/shared/uploads" ]] || { echo 'Folder uploads shared belum tersedia.' >&2; exit 1; }
install -d -o glink -g glink "$RELEASE"
for folder in 'GLink Portal-Backend' 'GLink Portal-frontend'; do
  mkdir "$RELEASE/$folder"
  rsync -a --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env*' \
    --exclude=uploads --exclude='*.tsbuildinfo' "$ROOT/$folder/" "$RELEASE/$folder/"
done
chown -R glink:glink "$RELEASE"
runuser -u glink -- bash -c 'cd "$1" && PATH=/opt/glink-node/current/bin:$PATH npm ci --omit=dev' _ "$RELEASE/GLink Portal-Backend"
runuser -u glink -- bash -c 'set -e; cd "$1"; export PATH=/opt/glink-node/current/bin:$PATH; npm ci; npm run build' _ "$RELEASE/GLink Portal-frontend"
# Build gagal akan berhenti sebelum layanan aktif disentuh.
PREVIOUS=$(readlink -f "$BASE/current" 2>/dev/null || true)
systemctl stop glink-frontend glink-backend
ln -s "$RELEASE" "$BASE/current.next"
mv -Tf "$BASE/current.next" "$BASE/current"
systemctl start glink-backend glink-frontend || true
READY=0
for attempt in $(seq 1 45); do
  if curl --max-time 5 -fsS http://127.0.0.1:5101/api/health >/dev/null && curl --max-time 5 -fsS http://127.0.0.1:3100/ >/dev/null; then
    READY=1; break
  fi
  sleep 2
done
if [[ "$READY" != 1 ]]; then
  echo 'Health check gagal. Periksa journalctl.' >&2
  systemctl stop glink-frontend glink-backend
  if [[ -n "$PREVIOUS" ]]; then
    ln -s "$PREVIOUS" "$BASE/current.rollback"
    mv -Tf "$BASE/current.rollback" "$BASE/current"
    systemctl start glink-backend glink-frontend
    echo "Symlink dikembalikan ke $PREVIOUS" >&2
  fi
  exit 1
fi
printf 'Release aktif: %s\n' "$RELEASE"
printf 'Lanjutkan uji PDF izin/cuti/dinas, upload, dan data; health check belum memeriksa database.\n'
