import { useCallback, useEffect, useState } from 'react';
import { addDays, PAY_METHOD_LABELS, PAY_METHODS, type PayMethod } from '@tagtech/domain';
import {
  api,
  type Cashbox,
  type Charge,
  type Expense,
  type FinanceSummary,
  type PixSettings,
} from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, diaLongo, dinheiro, hoje } from '../formato';
import {
  Botao,
  Cabecalho,
  Campo,
  Entrada,
  EntradaDinheiro,
  Gaveta,
  Icone,
  Seletor,
  Vazio,
} from '../ui';
import { Receber } from './receber';

type Aba = 'caixa' | 'receber' | 'pagar';

const fimDoMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const somarMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const nomeMes = (mes: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${mes}-15T12:00:00Z`),
  );

/** Financeiro: caixa do dia, contas a receber e a pagar, resultado do mês. */
export function FinanceiroTela() {
  const { gerencia, vinculo } = usePainel();
  const [aba, setAba] = useState<Aba>('caixa');
  const [mes, setMes] = useState(hoje().slice(0, 7));
  const [versao, setVersao] = useState(0);
  const mudou = useCallback(() => setVersao((v) => v + 1), []);

  const abas: Array<[Aba, string]> = [
    ['caixa', 'Caixa do dia'],
    ['receber', 'A receber'],
    ...(gerencia ? ([['pagar', 'A pagar']] as Array<[Aba, string]>) : []),
  ];

  return (
    <>
      <Cabecalho
        titulo="Financeiro"
        descricao="O que entrou, o que falta receber e o que a clínica tem a pagar."
        acoes={
          aba !== 'caixa' ? (
            <div className="flex items-center gap-1 rounded-xl bg-folha p-1 ring-1 ring-linha">
              <button
                type="button"
                aria-label="Mês anterior"
                onClick={() => setMes(somarMes(mes, -1))}
                className="grid h-9 w-9 place-items-center rounded-lg hover:bg-trilho"
              >
                <Icone nome="esquerda" className="h-4 w-4" />
              </button>
              <span className="inline-block min-w-36 text-center font-semibold first-letter:uppercase">
                {nomeMes(mes)}
              </span>
              <button
                type="button"
                aria-label="Próximo mês"
                onClick={() => setMes(somarMes(mes, 1))}
                className="grid h-9 w-9 place-items-center rounded-lg hover:bg-trilho"
              >
                <Icone nome="direita" className="h-4 w-4" />
              </button>
            </div>
          ) : null
        }
      />

      {gerencia ? <Resultado mes={mes} versao={versao} /> : null}

      <nav aria-label="Financeiro" className="mb-7 flex gap-1 border-b border-linha">
        {abas.map(([k, nome]) => (
          <button
            key={k}
            type="button"
            aria-current={aba === k ? 'page' : undefined}
            onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-4 pb-3 text-[0.95rem] font-semibold transition-colors ${
              aba === k
                ? 'border-petroleo text-petroleo'
                : 'border-transparent text-nevoa hover:text-tinta'
            }`}
          >
            {nome}
          </button>
        ))}
      </nav>

      {aba === 'caixa' ? <Caixa versao={versao} aoMudar={mudou} /> : null}
      {aba === 'receber' ? <AReceber mes={mes} versao={versao} aoMudar={mudou} /> : null}
      {aba === 'pagar' ? <APagar mes={mes} versao={versao} aoMudar={mudou} /> : null}

      {vinculo.role === 'owner' ? <PixConfig /> : null}
    </>
  );
}

// ------------------------------------------------------------ resultado do mês

function Resultado({ mes, versao }: { mes: string; versao: number }) {
  const { avisar } = usePainel();
  const [s, setS] = useState<FinanceSummary | null>(null);
  useEffect(() => {
    api
      .summary(mes)
      .then(setS)
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [mes, versao, avisar]);
  if (!s) return <div className="mb-8 h-40 animate-pulse rounded-3xl bg-folha ring-1 ring-linha" />;
  const positivo = s.resultCents >= 0;
  return (
    <section
      aria-label={`Resultado de ${nomeMes(mes)}`}
      className="mb-9 grid overflow-hidden rounded-3xl bg-folha ring-1 ring-linha lg:grid-cols-[1.1fr_2fr]"
    >
      <div className="bg-petroleo px-7 py-6 text-white">
        <p className="text-sm text-white/70">Resultado de {nomeMes(mes)}</p>
        <p
          className={`mt-2 font-display text-[2.8rem] leading-none tabular-nums ${positivo ? '' : 'text-[#ffb4a8]'}`}
        >
          {dinheiro(s.resultCents)}
        </p>
        <p className="mt-3 text-sm text-white/70">recebido menos o que já foi pago</p>
      </div>
      <dl className="grid grid-cols-2 divide-linha sm:grid-cols-4 sm:divide-x">
        <Numero rotulo="Recebido" valor={s.receivedCents} />
        <Numero rotulo="A receber no mês" valor={s.toReceiveCents} />
        <Numero rotulo="Pago" valor={s.paidCents} />
        <Numero rotulo="A pagar no mês" valor={s.toPayCents} />
        {s.overdueCents > 0 ? (
          <p className="col-span-full border-t border-linha px-6 py-3 text-sm font-semibold text-alerta">
            <Icone nome="alerta" className="mr-1.5 inline h-4 w-4 align-[-3px]" />
            {dinheiro(s.overdueCents)} em parcelas vencidas
          </p>
        ) : null}
      </dl>
    </section>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="px-6 py-5">
      <dt className="text-sm text-nevoa">{rotulo}</dt>
      <dd className="mt-1.5 text-xl font-semibold tabular-nums">{dinheiro(valor)}</dd>
    </div>
  );
}

// ------------------------------------------------------------ caixa do dia

function Caixa({ versao, aoMudar }: { versao: number; aoMudar: () => void }) {
  const { avisar } = usePainel();
  const [dia, setDia] = useState(hoje());
  const [c, setC] = useState<Cashbox | null>(null);
  const [abertas, setAbertas] = useState<Charge[]>([]);
  const [receber, setReceber] = useState<Charge | null>(null);
  const [nova, setNova] = useState(false);

  useEffect(() => {
    Promise.all([api.cashbox(dia), api.charges({ status: 'open', to: dia })])
      .then(([cx, ab]) => {
        setC(cx);
        setAbertas(ab.filter((x) => x.dueDate >= addDays(dia, -60)));
      })
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [dia, versao, avisar]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Botao
            tamanho="pequeno"
            variante="discreto"
            aria-label="Dia anterior"
            onClick={() => setDia(addDays(dia, -1))}
          >
            <Icone nome="esquerda" className="h-4 w-4" />
          </Botao>
          <h2 className="font-display text-xl first-letter:uppercase">{diaLongo(dia)}</h2>
          <Botao
            tamanho="pequeno"
            variante="discreto"
            aria-label="Próximo dia"
            onClick={() => setDia(addDays(dia, 1))}
          >
            <Icone nome="direita" className="h-4 w-4" />
          </Botao>
          {dia !== hoje() ? (
            <Botao tamanho="pequeno" variante="discreto" onClick={() => setDia(hoje())}>
              Hoje
            </Botao>
          ) : null}
          <Botao className="ml-auto" tamanho="pequeno" onClick={() => setNova(true)}>
            <Icone nome="mais" className="h-4 w-4" /> Lançar recebimento
          </Botao>
        </div>

        <h3 className="mt-6 mb-3 text-[0.82rem] font-semibold text-nevoa">
          Para receber até {dataCurta(dia)}
        </h3>
        {abertas.length ? (
          <Lista cobrancas={abertas} aoReceber={setReceber} />
        ) : (
          <p className="rounded-2xl bg-folha px-5 py-4 text-sm text-nevoa ring-1 ring-linha">
            Nada vencendo. Tudo em dia.
          </p>
        )}

        <h3 className="mt-8 mb-3 text-[0.82rem] font-semibold text-nevoa">Recebido no dia</h3>
        {c?.items.length ? (
          <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
            {c.items.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{x.patientName ?? x.description}</span>
                  <span className="text-sm text-nevoa">{x.patientName ? x.description : ''}</span>
                </span>
                <span className="rounded-md bg-trilho px-2 py-0.5 text-xs font-semibold text-nevoa">
                  {x.method ? PAY_METHOD_LABELS[x.method] : ''}
                </span>
                <span className="w-28 text-right font-semibold tabular-nums">
                  {dinheiro(x.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-folha px-5 py-4 text-sm text-nevoa ring-1 ring-linha">
            Nenhum recebimento neste dia.
          </p>
        )}
      </section>

      <aside className="h-fit rounded-3xl bg-folha p-6 ring-1 ring-linha lg:sticky lg:top-8">
        <p className="text-sm text-nevoa">Total do caixa</p>
        <p className="mt-1 font-display text-4xl tabular-nums">{dinheiro(c?.totalCents ?? 0)}</p>
        <ul className="mt-5 space-y-2.5 border-t border-linha pt-4">
          {PAY_METHODS.filter((m) => c?.byMethod[m]).map((m) => (
            <li key={m} className="flex justify-between text-[0.95rem]">
              <span className="text-nevoa">{PAY_METHOD_LABELS[m]}</span>
              <span className="font-semibold tabular-nums">{dinheiro(c!.byMethod[m]!)}</span>
            </li>
          ))}
          {!c?.totalCents ? <li className="text-sm text-bruma">Sem entradas ainda.</li> : null}
        </ul>
      </aside>

      <Receber
        cobranca={receber}
        aoFechar={() => setReceber(null)}
        aoReceber={() => {
          setReceber(null);
          aoMudar();
        }}
      />
      <NovaCobranca
        aberta={nova}
        aoFechar={() => setNova(false)}
        aoCriar={(c) => {
          setNova(false);
          aoMudar();
          setReceber(c);
        }}
      />
    </div>
  );
}

function Lista({ cobrancas, aoReceber }: { cobrancas: Charge[]; aoReceber: (c: Charge) => void }) {
  const hj = hoje();
  return (
    <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
      {cobrancas.map((x) => {
        const vencida = x.status === 'open' && x.dueDate < hj;
        return (
          <li key={x.id} className="flex items-center gap-3 px-5 py-3">
            <span
              className={`w-20 shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums ${vencida ? 'text-alerta' : 'text-nevoa'}`}
            >
              {dataCurta(x.dueDate)}
            </span>
            <span className="min-w-0 flex-1">
              {x.patientId ? (
                <a href={`#paciente/${x.patientId}`} className="block font-medium hover:underline">
                  {x.patientName}
                </a>
              ) : null}
              <span className={x.patientId ? 'text-sm text-nevoa' : 'font-medium'}>
                {x.description}
                {x.isDeposit ? ' · sinal' : ''}
              </span>
            </span>
            <span className="w-28 text-right font-semibold tabular-nums">
              {dinheiro(x.amountCents)}
            </span>
            {x.status === 'open' ? (
              <Botao tamanho="pequeno" onClick={() => aoReceber(x)}>
                Receber
              </Botao>
            ) : (
              <span
                className={`w-20 rounded-md px-2 py-0.5 text-center text-xs font-semibold ${
                  x.status === 'paid' ? 'bg-ok-fundo text-ok' : 'bg-trilho text-bruma'
                }`}
              >
                {x.status === 'paid' ? 'Pago' : 'Cancelada'}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NovaCobranca({
  aberta,
  aoFechar,
  aoCriar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoCriar: (c: Charge) => void;
}) {
  const { avisar } = usePainel();
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState<number | null>(null);
  const [dia, setDia] = useState(hoje());
  useEffect(() => {
    if (aberta) {
      setDescricao('');
      setValor(null);
      setDia(hoje());
    }
  }, [aberta]);
  async function criar() {
    if (!valor) return avisar('Informe o valor', 'erro');
    try {
      aoCriar(
        await api.createCharge({
          description: descricao.trim() || 'Atendimento',
          amountCents: valor,
          dueDate: dia,
        }),
      );
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }
  return (
    <Gaveta
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Lançar recebimento"
      subtitulo="Para uma cobrança avulsa. Parcelas de orçamento já aparecem sozinhas."
      rodape={
        <Botao variante="principal" className="flex-1" onClick={criar}>
          Continuar
        </Botao>
      }
    >
      <div className="space-y-5">
        <Campo rotulo="Descrição">
          <Entrada
            value={descricao}
            maxLength={160}
            placeholder="Ex.: Consulta avulsa"
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Campo>
        <Campo rotulo="Valor">
          <EntradaDinheiro valor={valor} aoMudar={setValor} />
        </Campo>
        <Campo rotulo="Vencimento">
          <Entrada type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        </Campo>
      </div>
    </Gaveta>
  );
}

// ------------------------------------------------------------ a receber

function AReceber({ mes, versao, aoMudar }: { mes: string; versao: number; aoMudar: () => void }) {
  const { avisar } = usePainel();
  const [lista, setLista] = useState<Charge[] | null>(null);
  const [filtro, setFiltro] = useState<'open' | 'paid' | ''>('open');
  const [receber, setReceber] = useState<Charge | null>(null);
  useEffect(() => {
    api
      .charges({ from: `${mes}-01`, to: fimDoMes(mes), ...(filtro ? { status: filtro } : {}) })
      .then(setLista)
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [mes, filtro, versao, avisar]);

  const total = (lista ?? []).reduce(
    (s, c) => s + (c.status === 'cancelled' ? 0 : c.amountCents),
    0,
  );
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Situação" className="flex rounded-xl bg-trilho p-1">
          {(
            [
              ['open', 'Em aberto'],
              ['paid', 'Pagas'],
              ['', 'Todas'],
            ] as const
          ).map(([v, nome]) => (
            <button
              key={v}
              type="button"
              aria-pressed={filtro === v}
              onClick={() => setFiltro(v)}
              className={`h-8 rounded-lg px-3 text-sm font-semibold ${filtro === v ? 'bg-folha shadow-sm' : 'text-nevoa'}`}
            >
              {nome}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-nevoa">
          {lista?.length ?? 0} cobranças ·{' '}
          <strong className="text-tinta tabular-nums">{dinheiro(total)}</strong>
        </span>
      </div>
      {lista === null ? (
        <p className="text-nevoa">Carregando…</p>
      ) : lista.length ? (
        <Lista cobrancas={lista} aoReceber={setReceber} />
      ) : (
        <Vazio
          titulo="Nada por aqui"
          texto="Parcelas de orçamentos aprovados e sinais do site aparecem nesta lista."
        />
      )}
      <Receber
        cobranca={receber}
        aoFechar={() => setReceber(null)}
        aoReceber={() => {
          setReceber(null);
          aoMudar();
        }}
      />
    </>
  );
}

// ------------------------------------------------------------ a pagar

function APagar({ mes, versao, aoMudar }: { mes: string; versao: number; aoMudar: () => void }) {
  const { avisar } = usePainel();
  const [lista, setLista] = useState<Expense[] | null>(null);
  const [nova, setNova] = useState(false);
  const [pagar, setPagar] = useState<Expense | null>(null);
  useEffect(() => {
    api
      .expenses(`${mes}-01`, fimDoMes(mes))
      .then(setLista)
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [mes, versao, avisar]);
  const hj = hoje();

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Botao variante="principal" onClick={() => setNova(true)}>
          <Icone nome="mais" className="h-4 w-4" /> Nova conta
        </Botao>
      </div>
      {lista === null ? (
        <p className="text-nevoa">Carregando…</p>
      ) : lista.length ? (
        <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
          {lista.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-5 py-3">
              <span
                className={`w-20 shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums ${x.status === 'open' && x.dueDate < hj ? 'text-alerta' : 'text-nevoa'}`}
              >
                {dataCurta(x.dueDate)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{x.description}</span>
                <span className="text-sm text-nevoa">
                  {[x.category, x.supplier].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="w-28 text-right font-semibold tabular-nums">
                {dinheiro(x.amountCents)}
              </span>
              {x.status === 'open' ? (
                <Botao tamanho="pequeno" onClick={() => setPagar(x)}>
                  Paguei
                </Botao>
              ) : (
                <span className="w-20 rounded-md bg-ok-fundo px-2 py-0.5 text-center text-xs font-semibold text-ok">
                  Paga
                </span>
              )}
              <button
                type="button"
                aria-label={`Apagar ${x.description}`}
                onClick={() =>
                  api
                    .deleteExpense(x.id)
                    .then(aoMudar)
                    .catch((e) => avisar(mensagem(e), 'erro'))
                }
                className="grid h-9 w-9 place-items-center rounded-lg text-bruma hover:bg-trilho hover:text-alerta"
              >
                <Icone nome="x" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Vazio
          titulo="Nenhuma conta neste mês"
          texto="Aluguel, material, laboratório: lance aqui e veja o resultado real do mês."
        />
      )}
      <NovaConta
        aberta={nova}
        aoFechar={() => setNova(false)}
        aoCriar={() => {
          setNova(false);
          aoMudar();
        }}
      />
      <Gaveta
        aberta={pagar !== null}
        aoFechar={() => setPagar(null)}
        titulo={pagar ? `Pagar ${dinheiro(pagar.amountCents)}` : ''}
        subtitulo={pagar?.description}
      >
        <div className="grid grid-cols-2 gap-2">
          {PAY_METHODS.map((m) => (
            <Botao
              key={m}
              tamanho="grande"
              onClick={() =>
                pagar &&
                api
                  .payExpense(pagar.id, m)
                  .then(() => {
                    setPagar(null);
                    aoMudar();
                  })
                  .catch((e) => avisar(mensagem(e), 'erro'))
              }
            >
              {PAY_METHOD_LABELS[m]}
            </Botao>
          ))}
        </div>
      </Gaveta>
    </>
  );
}

const CATEGORIAS = [
  'Material',
  'Laboratório',
  'Aluguel',
  'Equipe',
  'Marketing',
  'Impostos',
  'Outros',
];

function NovaConta({
  aberta,
  aoFechar,
  aoCriar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const { avisar } = usePainel();
  const [f, setF] = useState({
    description: '',
    category: 'Material',
    supplier: '',
    dueDate: hoje(),
  });
  const [valor, setValor] = useState<number | null>(null);
  const [paga, setPaga] = useState<PayMethod | ''>('');
  useEffect(() => {
    if (aberta) {
      setF({ description: '', category: 'Material', supplier: '', dueDate: hoje() });
      setValor(null);
      setPaga('');
    }
  }, [aberta]);
  async function criar() {
    if (!f.description.trim()) return avisar('Descreva a conta', 'erro');
    if (!valor) return avisar('Informe o valor', 'erro');
    try {
      await api.createExpense({
        ...f,
        amountCents: valor,
        ...(paga ? { paid: { method: paga } } : {}),
      });
      avisar('Conta lançada');
      aoCriar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }
  return (
    <Gaveta
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Nova conta a pagar"
      rodape={
        <Botao variante="principal" className="flex-1" onClick={criar}>
          Lançar conta
        </Botao>
      }
    >
      <div className="space-y-5">
        <Campo rotulo="Descrição">
          <Entrada
            value={f.description}
            maxLength={160}
            placeholder="Ex.: Resina composta A2"
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Campo>
        <div className="grid grid-cols-2 gap-4">
          <Campo rotulo="Valor">
            <EntradaDinheiro valor={valor} aoMudar={setValor} />
          </Campo>
          <Campo rotulo="Vencimento">
            <Entrada
              type="date"
              value={f.dueDate}
              onChange={(e) => setF({ ...f, dueDate: e.target.value })}
            />
          </Campo>
          <Campo rotulo="Categoria">
            <Seletor value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATEGORIAS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Seletor>
          </Campo>
          <Campo rotulo="Fornecedor">
            <Entrada
              value={f.supplier}
              maxLength={120}
              onChange={(e) => setF({ ...f, supplier: e.target.value })}
            />
          </Campo>
        </div>
        <Campo rotulo="Já foi paga?">
          <Seletor value={paga} onChange={(e) => setPaga(e.target.value as PayMethod | '')}>
            <option value="">Não, ainda vou pagar</option>
            {PAY_METHODS.map((m) => (
              <option key={m} value={m}>
                Sim, em {PAY_METHOD_LABELS[m].toLowerCase()}
              </option>
            ))}
          </Seletor>
        </Campo>
      </div>
    </Gaveta>
  );
}

// ------------------------------------------------------------ Pix da clínica

function PixConfig() {
  const { avisar } = usePainel();
  const [s, setS] = useState<PixSettings | null>(null);
  const [token, setToken] = useState('');
  const [sinal, setSinal] = useState<number | null>(0);
  useEffect(() => {
    api
      .pixSettings()
      .then((x) => {
        setS(x);
        setSinal(x.depositCents);
      })
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [avisar]);
  if (!s) return null;

  async function salvar() {
    try {
      const x = await api.savePix({
        ...(token.trim() ? { accessToken: token.trim() } : {}),
        depositCents: sinal ?? 0,
      });
      setS(x);
      setToken('');
      avisar('Pix salvo');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <section className="mt-14 rounded-3xl bg-folha p-6 ring-1 ring-linha lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">Pix da clínica</h2>
          <p className="mt-1 max-w-xl text-nevoa">
            O dinheiro cai direto na conta Mercado Pago da clínica. A TagTech não toca no valor.
          </p>
        </div>
        <span
          className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
            s.configured ? 'bg-ok-fundo text-ok' : 'bg-ambar-fundo text-ambar-tinta'
          }`}
        >
          {s.configured ? 'Mercado Pago conectado' : s.testMode ? 'Modo de teste' : 'Não conectado'}
        </span>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Campo
          rotulo="Access token de produção do Mercado Pago"
          ajuda="Em Mercado Pago › Seu negócio › Configurações › Credenciais. Fica guardado e nunca volta para a tela."
        >
          <Entrada
            type="password"
            autoComplete="off"
            value={token}
            placeholder={s.configured ? '•••••••• (já salvo)' : 'APP_USR-…'}
            onChange={(e) => setToken(e.target.value)}
          />
        </Campo>
        <Campo
          rotulo="Sinal para agendar pelo site"
          ajuda="Quem agenda pelo site paga no Pix para garantir o horário. Sem pagar em 30 min, o horário é liberado. Deixe 0 para não cobrar."
        >
          <EntradaDinheiro valor={sinal} aoMudar={setSinal} />
        </Campo>
      </div>
      <div className="mt-6 flex gap-3">
        <Botao variante="principal" onClick={salvar}>
          Salvar
        </Botao>
        {s.configured ? (
          <Botao
            variante="perigo"
            onClick={() =>
              api
                .removePix()
                .then((x) => {
                  setS(x);
                  avisar('Mercado Pago desconectado');
                })
                .catch((e) => avisar(mensagem(e), 'erro'))
            }
          >
            Desconectar
          </Botao>
        ) : null}
      </div>
    </section>
  );
}
