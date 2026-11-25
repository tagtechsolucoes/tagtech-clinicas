import { useEffect, useState } from 'react';
import { api, type CommissionSetting, type Overview, type Payout } from './api';
import { mensagem, usePainel } from './contexto';
import { dataCurta, dinheiro, hoje } from './formato';
import { Botao, Cabecalho, Campo, Entrada, EntradaDinheiro, Gaveta, Icone, Seletor } from './ui';

const somarMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const nomeMes = (mes: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${mes}-15T12:00:00Z`),
  );
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** Relatórios de gestão e repasse dos profissionais. */
export function RelatoriosTela() {
  const { avisar, vinculo } = usePainel();
  const [mes, setMes] = useState(hoje().slice(0, 7));
  const [ov, setOv] = useState<Overview | null>(null);
  const [rep, setRep] = useState<Payout[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [regras, setRegras] = useState<CommissionSetting | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    setOv(null);
    setRep(null);
    Promise.all([api.overview(mes), api.payouts(mes)])
      .then(([o, r]) => {
        setOv(o);
        setRep(r);
      })
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [mes, versao, avisar]);

  const maxFat = Math.max(1, ...(ov?.professionals.map((p) => p.revenueCents) ?? [1]));

  return (
    <>
      <Cabecalho
        titulo="Relatórios"
        descricao="Falta, ocupação, faturamento e repasse por profissional."
        acoes={
          <div className="flex items-center gap-1 rounded-xl bg-folha p-1 ring-1 ring-linha">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => setMes(somarMes(mes, -1))}
              className="grid h-9 w-9 place-items-center rounded-lg hover:bg-trilho"
            >
              <Icone nome="esquerda" className="h-4 w-4" />
            </button>
            <span className="inline-block min-w-40 text-center font-semibold first-letter:uppercase">
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
        }
      />

      {!ov || !rep ? (
        <div className="h-72 animate-pulse rounded-3xl bg-folha ring-1 ring-linha" />
      ) : (
        <>
          <dl className="grid grid-cols-2 overflow-hidden rounded-3xl bg-folha ring-1 ring-linha lg:grid-cols-4">
            {[
              ['Atendimentos feitos', String(ov.totals.done)],
              ['Taxa de falta', pct(ov.totals.noShowRate)],
              ['Faturado em consultas', dinheiro(ov.totals.revenueCents)],
              [
                'Orçamentos aprovados',
                ov.plans.sent ? `${ov.plans.approved} de ${ov.plans.sent}` : '—',
              ],
            ].map(([r, v], i) => (
              <div key={r} className={`px-6 py-5 ${i ? 'border-l border-linha' : ''}`}>
                <dt className="text-sm text-nevoa">{r}</dt>
                <dd className="mt-1 font-display text-3xl tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {ov.plans.sent ? (
            <p className="mt-3 text-sm text-nevoa">
              Orçamentos enviados no mês: {ov.plans.approved}{' '}
              {ov.plans.approved === 1 ? 'aprovado' : 'aprovados'} (
              {dinheiro(ov.plans.approvedCents)}), {ov.plans.declined} recusados e {ov.plans.open}{' '}
              sem resposta.
            </p>
          ) : null}

          <section className="mt-10">
            <h2 className="font-display text-2xl">Por profissional</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl bg-folha ring-1 ring-linha">
              <table className="w-full min-w-[720px] text-left">
                <thead className="text-sm text-nevoa">
                  <tr className="border-b border-linha">
                    <th className="px-5 py-3 font-semibold">Profissional</th>
                    <th className="px-3 py-3 text-right font-semibold">Consultas</th>
                    <th className="px-3 py-3 text-right font-semibold">Faltas</th>
                    <th className="px-3 py-3 font-semibold">Ocupação da agenda</th>
                    <th className="px-5 py-3 text-right font-semibold">Faturado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {ov.professionals.map((p) => (
                    <tr key={p.professionalId}>
                      <td className="px-5 py-3.5 font-medium">{p.name}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{p.appointments}</td>
                      <td
                        className={`px-3 py-3.5 text-right tabular-nums ${p.noShowRate !== null && p.noShowRate > 0.15 ? 'font-semibold text-alerta' : ''}`}
                      >
                        {pct(p.noShowRate)}
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="flex items-center gap-2.5">
                          <span className="h-2 w-28 overflow-hidden rounded-full bg-trilho">
                            <span
                              className="block h-full rounded-full bg-petroleo"
                              style={{ width: `${(p.occupancy ?? 0) * 100}%` }}
                            />
                          </span>
                          <span className="text-sm tabular-nums">{pct(p.occupancy)}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="flex items-center justify-end gap-3">
                          <span className="hidden h-2 w-24 overflow-hidden rounded-full bg-trilho sm:block">
                            <span
                              className="ml-auto block h-full rounded-full bg-ambar"
                              style={{ width: `${(p.revenueCents / maxFat) * 100}%` }}
                            />
                          </span>
                          <span className="font-semibold tabular-nums">
                            {dinheiro(p.revenueCents)}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!ov.professionals.length ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-nevoa">
                        Sem consultas neste mês.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-bruma">
              Ocupação: horas marcadas sobre as horas de trabalho do mês, já tirando os bloqueios.
            </p>
          </section>

          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">Repasse</h2>
                <p className="text-sm text-nevoa">
                  Sobre os atendimentos feitos no mês. Sessão de pacote vale o preço do pacote
                  dividido pelas sessões.
                </p>
              </div>
              <p className="font-display text-2xl tabular-nums">
                {dinheiro(rep.reduce((s, r) => s + r.payoutCents, 0))}
              </p>
            </div>
            <ul className="mt-4 divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
              {rep.map((r) => (
                <li key={r.professionalId}>
                  <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <button
                      type="button"
                      aria-expanded={aberto === r.professionalId}
                      onClick={() =>
                        setAberto(aberto === r.professionalId ? null : r.professionalId)
                      }
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <Icone
                        nome={aberto === r.professionalId ? 'baixo' : 'direita'}
                        className="h-4 w-4 text-nevoa"
                      />
                      <span>
                        <span className="block font-semibold">{r.name}</span>
                        <span className="text-sm text-nevoa">
                          {r.appointments} {r.appointments === 1 ? 'atendimento' : 'atendimentos'} ·{' '}
                          {dinheiro(r.producedCents)} produzidos · padrão {r.commissionPct}%
                        </span>
                      </span>
                    </button>
                    <span className="font-semibold tabular-nums">{dinheiro(r.payoutCents)}</span>
                    {vinculo.role === 'owner' ? (
                      <Botao
                        tamanho="pequeno"
                        onClick={async () => {
                          const todas = await api.commissions();
                          setRegras(
                            todas.find((c) => c.professionalId === r.professionalId) ?? null,
                          );
                        }}
                      >
                        Regras
                      </Botao>
                    ) : null}
                  </div>
                  {aberto === r.professionalId ? (
                    <table className="mx-5 mb-4 w-[calc(100%-2.5rem)] text-sm">
                      <tbody className="divide-y divide-linha">
                        {r.lines.map((l) => (
                          <tr key={l.appointmentId}>
                            <td className="py-2 text-nevoa tabular-nums">{dataCurta(l.date)}</td>
                            <td className="py-2">
                              {l.serviceName}
                              {l.insurance ? <span className="text-nevoa"> · convênio</span> : null}
                            </td>
                            <td className="py-2 text-right tabular-nums text-nevoa">
                              {dinheiro(l.baseCents)}
                            </td>
                            <td className="py-2 text-right font-semibold tabular-nums">
                              {dinheiro(l.commissionCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </li>
              ))}
              {!rep.length ? (
                <li className="px-5 py-6 text-center text-nevoa">
                  Nenhum profissional com repasse. Defina as regras em cada profissional.
                </li>
              ) : null}
            </ul>
            {vinculo.role === 'owner' && !rep.length ? (
              <Botao
                className="mt-3"
                onClick={async () => {
                  const todas = await api.commissions();
                  setRegras(todas[0] ?? null);
                }}
              >
                Definir repasse
              </Botao>
            ) : null}
          </section>
        </>
      )}
      <Regras
        atual={regras}
        aoFechar={() => setRegras(null)}
        aoSalvar={() => {
          setRegras(null);
          setVersao((v) => v + 1);
        }}
      />
    </>
  );
}

function Regras({
  atual,
  aoFechar,
  aoSalvar,
}: {
  atual: CommissionSetting | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { avisar, services, professionals } = usePainel();
  const [proId, setProId] = useState('');
  const [padrao, setPadrao] = useState('0');
  const [lista, setLista] = useState<
    Array<{ serviceId: string; tipo: 'pct' | 'fixo'; pct: string; fixo: number | null }>
  >([]);

  useEffect(() => {
    if (!atual) return;
    setProId(atual.professionalId);
    setPadrao(String(atual.commissionPct).replace('.', ','));
    setLista(
      atual.rules.map((r) => ({
        serviceId: r.serviceId,
        tipo: r.fixedCents !== null ? 'fixo' : 'pct',
        pct: String(r.pct ?? '').replace('.', ','),
        fixo: r.fixedCents,
      })),
    );
  }, [atual]);

  async function trocar(id: string) {
    const todas = await api.commissions();
    const c = todas.find((x) => x.professionalId === id);
    if (!c) return;
    setProId(id);
    setPadrao(String(c.commissionPct).replace('.', ','));
    setLista(
      c.rules.map((r) => ({
        serviceId: r.serviceId,
        tipo: r.fixedCents !== null ? 'fixo' : 'pct',
        pct: String(r.pct ?? '').replace('.', ','),
        fixo: r.fixedCents,
      })),
    );
  }

  async function salvar() {
    const num = (v: string) => Number(v.replace(',', '.')) || 0;
    try {
      await api.saveCommission(proId, {
        commissionPct: num(padrao),
        rules: lista
          .filter((r) => r.serviceId)
          .map((r) =>
            r.tipo === 'fixo'
              ? { serviceId: r.serviceId, fixedCents: r.fixo ?? 0 }
              : { serviceId: r.serviceId, pct: num(r.pct) },
          ),
      });
      avisar('Regras de repasse salvas');
      aoSalvar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <Gaveta
      aberta={atual !== null}
      aoFechar={aoFechar}
      titulo="Regras de repasse"
      subtitulo="Porcentagem padrão do profissional, com exceções por serviço."
      rodape={
        <Botao variante="principal" className="flex-1" onClick={salvar}>
          Salvar regras
        </Botao>
      }
    >
      <div className="space-y-5">
        <Campo rotulo="Profissional">
          <Seletor value={proId} onChange={(e) => void trocar(e.target.value)}>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Seletor>
        </Campo>
        <Campo rotulo="Repasse padrão (%)">
          <Entrada inputMode="decimal" value={padrao} onChange={(e) => setPadrao(e.target.value)} />
        </Campo>
        <div>
          <h3 className="mb-2 text-[0.82rem] font-semibold text-nevoa">Exceções por serviço</h3>
          <ul className="space-y-2">
            {lista.map((r, i) => (
              <li key={i} className="grid grid-cols-[1fr_7rem_8rem_auto] items-center gap-2">
                <Seletor
                  value={r.serviceId}
                  onChange={(e) =>
                    setLista(
                      lista.map((x, j) => (j === i ? { ...x, serviceId: e.target.value } : x)),
                    )
                  }
                >
                  <option value="">Serviço…</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Seletor>
                <Seletor
                  value={r.tipo}
                  onChange={(e) =>
                    setLista(
                      lista.map((x, j) =>
                        j === i ? { ...x, tipo: e.target.value as 'pct' | 'fixo' } : x,
                      ),
                    )
                  }
                >
                  <option value="pct">%</option>
                  <option value="fixo">Valor fixo</option>
                </Seletor>
                {r.tipo === 'pct' ? (
                  <Entrada
                    inputMode="decimal"
                    placeholder="%"
                    value={r.pct}
                    onChange={(e) =>
                      setLista(lista.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))
                    }
                  />
                ) : (
                  <EntradaDinheiro
                    valor={r.fixo}
                    aoMudar={(c) =>
                      setLista(lista.map((x, j) => (j === i ? { ...x, fixo: c } : x)))
                    }
                  />
                )}
                <button
                  type="button"
                  aria-label="Tirar exceção"
                  onClick={() => setLista(lista.filter((_, j) => j !== i))}
                  className="grid h-11 w-11 place-items-center rounded-xl text-nevoa hover:text-alerta"
                >
                  <Icone nome="x" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <Botao
            className="mt-2"
            onClick={() =>
              setLista([...lista, { serviceId: '', tipo: 'pct', pct: '', fixo: null }])
            }
          >
            <Icone nome="mais" className="h-4 w-4" /> Exceção
          </Botao>
        </div>
      </div>
    </Gaveta>
  );
}
