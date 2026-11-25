#!/usr/bin/env bash
# Liga o deploy automático na máquina do Google Cloud. Rode uma vez no Cloud Shell:
#   bash deploy/gcp-autodeploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
NOME=${NOME:-tagtech-clinicas}
ZONA=${ZONA:-southamerica-east1-b}
gcloud compute scp --zone "$ZONA" --quiet deploy/instalar-autodeploy.sh "$NOME:/tmp/"
gcloud compute ssh "$NOME" --zone "$ZONA" --quiet -- -t 'bash /tmp/instalar-autodeploy.sh'
