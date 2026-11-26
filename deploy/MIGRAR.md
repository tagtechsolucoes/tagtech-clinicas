# Trocar de servidor

Leva uns 30 minutos, com o sistema fora do ar por 10 a 15. Tudo vem junto: banco, fotos, o
WhatsApp conectado por QR code (ninguém precisa ler o código de novo), as senhas do `.env` e o
backup diário. Funciona para qualquer VPS com Ubuntu (Google Cloud, Hetzner, Hostinger, Oracle…).

Você precisa de: a chave privada do backup (`chave-backup.txt`), acesso ao Cloud Shell e ao
painel do DNS (hoje, a Hostinger, domínio tagtechsolucoes.com.br).

## 1. Na véspera

- Crie a máquina nova: Ubuntu 22.04 ou 24.04, 2 vCPU e 4 GB de memória, com as portas 80 e 443
  liberadas no firewall do provedor.
- Se usar domínio próprio (é o caso: tagtechsolucoes.com.br na Hostinger), baixe o TTL dos registros para 300 segundos.

## 2. Preparar a máquina nova

Entre por SSH na máquina nova e rode o mesmo instalador de sempre. Ele instala o Docker e
baixa o código; quando perguntar os endereços, pode responder qualquer coisa (o `.env` do
servidor antigo vai substituir). **Não rode o `./deploy.sh`** no fim.

```bash
curl -fsSL https://raw.githubusercontent.com/tagtechsolucoes/tagtech-clinicas/main/deploy/bootstrap-vps.sh -o bootstrap.sh && bash bootstrap.sh
```

Saia e entre de novo no SSH (para o Docker funcionar sem `sudo`).

## 3. Parar o servidor antigo e fazer o backup final

No Cloud Shell. Ele pede para digitar `SAIR`. A partir daqui o sistema fica fora do ar.

```bash
gcloud compute ssh tagtech-clinicas --zone southamerica-east1-b -- -t 'cd /opt/tagtech/deploy && ./migrar.sh sair'
```

No fim aparece **Data do backup final** (ex.: `2026-12-01_2130`). Anote.

## 4. Levar o backup e a chave para a máquina nova

No Cloud Shell, troque `DATA` pela data anotada e `usuario@IP` pelo acesso da máquina nova.
Antes, envie o `chave-backup.txt` para o Cloud Shell (menu ⋮ → Fazer upload).

```bash
DATA=2026-12-01_2130
mkdir -p migracao && gcloud storage cp "gs://tagclin-backups-tagtech-food-piloto/tagclin/*-$DATA.*" migracao/
```

```bash
scp -r migracao chave-backup.txt usuario@IP:~
```

Se a máquina nova também for do Google Cloud, use `gcloud compute scp --recurse migracao chave-backup.txt NOME-DA-VM:~ --zone ZONA`.

Devem ir quatro arquivos: `banco-`, `fotos-`, `whatsapp-` e `config-`, todos com a mesma data.

## 5. Subir tudo na máquina nova

Na máquina nova:

```bash
cd /opt/tagtech/deploy && ./migrar.sh chegar ~/chave-backup.txt ~/migracao
```

Ele põe o `.env` antigo, sobe o sistema, restaura os dados e agenda o backup diário. No fim
mostra o IP da máquina e os endereços.

## 6. Apontar o DNS

Na Hostinger (DNS de `tagtechsolucoes.com.br`), troque o IP dos registros `tagclin` e
`tagclin-site` pelo IP da máquina nova. O HTTPS sai sozinho assim que o DNS chegar (com TTL de
300, em até 5 minutos).

## 7. Conferir

- O painel abre e o login funciona; a agenda mostra as consultas.
- O site de agendamento abre com as fotos.
- Em Clínica e site → WhatsApp da clínica, o número aparece **conectado**. Se pedir QR code, leia de novo.
- Marque uma consulta de teste pelo site e veja chegar na agenda.

## 8. Fechar

Na máquina nova: ligue o deploy automático e apague a chave.

```bash
bash /opt/tagtech/deploy/instalar-autodeploy.sh && rm ~/chave-backup.txt
```

No Cloud Shell, apague a cópia da chave e os arquivos:

```bash
rm -rf migracao chave-backup.txt
```

Deixe a máquina antiga **parada** por uma semana, como reserva, e depois apague.

## Se algo der errado

O servidor antigo não perdeu nada, só está parado. Para voltar a atender por ele:

```bash
gcloud compute ssh tagtech-clinicas --zone southamerica-east1-b --command 'cd /opt/tagtech/deploy && docker compose up -d && sudo systemctl enable --now tagtech-autodeploy.timer'
```

e volte o IP na Hostinger.
