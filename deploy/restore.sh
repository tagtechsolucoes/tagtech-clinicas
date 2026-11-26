#!/usr/bin/env bash
# Restaura um backup criptografado neste servidor.
#
#   ./restore.sh --baixar AAAA-MM-DD_HHMM             traz do bucket os arquivos dessa data
#   ./restore.sh chave-backup.txt AAAA-MM-DD_HHMM     restaura banco, fotos e WhatsApp dessa data
#   ./restore.sh chave-backup.txt backups/banco-....dump.age [backups/fotos-....tar.gz.age]
#
# ATENÇÃO: apaga os dados atuais e põe os do backup no lugar. O .env não é trocado
# (para isso, e para trocar de servidor, use o migrar.sh).
set -euo pipefail
cd "$(dirname "$0")"
. ./env.sh && carregar_env .env

if [ "${1:-}" = "--baixar" ]; then
  [ -n "${2:-}" ] || { echo "Uso: $0 --baixar AAAA-MM-DD_HHMM"; exit 1; }
  mkdir -p backups
  docker run --rm --env-file <(env | grep '^RCLONE_' || true) \
    ${BACKUP_GCS_KEY_FILE:+-v "$BACKUP_GCS_KEY_FILE:/conta.json:ro" -e RCLONE_GCS_SERVICE_ACCOUNT_FILE=/conta.json} -v "$(pwd)/backups:/b" rclone/rclone:1.68 \
    copy "$BACKUP_REMOTE/" /b --include "*-$2.*"
  ls -l backups/*-"$2".*
  exit 0
fi

CHAVE="${1:-}"
[ -f "$CHAVE" ] || { echo "Uso: $0 chave-backup.txt AAAA-MM-DD_HHMM  (ou: banco.dump.age [fotos.tar.gz.age])"; exit 1; }

WHATS=""
if [[ "${2:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$ ]]; then
  BANCO="backups/banco-$2.dump.age"
  FOTOS="backups/fotos-$2.tar.gz.age"
  [ -f "backups/whatsapp-$2.tar.age" ] && WHATS="backups/whatsapp-$2.tar.age"
  [ -f "$FOTOS" ] || FOTOS=""
else
  BANCO="${2:-}"; FOTOS="${3:-}"
fi
[ -f "$BANCO" ] || { echo "Não achei $BANCO. Baixe antes com: $0 --baixar AAAA-MM-DD_HHMM"; exit 1; }

echo "Vai restaurar: $BANCO ${FOTOS:+$FOTOS }${WHATS:+$WHATS}"
if [ "${RESTAURAR_SEM_PERGUNTAR:-}" != 1 ]; then
  read -r -p "Isto substitui TODOS os dados atuais. Digite RESTAURAR para seguir: " ok
  [ "$ok" = "RESTAURAR" ] || exit 1
fi

dec() { # arquivo .age -> stdout
  docker run --rm -i -v "$(realpath "$CHAVE"):/chave:ro" alpine:3.20 \
    sh -c 'apk add -q --no-cache age >/dev/null && age -d -i /chave' < "$1"
}

docker compose stop api web-cliente
dec "$BANCO" | docker compose exec -T postgres pg_restore -U tagtech -d tagtech --clean --if-exists --no-owner
if [ -n "$FOTOS" ]; then
  dec "$FOTOS" | docker run --rm -i -v tagtech_media:/m alpine:3.20 sh -c 'rm -rf /m/* && tar -xzf - -C /m'
fi
if [ -n "$WHATS" ]; then
  # Banco e sessões da Evolution: os números conectados por QR code voltam sem ler o código de novo.
  docker compose stop evolution
  docker compose run --rm evolution-db > /dev/null
  dec "$WHATS" | docker run --rm -i -v tagtech_evolution:/instancias alpine:3.20 \
    sh -c 'mkdir /w && tar -xf - -C /w && rm -rf /instancias/* && cp -a /w/instancias/. /instancias/ && cat /w/evolution.dump' |
    docker compose exec -T postgres pg_restore -U tagtech -d evolution --clean --if-exists --no-owner
  docker compose start evolution
fi
docker compose start api web-cliente
echo "Restaurado."
