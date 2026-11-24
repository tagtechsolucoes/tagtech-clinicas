#!/usr/bin/env bash
# Roda UMA vez na máquina (o gcp-autodeploy.sh chama pelo Cloud Shell). Liga o deploy
# automático: chave de leitura só deste repositório, código como clone do git e um timer.
set -euo pipefail
REPO=git@github.com:tagtechsolucoes/tagtech-food.git
CHAVE=$HOME/.ssh/tagtech_deploy

mkdir -p ~/.ssh && chmod 700 ~/.ssh
[ -f "$CHAVE" ] || ssh-keygen -q -t ed25519 -N '' -C "deploy tagtech-food $(hostname)" -f "$CHAVE"
cat > ~/.ssh/config <<CFG
Host github.com
  IdentityFile $CHAVE
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
CFG
# O ssh-keyscan às vezes sai com erro mesmo tendo lido a chave (ex.: falha no IPv6); não
# pode derrubar o script. Se não ler nada, o accept-new acima aceita a chave na 1ª conexão.
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null || true
sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts

echo
echo "=================================================================="
echo "No GitHub: tagtech-food -> Settings -> Deploy keys -> Add deploy key"
echo "Título: servidor de produção. NÃO marque 'Allow write access'. Cole:"
echo
cat "$CHAVE.pub"
echo "=================================================================="
# O GitHub responde ao ssh -T com código de saída 1 mesmo quando a chave é aceita; com
# pipefail, o "| grep" sempre falharia. Por isso a saída é guardada antes de conferir.
aceita() { local r; r=$(ssh -T git@github.com 2>&1 || true); grep -q "successfully authenticated" <<< "$r"; }
until aceita; do
  read -r -p "Depois de adicionar a chave, aperte Enter para conferir..." _
done
echo "Chave aceita."

# Troca o código enviado por pacote por um clone do git, guardando .env e backups.
if [ ! -d /opt/tagtech/.git ]; then
  sudo mkdir -p /opt/tagtech.git-novo && sudo chown "$USER" /opt/tagtech.git-novo
  git clone -q "$REPO" /opt/tagtech.git-novo
  [ -f /opt/tagtech/deploy/.env ] && cp -p /opt/tagtech/deploy/.env /opt/tagtech.git-novo/deploy/.env
  [ -d /opt/tagtech/deploy/backups ] && cp -rp /opt/tagtech/deploy/backups /opt/tagtech.git-novo/deploy/
  sudo mv /opt/tagtech /opt/tagtech.antigo-$(date +%Y%m%d%H%M)
  sudo mv /opt/tagtech.git-novo /opt/tagtech
fi

sudo tee /etc/systemd/system/tagtech-autodeploy.service > /dev/null <<UNIT
[Unit]
Description=TagTech Clínicas: deploy automático da main
After=docker.service network-online.target

[Service]
Type=oneshot
User=$USER
Group=docker
ExecStart=/opt/tagtech/deploy/autodeploy.sh
UNIT
sudo tee /etc/systemd/system/tagtech-autodeploy.timer > /dev/null <<UNIT
[Unit]
Description=TagTech Clínicas: confere a main a cada 2 minutos

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now tagtech-autodeploy.timer
echo
echo "Deploy automático ligado. Subindo a versão atual da main agora (5 a 10 minutos):"
# O clone já está na main, então o timer não veria novidade: o primeiro deploy é aqui.
cd /opt/tagtech/deploy && sg docker -c ./deploy.sh
