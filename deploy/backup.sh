#!/usr/bin/env bash
# Backup diário, criptografado e enviado para fora do servidor. Cada rodada gera, com a mesma data:
#   banco-DATA.dump.age      o banco do sistema (pg_dump)
#   fotos-DATA.tar.gz.age    fotos e arquivos enviados
#   whatsapp-DATA.tar.age    o WhatsApp por QR code (banco e sessões da Evolution): na troca de
#                            servidor, ninguém precisa ler o QR code de novo
#   config-DATA.tar.age      o .env (senhas e chaves) e a conta de serviço do bucket
# Com os quatro e a chave privada, o migrar.sh sobe tudo igual num servidor novo.
#
# No .env:
#   BACKUP_AGE_RECIPIENT  chave PÚBLICA do age (age1...). A chave privada NÃO fica no servidor:
#                         guarde com os sócios (gerenciador de senhas). Sem ela não há restauração.
#   BACKUP_REMOTE         destino no rclone, ex.: ":gcs:bucket/pasta" ou ":s3:bucket/pasta"
#   RCLONE_*              credenciais do destino (ver deploy/README.md, seção Backup)
#   BACKUP_DIAS_REMOTO    quantos dias manter no bucket (padrão 30)
#
# Agende com: crontab -e  →  15 4 * * * /opt/tagtech/deploy/backup.sh >> $HOME/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
. ./env.sh && carregar_env .env

DIA=$(date +%Y-%m-%d_%H%M)
DESTINO=./backups
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
umask 077

# Sem chave pública ainda: guarda só o banco e as fotos aqui, sem criptografia, e não envia nada.
if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
  echo "$(date -Is) AVISO: BACKUP_AGE_RECIPIENT vazio; backup local sem criptografia (ver deploy/PRONTO-PARA-VENDER.md)"
  docker compose exec -T postgres pg_dump -U tagtech -d tagtech -Fc > "$DESTINO/banco-$DIA.dump"
  docker run --rm -v tagtech_media:/m:ro alpine:3.20 tar -czf - -C /m . > "$DESTINO/fotos-$DIA.tar.gz"
  find "$DESTINO" -type f -mtime +14 -delete
  exit 0
fi

age_enc() { # stdin -> stdout criptografado para a chave pública
  docker run --rm -i -e R="$BACKUP_AGE_RECIPIENT" alpine:3.20 \
    sh -c 'apk add -q --no-cache age >/dev/null && age -r "$R"'
}

BANCO="$DESTINO/banco-$DIA.dump.age"
FOTOS="$DESTINO/fotos-$DIA.tar.gz.age"
WHATS="$DESTINO/whatsapp-$DIA.tar.age"
CONFIG="$DESTINO/config-$DIA.tar.age"
ARQUIVOS=("$BANCO" "$FOTOS")

# Nada sai daqui sem criptografia: tudo passa direto pelo age, sem tocar o disco aberto.
docker compose exec -T postgres pg_dump -U tagtech -d tagtech -Fc | age_enc > "$BANCO"
docker run --rm -v tagtech_media:/m:ro alpine:3.20 tar -czf - -C /m . | age_enc > "$FOTOS"

# WhatsApp: o banco da Evolution e a pasta das instâncias, num pacote só.
if docker compose exec -T postgres psql -U tagtech -d tagtech -tAc \
  "select 1 from pg_database where datname = 'evolution'" | grep -q 1; then
  docker compose exec -T postgres pg_dump -U tagtech -d evolution -Fc |
    docker run --rm -i -v tagtech_evolution:/instancias:ro alpine:3.20 \
      sh -c 'mkdir /w && cat > /w/evolution.dump && tar -cf - -C /w evolution.dump -C / instancias' |
    age_enc > "$WHATS"
  ARQUIVOS+=("$WHATS")
fi

# Configuração: o .env e, se houver, a chave da conta de serviço que escreve no bucket.
CONTA=${BACKUP_GCS_KEY_FILE:-}
if [ -n "$CONTA" ] && [ -f "$CONTA" ]; then
  tar -cf - .env -C "$(dirname "$CONTA")" "$(basename "$CONTA")" | age_enc > "$CONFIG"
else
  tar -cf - .env | age_enc > "$CONFIG"
fi
ARQUIVOS+=("$CONFIG")

# Arquivo vazio ou minúsculo = algo falhou no caminho.
[ "$(stat -c %s "$BANCO")" -gt 1024 ] || { echo "backup do banco suspeito (muito pequeno)"; exit 1; }

find "$DESTINO" -type f -mtime +7 -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone() {
    docker run --rm --env-file <(env | grep '^RCLONE_' || true) \
    ${BACKUP_GCS_KEY_FILE:+-v "$BACKUP_GCS_KEY_FILE:/conta.json:ro" -e RCLONE_GCS_SERVICE_ACCOUNT_FILE=/conta.json} -v "$(pwd)/backups:/b:ro" rclone/rclone:1.68 "$@"
  }
  for f in "${ARQUIVOS[@]}"; do rclone copy "/b/$(basename "$f")" "$BACKUP_REMOTE/"; done
  rclone delete --min-age "${BACKUP_DIAS_REMOTO:-30}d" "$BACKUP_REMOTE/"
  echo "$(date -Is) enviado para $BACKUP_REMOTE"
else
  echo "$(date -Is) AVISO: BACKUP_REMOTE vazio; o backup ficou só neste servidor"
fi
echo "$(date -Is) backup ok ($DIA): $(for f in "${ARQUIVOS[@]}"; do printf '%s ' "$(basename "$f")"; done)"
