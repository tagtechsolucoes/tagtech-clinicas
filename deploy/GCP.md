# Pôr no ar no Google Cloud (com créditos)

Tudo pelo **Cloud Shell**, o terminal do próprio console, já logado na sua conta. Nenhuma
chave sai da sua conta.

## Antes

1. **Projeto:** no console, crie um projeto só para isso (ex.: `tagtech-food-piloto`) e
   ligue o faturamento com os créditos.
2. **Endereços:** em duckdns.org (login com GitHub ou Google), crie dois subdomínios, por
   exemplo `brasaepao-app` e `brasaepao-cardapio`. Não precisa pôr IP: o script faz isso.
   Copie o **token** do topo da página. (Com domínio próprio, o script pede os registros A.)
3. **Token do GitHub** para clonar o repositório privado: _Settings → Developer settings →
   Fine-grained tokens_, só o `tagtech-food`, **Contents: Read-only**.

## Subir

Abra o Cloud Shell (ícone `>_` no topo do console) e rode:

```bash
gcloud config set project ID_DO_PROJETO
git clone https://github.com/tagtechsolucoes/tagtech-food.git
# usuário: seu login do GitHub; senha: o token
cd tagtech-food
bash deploy/gcp-subir.sh
```

O script cria a máquina **e2-medium (2 vCPUs, 4 GB) em São Paulo**, IP fixo, firewall e
snapshot diário do disco; aponta o DuckDNS; instala o Docker; envia o código; gera o `.env`
com senhas; constrói e sobe; e agenda o backup. A primeira vez leva uns 15 a 20 minutos.

No fim ele mostra os endereços. Abra o da equipe em `/cadastro` e crie o restaurante.

## Atualizar

```bash
cd ~/tagtech-food && git pull && bash deploy/gcp-subir.sh
```

Reaproveita máquina, IP, endereços e senhas; só troca o código e reinicia.

## Custos e cuidados

- Veja o valor da máquina na calculadora do Google antes (`e2-medium`, `southamerica-east1`,
  disco de 30 GB, IP fixo) e crie um **orçamento com alerta** em _Faturamento → Orçamentos_.
- Se o crédito for o **teste gratuito**, ele vence em 90 dias e a conta precisa virar paga
  para a máquina continuar ligada. Faça o backup antes do vencimento.
- Logs: `gcloud compute ssh tagtech-piloto --zone southamerica-east1-b --command
"cd /opt/tagtech/deploy && docker compose logs --tail 100 api"`.

## Deploy automático

Liga uma vez e nunca mais precisa colar comandos para atualizar: a máquina confere a `main`
do GitHub a cada 2 minutos e, se tiver versão nova, atualiza e reinicia sozinha.

```bash
cd ~/tagtech-food && bash deploy/gcp-autodeploy.sh
```

O script mostra uma **chave** e espera. No GitHub: repositório `tagtech-food` → **Settings →
Deploy keys → Add deploy key**, título "servidor de produção", cole a chave e **não marque**
"Allow write access". Volte ao Cloud Shell e aperte Enter.

Daí em diante: **juntou um PR na `main`, em uns 2 minutos começa o deploy** (mais o tempo de
construir, 3 a 10 minutos). Se o build ou a migração falhar, a versão anterior continua no ar.

- Ver o que aconteceu: `gcloud compute ssh tagtech-piloto --zone southamerica-east1-b
--command "journalctl -u tagtech-autodeploy -n 50 --no-pager"`
- Forçar agora: `... --command "sudo systemctl start tagtech-autodeploy"`
- Desligar: `... --command "sudo systemctl disable --now tagtech-autodeploy.timer"`

A chave só lê este repositório e fica só na máquina. Para revogar, apague em Deploy keys.
