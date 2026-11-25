#!/usr/bin/env bash
# Restaura um backup criptografado:
#   ./restore.sh chave-backup.txt backups/banco-AAAA-MM-DD_HHMM.dump.age [backups/fotos-....tar.gz.age]
# Para baixar do bucket antes: ./restore.sh --baixar AAAA-MM-DD_HHMM
# ATENÇÃO: apaga o banco atual e põe o do arquivo no lugar.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

if [ "${1:-}" = "--baixar" ]; then
  [ -n "${2:-}" ] || { echo "Uso: $0 --baixar AAAA-MM-DD_HHMM"; exit 1; }
  mkdir -p backups
  docker run --rm --env-file <(env | grep '^RCLONE_' || true) \
    ${BACKUP_GCS_KEY_FILE:+-v "$BACKUP_GCS_KEY_FILE:/conta.json:ro" -e RCLONE_GCS_SERVICE_ACCOUNT_FILE=/conta.json} -v "$(pwd)/backups:/b" rclone/rclone:1.68 \
    copy "$BACKUP_REMOTE/" /b --include "*-$2.*"
  ls -l backups/*-"$2".*
  exit 0
fi

CHAVE="${1:-}"; BANCO="${2:-}"; FOTOS="${3:-}"
[ -f "$CHAVE" ] && [ -f "$BANCO" ] || { echo "Uso: $0 chave-backup.txt banco.dump.age [fotos.tar.gz.age]"; exit 1; }
read -r -p "Isto substitui TODOS os dados atuais. Digite RESTAURAR para seguir: " ok
[ "$ok" = "RESTAURAR" ] || exit 1

dec() { # arquivo .age -> stdout
  docker run --rm -i -v "$(realpath "$CHAVE"):/chave:ro" alpine:3.20 \
    sh -c 'apk add -q --no-cache age >/dev/null && age -d -i /chave' < "$1"
}

docker compose stop api web-cliente
dec "$BANCO" | docker compose exec -T postgres pg_restore -U tagtech -d tagtech --clean --if-exists --no-owner
if [ -n "$FOTOS" ]; then
  dec "$FOTOS" | docker run --rm -i -v tagtech_media:/m alpine:3.20 sh -c 'rm -rf /m/* && tar -xzf - -C /m'
fi
docker compose start api web-cliente
echo "Restaurado."
