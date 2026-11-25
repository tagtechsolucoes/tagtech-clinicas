import { useEffect, useMemo, useState } from 'react';
import { STATUS_LABELS, formatBRL } from '@tagtech/domain';
import { api, type Appointment, type FinanceSummary, type Overview } from './api';
import { pedirNovoAgendamento } from './atalhos';
import { mensagem, usePainel } from './contexto';
import { diaLongo, hoje, hora, inicioDoDia } from './formato';
import { Botao, Icone, STATUS_ESTILO } from './ui';

const mesDe = (dia: string) => dia.slice(0, 7);
const mesAnterior = (mes: string) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const nomeMes = (mes: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${mes}-15T12:00:00Z`),
  );
const compacto = (cents: number) =>
  Math.abs(cents) >= 1_000_00
    ? `${(cents / 100_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
    : String(Math.round(cents / 100));
/** Teto do eixo que divide em quartos redondos: 1, 2, 4 ou 8 vezes uma potência de 10. */
function tetoRedondo(v: number) {
  const pot = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 2, 4, 8, 10]) if (f * pot >= v) return f * pot;
  return 10 * pot;
}

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Tela de entrada de quem gerencia: o mês em números e o dia em uma lista. */
export function InicioTela() {
  const { me, avisar } = usePainel();
  const dia = hoje();
  const mes = mesDe(dia);
  const [dados, setDados] = useState<{
    resumo: FinanceSummary;
    anterior: FinanceSummary;
    visao: Overview;
    hoje: Appointment[];
    pedidos: number;
  } | null>(null);

  useEffect(() => {
    let vivo = true;
    const fim = new Date(new Date(inicioDoDia(dia)).getTime() + 86_400_000).toISOString();
    const daqui30 = new Date(Date.now() + 30 * 86_400_000).toISOString();
    Promise.all([
      api.summary(mes),
      api.summary(mesAnterior(mes)),
      api.overview(mes),
      api.agenda(inicioDoDia(dia), fim),
      api.agenda(new Date().toISOString(), daqui30),
    ]).then(
      ([resumo, anterior, visao, agendaHoje, proximos]) => {
        if (!vivo) return;
        setDados({
          resumo,
          anterior,
          visao,
          hoje: agendaHoje.appointments
            .filter((a) => a.status !== 'cancelled')
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
          pedidos: proximos.appointments.filter(
            (a) => a.source === 'online' && a.status === 'scheduled',
          ).length,
        });
      },
      (e) => avisar(mensagem(e), 'erro'),
    );
    return () => {
      vivo = false;
    };
  }, [dia, mes, avisar]);

  const primeiroNome = me.name.split(' ')[0];

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2rem] leading-none">
            {saudacao()}, {primeiroNome}
          </h1>
          <p className="mt-2.5 text-nevoa first-letter:uppercase">
            {diaLongo(dia)} · resumo de {nomeMes(mes)}
          </p>
        </div>
        <Botao variante="principal" onClick={pedirNovoAgendamento}>
          <Icone nome="mais" className="h-4 w-4" /> Novo agendamento
        </Botao>
      </div>

      {!dados ? (
        <Esqueleto />
      ) : (
        <>
          {dados.pedidos ? (
            <a
              href="#agenda"
              className="mb-5 flex items-center gap-3 rounded-2xl bg-ambar-fundo px-4 py-3 text-ambar-tinta ring-1 ring-ambar/30 transition hover:ring-ambar/60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ambar/20">
                <Icone nome="globo" className="h-[1.1rem] w-[1.1rem]" />
              </span>
              <span className="flex-1">
                <b>
                  {dados.pedidos}{' '}
                  {dados.pedidos === 1 ? 'pedido chegou pelo site' : 'pedidos chegaram pelo site'}
                </b>{' '}
                e {dados.pedidos === 1 ? 'espera' : 'esperam'} confirmação. O horário já está
                reservado.
              </span>
              <span className="hidden rounded-full bg-ambar-tinta px-3.5 py-1.5 text-sm font-semibold text-white sm:block">
                Ver na agenda
              </span>
            </a>
          ) : null}

          <Numeros resumo={dados.resumo} anterior={dados.anterior} visao={dados.visao} />

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <Grafico resumo={dados.resumo} hoje={dia} />
            <AgendaDeHoje itens={dados.hoje} />
          </div>
        </>
      )}
    </>
  );
}

function Numeros({
  resumo,
  anterior,
  visao,
}: {
  resumo: FinanceSummary;
  anterior: FinanceSummary;
  visao: Overview;
}) {
  const variacao =
    anterior.receivedCents > 0
      ? Math.round(((resumo.receivedCents - anterior.receivedCents) / anterior.receivedCents) * 100)
      : null;
  const margem =
    resumo.receivedCents > 0 ? Math.round((resumo.resultCents / resumo.receivedCents) * 100) : null;
  const t = visao.totals;
  const ticket = t.done ? Math.round(t.revenueCents / t.done) : null;
  const ocupacoes = visao.professionals
    .map((p) => p.occupancy)
    .filter((x): x is number => x !== null);
  const ocupacao = ocupacoes.length
    ? Math.round((ocupacoes.reduce((s, x) => s + x, 0) / ocupacoes.length) * 100)
    : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="relative overflow-hidden rounded-3xl bg-petroleo-escuro p-5 text-white">
        <div
          className="absolute -top-16 -right-16 h-44 w-44 rounded-full border border-white/10"
          aria-hidden
        />
        <Rotulo icone="dinheiro" claro>
          Recebido no mês
        </Rotulo>
        <p className="mt-4 text-[1.9rem] leading-none font-bold tracking-tight tabular-nums">
          {formatBRL(resumo.receivedCents)}
        </p>
        <p className="mt-3 flex items-center gap-2 text-sm text-white/65">
          {variacao !== null ? <Variacao valor={variacao} claro /> : null}
          {variacao !== null ? 'em relação ao mês passado' : 'primeiro mês com recebimentos'}
        </p>
      </div>
      <Cartao icone="grafico" rotulo="Resultado">
        <Valor>{formatBRL(resumo.resultCents)}</Valor>
        <Nota>
          {margem !== null ? `margem de ${margem}%` : 'sem recebimentos ainda'} ·{' '}
          {formatBRL(resumo.paidCents)} em despesas
        </Nota>
      </Cartao>
      <Cartao icone="pessoas" rotulo="Atendimentos">
        <Valor>
          {t.done}
          <span className="ml-1.5 text-base font-semibold text-bruma">de {t.appointments}</span>
        </Valor>
        <Nota>{ticket ? `ticket médio de ${formatBRL(ticket)}` : 'nenhum finalizado ainda'}</Nota>
      </Cartao>
      <Cartao icone="agenda" rotulo="Ocupação da agenda">
        <Valor>{ocupacao !== null ? `${ocupacao}%` : '—'}</Valor>
        <Nota>
          {t.noShowRate !== null
            ? `${Math.round(t.noShowRate * 100)}% de faltas (${t.noShows})`
            : 'sem faltas registradas'}
        </Nota>
      </Cartao>
    </div>
  );
}

function Rotulo({ icone, claro, children }: { icone: string; claro?: boolean; children: string }) {
  return (
    <p
      className={`flex items-center gap-2.5 text-sm font-semibold ${claro ? 'text-white/80' : 'text-nevoa'}`}
    >
      <span
        className={`grid h-8 w-8 place-items-center rounded-xl ${claro ? 'bg-white/10' : 'bg-agua text-petroleo'}`}
      >
        <Icone nome={icone} className="h-4 w-4" />
      </span>
      {children}
    </p>
  );
}

function Cartao({
  icone,
  rotulo,
  children,
}: {
  icone: string;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-folha p-5 ring-1 ring-linha">
      <Rotulo icone={icone}>{rotulo}</Rotulo>
      {children}
    </div>
  );
}
const Valor = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-4 text-[1.75rem] leading-none font-bold tracking-tight tabular-nums">
    {children}
  </p>
);
const Nota = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-3 text-sm text-nevoa">{children}</p>
);

function Variacao({ valor, claro }: { valor: number; claro?: boolean }) {
  const sobe = valor >= 0;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
        claro
          ? sobe
            ? 'bg-ok/25 text-[#9be3bb]'
            : 'bg-alerta/25 text-[#ffb3b8]'
          : sobe
            ? 'bg-ok-fundo text-ok'
            : 'bg-alerta-fundo text-alerta'
      }`}
    >
      {sobe ? '↗' : '↘'} {Math.abs(valor)}%
    </span>
  );
}

/** Receitas e despesas acumuladas no mês, até hoje. */
function Grafico({ resumo, hoje: dia }: { resumo: FinanceSummary; hoje: string }) {
  const pontos = useMemo(() => {
    const ate = resumo.daily.filter((d) => d.date <= dia);
    let r = 0;
    let p = 0;
    return ate.map((d) => {
      r += d.receivedCents;
      p += d.paidCents;
      return { date: d.date, r, p };
    });
  }, [resumo, dia]);
  const W = 640;
  const H = 220;
  const total = resumo.daily.length;
  const max = Math.max(1, ...pontos.map((x) => Math.max(x.r, x.p)));
  const teto = tetoRedondo(Math.max(max * 1.08, 100_00));
  const x = (i: number) => (total > 1 ? (i / (total - 1)) * W : 0);
  const y = (v: number) => H - (v / teto) * H;
  const linha = (k: 'r' | 'p') =>
    pontos.map((pt, i) => `${i ? 'L' : 'M'}${x(i)},${y(pt[k])}`).join('');
  const area = pontos.length ? `${linha('r')}L${x(pontos.length - 1)},${H}L0,${H}Z` : '';
  const ultimo = pontos.at(-1);
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(teto * f));

  return (
    <section className="min-w-0 rounded-3xl bg-folha p-5 ring-1 ring-linha sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg">Receitas e despesas</h2>
          <p className="text-sm text-nevoa">
            Acumulado do mês, pelo dia em que o dinheiro entrou ou saiu.
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
      <div className="mt-6 flex gap-3">
        <div className="flex h-[220px] flex-col-reverse justify-between text-right text-[0.7rem] text-bruma tabular-nums">
          {marcas.map((m) => (
            <span key={m} className="-my-1.5">
              {compacto(m)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-[220px] w-full overflow-visible"
          >
            <defs>
              <linearGradient id="g-receita" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--color-petroleo)" stopOpacity="0.18" />
                <stop offset="1" stopColor="var(--color-petroleo)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {marcas.map((m) => (
              <line
                key={m}
                x1="0"
                x2={W}
                y1={y(m)}
                y2={y(m)}
                stroke="var(--color-linha)"
                strokeDasharray="3 5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {pontos.length ? (
              <>
                <path d={area} fill="url(#g-receita)" />
                <path
                  d={linha('r')}
                  fill="none"
                  stroke="var(--color-petroleo)"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
                <path
                  d={linha('p')}
                  fill="none"
                  stroke="var(--color-ambar)"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
              </>
            ) : null}
          </svg>
          {ultimo ? (
            <>
              <Ponto x={x(pontos.length - 1) / W} y={y(ultimo.r) / H} cor="bg-petroleo" />
              <Ponto x={x(pontos.length - 1) / W} y={y(ultimo.p) / H} cor="bg-ambar" />
            </>
          ) : null}
          <div className="mt-2 flex justify-between text-[0.7rem] text-bruma">
            <span>01</span>
            <span>{String(Math.ceil(total / 2)).padStart(2, '0')}</span>
            <span>{total}</span>
          </div>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-linha pt-4">
        <Total rotulo="Recebido" valor={resumo.receivedCents} />
        <Total rotulo="A receber" valor={resumo.toReceiveCents} />
        <Total rotulo="Despesas pagas" valor={resumo.paidCents} />
      </dl>
    </section>
  );
}

const Ponto = ({ x, y, cor }: { x: number; y: number; cor: string }) => (
  <span
    className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-white ${cor}`}
    style={{ left: `${x * 100}%`, top: `${y * 220}px` }}
  />
);

const Total = ({ rotulo, valor }: { rotulo: string; valor: number }) => (
  <div>
    <dt className="text-xs text-nevoa">{rotulo}</dt>
    <dd className="mt-0.5 font-semibold tabular-nums">{formatBRL(valor)}</dd>
  </div>
);

function AgendaDeHoje({ itens }: { itens: Appointment[] }) {
  const agora = new Date().toISOString();
  const proxima = itens.find((a) => a.endsAt > agora && !['done', 'no_show'].includes(a.status));
  return (
    <section className="flex min-w-0 flex-col rounded-3xl bg-folha p-5 ring-1 ring-linha sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg">Agenda de hoje</h2>
          <p className="text-sm text-nevoa">
            {itens.length
              ? `${itens.length} ${itens.length === 1 ? 'consulta' : 'consultas'}`
              : 'Nenhuma consulta marcada'}
          </p>
        </div>
        <a href="#agenda" className="text-sm font-semibold text-petroleo hover:underline">
          Abrir agenda
        </a>
      </div>
      {itens.length ? (
        <ul className="rolagem-fina -mr-2 mt-4 max-h-[22rem] flex-1 space-y-1 overflow-y-auto pr-2">
          {itens.map((a) => (
            <li key={a.id}>
              <a
                href={`#paciente/${a.patient.id}`}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-porcelana ${a.id === proxima?.id ? 'bg-agua/60' : ''}`}
              >
                <span className="w-11 shrink-0 font-semibold tabular-nums">{hora(a.startsAt)}</span>
                <span
                  className="h-9 w-1 shrink-0 rounded-full"
                  style={{ background: a.professional.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.patient.name}</span>
                  <span className="block truncate text-sm text-nevoa">
                    {a.service.name} · {a.professional.name}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_ESTILO[a.status]}`}
                >
                  {STATUS_LABELS[a.status]}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 grid flex-1 place-items-center rounded-2xl border-2 border-dashed border-linha p-6 text-center text-sm text-nevoa">
          <div>
            O dia está livre.
            <button
              type="button"
              onClick={pedirNovoAgendamento}
              className="mt-2 block w-full font-semibold text-petroleo hover:underline"
            >
              Marcar uma consulta
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Esqueleto() {
  return (
    <div className="grid animate-pulse gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`h-36 rounded-3xl ${i ? 'bg-trilho' : 'bg-petroleo-escuro/80'}`} />
      ))}
      <div className="h-80 rounded-3xl bg-trilho sm:col-span-2" />
      <div className="h-80 rounded-3xl bg-trilho sm:col-span-2" />
    </div>
  );
}
