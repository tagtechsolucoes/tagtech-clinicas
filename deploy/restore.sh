#!/usr/bin/env bash
# Restaura um backup: ./restore.sh backups/banco-AAAA-MM-DD_HHMM.dump [backups/fotos-....tar.gz]
# ATENÇÃO: apaga o banco atual e põe o do arquivo no lugar.
set -euo pipefail
cd "$(dirname "$0")"
[ -f "${1:-}" ] || { echo "Uso: $0 arquivo.dump [fotos.tar.gz]"; exit 1; }
read -r -p "Isto substitui TODOS os dados atuais. Digite RESTAURAR para seguir: " ok
[ "$ok" = "RESTAURAR" ] || exit 1

docker compose stop api web-cliente
docker compose exec -T postgres pg_restore -U tagtech -d tagtech --clean --if-exists --no-owner < "$1"
if [ -n "${2:-}" ]; then
  docker run --rm -v tagtech_media:/m -v "$(cd "$(dirname "$2")" && pwd):/b:ro" alpine \
    sh -c "rm -rf /m/* && tar -xzf /b/$(basename "$2") -C /m"
fi
docker compose start api web-cliente
echo "Restaurado."
