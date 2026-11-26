import { useEffect, useState } from 'react';
import { PAY_METHOD_LABELS, type PayMethod } from '@tagtech/domain';
import { api, type FinanceSummary } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dinheiro } from '../formato';
import { Icone } from '../ui';

const somarMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const mesCurto = (mes: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${mes}-15T12:00:00Z`))
    .replace('.', '');
const mil = (cents: number) =>
  cents >= 1_000_00
    ? `${(cents / 100_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
    : String(Math.round(cents / 100));
function tetoRedondo(v: number) {
  const pot = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  for (const f of [1, 2, 4, 8, 10]) if (f * pot >= v) return f * pot;
  return 10 * pot;
}

const CORES_METODO: Record<string, string> = {
  pix: '#2a9d8f',
  credit: '#1d4e5f',
  debit: '#3563c9',
  cash: '#e9a23b',
  transfer: '#7b5ea7',
  other: '#8a9aa1',
};

/** Visão geral do mês: números, os últimos 6 meses e para onde foi o dinheiro. */
export function VisaoGeral({
  mes,
  setMes,
  versao,
}: {
  mes: string;
  setMes: (m: string) => void;
  versao: number;
}) {
  const { avisar } = usePainel();
  const [meses, setMeses] = useState<FinanceSummary[] | null>(null);

  useEffect(() => {
    let vivo = true;
    const lista = Array.from({ length: 6 }, (_, i) => somarMes(mes, i - 5));
    Promise.all(lista.map((m) => api.summary(m))).then(
      (r) => vivo && setMeses(r),
      (e) => avisar(mensagem(e), 'erro'),
    );
    return () => {
      vivo = false;
    };
  }, [mes, versao, avisar]);

  if (!meses)
    return (
      <div className="grid animate-pulse gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-3xl bg-trilho" />
        ))}
        <div className="h-80 rounded-3xl bg-trilho sm:col-span-2 xl:col-span-4" />
      </div>
    );

  const s = meses.at(-1)!;
  const despesas = s.paidCents + s.toPayCents;
  const saldo = s.receivedCents - s.paidCents;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cartao cor="bg-petroleo" rotulo="Receitas" valor={s.receivedCents}>
          recebido no mês
        </Cartao>
        <Cartao cor="bg-ambar" rotulo="Despesas" valor={despesas}>
          {dinheiro(s.paidCents)} pagos · {dinheiro(s.toPayCents)} a pagar
        </Cartao>
        <Cartao
          cor={saldo >= 0 ? 'bg-ok' : 'bg-alerta'}
          rotulo="Saldo do mês"
          valor={saldo}
          tom={saldo >= 0 ? 'text-ok' : 'text-alerta'}
        >
          recebido menos o que já foi pago
        </Cartao>
        <Cartao cor="bg-azul" rotulo="A receber" valor={s.toReceiveCents}>
          {s.overdueCents ? (
            <span className="font-semibold text-alerta">{dinheiro(s.overdueCents)} vencido</span>
          ) : (
            'parcelas do mês ainda abertas'
          )}
        </Cartao>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Barras meses={meses} atual={mes} aoEscolher={setMes} />
        <Distribuicao
          titulo="Recebido por forma de pagamento"
          vazio="Nenhum recebimento neste mês."
          itens={Object.entries(s.byMethod).map(([k, v]) => ({
            nome: PAY_METHOD_LABELS[k as PayMethod] ?? k,
            valor: v ?? 0,
            cor: CORES_METODO[k] ?? '#8a9aa1',
          }))}
        />
      </div>
      <Distribuicao
        titulo="Para onde foi o dinheiro"
        subtitulo="Despesas do mês por categoria, pagas e a pagar"
        vazio="Nenhuma despesa lançada neste mês."
        colunas
        itens={Object.entries(s.byCategory).map(([nome, valor]) => ({
          nome,
          valor,
          cor: 'var(--color-ambar)',
        }))}
      />
    </div>
  );
}

function Cartao({
  cor,
  rotulo,
  valor,
  tom,
  children,
}: {
  cor: string;
  rotulo: string;
  valor: number;
  tom?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-folha p-5 ring-1 ring-linha">
      <p className="flex items-center gap-2 text-sm font-semibold text-nevoa">
        <i className={`h-2.5 w-2.5 rounded-full ${cor}`} /> {rotulo}
      </p>
      <p
        className={`mt-3 text-[1.65rem] leading-none font-bold tracking-tight tabular-nums ${tom ?? ''}`}
      >
        {dinheiro(valor)}
      </p>
      <p className="mt-2.5 text-sm text-nevoa">{children}</p>
    </div>
  );
}

/** Receitas x despesas pagas, mês a mês. Clicar numa coluna abre aquele mês. */
function Barras({
  meses,
  atual,
  aoEscolher,
}: {
  meses: FinanceSummary[];
  atual: string;
  aoEscolher: (m: string) => void;
}) {
  const teto = tetoRedondo(
    Math.max(100_00, ...meses.map((m) => Math.max(m.receivedCents, m.paidCents))) * 1.05,
  );
  const marcas = [1, 0.75, 0.5, 0.25, 0];
  return (
    <section className="min-w-0 rounded-3xl bg-folha p-5 ring-1 ring-linha sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg">Últimos 6 meses</h2>
          <p className="text-sm text-nevoa">
            Receitas e despesas pagas. Clique num mês para abrir.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-petroleo" /> Receitas
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-ambar" /> Despesas
          </span>
        </div>
      </div>
      <div className="relative mt-6 h-56">
        <div className="absolute inset-0 flex flex-col justify-between">
          {marcas.map((f) => (
            <div key={f} className="flex items-center gap-3">
              <span className="w-12 text-right text-[0.7rem] text-bruma tabular-nums">
                {mil(teto * f)}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-linha" />
            </div>
          ))}
        </div>
        <div className="absolute inset-y-0 right-0 left-[3.75rem] flex items-end justify-around gap-2">
          {meses.map((m) => {
            const ativo = m.month === atual;
            return (
              <button
                key={m.month}
                type="button"
                onClick={() => aoEscolher(m.month)}
                aria-label={`${mesCurto(m.month)}: receitas ${dinheiro(m.receivedCents)}, despesas ${dinheiro(m.paidCents)}`}
                aria-pressed={ativo}
                className={`group relative flex h-full flex-1 items-end justify-center gap-1 rounded-xl px-1 pb-0 transition ${ativo ? 'bg-agua/70' : 'hover:bg-trilho/70'}`}
              >
                <span
                  className="w-full max-w-7 rounded-t-md bg-petroleo transition-[height]"
                  style={{ height: `${(m.receivedCents / teto) * 100}%` }}
                />
                <span
                  className="w-full max-w-7 rounded-t-md bg-ambar transition-[height]"
                  style={{ height: `${(m.paidCents / teto) * 100}%` }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-around gap-2 pl-[3.75rem]">
        {meses.map((m) => (
          <span
            key={m.month}
            className={`flex-1 text-center text-xs ${m.month === atual ? 'font-bold text-petroleo' : 'text-nevoa'}`}
          >
            {mesCurto(m.month)}
          </span>
        ))}
      </div>
    </section>
  );
}

function Distribuicao({
  titulo,
  subtitulo,
  vazio,
  itens,
  colunas,
}: {
  titulo: string;
  subtitulo?: string;
  vazio: string;
  itens: Array<{ nome: string; valor: number; cor: string }>;
  colunas?: boolean;
}) {
  const ordenados = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = ordenados.reduce((s, i) => s + i.valor, 0);
  const maior = ordenados[0]?.valor ?? 1;
  return (
    <section className="min-w-0 rounded-3xl bg-folha p-5 ring-1 ring-linha sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg">{titulo}</h2>
          {subtitulo ? <p className="text-sm text-nevoa">{subtitulo}</p> : null}
        </div>
        {total ? (
          <p className="shrink-0 font-semibold whitespace-nowrap tabular-nums">{dinheiro(total)}</p>
        ) : null}
      </div>
      {ordenados.length ? (
        <ul className={`mt-5 gap-x-10 gap-y-4 ${colunas ? 'grid md:grid-cols-2' : 'space-y-4'}`}>
          {ordenados.map((i) => (
            <li key={i.nome}>
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.cor }} />
                  <span className="truncate">{i.nome}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {dinheiro(i.valor)}
                  <span className="ml-2 text-xs text-bruma">
                    {Math.round((i.valor / total) * 100)}%
                  </span>
                </span>
              </p>
              <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-trilho">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(i.valor / maior) * 100}%`, background: i.cor }}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 flex items-center gap-2 rounded-2xl bg-porcelana px-4 py-4 text-sm text-nevoa">
          <Icone nome="grafico" className="h-4 w-4" /> {vazio}
        </p>
      )}
    </section>
  );
}
