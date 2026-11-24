#!/usr/bin/env bash
# Backup diário: banco (pg_dump) e fotos. Guarda 14 dias no servidor e, se BACKUP_S3_URI
# estiver no .env, manda uma cópia para fora (bucket do Lightsail ou S3).
# Agende com: crontab -e  →  15 4 * * * /opt/tagtech/deploy/backup.sh >> /var/log/tagtech-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

DIA=$(date +%Y-%m-%d_%H%M)
DESTINO=./backups
mkdir -p "$DESTINO"

docker compose exec -T postgres pg_dump -U tagtech -d tagtech -Fc > "$DESTINO/banco-$DIA.dump"
docker run --rm -v tagtech_media:/m:ro -v "$(pwd)/backups:/b" alpine \
  tar -czf "/b/fotos-$DIA.tar.gz" -C /m .

# Confere que o dump abre antes de considerar o backup bom.
docker compose exec -T postgres pg_restore --list < "$DESTINO/banco-$DIA.dump" > /dev/null

find "$DESTINO" -type f -mtime +14 -delete

if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$DESTINO/banco-$DIA.dump" "$BACKUP_S3_URI/" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"}
  aws s3 cp "$DESTINO/fotos-$DIA.tar.gz" "$BACKUP_S3_URI/" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"}
fi
echo "$(date -Is) backup ok: banco-$DIA.dump, fotos-$DIA.tar.gz"
