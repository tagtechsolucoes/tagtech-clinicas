import { useEffect, useState } from 'react';
import { api, type Results } from './api';
import { mensagem, usePainel } from './contexto';
import { dinheiro, hoje } from './formato';
import { Icone } from './ui';

const somarMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const nomeMes = (mes: string, comAno = true) =>
  new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    ...(comAno ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${mes}-15T12:00:00Z`));
const pct = (v: number | null) =>
  v === null ? '—' : `${Math.round(v * 1000) / 10}%`.replace('.', ',');

const PARTES = [
  {
    k: 'online',
    nome: 'Agendado pelo site',
    cor: '#eef3f4',
    ajuda: 'Consultas que o paciente marcou sozinho, a qualquer hora.',
  },
  {
    k: 'waitlist',
    nome: 'Horário vago preenchido',
    cor: '#e9a23b',
    ajuda: 'Desmarcações que a lista de espera ocupou.',
  },
  {
    k: 'plans',
    nome: 'Orçamento aprovado pelo link',
    cor: '#7fb3c1',
    ajuda: 'Tratamentos fechados pelo celular do paciente.',
  },
] as const;

/** Painel do resultado: quanto o sistema trouxe no mês. */
export function ResultadoTela() {
  const { avisar, clinic } = usePainel();
  const [mes, setMes] = useState(hoje().slice(0, 7));
  const [r, setR] = useState<Results | null>(null);
  useEffect(() => {
    setR(null);
    api
      .results(mes)
      .then(setR)
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [mes, avisar]);

  const variacao =
    r && r.previous.generatedCents > 0
      ? Math.round(
          ((r.generatedCents - r.previous.generatedCents) / r.previous.generatedCents) * 100,
        )
      : null;
  const futuro = mes > hoje().slice(0, 7);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[2.2rem] leading-none font-medium">Resultado</h1>
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
            disabled={futuro}
            onClick={() => setMes(somarMes(mes, 1))}
            className="grid h-9 w-9 place-items-center rounded-lg hover:bg-trilho disabled:opacity-30"
          >
            <Icone nome="direita" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!r ? (
        <div className="h-80 animate-pulse rounded-[2rem] bg-folha ring-1 ring-linha" />
      ) : (
        <>
          <section className="relative overflow-hidden rounded-[2rem] bg-petroleo px-7 py-9 text-white sm:px-10">
            <svg
              aria-hidden
              viewBox="0 0 400 400"
              className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 opacity-[0.09]"
            >
              {[60, 110, 160, 210].map((raio) => (
                <circle
                  key={raio}
                  cx="200"
                  cy="200"
                  r={raio}
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                />
              ))}
            </svg>
            <p className="relative text-white/75">
              Em {nomeMes(mes, false)}, a TagTech trouxe para a {clinic.name}
            </p>
            <p className="relative mt-2 font-display text-[3.6rem] leading-none tabular-nums sm:text-[4.6rem]">
              {dinheiro(r.generatedCents)}
            </p>
            {variacao !== null ? (
              <p className="relative mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-sm font-semibold">
                {variacao >= 0 ? '▲' : '▼'} {Math.abs(variacao)}% em relação a{' '}
                {nomeMes(somarMes(mes, -1), false)}
              </p>
            ) : null}

            <div className="relative mt-9">
              <div
                className="flex h-3 overflow-hidden rounded-full bg-white/10"
                role="img"
                aria-label="Composição do valor"
              >
                {PARTES.map((p) => {
                  const v = r.parts[p.k].valueCents;
                  return v > 0 ? (
                    <span
                      key={p.k}
                      style={{
                        width: `${(v / Math.max(1, r.generatedCents)) * 100}%`,
                        background: p.cor,
                      }}
                    />
                  ) : null;
                })}
              </div>
              <dl className="mt-6 grid gap-6 sm:grid-cols-3">
                {PARTES.map((p) => (
                  <div key={p.k}>
                    <dt className="flex items-center gap-2 text-sm text-white/75">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.cor }} />
                      {p.nome}
                    </dt>
                    <dd className="mt-1.5 text-2xl font-semibold tabular-nums">
                      {dinheiro(r.parts[p.k].valueCents)}
                    </dd>
                    <dd className="text-sm text-white/60">
                      {r.parts[p.k].count}{' '}
                      {p.k === 'plans'
                        ? `de ${r.parts.plans.sent} enviados`
                        : r.parts[p.k].count === 1
                          ? 'consulta'
                          : 'consultas'}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador
              rotulo="Taxa de falta"
              valor={pct(r.agenda.noShowRate)}
              detalhe={
                r.previous.noShowRate !== null
                  ? `${pct(r.previous.noShowRate)} no mês anterior`
                  : `${r.agenda.noShows} faltas no mês`
              }
              bom={
                r.agenda.noShowRate !== null && r.previous.noShowRate !== null
                  ? r.agenda.noShowRate <= r.previous.noShowRate
                  : null
              }
            />
            <Indicador
              rotulo="Confirmadas pelo paciente"
              valor={String(r.agenda.confirmedByPatient)}
              detalhe={`de ${r.agenda.total - r.agenda.cancelled} consultas no mês`}
              bom={null}
            />
            <Indicador
              rotulo="Avisos no WhatsApp"
              valor={String(r.whatsappSent)}
              detalhe="confirmações e lembretes enviados"
              bom={null}
            />
            <Indicador
              rotulo="Sinais pagos no Pix"
              valor={dinheiro(r.deposits.valueCents)}
              detalhe={`${r.deposits.count} ${r.deposits.count === 1 ? 'horário garantido' : 'horários garantidos'}`}
              bom={null}
            />
          </section>

          <details className="mt-8 rounded-2xl bg-folha px-5 py-4 text-sm text-nevoa ring-1 ring-linha">
            <summary className="cursor-pointer font-semibold text-tinta">
              Como este número é calculado
            </summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              {PARTES.map((p) => (
                <li key={p.k}>
                  <strong className="text-tinta">{p.nome}:</strong> {p.ajuda}{' '}
                  {p.k === 'plans'
                    ? 'Conta as parcelas não canceladas dos orçamentos enviados por link e aprovados no mês.'
                    : 'Conta o preço do serviço das consultas não canceladas.'}
                </li>
              ))}
              <li>
                Cada consulta entra uma vez só. Orçamento aprovado no balcão, sem link, não entra.
              </li>
            </ul>
          </details>
        </>
      )}
    </>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
  bom,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  bom: boolean | null;
}) {
  return (
    <div className="rounded-2xl bg-folha p-5 ring-1 ring-linha">
      <p className="text-sm text-nevoa">{rotulo}</p>
      <p className="mt-1.5 font-display text-3xl tabular-nums">{valor}</p>
      <p
        className={`mt-1 text-sm ${bom === true ? 'text-ok' : bom === false ? 'text-alerta' : 'text-nevoa'}`}
      >
        {detalhe}
      </p>
    </div>
  );
}
