#!/usr/bin/env bash
# Teste de restauração (faça todo trimestre): abre o backup mais recente num banco
# descartável, ao lado do de produção, e conta os registros principais. Não mexe em produção.
#   ./testar-restauracao.sh chave-backup.txt [backups/banco-....dump.age]
set -euo pipefail
cd "$(dirname "$0")"
CHAVE="${1:?Uso: $0 chave-backup.txt [banco.dump.age]}"
BANCO="${2:-$(ls -t backups/banco-*.dump.age | head -1)}"
NOME=tagtech-teste-restauracao
trap 'docker rm -f $NOME >/dev/null 2>&1 || true' EXIT

docker run -d --name $NOME -e POSTGRES_PASSWORD=teste -e POSTGRES_USER=tagtech postgres:16-alpine >/dev/null
until docker exec $NOME pg_isready -U tagtech >/dev/null 2>&1; do sleep 1; done
for r in tagtech_app; do docker exec $NOME psql -U tagtech -qc "create role $r" ; done
docker run --rm -i -v "$(realpath "$CHAVE"):/chave:ro" alpine:3.20 \
  sh -c 'apk add -q --no-cache age >/dev/null && age -d -i /chave' < "$BANCO" \
  | docker exec -i $NOME pg_restore -U tagtech -d tagtech --no-owner --exit-on-error
docker exec $NOME psql -U tagtech -d tagtech -c "
  select (select count(*) from tenants) clinicas, (select count(*) from patients) pacientes,
         (select count(*) from appointments) consultas, (select count(*) from clinical_notes) prontuarios,
         (select max(created_at) from appointments) ultima_consulta_criada;"
echo "OK: $BANCO abre e tem dados. Anote a data deste teste."
