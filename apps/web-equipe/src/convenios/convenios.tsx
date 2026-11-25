import { useCallback, useEffect, useState } from 'react';
import { api, type Batch, type Billing, type Insurer } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, dinheiro, hoje } from '../formato';
import {
  Botao,
  Cabecalho,
  Campo,
  Entrada,
  EntradaDinheiro,
  Gaveta,
  Icone,
  Interruptor,
  Vazio,
} from '../ui';

type Aba = 'faturamento' | 'convenios';
const somarMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const nomeMes = (mes: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${mes}-15T12:00:00Z`),
  );
const SITUACAO = {
  open: { texto: 'Aberto', cor: 'bg-trilho text-nevoa' },
  sent: { texto: 'Enviado', cor: 'bg-azul-fundo text-azul' },
  paid: { texto: 'Pago', cor: 'bg-ok-fundo text-ok' },
} as const;

/** Convênios: faturamento mensal com lote TISS e glosas, e a tabela de cada plano. */
export function ConveniosTela() {
  const { gerencia } = usePainel();
  const [aba, setAba] = useState<Aba>('faturamento');
  return (
    <>
      <Cabecalho
        titulo="Convênios"
        descricao="Feche o lote do mês, baixe o XML TISS para o portal do plano e confira o que foi pago e glosado."
      />
      <nav aria-label="Convênios" className="mb-7 flex gap-1 border-b border-linha">
        {(
          [
            ['faturamento', 'Faturamento'],
            ...(gerencia ? [['convenios', 'Planos e tabela']] : []),
          ] as Array<[Aba, string]>
        ).map(([k, nome]) => (
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
      {aba === 'faturamento' ? <Faturamento /> : <Planos />}
    </>
  );
}

// ------------------------------------------------------------ faturamento

function Faturamento() {
  const { avisar, gerencia } = usePainel();
  const [mes, setMes] = useState(somarMes(hoje().slice(0, 7), 0));
  const [dados, setDados] = useState<Billing | null>(null);
  const [rel, setRel] = useState<Awaited<ReturnType<typeof api.insuranceReport>>>([]);
  const [lote, setLote] = useState<Batch | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados(await api.billing(mes));
      if (gerencia) setRel(await api.insuranceReport());
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }, [mes, avisar, gerencia]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function abrir(id: string) {
    try {
      setLote(await api.batch(id));
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const aReceber = rel.reduce((s, r) => s + r.receivableCents, 0);
  const glosa = rel.reduce((s, r) => s + r.glosaCents, 0);
  const faturado = rel.reduce((s, r) => s + r.billedCents, 0);

  return (
    <div className="space-y-8">
      {gerencia && rel.length ? (
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-petroleo p-5 text-white">
            <dt className="text-sm text-white/70">A receber dos planos</dt>
            <dd className="mt-1 font-display text-3xl tabular-nums">{dinheiro(aReceber)}</dd>
          </div>
          <div className="rounded-2xl bg-folha p-5 ring-1 ring-linha">
            <dt className="text-sm text-nevoa">Faturado no total</dt>
            <dd className="mt-1 font-display text-3xl tabular-nums">{dinheiro(faturado)}</dd>
          </div>
          <div className="rounded-2xl bg-folha p-5 ring-1 ring-linha">
            <dt className="text-sm text-nevoa">Glosado</dt>
            <dd className={`mt-1 font-display text-3xl tabular-nums ${glosa ? 'text-alerta' : ''}`}>
              {dinheiro(glosa)}
              {faturado ? (
                <span className="ml-2 text-base text-nevoa">
                  {Math.round((glosa / faturado) * 100)}%
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Mês anterior"
          onClick={() => setMes(somarMes(mes, -1))}
          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-trilho"
        >
          <Icone nome="esquerda" className="h-4 w-4" />
        </button>
        <h2 className="inline-block font-display text-xl first-letter:uppercase">
          Competência {nomeMes(mes)}
        </h2>
        <button
          type="button"
          aria-label="Próximo mês"
          onClick={() => setMes(somarMes(mes, 1))}
          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-trilho"
        >
          <Icone nome="direita" className="h-4 w-4" />
        </button>
      </div>

      {dados?.pending.length ? (
        <section>
          <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">
            Atendimentos finalizados ainda sem lote
          </h3>
          <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
            {dados.pending.map((p) => (
              <li key={p.insurerId} className="flex items-center gap-4 px-5 py-4">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.insurerName}</span>
                  <span className="text-sm text-nevoa">
                    {p.count} {p.count === 1 ? 'atendimento' : 'atendimentos'}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{dinheiro(p.totalCents)}</span>
                <Botao
                  variante="principal"
                  tamanho="pequeno"
                  onClick={async () => {
                    try {
                      setLote(await api.createBatch(p.insurerId, mes));
                      await carregar();
                    } catch (e) {
                      avisar(mensagem(e), 'erro');
                    }
                  }}
                >
                  Fechar lote
                </Botao>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">Lotes</h3>
        {dados?.batches.length ? (
          <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
            {dados.batches.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => abrir(l.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-porcelana"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {l.insurerName} · lote {l.number}
                    </span>
                    <span className="text-sm text-nevoa">
                      {l.count} guias
                      {l.sentAt ? ` · enviado ${dataCurta(l.sentAt.slice(0, 10))}` : ''}
                      {l.glosaCents ? ` · ${dinheiro(l.glosaCents)} glosados` : ''}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block font-semibold">
                      {dinheiro(l.paidCents ?? l.billedCents)}
                    </span>
                    {l.paidCents !== null && l.paidCents !== l.billedCents ? (
                      <span className="text-xs text-bruma line-through">
                        {dinheiro(l.billedCents)}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${SITUACAO[l.status].cor}`}
                  >
                    {SITUACAO[l.status].texto}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Vazio
            titulo="Nenhum lote nesta competência"
            texto="Quando houver atendimentos pelo convênio finalizados no mês, feche o lote aqui."
          />
        )}
      </section>

      <LoteGaveta
        lote={lote}
        aoFechar={() => setLote(null)}
        aoMudar={async (l) => {
          setLote(l);
          await carregar();
        }}
      />
    </div>
  );
}

function LoteGaveta({
  lote,
  aoFechar,
  aoMudar,
}: {
  lote: Batch | null;
  aoFechar: () => void;
  aoMudar: (l: Batch) => Promise<void>;
}) {
  const { avisar, gerencia } = usePainel();
  const [baixa, setBaixa] = useState<Record<
    string,
    { pago: number | null; motivo: string }
  > | null>(null);
  useEffect(() => setBaixa(null), [lote?.id, lote?.status]);

  async function agir(fn: () => Promise<Batch>, ok: string) {
    try {
      await aoMudar(await fn());
      avisar(ok);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const iniciarBaixa = () =>
    lote &&
    setBaixa(
      Object.fromEntries(lote.claims.map((c) => [c.id, { pago: c.billedCents, motivo: '' }])),
    );

  return (
    <Gaveta
      aberta={lote !== null}
      aoFechar={aoFechar}
      titulo={lote ? `${lote.insurerName} · lote ${lote.number}` : ''}
      subtitulo={
        lote
          ? `Competência ${nomeMes(lote.competence)} · ${SITUACAO[lote.status].texto} · ${dinheiro(lote.billedCents)}`
          : undefined
      }
      rodape={
        lote ? (
          <>
            <a
              href={api.tissUrl(lote.id)}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-folha px-4 font-semibold ring-1 ring-linha hover:ring-tinta/35"
            >
              <Icone nome="upload" className="h-4 w-4 rotate-180" /> XML TISS
            </a>
            {lote.status === 'open' ? (
              <Botao
                variante="principal"
                className="flex-1"
                onClick={() =>
                  agir(() => api.sendBatch(lote.id), 'Lote enviado. Já está em contas a receber.')
                }
              >
                Marcar como enviado
              </Botao>
            ) : null}
            {lote.status === 'sent' && gerencia && !baixa ? (
              <Botao variante="principal" className="flex-1" onClick={iniciarBaixa}>
                Registrar pagamento
              </Botao>
            ) : null}
            {baixa && lote.status === 'sent' ? (
              <Botao
                variante="principal"
                className="flex-1"
                onClick={() =>
                  agir(
                    () =>
                      api.receiveBatch(
                        lote.id,
                        Object.entries(baixa).map(([claimId, v]) => ({
                          claimId,
                          paidCents: v.pago ?? 0,
                          glosaReason: v.motivo,
                        })),
                      ),
                    'Pagamento registrado',
                  )
                }
              >
                Confirmar {dinheiro(Object.values(baixa).reduce((s, v) => s + (v.pago ?? 0), 0))}
              </Botao>
            ) : null}
          </>
        ) : null
      }
    >
      {lote ? (
        <div className="space-y-4">
          {lote.status === 'open' ? (
            <p className="rounded-2xl bg-azul-fundo px-4 py-3 text-sm text-azul">
              Baixe o XML e envie no portal do {lote.insurerName}. Confira no validador do plano no
              primeiro envio.
            </p>
          ) : null}
          <ul className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
            {lote.claims.map((c) => {
              const glosado = c.paidCents !== null && c.paidCents < c.billedCents;
              const b = baixa?.[c.id];
              return (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.patientName}</span>
                      <span className="text-sm text-nevoa">
                        {dataCurta(c.date)} · {c.serviceName} · carteirinha {c.cardNumber}
                        {c.guideNumber ? ` · guia ${c.guideNumber}` : ''}
                      </span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block font-semibold">{dinheiro(c.billedCents)}</span>
                      {glosado ? (
                        <span className="text-xs font-semibold text-alerta">
                          pago {dinheiro(c.paidCents!)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {glosado ? (
                    <div className="mt-2 flex items-center gap-2 rounded-xl bg-alerta-fundo px-3 py-2 text-sm text-alerta">
                      <span className="flex-1">Glosa: {c.glosaReason}</span>
                      <Botao
                        tamanho="pequeno"
                        onClick={() =>
                          agir(() => api.rebill(c.id), 'Glosa reapresentada num lote novo')
                        }
                      >
                        Reapresentar
                      </Botao>
                    </div>
                  ) : null}
                  {b ? (
                    <div className="mt-2 grid grid-cols-[9rem_1fr] gap-2">
                      <EntradaDinheiro
                        aria-label="Valor pago"
                        valor={b.pago}
                        aoMudar={(v) => setBaixa({ ...baixa!, [c.id]: { ...b, pago: v } })}
                      />
                      {b.pago !== null && b.pago < c.billedCents ? (
                        <Entrada
                          placeholder="Motivo da glosa"
                          value={b.motivo}
                          onChange={(e) =>
                            setBaixa({ ...baixa!, [c.id]: { ...b, motivo: e.target.value } })
                          }
                        />
                      ) : (
                        <span className="self-center text-sm text-ok">Pago inteiro</span>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Gaveta>
  );
}

// ------------------------------------------------------------ planos e tabela

function Planos() {
  const { avisar, services, professionals } = usePainel();
  const [lista, setLista] = useState<Insurer[] | null>(null);
  const [aberto, setAberto] = useState<Insurer | 'novo' | null>(null);
  const [f, setF] = useState({
    name: '',
    ansCode: '',
    providerCode: '',
    paymentDays: '30',
    showOnSite: true,
    active: true,
  });
  const [tabela, setTabela] = useState<
    Record<
      string,
      { on: boolean; price: number | null; copay: number | null; tuss: string; guia: boolean }
    >
  >({});
  const [pros, setPros] = useState<string[]>([]);

  const carregar = useCallback(
    () =>
      api
        .insurers()
        .then(setLista)
        .catch((e) => avisar(mensagem(e), 'erro')),
    [avisar],
  );
  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    const i = aberto !== 'novo' ? aberto : null;
    setF({
      name: i?.name ?? '',
      ansCode: i?.ansCode ?? '',
      providerCode: i?.providerCode ?? '',
      paymentDays: String(i?.paymentDays ?? 30),
      showOnSite: i?.showOnSite ?? true,
      active: i?.active ?? true,
    });
    setTabela(
      Object.fromEntries(
        services.map((s) => {
          const p = i?.prices.find((x) => x.serviceId === s.id);
          return [
            s.id,
            {
              on: !!p,
              price: p?.priceCents ?? s.priceCents ?? 0,
              copay: p?.copayCents ?? 0,
              tuss: p?.tussCode ?? '',
              guia: p?.needsAuthorization ?? false,
            },
          ];
        }),
      ),
    );
    setPros(i?.professionalIds ?? []);
  }, [aberto, services]);

  async function salvar() {
    if (!f.name.trim()) return avisar('Informe o nome do convênio', 'erro');
    try {
      const corpo = { ...f, name: f.name.trim(), paymentDays: Number(f.paymentDays) || 0 };
      const i =
        aberto === 'novo'
          ? await api.createInsurer(corpo)
          : await api.updateInsurer((aberto as Insurer).id, corpo);
      await api.setInsurerPrices(
        i.id,
        Object.entries(tabela)
          .filter(([, v]) => v.on)
          .map(([serviceId, v]) => ({
            serviceId,
            priceCents: v.price ?? 0,
            copayCents: v.copay ?? 0,
            tussCode: v.tuss.replace(/\D/g, ''),
            needsAuthorization: v.guia,
          })),
      );
      await api.setInsurerProfessionals(i.id, pros);
      avisar('Convênio salvo');
      setAberto(null);
      await carregar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Botao variante="principal" onClick={() => setAberto('novo')}>
          <Icone nome="mais" className="h-4 w-4" /> Novo convênio
        </Botao>
      </div>
      {lista?.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {lista.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => setAberto(i)}
                className="h-full w-full rounded-2xl bg-folha p-5 text-left ring-1 ring-linha hover:ring-tinta/30"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-xl">{i.name}</span>
                  {!i.active ? (
                    <span className="rounded-md bg-trilho px-2 py-0.5 text-xs font-semibold text-nevoa">
                      Inativo
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-sm text-nevoa">
                  {[
                    i.ansCode ? `ANS ${i.ansCode}` : null,
                    `paga em ${i.paymentDays} dias`,
                    `${i.prices.length} procedimentos`,
                    i.showOnSite ? 'aparece no site' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : lista ? (
        <Vazio
          titulo="Nenhum convênio cadastrado"
          texto="Cadastre os planos aceitos com o valor que cada um paga por procedimento."
        />
      ) : null}

      <Gaveta
        aberta={aberto !== null}
        aoFechar={() => setAberto(null)}
        titulo={aberto === 'novo' ? 'Novo convênio' : (aberto?.name ?? '')}
        rodape={
          <Botao variante="principal" className="flex-1" onClick={salvar}>
            Salvar convênio
          </Botao>
        }
      >
        <div className="space-y-6">
          <Campo rotulo="Nome do plano">
            <Entrada
              value={f.name}
              maxLength={120}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Campo>
          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="Registro ANS">
              <Entrada
                inputMode="numeric"
                maxLength={6}
                value={f.ansCode}
                onChange={(e) => setF({ ...f, ansCode: e.target.value.replace(/\D/g, '') })}
              />
            </Campo>
            <Campo rotulo="Código na operadora">
              <Entrada
                value={f.providerCode}
                maxLength={20}
                onChange={(e) => setF({ ...f, providerCode: e.target.value })}
              />
            </Campo>
            <Campo rotulo="Paga em (dias)">
              <Entrada
                inputMode="numeric"
                value={f.paymentDays}
                onChange={(e) => setF({ ...f, paymentDays: e.target.value })}
              />
            </Campo>
          </div>
          <Interruptor
            ligado={f.showOnSite}
            aoMudar={(v) => setF({ ...f, showOnSite: v })}
            rotulo="Aparece no site"
            descricao="O paciente escolhe este plano ao agendar."
          />
          {aberto !== 'novo' ? (
            <Interruptor
              ligado={f.active}
              aoMudar={(v) => setF({ ...f, active: v })}
              rotulo="Ativo"
            />
          ) : null}

          <section>
            <h3 className="mb-1 text-[0.82rem] font-semibold text-nevoa">Tabela do plano</h3>
            <p className="mb-3 text-sm text-bruma">
              Marque o que o plano cobre, com o valor pago e a coparticipação.
            </p>
            <ul className="space-y-2">
              {services
                .filter((s) => s.active)
                .map((s) => {
                  const t = tabela[s.id];
                  if (!t) return null;
                  const set = (p: Partial<typeof t>) =>
                    setTabela({ ...tabela, [s.id]: { ...t, ...p } });
                  return (
                    <li
                      key={s.id}
                      className={`rounded-2xl p-3 ring-1 ${t.on ? 'bg-porcelana ring-petroleo/40' : 'ring-linha'}`}
                    >
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={t.on}
                          onChange={() => set({ on: !t.on })}
                          className="h-4 w-4 accent-petroleo"
                        />
                        <span className="flex-1 font-medium">{s.name}</span>
                        {s.priceCents !== null ? (
                          <span className="text-sm text-bruma">
                            particular {dinheiro(s.priceCents)}
                          </span>
                        ) : null}
                      </label>
                      {t.on ? (
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                          <EntradaDinheiro
                            aria-label="Valor pago pelo plano"
                            valor={t.price}
                            aoMudar={(v) => set({ price: v })}
                          />
                          <EntradaDinheiro
                            aria-label="Coparticipação"
                            placeholder="Copart."
                            valor={t.copay}
                            aoMudar={(v) => set({ copay: v })}
                          />
                          <Entrada
                            aria-label="Código TUSS"
                            placeholder="TUSS"
                            inputMode="numeric"
                            maxLength={8}
                            value={t.tuss}
                            onChange={(e) => set({ tuss: e.target.value })}
                          />
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={t.guia}
                              onChange={() => set({ guia: !t.guia })}
                              className="h-4 w-4 accent-petroleo"
                            />
                            Pede guia
                          </label>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </section>

          <section>
            <h3 className="mb-1 text-[0.82rem] font-semibold text-nevoa">Quem atende pelo plano</h3>
            <p className="mb-2 text-sm text-bruma">Sem ninguém marcado, todos atendem.</p>
            <div className="space-y-1">
              {professionals
                .filter((p) => p.active)
                .map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-porcelana"
                  >
                    <input
                      type="checkbox"
                      checked={pros.includes(p.id)}
                      onChange={() =>
                        setPros(
                          pros.includes(p.id) ? pros.filter((x) => x !== p.id) : [...pros, p.id],
                        )
                      }
                      className="h-4 w-4 accent-petroleo"
                    />
                    {p.name}
                  </label>
                ))}
            </div>
          </section>
        </div>
      </Gaveta>
    </>
  );
}
