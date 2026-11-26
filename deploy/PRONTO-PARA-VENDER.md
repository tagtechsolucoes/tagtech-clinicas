# TagClin: o que ligar no servidor antes do primeiro cliente

Tudo aqui roda no **Cloud Shell**, no mesmo projeto do Google Cloud da máquina
`tagtech-clinicas` (zona `southamerica-east1-b`). Troque `SEU_EMAIL` pelo e-mail da sua conta no
painel do TagClin.

## Atalho: tudo de uma vez

No Cloud Shell, no projeto da máquina, cole:

```bash
gcloud compute ssh tagtech-clinicas --zone southamerica-east1-b \
  --command 'cat /opt/tagtech/deploy/preparar-venda.sh' > preparar-venda.sh && bash preparar-venda.sh
```

Ele pergunta seu e-mail, a forma de pagamento da mensalidade, o WhatsApp da TagTech e o DSN do
Sentry (opcional), e faz sozinho:

- chave do backup, bucket e conta de serviço, primeiro backup criptografado e o agendamento diário;
- `PLATFORM_ADMINS`, `PLATFORM_PAYMENT_INFO`, `PLATFORM_WHATSAPP` e `SENTRY_DSN` no `.env`;
- verificação a cada 5 minutos dos endereços, com alerta no seu e-mail se cair;
- troca a conta de demonstração pela sua (a Clínica Aurora passa a ser sua);

No fim, mostra a **chave privada do backup**: guarde em dois lugares seguros e apague do Cloud
Shell. Pode rodar de novo quando quiser; o que já existe fica como está. As seções abaixo são o
passo a passo manual do mesmo processo.

## 1. Tirar a conta de demonstração com senha pública

A conta `dono@demo.tagtech` tem a senha escrita no repositório. Recrie a Clínica Aurora na sua
própria conta; o seed apaga a conta antiga:

```bash
gcloud compute ssh tagtech-clinicas --zone southamerica-east1-b --command \
  'cd /opt/tagtech/deploy && docker compose run --rm -e SEED_DONO=SEU_EMAIL migrate pnpm db:seed'
```

Depois disso a Aurora aparece no seu painel, no seletor de clínica, ao lado da Dental Tag.
Fora do computador local o seed agora se recusa a rodar sem `SEED_DONO`.

## 2. Backup fora do servidor (criptografado)

1. **Chave**, no seu computador: `bash deploy/gerar-chave-backup.sh`. Guarde
   `chave-backup.txt` em dois lugares seguros (sem ela os backups não abrem).
2. **Bucket e conta de serviço**, no Cloud Shell:

   ```bash
   PROJETO=$(gcloud config get-value project)
   BUCKET=tagclin-backups-$PROJETO
   gcloud storage buckets create gs://$BUCKET --location=southamerica-east1 --uniform-bucket-level-access
   gcloud iam service-accounts create tagclin-backup --display-name="Backup TagClin"
   gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
     --member=serviceAccount:tagclin-backup@$PROJETO.iam.gserviceaccount.com --role=roles/storage.objectAdmin
   gcloud iam service-accounts keys create conta-backup.json \
     --iam-account=tagclin-backup@$PROJETO.iam.gserviceaccount.com
   gcloud compute scp conta-backup.json tagtech-clinicas:/tmp/ --zone southamerica-east1-b
   rm conta-backup.json
   echo "BACKUP_REMOTE=:gcs:$BUCKET/clinicas"
   ```

3. **No servidor**: mova a chave e preencha o `.env`:

   ```bash
   gcloud compute ssh tagtech-clinicas --zone southamerica-east1-b
   sudo mv /tmp/conta-backup.json /opt/tagtech/ && sudo chmod 600 /opt/tagtech/conta-backup.json
   nano /opt/tagtech/deploy/.env   # BACKUP_AGE_RECIPIENT=age1...  BACKUP_REMOTE=:gcs:...  BACKUP_GCS_KEY_FILE=/opt/tagtech/conta-backup.json
   cd /opt/tagtech/deploy && ./backup.sh   # deve terminar com "enviado para :gcs:..."
   ```

4. Uma vez por mês, teste a restauração (`deploy/README.md`, seção 7).

## 3. Aviso quando cair ou der erro

- **Queda:** Console → Monitoring → Uptime checks → Create. URL
  `https://tagclin.tagtechsolucoes.com.br/api/health`, a cada 5 minutos, alerta por e-mail.
  Faça outro para `https://tagclin-site.tagtechsolucoes.com.br`.
- **Erros:** crie um projeto gratuito no [Sentry](https://sentry.io) (plataforma Node), copie o
  DSN para `SENTRY_DSN=` no `.env` do servidor e rode `sg docker -c ./deploy.sh`.

## 4. Modelos do WhatsApp para aprovar na Meta

No Gerenciador do WhatsApp (Meta Business), crie um modelo para cada linha, em **Português (BR)**,
com o texto **exatamente** igual. Os exemplos de variável vão no campo "Amostra".

| Nome               | Categoria | Texto                                                                                                                                     | Amostras                                                                                                                     |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `consulta_aviso`   | Utilidade | Olá, {{1}}! Sua consulta de {{2}} na {{3}} {{4}} Para confirmar ou desmarcar, use o link: {{5}}                                           | Ana · Limpeza · Clínica Aurora · está marcada para qui, 26/11, às 09:00. · https://tagclin-site.tagtechsolucoes.com.br/a/abc |
| `vaga_oferta`      | Utilidade | Olá, {{1}}! Abriu um horário de {{2}} na {{3}}: {{4}}. Você estava na lista de espera. Para ficar com ele, toque no link até {{5}}: {{6}} | Ana · Limpeza · Clínica Aurora · qui, 26/11, às 09:00 · 11:30 · https://tagclin-site.tagtechsolucoes.com.br/v/abc            |
| `retorno_aviso`    | Utilidade | Olá, {{1}}! Já está na hora do seu retorno de {{2}} na {{3}}. Escolha o melhor horário pelo link: {{4}}                                   | Ana · Limpeza · Clínica Aurora · https://tagclin-site.tagtechsolucoes.com.br/c/clinica-aurora                                |
| `reativacao`       | Marketing | Olá, {{1}}! Faz um tempo que você não vem à {{2}}. Quando quiser voltar, é só agendar pelo link: {{3}}                                    | Ana · Clínica Aurora · https://tagclin-site.tagtechsolucoes.com.br/c/clinica-aurora                                          |
| `avaliacao_pedido` | Utilidade | Olá, {{1}}! Obrigado por vir à {{2}}. Como foi o seu atendimento? Leva 10 segundos: {{3}}                                                 | Ana · Clínica Aurora · https://tagclin-site.tagtechsolucoes.com.br/r/abc                                                     |

Depois de aprovados, a clínica liga o WhatsApp em **Clínica e site → WhatsApp** com o ID do número
e o token permanente.

## 5. Planos e mensalidade

No `.env` do servidor:

```bash
PLATFORM_ADMINS=seu@email.com,socio@email.com   # quem vê a tela "TagTech" (todas as clínicas)
PLATFORM_PAYMENT_INFO='Pix (CNPJ): 00.000.000/0001-00 · TagTech Soluções. Mande o comprovante pelo WhatsApp.'
PLATFORM_WHATSAPP=5581999990000                 # WhatsApp da TagTech, com DDI e DDD
```

Depois, `sg docker -c ./deploy.sh`. Com isso:

- Clínica nova entra em **teste de 14 dias** com tudo liberado; as que já existiam ficaram
  **em dia por 30 dias** no plano Clínica.
- Na tela **TagTech** do painel vocês definem plano (Essencial, Profissional ou Clínica),
  mensalidade e vencimento, e registram cada pagamento, que estende o "pago até".
- Venceu: o painel avisa. **7 dias depois** fica só para consulta e o site para de agendar,
  até registrar o pagamento. Nenhum dado é apagado.

## 6. Antes de cada cliente novo

- Contrato de assinatura e DPA assinados (modelo revisado pelo advogado).
- **Valores no site** escolhidos conforme o conselho da profissão (odontologia: esconder).
- Pix (Mercado Pago) e nota (Focus NFe) configurados pela própria clínica, se ela for usar.
- Antes e depois só com o termo de autorização do paciente assinado (o painel exige).
