#!/usr/bin/env bash
# Roda na máquina a cada 2 minutos (timer do systemd). Se a main do GitHub tem commit novo,
# atualiza o código e chama o deploy.sh. Sem novidade, não faz nada.
set -euo pipefail
cd /opt/tagtech
exec 9> /tmp/tagtech-autodeploy.lock
flock -n 9 || exit 0 # outro deploy ainda rodando

git fetch -q origin main
ATUAL=$(git rev-parse HEAD)
NOVO=$(git rev-parse origin/main)
[ "$ATUAL" = "$NOVO" ] && exit 0

echo "Nova versão: ${ATUAL:0:7} -> ${NOVO:0:7}"
# .env e backups não estão no git (ficam intactos).
git reset -q --hard origin/main
if ! ./deploy/deploy.sh; then
  echo "Deploy de ${NOVO:0:7} falhou; a versão anterior continua no ar." >&2
  exit 1
fi
