import { useEffect, useMemo, useState } from 'react';
import { PLAN_STATUS_LABELS, planTotals, splitInstallments, whatsappLink } from '@tagtech/domain';
import {
  api,
  linkOrcamento,
  type Charge,
  type Plan,
  type PlanInput,
  type PlanItem,
  type PlanStatus,
} from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, dinheiro, hoje } from '../formato';
import { Receber } from '../financeiro/receber';
import {
  Botao,
  Campo,
  Entrada,
  EntradaDinheiro,
  Gaveta,
  Icone,
  Seletor,
  Texto,
  Vazio,
} from '../ui';

const ESTILO: Record<PlanStatus, string> = {
  draft: 'bg-trilho text-nevoa',
  sent: 'bg-azul-fundo text-azul',
  approved: 'bg-ok-fundo text-ok',
  declined: 'bg-alerta-fundo text-alerta',
  cancelled: 'bg-trilho text-bruma line-through',
};

const vazio = (): PlanInput => ({
  title: '',
  professionalId: null,
  discountCents: 0,
  cashDiscountPct: 0,
  maxInstallments: 1,
  notes: '',
  validUntil: null,
  items: [],
});

/** Aba "Orçamentos" do paciente. */
export function Orcamentos({ patientId, telefone }: { patientId: string; telefone: string }) {
  const { avisar, vinculo } = usePainel();
  const [lista, setLista] = useState<Plan[] | null>(null);
  const [aberto, setAberto] = useState<Plan | 'novo' | null>(null);

  const carregar = () =>
    api
      .plans(patientId)
      .then(setLista)
      .catch((e) => avisar(mensagem(e), 'erro'));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const abrir = async (p: Plan) => {
    try {
      setAberto(await api.plan(p.id));
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  };

  if (!lista) return <p className="text-nevoa">Carregando…</p>;

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-nevoa">
          Monte o plano de tratamento, mande o link e o paciente aprova escolhendo as parcelas.
        </p>
        <Botao variante="principal" onClick={() => setAberto('novo')}>
          <Icone nome="mais" className="h-4 w-4" /> Novo orçamento
        </Botao>
      </div>

      {lista.length ? (
        <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
          {lista.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => abrir(p)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-porcelana"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.title}</span>
                  <span className="text-sm text-nevoa">
                    {p.items.length} {p.items.length === 1 ? 'item' : 'itens'}
                    {p.professionalName ? ` · ${p.professionalName}` : ''} ·{' '}
                    {dataCurta(p.createdAt.slice(0, 10))}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{dinheiro(p.total)}</span>
                  {p.status === 'approved' && p.chosenInstallments ? (
                    <span className="text-xs text-nevoa">
                      {p.chosenInstallments === 1 ? 'à vista' : `em ${p.chosenInstallments}x`}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO[p.status]}`}
                >
                  {PLAN_STATUS_LABELS[p.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Vazio
          titulo="Nenhum orçamento ainda"
          texto="Orçamento aprovado vira parcelas no financeiro, com cobrança no Pix."
        />
      )}

      <PlanoGaveta
        plano={aberto}
        patientId={patientId}
        telefone={telefone}
        podeCancelar={vinculo.role === 'owner' || vinculo.role === 'manager'}
        podeAprovar={vinculo.role !== 'professional'}
        aoFechar={() => setAberto(null)}
        aoMudar={(p) => {
          setAberto(p);
          void carregar();
        }}
      />
    </>
  );
}

function PlanoGaveta({
  plano,
  patientId,
  telefone,
  podeCancelar,
  podeAprovar,
  aoFechar,
  aoMudar,
}: {
  plano: Plan | 'novo' | null;
  patientId: string;
  telefone: string;
  podeCancelar: boolean;
  podeAprovar: boolean;
  aoFechar: () => void;
  aoMudar: (p: Plan) => void;
}) {
  const { avisar, services, professionals } = usePainel();
  const [f, setF] = useState<PlanInput>(vazio());
  const [salvando, setSalvando] = useState(false);
  const [parcelas, setParcelas] = useState(1);
  const [receber, setReceber] = useState<Charge | null>(null);

  const editavel = plano === 'novo' || (plano !== null && ['draft', 'sent'].includes(plano.status));

  useEffect(() => {
    if (plano === 'novo') setF(vazio());
    else if (plano) {
      setF({
        title: plano.title,
        professionalId: plano.professionalId,
        discountCents: plano.discountCents,
        cashDiscountPct: plano.cashDiscountPct,
        maxInstallments: plano.maxInstallments,
        notes: plano.notes,
        validUntil: plano.validUntil,
        items: plano.items.map(({ id: _i, appointmentId: _a, ...i }) => i),
      });
      setParcelas(plano.maxInstallments);
    }
  }, [plano]);

  const contas = useMemo(
    () => planTotals(f.items, f.discountCents, f.cashDiscountPct),
    [f.items, f.discountCents, f.cashDiscountPct],
  );
  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const setItem = (i: number, patch: Partial<PlanItem>) =>
    set(
      'items',
      f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    );

  async function salvar(): Promise<Plan | null> {
    if (!f.title.trim()) {
      avisar('Dê um nome ao orçamento', 'erro');
      return null;
    }
    setSalvando(true);
    try {
      const p =
        plano === 'novo'
          ? await api.createPlan(patientId, f)
          : await api.updatePlan((plano as Plan).id, f);
      aoMudar(p);
      return p;
    } catch (e) {
      avisar(mensagem(e), 'erro');
      return null;
    } finally {
      setSalvando(false);
    }
  }

  async function enviar() {
    const p = await salvar();
    if (!p) return;
    try {
      const r = await api.sendPlan(p.id);
      const link = linkOrcamento(r.token);
      void navigator.clipboard?.writeText(link).catch(() => undefined);
      const texto = `Olá! Segue o seu orçamento "${p.title}". Você pode ver os detalhes e aprovar por aqui: ${link}`;
      if (r.patientPhone) window.open(whatsappLink(r.patientPhone, texto), '_blank', 'noopener');
      avisar(r.patientPhone ? 'Link copiado e WhatsApp aberto' : 'Link copiado');
      aoMudar(await api.plan(p.id));
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  async function acao(fn: () => Promise<Plan>, ok: string) {
    try {
      const p = await fn();
      avisar(ok);
      aoMudar(await api.plan(p.id));
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const p = plano !== 'novo' ? plano : null;
  const valorParcela = splitInstallments(
    parcelas === 1 ? contas.cashTotal : contas.total,
    parcelas,
  )[0];

  return (
    <>
      <Gaveta
        aberta={plano !== null}
        aoFechar={aoFechar}
        titulo={plano === 'novo' ? 'Novo orçamento' : (p?.title ?? '')}
        subtitulo={
          p ? (
            <>
              {PLAN_STATUS_LABELS[p.status]}
              {p.sentAt ? ` · enviado ${dataCurta(p.sentAt.slice(0, 10))}` : ''}
              {p.decidedAt ? ` · decidido ${dataCurta(p.decidedAt.slice(0, 10))}` : ''}
            </>
          ) : undefined
        }
        rodape={
          editavel ? (
            <>
              <Botao disabled={salvando} onClick={() => void salvar()}>
                Salvar
              </Botao>
              <Botao
                variante="principal"
                className="flex-1"
                disabled={salvando || !f.items.length}
                onClick={enviar}
              >
                <Icone nome="whatsapp" className="h-4 w-4" />
                {p?.status === 'sent' ? 'Reenviar link' : 'Enviar ao paciente'}
              </Botao>
            </>
          ) : p?.status === 'approved' && podeCancelar ? (
            <Botao
              variante="perigo"
              onClick={() => acao(() => api.cancelPlan(p.id), 'Orçamento cancelado')}
            >
              Cancelar orçamento
            </Botao>
          ) : null
        }
      >
        {editavel ? (
          <div className="space-y-6">
            <Campo rotulo="Nome do orçamento">
              <Entrada
                value={f.title}
                maxLength={120}
                placeholder="Ex.: Reabilitação superior"
                onChange={(e) => set('title', e.target.value)}
              />
            </Campo>
            <Campo rotulo="Profissional responsável">
              <Seletor
                value={f.professionalId ?? ''}
                onChange={(e) => set('professionalId', e.target.value || null)}
              >
                <option value="">Sem profissional definido</option>
                {professionals
                  .filter((x) => x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </Seletor>
            </Campo>

            <section>
              <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">Procedimentos</h3>
              <ul className="space-y-3">
                {f.items.map((it, i) => (
                  <li key={i} className="rounded-2xl bg-porcelana p-3.5 ring-1 ring-linha">
                    <div className="flex gap-2">
                      <Entrada
                        aria-label="Descrição"
                        value={it.description}
                        maxLength={160}
                        onChange={(e) => setItem(i, { description: e.target.value })}
                      />
                      <button
                        type="button"
                        aria-label="Tirar item"
                        onClick={() =>
                          set(
                            'items',
                            f.items.filter((_, j) => j !== i),
                          )
                        }
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-nevoa hover:bg-tinta/5 hover:text-alerta"
                      >
                        <Icone nome="x" className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-[5rem_4.5rem_1fr] gap-2">
                      <Entrada
                        aria-label="Dente"
                        placeholder="Dente"
                        inputMode="numeric"
                        value={it.tooth ?? ''}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2));
                          setItem(i, { tooth: n || null });
                        }}
                      />
                      <Entrada
                        aria-label="Quantidade"
                        type="number"
                        min={1}
                        max={99}
                        value={it.quantity}
                        onChange={(e) =>
                          setItem(i, {
                            quantity: Math.max(1, Math.min(99, Number(e.target.value) || 1)),
                          })
                        }
                      />
                      <EntradaDinheiro
                        aria-label="Valor unitário"
                        valor={it.unitPriceCents}
                        aoMudar={(c) => setItem(i, { unitPriceCents: c ?? 0 })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Seletor
                  aria-label="Incluir serviço"
                  value=""
                  onChange={(e) => {
                    const s = services.find((x) => x.id === e.target.value);
                    if (s)
                      set('items', [
                        ...f.items,
                        {
                          serviceId: s.id,
                          description: s.name,
                          quantity: 1,
                          unitPriceCents: s.priceCents ?? 0,
                          tooth: null,
                        },
                      ]);
                  }}
                >
                  <option value="">Incluir serviço da clínica…</option>
                  {services
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.priceCents !== null ? `· ${dinheiro(s.priceCents)}` : ''}
                      </option>
                    ))}
                </Seletor>
                <Botao
                  onClick={() =>
                    set('items', [
                      ...f.items,
                      { description: '', quantity: 1, unitPriceCents: 0, tooth: null },
                    ])
                  }
                >
                  <Icone nome="mais" className="h-4 w-4" /> Item livre
                </Botao>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-4">
              <Campo rotulo="Desconto">
                <EntradaDinheiro
                  valor={f.discountCents}
                  aoMudar={(c) => set('discountCents', c ?? 0)}
                />
              </Campo>
              <Campo rotulo="Desconto à vista (%)">
                <Entrada
                  type="number"
                  min={0}
                  max={50}
                  value={f.cashDiscountPct}
                  onChange={(e) =>
                    set('cashDiscountPct', Math.max(0, Math.min(50, Number(e.target.value) || 0)))
                  }
                />
              </Campo>
              <Campo rotulo="Parcelas no máximo">
                <Seletor
                  value={f.maxInstallments}
                  onChange={(e) => set('maxInstallments', Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'Só à vista' : `Até ${n}x`}
                    </option>
                  ))}
                </Seletor>
              </Campo>
              <Campo rotulo="Vale até">
                <Entrada
                  type="date"
                  min={hoje()}
                  value={f.validUntil ?? ''}
                  onChange={(e) => set('validUntil', e.target.value || null)}
                />
              </Campo>
            </section>

            <Campo rotulo="Observações para o paciente">
              <Texto
                value={f.notes}
                maxLength={2000}
                placeholder="Ex.: inclui retorno de 30 dias."
                onChange={(e) => set('notes', e.target.value)}
              />
            </Campo>

            <Totais
              subtotal={contas.subtotal}
              total={contas.total}
              cash={contas.cashTotal}
              pct={f.cashDiscountPct}
              max={f.maxInstallments}
            />

            {p && podeAprovar ? (
              <section className="rounded-2xl bg-porcelana p-4 ring-1 ring-linha">
                <h3 className="font-semibold">Paciente aprovou aqui na clínica?</h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Seletor
                    aria-label="Parcelas"
                    value={parcelas}
                    onChange={(e) => setParcelas(Number(e.target.value))}
                    className="w-auto"
                  >
                    {Array.from({ length: f.maxInstallments }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? `À vista · ${dinheiro(contas.cashTotal)}` : `${n}x`}
                      </option>
                    ))}
                  </Seletor>
                  {parcelas > 1 && valorParcela !== undefined ? (
                    <span className="text-sm text-nevoa">de {dinheiro(valorParcela)}</span>
                  ) : null}
                  <Botao
                    variante="destaque"
                    tamanho="pequeno"
                    onClick={() =>
                      acao(async () => {
                        await api.updatePlan(p.id, f);
                        return api.approvePlan(p.id, parcelas);
                      }, 'Orçamento aprovado. Parcelas no financeiro.')
                    }
                  >
                    Aprovar
                  </Botao>
                  <Botao
                    variante="discreto"
                    tamanho="pequeno"
                    onClick={() =>
                      acao(() => api.declinePlan(p.id), 'Orçamento marcado como recusado')
                    }
                  >
                    Recusou
                  </Botao>
                </div>
              </section>
            ) : null}
          </div>
        ) : p ? (
          <div className="space-y-6">
            <ul className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
              {p.items.map((it) => (
                <li key={it.id} className="flex gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    {it.description}
                    {it.tooth ? <span className="text-nevoa"> · dente {it.tooth}</span> : null}
                    {it.quantity > 1 ? <span className="text-nevoa"> · {it.quantity}x</span> : null}
                  </span>
                  <span className="tabular-nums">{dinheiro(it.quantity * it.unitPriceCents)}</span>
                </li>
              ))}
            </ul>
            <Totais
              subtotal={p.subtotal}
              total={p.total}
              cash={p.cashTotal}
              pct={p.cashDiscountPct}
              max={p.maxInstallments}
            />
            {p.charges?.length ? (
              <section>
                <h3 className="mb-3 text-[0.82rem] font-semibold text-nevoa">Parcelas</h3>
                <ul className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
                  {p.charges.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-12 text-sm font-semibold text-nevoa tabular-nums">
                        {c.installment}/{c.installments}
                      </span>
                      <span className="flex-1 text-sm">vence {dataCurta(c.dueDate)}</span>
                      <span className="font-semibold tabular-nums">{dinheiro(c.amountCents)}</span>
                      {c.status === 'open' && podeAprovar ? (
                        <Botao tamanho="pequeno" onClick={() => setReceber(c)}>
                          Receber
                        </Botao>
                      ) : (
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            c.status === 'paid' ? 'bg-ok-fundo text-ok' : 'bg-trilho text-bruma'
                          }`}
                        >
                          {c.status === 'paid'
                            ? 'Pago'
                            : c.status === 'open'
                              ? 'Em aberto'
                              : 'Cancelada'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </Gaveta>
      <Receber
        cobranca={receber}
        aoFechar={() => setReceber(null)}
        aoReceber={() => {
          setReceber(null);
          if (p) void api.plan(p.id).then(aoMudar);
        }}
      />
    </>
  );
}

function Totais({
  subtotal,
  total,
  cash,
  pct,
  max,
}: {
  subtotal: number;
  total: number;
  cash: number;
  pct: number;
  max: number;
}) {
  return (
    <dl className="rounded-2xl bg-petroleo p-5 text-white">
      {subtotal !== total ? (
        <div className="flex justify-between text-sm text-white/70">
          <dt>Subtotal</dt>
          <dd className="tabular-nums line-through">{dinheiro(subtotal)}</dd>
        </div>
      ) : null}
      <div className="mt-1 flex items-baseline justify-between">
        <dt className="font-semibold">Total</dt>
        <dd className="font-display text-3xl tabular-nums">{dinheiro(total)}</dd>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/15 pt-3 text-sm text-white/80">
        {pct > 0 ? (
          <span>
            À vista <strong className="text-ambar">{dinheiro(cash)}</strong> ({pct}% off)
          </span>
        ) : null}
        {max > 1 ? (
          <span>
            ou {max}x de {dinheiro(splitInstallments(total, max)[0] ?? 0)}
          </span>
        ) : null}
      </div>
    </dl>
  );
}
