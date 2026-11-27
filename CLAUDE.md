# TagClin (repo tagtech-clinicas)

Sistema para clínicas de qualquer área (1 profissional ou várias), vendido pela **TagTech** (tagtechsolucoes). Posicionamento: "o sistema que enche a agenda". Produto irmão: TagBite (restaurantes), no repo `tagtech-food`. Visual baseado no esboço Alvor Odontologia (petróleo, porcelana, âmbar).

Detalhes técnicos no `README.md` e em `deploy/*.md`. Este arquivo é o contexto para continuar o trabalho.

## O que já existe

- Agenda (dia, semana, mês), recepção, pacientes com prontuário, odontograma, fotos, documentos, orçamentos e pacotes, lista de espera.
- Site de agendamento da clínica (`/c/<slug>`), confirmação e remarcação por link.
- Financeiro, estoque, convênios com guias e XML TISS (só para quem atende plano), relatórios, resultado.
- WhatsApp: número da clínica por **QR code (Evolution API, contêiner no compose)** ou API oficial da Meta. Mensagens automáticas (aviso, lembrete, lista de espera, retorno, reativação, avaliação) e **central de Conversas** (resposta pelo painel, paciente do número, próximas consultas, "Marcar consulta" já preenchido). Atualiza por consulta a cada 5 s (sem socket).
- PWA instalável. Tela "Administração TagTech" para quem está em `PLATFORM_ADMINS`.
- Lembrete com confirmação respondendo 1 ou 2 (pelo QR code) e lembrete do dia com o endereço.
- Backup diário criptografado (banco, fotos, WhatsApp e `.env`) e troca de servidor com `deploy/migrar.sh` (guia em `deploy/MIGRAR.md`).

## Planos e preços (tabela, por mês)

Essencial (1 profissional) R$ 115 · Profissional (até 5) R$ 240 · Clínica (sem limite) R$ 349 de referência, vendido sob consulta. No cartão, plano anual; no Pix à vista: Essencial R$ 999 e Profissional R$ 2.000 por ano (`packages/domain/src/planos.ts`). Mensalidade combinada sobrescreve a tabela.

## Produção

- Google Cloud, projeto `tagtech-food-piloto`, VM `tagtech-clinicas`, zona `southamerica-east1-b`.
- Painel `tagclin.tagtechsolucoes.com.br`, site `tagclin-site.tagtechsolucoes.com.br` (DNS na Hostinger, domínio tagtechsolucoes.com.br).
- Atualização automática: a VM puxa a `main` a cada ~2 min e roda `deploy/deploy.sh`. O `deploy.sh` cria a `EVOLUTION_API_KEY` se faltar. `.env` em `/opt/tagtech/deploy/.env`, carregar com `deploy/env.sh`.
- Primeira venda: `deploy/preparar-venda.sh`.

```bash
# Recriar a Clínica Aurora (demonstração) com fotos
gcloud compute ssh tagtech-clinicas --zone southamerica-east1-b --command 'cd /opt/tagtech/deploy && docker compose run --rm -e SEED_DONO=clinicaaurora@example.com -e SEED_ADMIN=tagtechsolucoes@gmail.com migrate pnpm db:seed'
# Ver serviços e logs
gcloud compute ssh tagtech-clinicas --zone southamerica-east1-b --command 'cd /opt/tagtech/deploy && docker compose ps && docker compose logs --tail 40 api evolution'
```

## Contas

- Admin da plataforma: `tagtechsolucoes@gmail.com` (só a tela TagTech, sem clínica).
- Demonstração: `clinicaaurora@example.com` (Clínica Aurora, slug `clinica-aurora`, assinatura sem fim). Senha gerada pelo seed, com o João. Fotos em `packages/db/seed-media/aurora` (Unsplash). O seed não apaga a Aurora se o e-mail do dono estiver errado.

## Desenvolvimento local

`.env` já existe localmente (não versionado). `pnpm db:migrate && pnpm db:seed`, `pnpm --filter api dev` (:3000), `pnpm --filter web-equipe dev` (:3002). Login local: `dono@demo.tagtech` / `demo-tagtech-123` (é admin local: abrir a clínica pelo menu "Abrir uma clínica").

## Próximos passos possíveis

Comparação com a Clínica Experts sugeriu: termos com assinatura, permissões por colaborador; IA de atendimento depois. Testar o QR code com número real em produção.

## Como trabalhar com o João (dono do projeto)

- Responder em português do Brasil, de forma enxuta: o que foi feito, o que ele precisa fazer, a pergunta. Sem recapitular passos.
- Interface sempre bonita, moderna e sofisticada. Conferir com screenshot (Playwright) antes de entregar.
- Fluxo: branch a partir da `main` → commit → push → PR pela API (`gh api repos/tagtechsolucoes/<repo>/pulls`). **Merge só depois do "sim" dele**, com squash (`gh api -X PUT repos/tagtechsolucoes/<repo>/pulls/N/merge -f merge_method=squash`) e com o CI verde.
- Antes do PR: `pnpm format:check`, `pnpm typecheck`, `timeout 900 pnpm test` (Postgres local; se cair, `service postgresql start`).
- Versão (MAJOR.MINOR.PATCH) no `package.json` e no `CHANGELOG.md`: todo PR escreve o que mudou em "Próxima versão" e roda `pnpm versao patch|minor|major` (correção, função nova, mudança grande). O CI cria a tag e a release. A versão no ar aparece no rodapé do painel e em `/api/health`.
- Nunca gravar senha, token ou chave no repositório. Senhas de contas de demonstração são geradas no seed e só aparecem na saída do comando.
- Ele não tem acesso direto ao servidor por aqui: roda os comandos no Google Cloud Shell. Entregar comandos prontos para colar, um bloco por servidor, dizendo o que deve aparecer.
- A TagTech tem 4 sócios. Mensalidades são cobradas à mão (Pix/boleto) e controladas na tela "TagTech" (só para quem está em `PLATFORM_ADMINS`).
