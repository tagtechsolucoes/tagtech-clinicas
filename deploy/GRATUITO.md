# Piloto de graça (temporário): Oracle Cloud Always Free

Para rodar o piloto sem pagar servidor nem domínio. Quando o piloto virar cliente pagante,
migre para o Lightsail (ver `README.md`); o processo é o mesmo.

## O que você ganha

- **Servidor:** Oracle Cloud Always Free, máquina **Ampere A1 (ARM) com 2 OCPUs e 12 GB de
  RAM** e até 200 GB de disco. Sobra para Postgres, API, site e Caddy.
- **Endereço com HTTPS:** dois subdomínios grátis do **DuckDNS** (ex.:
  `minhaclinica-app.duckdns.org`), e o Caddy tira o certificado do Let's Encrypt sozinho.

## Cuidados

1. **Cartão de crédito:** a Oracle pede para conferir identidade. Não cobra se você ficar
   nos limites gratuitos.
2. **"Out of capacity":** na criação da máquina ARM, a região pode estar sem vaga. Tente
   outro horário ou outro _Availability Domain_. A região (home region) é escolhida no
   cadastro e não muda depois: São Paulo ou Vinhedo dão menos latência.
3. **Máquina parada é recolhida:** a Oracle pode recolher instância gratuita que passa 7 dias
   com CPU, rede e memória abaixo de 20%. Uma clínica pequena fica bem abaixo disso.
   Para evitar, mude a conta para **Pay As You Go** (continua grátis dentro dos limites) e
   crie um **orçamento com alerta de R$ 1** em _Billing → Budgets_.
4. **Backup:** o `backup.sh` criptografa e manda para um bucket (README, seção Backup); sem bucket, guarda só no próprio servidor. Num servidor gratuito, baixe uma
   cópia de vez em quando (`scp ubuntu@IP:/opt/tagtech/deploy/backups/* .`).

## Passo a passo

### 1. Conta e máquina

1. Crie a conta em oracle.com/cloud/free (escolha a região de São Paulo ou Vinhedo).
2. _Compute → Instances → Create instance_:
   - **Image:** Canonical Ubuntu 24.04.
   - **Shape:** _Ampere_ → `VM.Standard.A1.Flex`, **2 OCPUs, 12 GB**.
   - **Networking:** deixe criar a VCN nova com IP público.
   - **SSH keys:** baixe a chave privada (ou cole a sua pública).
   - **Boot volume:** 50 GB está ótimo.
3. Anote o **IP público** da instância.

### 2. Liberar 80 e 443 no painel

_Networking → Virtual cloud networks → (sua VCN) → Security Lists → Default_ → **Add Ingress
Rules**, origem `0.0.0.0/0`:

| Protocolo | Porta |
| --------- | ----- |
| TCP       | 80    |
| TCP       | 443   |
| UDP       | 443   |

(O firewall de dentro da máquina o script abre sozinho.)

### 3. Endereços no DuckDNS

Entre em duckdns.org (login com GitHub ou Google), crie **dois subdomínios**, por exemplo
`minhaclinica-site` e `minhaclinica-app`, e em cada um coloque o **IP público** da máquina em
_current ip_ → _update ip_.

### 4. Token do GitHub (o repositório é privado)

github.com → _Settings → Developer settings → Fine-grained tokens → Generate_: só o
repositório `tagtech-food`, permissão **Contents: Read-only**, validade curta. O script usa
para clonar e não salva.

### 5. Instalar e subir

```bash
ssh -i chave.key ubuntu@IP
curl -fsSL https://raw.githubusercontent.com/tagtechsolucoes/tagtech-food/main/deploy/bootstrap-vps.sh -o bootstrap.sh
# (repositório privado: se o curl der 404, copie o arquivo pelo scp ou cole o conteúdo)
bash bootstrap.sh
exit                      # entre de novo para o Docker valer
ssh -i chave.key ubuntu@IP
cd /opt/tagtech/deploy && ./deploy.sh
```

O script pergunta os dois endereços do DuckDNS e o seu e-mail, e gera as senhas do banco.
O primeiro build leva de 10 a 15 minutos na máquina ARM. Depois:

- equipe: `https://minhaclinica-app.duckdns.org/cadastro`
- site de agendamento: `https://minhaclinica-site.duckdns.org`

### 6. Agendar o backup

```bash
crontab -e
15 4 * * * /opt/tagtech/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1
```

## Quando tiver domínio

Troque `SITE_HOST` e `EQUIPE_HOST` no `deploy/.env`, aponte o DNS para o IP e rode
`./deploy.sh`. **Os QR impressos com o endereço do DuckDNS deixam de valer**: gere de novo em
Mesas (ou "Trocar QR") e reimprima. Por isso, se der, compre o domínio antes de imprimir os QR
definitivos. Estudante com o GitHub Student Pack ganha um domínio .tech ou .me por um ano.
