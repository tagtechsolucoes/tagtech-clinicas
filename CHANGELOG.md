# Versões do TagClin

Cada versão é `MAJOR.MINOR.PATCH`:

- **PATCH** (1.0.**1**): correção, sem nada novo para o cliente.
- **MINOR** (1.**1**.0): função nova ou melhoria visível, sem quebrar nada.
- **MAJOR** (**2**.0.0): mudança grande, que exige ação no servidor, muda os planos ou quebra algo.

Como subir: escreva o que mudou em "Próxima versão" e rode `pnpm versao patch|minor|major` no
PR. Depois do merge, o CI cria a tag `vX.Y.Z` e a release no GitHub. A versão no ar aparece no
rodapé do painel e em `/api/health`.

## Próxima versão

## 1.1.0 · 2026-11-26

- Ícone novo: uma folha de agenda com a cruz da saúde em âmbar, sobre petróleo, com fundo liso.

## 1.0.0 · 2026-11-26

Primeira versão numerada, com tudo que já estava no ar:

- Agenda (dia, semana e mês), recepção, pacientes com prontuário, odontograma, fotos,
  documentos, orçamentos, pacotes e lista de espera.
- Site de agendamento da clínica, com confirmação e remarcação por link.
- Financeiro, estoque, convênios com guias e XML TISS, relatórios e resultado do mês.
- WhatsApp por QR code ou API oficial: aviso, lembrete com confirmação respondendo 1 ou 2,
  lembrete do dia com o endereço, lista de espera, retorno, reativação, avaliação e central de
  Conversas.
- Backup diário criptografado com banco, fotos, WhatsApp conectado e configuração, e troca de
  servidor em dois comandos (`deploy/migrar.sh`, guia em `deploy/MIGRAR.md`).
- Planos Essencial R$ 115, Profissional R$ 240 e Clínica sob consulta; ícones novos; app
  instalável.
