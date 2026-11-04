#!/usr/bin/env bash
set -euo pipefail
SOURCE=$(cd "$(dirname "$0")/.." && pwd)
if [[ -f "$SOURCE/server.js" ]]; then
  ROOT=$(cd "$SOURCE/.." && pwd)
else
  ROOT="$SOURCE"
fi
OUT="${1:-/tmp/glink-portal-source.tar.gz}"
case "$OUT" in /*) ;; *) echo 'Gunakan path output absolut.' >&2; exit 1;; esac
COPYFILE_DISABLE=1 tar --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='.env*' \
  --exclude='uploads' --exclude='.DS_Store' --exclude='*.tsbuildinfo' \
  -czf "$OUT" -C "$ROOT" 'GLink Portal-Backend' 'GLink Portal-frontend'
printf 'Paket source siap: %s\n' "$OUT"
printf 'Paket tidak berisi database, upload, atau konfigurasi rahasia.\n'
