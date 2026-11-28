# Versões do TagClin

Cada versão é `MAJOR.MINOR.PATCH`:

- **PATCH** (1.0.**1**): correção, sem nada novo para o cliente.
- **MINOR** (1.**1**.0): função nova ou melhoria visível, sem quebrar nada.
- **MAJOR** (**2**.0.0): mudança grande, que exige ação no servidor, muda os planos ou quebra algo.

Como subir: escreva o que mudou em "Próxima versão" e rode `pnpm versao patch|minor|major` no
PR. Depois do merge, o CI cria a tag `vX.Y.Z` e a release no GitHub. A versão no ar aparece no
rodapé do painel e em `/api/health`.

## Próxima versão

## 1.1.2 · 2026-11-27

- Menu lateral no notebook (1366×768): cabe inteiro, até "Plano", sem cortar nem rolar.
- Ícone do WhatsApp novo (o logo de verdade) no painel e no site da clínica.
- Clínica Aurora (demonstração) com dois meses de histórico: consultas, poucas faltas,
  recebimentos, despesas do mês e 70 pacientes. O painel abre com ocupação e resultado reais.

## 1.1.1 · 2026-11-26

- Agenda no celular: a barra de cima cabe na tela (o botão Agendar não fica mais cortado).
- Pacientes: quem está na clínica hoje aparece como "Na clínica", com a consulta do dia, em vez
  de "Sem consulta". "Vieram pelo site" conta quem já marcou pelo site, como no Resultado.
- Plano: o plano Clínica aparece "Sob consulta"; "Pago até" mostra o ano quando é outro, e
  assinatura sem fim mostra "Sem vencimento" em vez de milhares de dias.
- Menu lateral em telas baixas (notebook): itens mais compactos e o resumo do dia some, para o
  menu caber; um esmaecido no fim mostra que dá para rolar.

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
