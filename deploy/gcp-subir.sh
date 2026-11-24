#!/usr/bin/env bash
# Sobe o TagTech Clínicas no Google Cloud. Rode no Cloud Shell, de dentro do clone do repositório:
#   bash deploy/gcp-subir.sh
# Cria (se ainda não existir): máquina em São Paulo, IP fixo, firewall 80/443, snapshot
# diário do disco. Depois envia o código, gera o .env com senhas e põe tudo no ar.
# Pode rodar de novo sem medo: o que já existe é reaproveitado.
set -euo pipefail
cd "$(dirname "$0")/.."

NOME=${NOME:-tagtech-piloto}
REGIAO=${REGIAO:-southamerica-east1}
ZONA=${ZONA:-southamerica-east1-b}
MAQUINA=${MAQUINA:-e2-medium}
PROJETO=$(gcloud config get-value project 2>/dev/null)
[ -n "$PROJETO" ] || { echo "Escolha o projeto: gcloud config set project ID_DO_PROJETO"; exit 1; }
existe() { "$@" > /dev/null 2>&1; }

echo "== Projeto $PROJETO, máquina $NOME ($MAQUINA) em $ZONA"
read -r -p "Seguir? [s/N] " ok; [ "$ok" = "s" ] || exit 1

echo "== 1/7 Ligando a API do Compute Engine (a primeira vez demora ~1 min)"
gcloud services enable compute.googleapis.com

echo "== 2/7 IP fixo"
existe gcloud compute addresses describe "$NOME-ip" --region "$REGIAO" ||
  gcloud compute addresses create "$NOME-ip" --region "$REGIAO"
IP=$(gcloud compute addresses describe "$NOME-ip" --region "$REGIAO" --format='value(address)')
echo "IP: $IP"

echo "== 3/7 Firewall (80 e 443)"
existe gcloud compute firewall-rules describe "$NOME-web" ||
  gcloud compute firewall-rules create "$NOME-web" --allow tcp:80,tcp:443,udp:443 \
    --target-tags "$NOME-web" --description "TagTech Clínicas: HTTP e HTTPS"

echo "== 4/7 Máquina"
if ! existe gcloud compute instances describe "$NOME" --zone "$ZONA"; then
  gcloud compute instances create "$NOME" --zone "$ZONA" --machine-type "$MAQUINA" \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-balanced \
    --address "$IP" --tags "$NOME-web"
  # Snapshot diário do disco, guardado por 14 dias (segunda camada de backup).
  existe gcloud compute resource-policies describe "$NOME-snapshot" --region "$REGIAO" ||
    gcloud compute resource-policies create snapshot-schedule "$NOME-snapshot" --region "$REGIAO" \
      --daily-schedule --start-time 07:00 --max-retention-days 14 --on-source-disk-delete keep-auto-snapshots
  gcloud compute disks add-resource-policies "$NOME" --zone "$ZONA" --resource-policies "$NOME-snapshot"
  echo "Esperando a máquina aceitar SSH..."
  for _ in $(seq 1 30); do
    existe gcloud compute ssh "$NOME" --zone "$ZONA" --quiet --command true && break
    sleep 10
  done
fi
ssh_vm() { gcloud compute ssh "$NOME" --zone "$ZONA" --quiet --command "$1"; }

echo "== 5/7 Endereços"
if ssh_vm "test -f /opt/tagtech/deploy/.env" 2>/dev/null; then
  echo "A máquina já tem deploy/.env; mantendo endereços e senhas."
  ENV_NOVO=""
else
  echo "Use dois subdomínios do DuckDNS (ex.: brasaepao-app e brasaepao-cardapio) ou seu domínio."
  read -r -p "Endereço do app da equipe (ex.: brasaepao-app.duckdns.org): " EQUIPE
  read -r -p "Endereço do cardápio (ex.: brasaepao-cardapio.duckdns.org): " CARDAPIO
  read -r -p "Seu e-mail (avisos do certificado HTTPS): " EMAIL
  if [[ "$EQUIPE" == *.duckdns.org && "$CARDAPIO" == *.duckdns.org ]]; then
    read -r -s -p "Token do DuckDNS (aparece no topo de duckdns.org): " DUCK; echo
    SUBS="${EQUIPE%.duckdns.org},${CARDAPIO%.duckdns.org}"
    R=$(curl -fsS "https://www.duckdns.org/update?domains=$SUBS&token=$DUCK&ip=$IP")
    [ "$R" = "OK" ] && echo "DuckDNS apontado para $IP" || { echo "DuckDNS respondeu: $R"; exit 1; }
  else
    echo "Crie no seu DNS dois registros A para $IP: $EQUIPE e $CARDAPIO"
    read -r -p "Feito? [s/N] " ok; [ "$ok" = "s" ] || exit 1
  fi
  senha() { openssl rand -base64 48 | tr -d '/+=\n' | head -c 32; }
  ENV_NOVO="SITE_HOST=$CARDAPIO
EQUIPE_HOST=$EQUIPE
ACME_EMAIL=$EMAIL
OWNER_DB_PASSWORD=$(senha)
APP_DB_PASSWORD=$(senha)
RESEND_API_KEY=
MAIL_FROM=
SENTRY_DSN=
APP_VERSION="
fi

if ssh_vm "test -d /opt/tagtech/.git" 2>/dev/null; then
  echo "Deploy automático ligado: a máquina se atualiza sozinha a partir da main."
  echo "Para forçar agora: gcloud compute ssh $NOME --zone $ZONA --command 'sudo systemctl start tagtech-autodeploy'"
  exit 0
fi

echo "== 6/7 Preparando a máquina (Docker, swap) e enviando o código"
ssh_vm 'set -e
  if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; fi
  sudo usermod -aG docker "$USER"
  if ! swapon --show | grep -q /swapfile; then
    sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile && echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  fi
  sudo mkdir -p /opt/tagtech && sudo chown "$USER" /opt/tagtech'
PACOTE=$(mktemp -d)/tagtech.tar.gz
git archive --format=tar.gz -o "$PACOTE" HEAD
git rev-parse --short HEAD > "$(dirname "$PACOTE")/VERSION"
gcloud compute scp --zone "$ZONA" --quiet "$PACOTE" "$(dirname "$PACOTE")/VERSION" "$NOME:/tmp/"
# Troca o código, preservando o .env e os backups da máquina.
ssh_vm 'set -e; cd /opt/tagtech
  find . -mindepth 1 -maxdepth 1 ! -name deploy -exec rm -rf {} +
  [ -d deploy ] && find deploy -mindepth 1 -maxdepth 1 ! -name .env ! -name backups -exec rm -rf {} +
  tar -xzf /tmp/tagtech.tar.gz && mv /tmp/VERSION . && rm /tmp/tagtech.tar.gz'
if [ -n "$ENV_NOVO" ]; then
  printf '%s\n' "$ENV_NOVO" | gcloud compute ssh "$NOME" --zone "$ZONA" --quiet \
    --command 'umask 077; cat > /opt/tagtech/deploy/.env'
fi

echo "== 7/7 Construindo e subindo (primeira vez: 10 a 15 min)"
ssh_vm 'cd /opt/tagtech/deploy && sg docker -c ./deploy.sh'
ssh_vm '(crontab -l 2>/dev/null | grep -q backup.sh) || (crontab -l 2>/dev/null; echo "15 4 * * * /opt/tagtech/deploy/backup.sh >> \$HOME/backup.log 2>&1") | crontab -'

EQ=$(ssh_vm "grep ^EQUIPE_HOST /opt/tagtech/deploy/.env | cut -d= -f2")
CA=$(ssh_vm "grep ^SITE_HOST /opt/tagtech/deploy/.env | cut -d= -f2")
echo
echo "No ar (o HTTPS pode levar 1 a 2 minutos na primeira vez):"
echo "  Equipe:   https://$EQ/cadastro"
echo "  Cardápio: https://$CA"
echo "Para atualizar depois: git pull aqui no Cloud Shell e rode este script de novo."
