#!/usr/bin/env bash
# Troca de servidor (passo a passo em deploy/MIGRAR.md).
#
#   No servidor ANTIGO:  ./migrar.sh sair
#       para o sistema, faz o backup final (banco, fotos, WhatsApp e .env) e envia ao bucket.
#
#   No servidor NOVO (depois do bootstrap-vps.sh e de copiar a chave e os arquivos):
#       ./migrar.sh chegar chave-backup.txt pasta-com-os-arquivos
#       põe o .env antigo, sobe o sistema e restaura tudo. Depois é só apontar o DNS.
#
# Para desfazer no antigo (voltar a atender por ele): docker compose up -d
set -euo pipefail
cd "$(dirname "$0")"

ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
titulo() { printf '\n\033[1m%s\033[0m\n' "$*"; }
falha() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

sair() {
  titulo "Saída deste servidor"
  echo "O sistema vai parar aqui (os clientes veem o site fora do ar até o DNS apontar para o novo)."
  read -r -p "Digite SAIR para seguir: " r
  [ "$r" = "SAIR" ] || exit 1

  # Sem o deploy automático, uma atualização não religa o sistema aqui por engano.
  if systemctl list-unit-files tagtech-autodeploy.timer > /dev/null 2>&1; then
    sudo systemctl disable --now tagtech-autodeploy.timer > /dev/null 2>&1 || true
    ok "deploy automático desligado neste servidor"
  fi
  docker compose stop api web-cliente evolution > /dev/null
  ok "sistema parado: ninguém grava mais nada aqui"

  SAIDA=$(./backup.sh 2>&1) || { echo "$SAIDA"; falha "o backup final falhou; nada foi perdido, o sistema só está parado"; }
  echo "$SAIDA" | tail -2
  DIA=$(echo "$SAIDA" | sed -n 's/.*backup ok (\([0-9_-]*\)).*/\1/p' | tail -1)
  [ -n "$DIA" ] || falha "não achei a data do backup na saída acima"
  echo "$SAIDA" | grep -q "enviado para" || falha "o backup não foi enviado ao bucket (veja acima)"
  ok "backup final: $DIA"

  . ./env.sh && carregar_env .env
  titulo "Próximo passo, no Cloud Shell (veja deploy/MIGRAR.md)"
  echo "  Data do backup final: $DIA"
  echo "  Bucket: ${BACKUP_REMOTE#:gcs:}"
  echo "  Endereços que vão apontar para o servidor novo:"
  grep -E '^[A-Z]+_HOST=' .env | sed 's/^/    /'
}

chegar() {
  local CHAVE="${1:-}" PASTA="${2:-}"
  [ -f "$CHAVE" ] && [ -d "$PASTA" ] || falha "Uso: $0 chegar chave-backup.txt pasta-com-os-arquivos"
  CHAVE=$(realpath "$CHAVE")
  local DIA
  DIA=$(ls "$PASTA" | sed -n 's/^banco-\([0-9_-]*\)\.dump\.age$/\1/p' | sort | tail -1)
  [ -n "$DIA" ] || falha "não achei banco-AAAA-MM-DD_HHMM.dump.age em $PASTA"
  [ -f "$PASTA/config-$DIA.tar.age" ] || falha "falta $PASTA/config-$DIA.tar.age (o .env do servidor antigo)"
  command -v docker > /dev/null || falha "rode antes o bootstrap-vps.sh (instala o Docker e baixa o código)"
  docker info > /dev/null 2>&1 || falha "sem acesso ao Docker: saia e entre de novo no SSH e rode de novo"

  # O banco do servidor novo nasce com as senhas do .env antigo; se já subiu com outras, não casa.
  if docker volume inspect tagtech_pgdata > /dev/null 2>&1; then
    falha "este servidor já tem um banco (volume tagtech_pgdata). Migre para uma máquina nova, ou apague com: docker compose down -v"
  fi

  titulo "Chegada neste servidor · backup $DIA"
  dec() { docker run --rm -i -v "$CHAVE:/chave:ro" alpine:3.20 sh -c 'apk add -q --no-cache age >/dev/null && age -d -i /chave' < "$1"; }

  # Configuração do servidor antigo: .env (mesmas senhas e endereços) e a conta do bucket.
  local TMP
  TMP=$(mktemp -d) && chmod 700 "$TMP"
  # Caminho fixado agora (aspas duplas): ao sair, apaga só esta pasta temporária.
  # shellcheck disable=SC2064
  trap "rm -rf '$TMP'" EXIT
  dec "$PASTA/config-$DIA.tar.age" | tar -xf - -C "$TMP" || falha "não consegui abrir a configuração: a chave é a certa?"
  [ -f .env ] && cp -p .env ".env.antes-da-migracao"
  install -m 600 "$TMP/.env" .env
  ok ".env do servidor antigo no lugar (o anterior ficou em .env.antes-da-migracao)"
  local CONTA
  CONTA=$(find "$TMP" -maxdepth 1 -name '*.json' | head -1)
  if [ -n "$CONTA" ]; then
    . ./env.sh && carregar_env .env
    local ALVO=${BACKUP_GCS_KEY_FILE:-/opt/tagtech/conta-backup.json}
    sudo install -m 600 -o "$(id -u)" -g "$(id -g)" "$CONTA" "$ALVO"
    ok "conta do bucket em $ALVO"
  fi

  titulo "Subindo o sistema (o primeiro build demora alguns minutos)"
  ./deploy.sh > /tmp/migrar-deploy.log 2>&1 || { tail -20 /tmp/migrar-deploy.log; falha "o deploy falhou (log em /tmp/migrar-deploy.log)"; }
  ok "sistema no ar, ainda vazio"

  titulo "Restaurando os dados"
  mkdir -p backups && chmod 700 backups
  cp "$PASTA"/*-"$DIA".* backups/
  RESTAURAR_SEM_PERGUNTAR=1 ./restore.sh "$CHAVE" "$DIA"
  docker compose up -d > /dev/null
  ok "dados de $DIA restaurados"

  titulo "Backup diário"
  if ! command -v crontab > /dev/null; then
    sudo apt-get install -y -qq cron > /dev/null 2>&1 || true
  fi
  if command -v crontab > /dev/null; then
    (crontab -l 2> /dev/null | grep -q backup.sh) ||
      { (crontab -l 2> /dev/null; echo "15 4 * * * /opt/tagtech/deploy/backup.sh >> \$HOME/backup.log 2>&1") | crontab -; }
    ok "agendado todo dia às 4h15"
  else
    printf '\033[33m!\033[0m %s\n' "não consegui agendar o backup: instale o cron e rode crontab -e (ver deploy/README.md)"
  fi

  titulo "Falta"
  echo "  1. Apontar o DNS destes endereços para o IP desta máquina ($(curl -fsS https://api.ipify.org 2> /dev/null || echo 'veja no painel da nuvem')):"
  grep -E '^[A-Z]+_HOST=' .env | sed 's/^/       /'
  echo "     O HTTPS sai sozinho assim que o DNS chegar aqui."
  echo "  2. Ligar o deploy automático: bash deploy/instalar-autodeploy.sh (pede a chave no GitHub)."
  echo "  3. Apagar a chave privada desta máquina: rm $CHAVE"
}

case "${1:-}" in
  sair) sair ;;
  chegar) shift; chegar "$@" ;;
  *) sed -n '2,11p' "$0"; exit 1 ;;
esac
