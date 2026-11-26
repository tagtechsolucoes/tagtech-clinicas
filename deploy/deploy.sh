#!/usr/bin/env bash
# Constrói, migra e reinicia. Se a pasta for um clone do git, baixa a versão nova antes.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d .git ]; then
  # Repositório privado: sem credencial salva o pull falha; aí segue com o código daqui.
  git pull --ff-only || echo "Aviso: não consegui baixar a versão nova; usando o código atual."
  # "1.2.0 (a1b2c3d)": a versão do package.json e o commit exato.
  VERSAO=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)
  APP_VERSION="${VERSAO:-?} ($(git rev-parse --short HEAD))"
else
  # Código enviado como pacote (scripts do Google Cloud): a versão vem no arquivo VERSION.
  APP_VERSION=$(cat VERSION 2>/dev/null || echo manual)
fi
export APP_VERSION
cd deploy
# Chave interna da Evolution (WhatsApp por QR code), criada uma vez e guardada no .env.
if [ -f .env ] && ! grep -q '^EVOLUTION_API_KEY=' .env; then
  echo "EVOLUTION_API_KEY=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> .env
  echo "Chave da Evolution criada no .env"
fi
docker compose build
# Migrações primeiro; se falharem, nada é reiniciado.
docker compose run --rm migrate
docker compose up -d
docker image prune -f > /dev/null
echo "No ar: versão $APP_VERSION"
