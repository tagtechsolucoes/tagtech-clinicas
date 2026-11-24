# TagTech Clínicas

Sistema para clínicas (odonto, estética, fisio, psicologia, nutrição, medicina) que enche a
agenda: agendamento online pelo site da clínica, confirmação pelo WhatsApp, lista de espera
que preenche horário vago e painel da recepção.

## Estrutura

- `apps/api`: API em NestJS (Fastify). Agenda, pacientes, equipe, site público.
- `apps/web-equipe`: painel da clínica (Vite + React). Agenda do dia e da semana, pacientes,
  lista de espera, profissionais, serviços, clínica e site, equipe.
- `apps/web-cliente`: site público em Next.js. `/c/<endereço>` (agendar) e `/a/<link>`
  (o paciente confirma ou desmarca).
- `packages/db`: migrações SQL (fonte da verdade, com RLS por clínica) e o espelho Drizzle.
- `packages/domain`: regras puras (horários livres, estados da consulta, fuso, telefone, CPF).

## Rodar local

```bash
pnpm install
cp .env.example .env
pnpm db:up && pnpm db:migrate && pnpm db:seed   # clínica de demonstração
pnpm dev
```

Painel em http://localhost:3002 (dono@demo.tagtech / demo-tagtech-123) e site em
http://localhost:3001/c/clinica-aurora.

## Garantias do banco

- Cada clínica só enxerga os próprios dados (RLS em toda tabela com `tenant_id`).
- O mesmo profissional, ou a mesma sala, nunca tem duas consultas ativas ao mesmo tempo
  (restrição de exclusão no Postgres).
- Paciente e consulta não se apagam pela API; cada abertura de ficha fica registrada.
