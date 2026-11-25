#!/usr/bin/env bash
# Gera o par de chaves do backup. Rode no SEU computador, não no servidor.
#   - A linha "public key: age1..." vai no .env do servidor (BACKUP_AGE_RECIPIENT).
#   - O arquivo chave-backup.txt é a chave privada: guarde em 2 lugares seguros e apague daqui.
set -euo pipefail
docker run --rm -v "$(pwd):/k" alpine:3.20 \
  sh -c 'apk add -q --no-cache age >/dev/null && age-keygen -o /k/chave-backup.txt'
grep 'public key' chave-backup.txt
echo "Chave privada em ./chave-backup.txt — guarde e apague deste computador depois."
