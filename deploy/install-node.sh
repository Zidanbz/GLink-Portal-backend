#!/usr/bin/env bash
# Instalasi Node TERPISAH dari Node aplikasi lain. Ubuntu/Debian glibc.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'Jalankan sebagai root.' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64) ARCH=arm64 ;;
  *) echo 'Arsitektur belum didukung script ini.' >&2; exit 1 ;;
esac
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
BASE=https://nodejs.org/dist/latest-v22.x
curl -fSLO "$BASE/SHASUMS256.txt"
FILE=$(awk -v arch="$ARCH" '$2 ~ "^node-v22[.].*-linux-" arch "[.]tar[.]xz$" {print $2}' SHASUMS256.txt)
[[ -n "$FILE" && "$FILE" != *$'\n'* ]] || { echo 'Manifest Node tidak valid.' >&2; exit 1; }
curl -fSLO "$BASE/$FILE"
awk -v file="$FILE" '$2 == file' SHASUMS256.txt | sha256sum -c -
install -d /opt/glink-node
tar -xJf "$FILE" -C /opt/glink-node
ln -sfn "/opt/glink-node/${FILE%.tar.xz}" /opt/glink-node/current
/opt/glink-node/current/bin/node --version
