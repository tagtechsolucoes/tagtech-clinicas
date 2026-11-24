# Pôr no ar (piloto)

> Sem orçamento ainda? Veja [GRATUITO.md](GRATUITO.md): Oracle Cloud Always Free com endereço
> do DuckDNS, sem pagar servidor nem domínio. O script `bootstrap-vps.sh` prepara qualquer VPS Ubuntu.
> Tem créditos no Google Cloud? Veja [GCP.md](GCP.md): um script no Cloud Shell faz tudo.

Um servidor só, com tudo em contêineres: Postgres, API, cardápio (Next), app da equipe
(estático) e Caddy na frente com HTTPS automático.

```
Internet ─► Caddy :443 ─┬─ agendar.seudominio  ─► web-cliente (Next)   ─┐
                        │      └─ /api/* ───────────────────────────────►├─► api ─► postgres
                        └─ app.seudominio      ─► arquivos do app equipe │
                               └─ /api/* ───────────────────────────────►┘
```

## 1. Servidor

1. No Lightsail, crie uma instância **Linux/Ubuntu 24.04**, plano de **4 GB** (o build do Next
   precisa de memória). Região São Paulo.
2. Em _Networking_: crie um **IP estático** e ligue à instância; no firewall, deixe abertas
   **22, 80 e 443** (TCP) e **443 (UDP)**.
3. Ative **snapshots automáticos** diários da instância (segunda camada de backup).

## 2. Domínio

No painel do registro do domínio, crie dois registros **A** apontando para o IP estático:

| Nome       | Tipo | Valor          |
| ---------- | ---- | -------------- |
| `cardapio` | A    | IP do servidor |
| `app`      | A    | IP do servidor |

## 3. Instalar

```bash
ssh ubuntu@IP_DO_SERVIDOR
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # entre de novo para valer
sudo mkdir -p /opt/tagtech && sudo chown ubuntu /opt/tagtech
git clone https://github.com/tagtechsolucoes/tagtech-food.git /opt/tagtech
cd /opt/tagtech/deploy
cp .env.example .env && nano .env       # preencha endereços, senhas, Resend, Sentry
./deploy.sh
```

O primeiro build leva alguns minutos. O Caddy pede os certificados sozinho assim que o DNS
estiver propagado.

## 4. Primeiro acesso

1. Abra `https://app.seudominio.com.br/cadastro` e crie a conta do restaurante.
2. No painel: Marca, Cardápio, Mesas (imprima os QR), Equipe (convide e ligue o tablet).
3. Faça um pedido de teste pelo QR e feche a conta.

## 5. E-mail (troca de senha)

1. Crie a conta em resend.com, adicione o domínio e copie os registros DNS que ele pedir
   (SPF/DKIM) para o seu domínio.
2. Gere uma API key e coloque em `RESEND_API_KEY`; `MAIL_FROM` com um endereço do domínio.
3. `./deploy.sh` de novo. Sem isso, o link de troca de senha só aparece no log:
   `docker compose logs api | grep "E-mail para"`.

## 6. Erros (Sentry)

Crie um projeto Node no sentry.io e cole o DSN em `SENTRY_DSN`. Só erros 5xx e falhas
inesperadas são enviados, sem corpo de pedido, cookies ou cabeçalhos.

## 7. Backup

```bash
crontab -e
15 4 * * * /opt/tagtech/deploy/backup.sh >> /var/log/tagtech-backup.log 2>&1
```

Guarda 14 dias em `deploy/backups`. Para ter cópia fora do servidor, crie um bucket no
Lightsail, instale o `aws` CLI e preencha no `.env`:
`BACKUP_S3_URI=s3://nome-do-bucket/tagtech` e `BACKUP_S3_ENDPOINT=https://...` (o endpoint
que o Lightsail mostra). Para restaurar: `./restore.sh backups/banco-....dump backups/fotos-....tar.gz`.

## 8. Atualizar

Depois de juntar mudanças na `main`: `cd /opt/tagtech/deploy && ./deploy.sh`.
As migrações rodam antes de reiniciar; se falharem, a versão anterior continua no ar.

## Impressora e tablets

- Impressora térmica 80 mm: instale no computador/tablet da cozinha e deixe como padrão.
  Para imprimir sem confirmar, abra o Chrome com `--kiosk-printing`.
- Tablet do salão: entre como dono em `app.…`, Equipe → "Usar este aparelho como tablet".

## Comandos úteis

```bash
docker compose ps                     # o que está rodando
docker compose logs -f api            # log da API
docker compose exec postgres psql -U tagtech tagtech   # banco (cuidado)
```
