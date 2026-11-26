#!/usr/bin/env bash
# Liga, de uma vez, o que o servidor precisa antes de vender (ver PRONTO-PARA-VENDER.md):
# backup criptografado fora da máquina, aviso por e-mail quando cair, PLATFORM_* e o resto.
#
# No Cloud Shell, no projeto da máquina, cole:
#
#   gcloud compute ssh tagtech-clinicas --zone southamerica-east1-b \
#     --command 'cat /opt/tagtech/deploy/preparar-venda.sh' > preparar-venda.sh && bash preparar-venda.sh
#
# Pode rodar de novo quantas vezes quiser: o que já existe fica como está.
# (Na máquina, o mesmo arquivo roda com "servidor", chamado pelo próprio script.)
set -euo pipefail

# ------------------------------------------------------------------ por produto
PRODUTO="TagClin"
VM="tagtech-clinicas"
ZONA="southamerica-east1-b"
SLUG="tagclin"
DEMO_PADRAO="clinicaaurora@example.com"
HOSTS_VARS="EQUIPE_HOST SITE_HOST"
# ------------------------------------------------------------------

ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
aviso() { printf '\033[33m!\033[0m %s\n' "$*"; }
titulo() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# =================================================================== na máquina
if [ "${1:-}" = "servidor" ]; then
  cd /opt/tagtech/deploy
  # Troca (ou acrescenta) CHAVE='valor' no .env. Entre aspas simples o valor vale igual para o
  # docker compose e para o bash (o backup.sh lê o .env com "."); aspa simples vira ’.
  set_env() {
    CHAVE="$1" VALOR="'${2//\'/’}'" awk -v k="$1" '
      BEGIN { feito = 0 }
      index($0, k "=") == 1 { print k "=" ENVIRON["VALOR"]; feito = 1; next }
      { print }
      END { if (!feito) print k "=" ENVIRON["VALOR"] }' .env > .env.novo
    cat .env.novo > .env && rm .env.novo
  }

  titulo "Configuração (.env)"
  [ -n "${P_ADMINS:-}" ] && set_env PLATFORM_ADMINS "$P_ADMINS" && ok "PLATFORM_ADMINS"
  [ -n "${P_PAGAMENTO:-}" ] && set_env PLATFORM_PAYMENT_INFO "$P_PAGAMENTO" && ok "PLATFORM_PAYMENT_INFO"
  [ -n "${P_WHATSAPP:-}" ] && set_env PLATFORM_WHATSAPP "$P_WHATSAPP" && ok "PLATFORM_WHATSAPP"
  [ -n "${P_SENTRY:-}" ] && set_env SENTRY_DSN "$P_SENTRY" && ok "SENTRY_DSN"
  if [ -n "${P_AGE:-}" ]; then
    set_env BACKUP_AGE_RECIPIENT "$P_AGE"
    set_env BACKUP_REMOTE "$P_REMOTE"
    set_env BACKUP_GCS_KEY_FILE /opt/tagtech/conta-backup.json
    set_env RCLONE_GCS_BUCKET_POLICY_ONLY true
    ok "backup apontando para $P_REMOTE"
  fi
  if [ -f /tmp/conta-backup.json ]; then
    sudo mv /tmp/conta-backup.json /opt/tagtech/conta-backup.json
    sudo chown "$(id -u):$(id -g)" /opt/tagtech/conta-backup.json
    chmod 600 /opt/tagtech/conta-backup.json
    ok "chave da conta de backup guardada (600)"
  fi

  titulo "Aplicando"
  sg docker -c ./deploy.sh > /tmp/preparar-deploy.log 2>&1 && ok "deploy refeito" ||
    { aviso "o deploy falhou; veja /tmp/preparar-deploy.log"; exit 1; }

  DEMO=$(sg docker -c "docker compose exec -T postgres psql -U tagtech -d tagtech -tAc \"select count(*) from users where email = 'dono@demo.tagtech'\"" 2> /dev/null | tr -d '[:space:]' || true)
  if [ "$PRODUTO_SLUG" = "tagclin" ] && [ -n "${P_DONO:-}" ] && [ "${DEMO:-0}" != "0" ]; then
    titulo "Conta de demonstração"
    if sg docker -c "docker compose run --rm -e SEED_DONO=$(printf %q "$P_DONO") -e SEED_ADMIN=$(printf %q "${P_ADMIN:-}") migrate pnpm db:seed" > /tmp/preparar-seed.log 2>&1; then
      grep -A3 "Contas criadas" /tmp/preparar-seed.log || true
      ok "conta dono@demo.tagtech removida; a Clínica Aurora agora é de $P_DONO"
    else
      aviso "não consegui refazer a demonstração; veja /tmp/preparar-seed.log"
    fi
  fi

  if [ "$PRODUTO_SLUG" = "food" ]; then
    titulo "Versão no ar"
    if sg docker -c "docker compose exec -T postgres psql -U tagtech -d tagtech -tAc \"select to_regclass('cash_sessions') is not null and to_regclass('stock_movements') is not null\"" | grep -q t; then
      ok "caixa e estoque estão no banco"
    else
      aviso "caixa/estoque ainda não estão no banco: o autodeploy pode estar desligado (sudo systemctl status tagtech-autodeploy.timer)"
    fi
  fi

  titulo "Backup"
  (crontab -l 2>/dev/null | grep -q backup.sh) ||
    { (crontab -l 2>/dev/null; echo "15 4 * * * /opt/tagtech/deploy/backup.sh >> \$HOME/backup.log 2>&1") | crontab -; }
  ok "agendado todo dia às 4h15"
  if sg docker -c ./backup.sh > /tmp/preparar-backup.log 2>&1; then
    if grep -q "enviado para" /tmp/preparar-backup.log; then ok "primeiro backup criptografado enviado ao bucket"
    else aviso "backup feito só na máquina: $(tail -1 /tmp/preparar-backup.log)"; fi
  else
    aviso "o backup falhou; veja /tmp/preparar-backup.log"
  fi
  exit 0
fi

# =================================================================== no Cloud Shell
command -v gcloud > /dev/null || { echo "Rode no Cloud Shell do Google Cloud."; exit 1; }
PROJETO=$(gcloud config get-value project 2> /dev/null)
[ -n "$PROJETO" ] || { echo "Escolha o projeto: gcloud config set project ID"; exit 1; }
vm() { gcloud compute ssh "$VM" --zone "$ZONA" --quiet --command "$1"; }

titulo "$PRODUTO · projeto $PROJETO · máquina $VM"
read -rp "E-mail de administrador da TagTech (alertas e tela TagTech): " EMAIL
read -rp "E-mail da conta da clínica de demonstração [$DEMO_PADRAO]: " DEMO
DEMO="${DEMO:-$DEMO_PADRAO}"
read -rp "E-mails de mais sócios com acesso à tela TagTech (vírgula, ou Enter): " SOCIOS
read -rp "Como o cliente paga a mensalidade (ex.: Pix CNPJ 00.000.000/0001-00 · TagTech), ou Enter: " PAGAMENTO
read -rp "WhatsApp da TagTech com DDI e DDD (ex.: 5581999990000), ou Enter: " WHATS
read -rp "DSN do Sentry (sentry.io › projeto Node), ou Enter para pular: " SENTRY
ADMINS="$EMAIL${SOCIOS:+,$SOCIOS}"
ADMINS="${ADMINS// /}"

# -------------------------------------------------- chave do backup (age)
titulo "1. Chave do backup"
CHAVE="$HOME/chave-backup-$SLUG.txt"
if ! command -v age-keygen > /dev/null; then
  mkdir -p "$HOME/.local/bin"
  curl -fsSL https://github.com/FiloSottile/age/releases/download/v1.2.1/age-v1.2.1-linux-amd64.tar.gz |
    tar -xz -C "$HOME/.local/bin" --strip-components=1 age/age age/age-keygen
  export PATH="$HOME/.local/bin:$PATH"
fi
if [ ! -f "$CHAVE" ]; then
  age-keygen -o "$CHAVE" 2> /dev/null
  chmod 600 "$CHAVE"
  ok "chave criada"
else
  ok "chave já existia ($CHAVE)"
fi
PUBLICA=$(grep -o 'age1[0-9a-z]*' "$CHAVE" | head -1)

# -------------------------------------------------- bucket e conta de serviço
titulo "2. Bucket e conta de serviço"
BUCKET="$SLUG-backups-$PROJETO"
CONTA="$SLUG-backup@$PROJETO.iam.gserviceaccount.com"
gcloud storage buckets describe "gs://$BUCKET" > /dev/null 2>&1 ||
  gcloud storage buckets create "gs://$BUCKET" --location=southamerica-east1 --uniform-bucket-level-access --quiet
ok "bucket gs://$BUCKET"
gcloud iam service-accounts describe "$CONTA" > /dev/null 2>&1 ||
  gcloud iam service-accounts create "$SLUG-backup" --display-name="Backup $PRODUTO" --quiet
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$CONTA" --role=roles/storage.objectAdmin --quiet > /dev/null
ok "conta $CONTA com acesso só ao bucket"
if ! vm 'test -f /opt/tagtech/conta-backup.json' 2> /dev/null; then
  TMP=$(mktemp -d)
  gcloud iam service-accounts keys create "$TMP/conta-backup.json" --iam-account="$CONTA" --quiet
  gcloud compute scp "$TMP/conta-backup.json" "$VM:/tmp/conta-backup.json" --zone "$ZONA" --quiet
  rm -rf "$TMP"
  ok "chave da conta enviada à máquina"
else
  ok "a máquina já tem a chave da conta"
fi

# -------------------------------------------------- servidor
titulo "3. Servidor"
q() { printf %q "$1"; }
vm "P_ADMINS=$(q "$ADMINS") P_PAGAMENTO=$(q "$PAGAMENTO") P_WHATSAPP=$(q "$WHATS") \
  P_SENTRY=$(q "$SENTRY") P_AGE=$(q "$PUBLICA") P_REMOTE=$(q ":gcs:$BUCKET/$SLUG") \
  P_DONO=$(q "$DEMO") P_ADMIN=$(q "$EMAIL") PRODUTO_SLUG=$SLUG bash /opt/tagtech/deploy/preparar-venda.sh servidor"

# -------------------------------------------------- aviso de queda
titulo "4. Aviso por e-mail quando cair"
CANAL=$(gcloud beta monitoring channels list --filter="labels.email_address=\"$EMAIL\"" --format='value(name)' 2> /dev/null | head -1)
if [ -z "$CANAL" ]; then
  CANAL=$(gcloud beta monitoring channels create --display-name="$EMAIL" --type=email \
    --channel-labels=email_address="$EMAIL" --format='value(name)' 2> /dev/null || true)
fi
[ -n "$CANAL" ] && ok "canal de e-mail $EMAIL" || aviso "não criei o canal de e-mail (crie em Monitoring › Alerting)"
for VAR in $HOSTS_VARS; do
  HOST=$(vm "grep -E '^$VAR=' /opt/tagtech/deploy/.env | cut -d= -f2-" 2> /dev/null | tr -d '\r')
  [ -n "$HOST" ] || continue
  CAMINHO=/
  [ "$VAR" = "EQUIPE_HOST" ] && CAMINHO=/api/health
  NOME="$SLUG-$(echo "$VAR" | tr 'A-Z_' 'a-z-')"
  ID=$(gcloud monitoring uptime list-configs --filter="displayName=\"$NOME\"" --format='value(name)' 2> /dev/null | head -1)
  if [ -z "$ID" ]; then
    gcloud monitoring uptime create "$NOME" --resource-type=uptime-url \
      --resource-labels="host=$HOST,project_id=$PROJETO" --protocol=https --path="$CAMINHO" \
      --period=5 --timeout=10 --quiet > /dev/null 2>&1 || { aviso "não criei a verificação de $HOST"; continue; }
    ID=$(gcloud monitoring uptime list-configs --filter="displayName=\"$NOME\"" --format='value(name)' | head -1)
  fi
  ok "verificação a cada 5 min: https://$HOST$CAMINHO"
  CHECK_ID=${ID##*/}
  if [ -n "$CANAL" ] && ! gcloud alpha monitoring policies list --filter="displayName=\"$NOME fora do ar\"" --format='value(name)' 2> /dev/null | grep -q .; then
    POL=$(mktemp)
    cat > "$POL" << JSON
{
  "displayName": "$NOME fora do ar",
  "combiner": "OR",
  "conditions": [{
    "displayName": "$HOST não responde",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"$CHECK_ID\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "300s",
      "aggregations": [{
        "alignmentPeriod": "1200s",
        "perSeriesAligner": "ALIGN_NEXT_OLDER",
        "crossSeriesReducer": "REDUCE_COUNT_FALSE",
        "groupByFields": ["resource.label.*"]
      }],
      "trigger": { "count": 1 }
    }
  }],
  "notificationChannels": ["$CANAL"]
}
JSON
    gcloud alpha monitoring policies create --policy-from-file="$POL" --quiet > /dev/null 2>&1 &&
      ok "alerta por e-mail se $HOST cair" || aviso "não criei o alerta de $HOST (Monitoring › Alerting)"
    rm -f "$POL"
  fi
done

# -------------------------------------------------- fim
titulo "Pronto"
echo "Guarde AGORA a chave privada do backup em dois lugares seguros (gerenciador de senhas"
echo "dos sócios). Sem ela, nenhum backup abre. Ela está em: $CHAVE"
echo
cat "$CHAVE"
echo
echo "Depois de guardar, apague daqui: rm $CHAVE"
