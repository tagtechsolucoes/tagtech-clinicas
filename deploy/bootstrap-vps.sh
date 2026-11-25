#!/usr/bin/env bash
# Prepara uma VPS Ubuntu nova (Oracle Cloud, Lightsail, qualquer uma) e sobe o TagTech Clínicas.
# Uso, logado na VPS como o usuário padrão (ubuntu):
#   curl -fsSL https://raw.githubusercontent.com/tagtechsolucoes/tagtech-clinicas/main/deploy/bootstrap-vps.sh -o bootstrap.sh
#   bash bootstrap.sh
# O repositório é privado: o script pede um token do GitHub só para clonar (não fica salvo).
set -euo pipefail

DIR=/opt/tagtech
REPO=github.com/tagtechsolucoes/tagtech-clinicas.git

echo "== 1/6 Atualizando o sistema"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl openssl iptables-persistent

echo "== 2/6 Abrindo as portas 80 e 443 no firewall da própria máquina"
# As imagens Ubuntu da Oracle vêm com iptables que rejeita tudo menos SSH. Sem isto, mesmo
# liberando no painel da nuvem, o site não abre.
for proto in tcp udp; do
  for port in 80 443; do
    [ "$proto/$port" = "udp/80" ] && continue
    sudo iptables -C INPUT -p "$proto" --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null ||
      sudo iptables -I INPUT 5 -p "$proto" --dport "$port" -m state --state NEW -j ACCEPT
  done
done
sudo netfilter-persistent save > /dev/null

echo "== 3/6 Memória extra (swap de 4 GB) para o build não faltar memória"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile > /dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

echo "== 4/6 Docker"
if ! command -v docker > /dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "== 5/6 Código"
if [ ! -d "$DIR/.git" ]; then
  read -r -s -p "Token do GitHub (fine-grained, só leitura do repositório): " TOKEN; echo
  sudo mkdir -p "$DIR" && sudo chown "$USER" "$DIR"
  git clone -q "https://x-access-token:${TOKEN}@${REPO}" "$DIR"
  # Tira o token da configuração do git depois de clonar.
  git -C "$DIR" remote set-url origin "https://${REPO}"
  unset TOKEN
fi

echo "== 6/6 Configuração"
cd "$DIR/deploy"
if [ ! -f .env ]; then
  IP=$(curl -fsS https://api.ipify.org)
  senha() { openssl rand -base64 48 | tr -d '/+=\n' | head -c 32; }
  echo "IP público desta máquina: $IP"
  echo "Endereços: use os dois subdomínios que você criou no DuckDNS apontando para esse IP"
  echo "(ex.: minhaclinica-site.duckdns.org e minhaclinica-app.duckdns.org) ou o seu domínio."
  read -r -p "Endereço do site de agendamento: " SITE
  read -r -p "Endereço do app da equipe: " EQUIPE
  read -r -p "Seu e-mail (avisos do certificado HTTPS): " EMAIL
  cat > .env <<ENV
# Quando trocar de endereço, edite aqui e rode ./deploy.sh de novo (e reimprima os QR).
SITE_HOST=${SITE}
EQUIPE_HOST=${EQUIPE}
ACME_EMAIL=${EMAIL}
OWNER_DB_PASSWORD=$(senha)
APP_DB_PASSWORD=$(senha)
RESEND_API_KEY=
MAIL_FROM=
SENTRY_DSN=
APP_VERSION=
ENV
  chmod 600 .env
  echo "Criado deploy/.env com senhas geradas."
fi

echo
echo "Pronto. Saia e entre de novo no SSH (para o grupo docker valer) e rode:"
echo "  cd $DIR/deploy && ./deploy.sh"
grep -E '^(SITE|EQUIPE)_HOST' .env | sed 's/^/  /'
