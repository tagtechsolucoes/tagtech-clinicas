#!/usr/bin/env bash
# Constrói, migra e reinicia. Se a pasta for um clone do git, baixa a versão nova antes.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d .git ]; then
  # Repositório privado: sem credencial salva o pull falha; aí segue com o código daqui.
  git pull --ff-only || echo "Aviso: não consegui baixar a versão nova; usando o código atual."
  APP_VERSION=$(git rev-parse --short HEAD)
else
  # Código enviado como pacote (scripts do Google Cloud): a versão vem no arquivo VERSION.
  APP_VERSION=$(cat VERSION 2>/dev/null || echo manual)
fi
export APP_VERSION
cd deploy
docker compose build
# Migrações primeiro; se falharem, nada é reiniciado.
docker compose run --rm migrate
docker compose up -d
docker image prune -f > /dev/null
echo "No ar: versão $APP_VERSION"
