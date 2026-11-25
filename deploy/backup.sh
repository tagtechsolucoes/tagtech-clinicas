#!/usr/bin/env bash
# Backup diário: banco (pg_dump) e fotos, criptografados e enviados para fora do servidor.
#
# No .env:
#   BACKUP_AGE_RECIPIENT  chave PÚBLICA do age (age1...). A chave privada NÃO fica no servidor:
#                         guarde com os sócios (gerenciador de senhas). Sem ela não há restauração.
#   BACKUP_REMOTE         destino no rclone, ex.: ":gcs:tagtech-backups/clinicas" ou ":s3:bucket/pasta"
#   RCLONE_*              credenciais do destino (ver deploy/README.md, seção Backup)
#   BACKUP_DIAS_REMOTO    quantos dias manter no bucket (padrão 30)
#
# Agende com: crontab -e  →  15 4 * * * /opt/tagtech/deploy/backup.sh >> /var/log/tagtech-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

DIA=$(date +%Y-%m-%d_%H%M)
DESTINO=./backups
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
umask 077

: "${BACKUP_AGE_RECIPIENT:?defina BACKUP_AGE_RECIPIENT no .env (gere com ./gerar-chave-backup.sh)}"

age_enc() { # stdin -> stdout criptografado para a chave pública
  docker run --rm -i -e R="$BACKUP_AGE_RECIPIENT" alpine:3.20 \
    sh -c 'apk add -q --no-cache age >/dev/null && age -r "$R"'
}

BANCO="$DESTINO/banco-$DIA.dump.age"
FOTOS="$DESTINO/fotos-$DIA.tar.gz.age"

# O dump nunca toca o disco sem criptografia.
docker compose exec -T postgres pg_dump -U tagtech -d tagtech -Fc | age_enc > "$BANCO"
docker run --rm -v tagtech_media:/m:ro alpine:3.20 tar -czf - -C /m . | age_enc > "$FOTOS"

# Arquivo vazio ou minúsculo = algo falhou no caminho.
[ "$(stat -c %s "$BANCO")" -gt 1024 ] || { echo "backup do banco suspeito (muito pequeno)"; exit 1; }

find "$DESTINO" -type f -mtime +7 -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone() {
    docker run --rm --env-file <(env | grep '^RCLONE_' || true) \
    ${BACKUP_GCS_KEY_FILE:+-v "$BACKUP_GCS_KEY_FILE:/conta.json:ro" -e RCLONE_GCS_SERVICE_ACCOUNT_FILE=/conta.json} -v "$(pwd)/backups:/b:ro" rclone/rclone:1.68 "$@"
  }
  rclone copy "/b/$(basename "$BANCO")" "$BACKUP_REMOTE/"
  rclone copy "/b/$(basename "$FOTOS")" "$BACKUP_REMOTE/"
  rclone delete --min-age "${BACKUP_DIAS_REMOTO:-30}d" "$BACKUP_REMOTE/"
  echo "$(date -Is) enviado para $BACKUP_REMOTE"
else
  echo "$(date -Is) AVISO: BACKUP_REMOTE vazio; o backup ficou só neste servidor"
fi
echo "$(date -Is) backup ok: $(basename "$BANCO"), $(basename "$FOTOS")"
