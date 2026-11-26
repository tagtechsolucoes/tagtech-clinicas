import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatBRL, PLAN_INFO, PLANS, subscriptionState, type Plan } from '@tagtech/domain';
import { api, type PlatformPayment, type PlatformTenant } from './api';
import { mensagem, usePainel } from './contexto';
import { dataCurta, hoje } from './formato';
import {
  Botao,
  Cabecalho,
  Campo,
  Entrada,
  EntradaDinheiro,
  Gaveta,
  Icone,
  Seletor,
  Texto,
} from './ui';

const SITUACAO = {
  trial: { nome: 'Teste', estilo: 'bg-azul-fundo text-azul' },
  ok: { nome: 'Em dia', estilo: 'bg-ok-fundo text-ok' },
  due_soon: { nome: 'Vence logo', estilo: 'bg-ambar-fundo text-ambar-tinta' },
  overdue: { nome: 'Atrasada', estilo: 'bg-alerta-fundo text-alerta' },
  blocked: { nome: 'Bloqueada', estilo: 'bg-alerta text-white' },
} as const;

const estado = (t: PlatformTenant) =>
  subscriptionState(
    { plan: t.plan, status: t.status, trialEndsAt: t.trialEndsAt, paidUntil: t.paidUntil },
    hoje(),
  );

/** Equipe TagTech: todas as clínicas, plano, vencimento e pagamentos. */
export function TagTechTela() {
  const { avisar } = usePainel();
  const [lista, setLista] = useState<PlatformTenant[] | null>(null);
  const [aberta, setAberta] = useState<PlatformTenant | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'atencao'>('todas');

  const carregar = useCallback(
    () => api.platformTenants().then(setLista, (e) => avisar(mensagem(e), 'erro')),
    [avisar],
  );
  useEffect(() => void carregar(), [carregar]);

  const resumo = useMemo(() => {
    const l = lista ?? [];
    const ativas = l.filter((t) => ['ok', 'due_soon', 'overdue'].includes(estado(t).situation));
    return {
      mrr: ativas.reduce((s, t) => s + t.priceCents, 0),
      ativas: ativas.length,
      teste: l.filter((t) => estado(t).situation === 'trial').length,
      atencao: l.filter((t) => ['due_soon', 'overdue', 'blocked'].includes(estado(t).situation))
        .length,
    };
  }, [lista]);

  const visiveis = (lista ?? []).filter(
    (t) => filtro === 'todas' || ['due_soon', 'overdue', 'blocked'].includes(estado(t).situation),
  );

  return (
    <>
      <Cabecalho
        titulo="TagTech"
        descricao="Todas as clínicas do TagClin: plano, vencimento e pagamentos. Só a equipe TagTech vê esta tela."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Numero rotulo="Receita mensal" valor={formatBRL(resumo.mrr)} escuro />
        <Numero rotulo="Clínicas pagantes" valor={String(resumo.ativas)} />
        <Numero rotulo="Em teste" valor={String(resumo.teste)} />
        <Numero rotulo="Pedem atenção" valor={String(resumo.atencao)} alerta={resumo.atencao > 0} />
      </div>

      <div className="overflow-hidden rounded-3xl bg-folha ring-1 ring-linha">
        <div className="flex gap-1.5 border-b border-linha p-3">
          {(
            [
              ['todas', 'Todas'],
              ['atencao', 'Vencendo, atrasadas e bloqueadas'],
            ] as const
          ).map(([k, n]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filtro === k}
              onClick={() => setFiltro(k)}
              className={`h-9 rounded-full px-3.5 text-sm font-semibold ${filtro === k ? 'bg-petroleo text-white' : 'text-nevoa hover:bg-trilho'}`}
            >
              {n}
            </button>
          ))}
        </div>
        {!lista ? (
          <p className="p-6 text-sm text-bruma">Carregando…</p>
        ) : (
          <table className="w-full text-left">
            <thead className="border-b border-linha text-xs font-semibold text-nevoa">
              <tr>
                <th className="px-5 py-3">Clínica</th>
                <th className="px-5 py-3">Plano</th>
                <th className="hidden px-5 py-3 md:table-cell">Mensalidade</th>
                <th className="hidden px-5 py-3 md:table-cell">Vence</th>
                <th className="hidden px-5 py-3 lg:table-cell">Uso (30 dias)</th>
                <th className="px-5 py-3">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {visiveis.map((t) => {
                const e = estado(t);
                return (
                  <tr
                    key={t.tenantId}
                    onClick={() => setAberta(t)}
                    className="cursor-pointer hover:bg-porcelana"
                  >
                    <td className="px-5 py-3">
                      <span className="block font-semibold">{t.name}</span>
                      <span className="block text-sm text-nevoa">{t.ownerEmail ?? '—'}</span>
                    </td>
                    <td className="px-5 py-3">{PLAN_INFO[t.plan].name}</td>
                    <td className="hidden px-5 py-3 tabular-nums md:table-cell">
                      {t.priceCents ? formatBRL(t.priceCents) : '—'}
                    </td>
                    <td className="hidden px-5 py-3 tabular-nums md:table-cell">
                      {e.until ? dataCurta(e.until) : '—'}
                    </td>
                    <td className="hidden px-5 py-3 text-sm text-nevoa lg:table-cell">
                      {t.appointments30d} consultas · {t.professionals} prof. · {t.patients}{' '}
                      pacientes
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${SITUACAO[e.situation].estilo}`}
                      >
                        {SITUACAO[e.situation].nome}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Editar
        clinica={aberta}
        aoFechar={() => setAberta(null)}
        aoSalvar={() => {
          void carregar();
        }}
      />
    </>
  );
}

function Numero({
  rotulo,
  valor,
  escuro,
  alerta,
}: {
  rotulo: string;
  valor: string;
  escuro?: boolean;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl p-5 ring-1 ${escuro ? 'bg-petroleo-escuro text-white ring-transparent' : 'bg-folha ring-linha'}`}
    >
      <p className={`text-sm font-semibold ${escuro ? 'text-white/70' : 'text-nevoa'}`}>{rotulo}</p>
      <p
        className={`mt-2 text-[1.7rem] leading-none font-bold tabular-nums ${alerta ? 'text-alerta' : ''}`}
      >
        {valor}
      </p>
    </div>
  );
}

function Editar({
  clinica,
  aoFechar,
  aoSalvar,
}: {
  clinica: PlatformTenant | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { avisar } = usePainel();
  const [f, setF] = useState<PlatformTenant | null>(null);
  const [pagamentos, setPagamentos] = useState<PlatformPayment[]>([]);
  const [pg, setPg] = useState({
    valor: null as number | null,
    dia: hoje(),
    meses: '1',
    metodo: 'pix',
    nota: '',
  });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setF(clinica);
    if (clinica) {
      setPg((p) => ({ ...p, valor: clinica.priceCents || null, dia: hoje(), nota: '' }));
      api.platformPayments(clinica.tenantId).then(setPagamentos, () => setPagamentos([]));
    }
  }, [clinica]);

  async function salvar() {
    if (!f) return;
    setSalvando(true);
    try {
      await api.platformSet(f.tenantId, {
        plan: f.plan,
        status: f.status,
        priceCents: f.priceCents,
        trialEndsAt: f.trialEndsAt || null,
        paidUntil: f.paidUntil || null,
        notes: f.notes,
      });
      avisar('Assinatura salva');
      aoSalvar();
      aoFechar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function registrar() {
    if (!f || pg.valor === null) return;
    setSalvando(true);
    try {
      const r = await api.platformPay(f.tenantId, {
        amountCents: pg.valor,
        paidOn: pg.dia,
        months: Number(pg.meses),
        method: pg.metodo,
        note: pg.nota,
      });
      avisar(`Pagamento registrado · pago até ${dataCurta(r.paidUntil)}`);
      setF({
        ...f,
        status: f.status === 'cancelled' ? f.status : 'active',
        paidUntil: r.paidUntil,
      });
      setPagamentos(await api.platformPayments(f.tenantId));
      aoSalvar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      aberta={clinica !== null}
      aoFechar={aoFechar}
      titulo={f?.name ?? ''}
      subtitulo={
        f
          ? `${f.ownerEmail ?? 'sem dono'} · desde ${dataCurta(f.createdAt.slice(0, 10))}`
          : undefined
      }
      rodape={
        <Botao
          variante="principal"
          disabled={salvando}
          onClick={() => void salvar()}
          className="w-full"
        >
          Salvar assinatura
        </Botao>
      }
    >
      {f ? (
        <div className="space-y-6">
          <section className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Plano">
                <Seletor
                  value={f.plan}
                  onChange={(e) => setF({ ...f, plan: e.target.value as Plan })}
                >
                  {PLANS.map((p) => (
                    <option key={p} value={p}>
                      {PLAN_INFO[p].name}
                    </option>
                  ))}
                </Seletor>
              </Campo>
              <Campo rotulo="Situação">
                <Seletor
                  value={f.status}
                  onChange={(e) =>
                    setF({ ...f, status: e.target.value as PlatformTenant['status'] })
                  }
                >
                  <option value="trial">Teste</option>
                  <option value="active">Ativa</option>
                  <option value="suspended">Suspensa</option>
                  <option value="cancelled">Cancelada</option>
                </Seletor>
              </Campo>
              <Campo rotulo="Mensalidade">
                <EntradaDinheiro
                  valor={f.priceCents || null}
                  aoMudar={(v) => setF({ ...f, priceCents: v ?? 0 })}
                />
              </Campo>
              {f.status === 'trial' ? (
                <Campo rotulo="Teste até">
                  <Entrada
                    type="date"
                    value={f.trialEndsAt ?? ''}
                    onChange={(e) => setF({ ...f, trialEndsAt: e.target.value || null })}
                  />
                </Campo>
              ) : (
                <Campo rotulo="Pago até">
                  <Entrada
                    type="date"
                    value={f.paidUntil ?? ''}
                    onChange={(e) => setF({ ...f, paidUntil: e.target.value || null })}
                  />
                </Campo>
              )}
            </div>
            <Campo rotulo="Anotações (só a TagTech vê)">
              <Texto
                rows={2}
                maxLength={1000}
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
              />
            </Campo>
          </section>

          <section className="space-y-3 rounded-2xl bg-porcelana p-4 ring-1 ring-linha">
            <h3 className="font-semibold">Registrar pagamento</h3>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Valor">
                <EntradaDinheiro valor={pg.valor} aoMudar={(v) => setPg({ ...pg, valor: v })} />
              </Campo>
              <Campo rotulo="Pago em">
                <Entrada
                  type="date"
                  value={pg.dia}
                  onChange={(e) => setPg({ ...pg, dia: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Meses pagos">
                <Seletor value={pg.meses} onChange={(e) => setPg({ ...pg, meses: e.target.value })}>
                  {[1, 2, 3, 6, 12].map((m) => (
                    <option key={m} value={m}>
                      {m} {m === 1 ? 'mês' : 'meses'}
                    </option>
                  ))}
                </Seletor>
              </Campo>
              <Campo rotulo="Forma">
                <Seletor
                  value={pg.metodo}
                  onChange={(e) => setPg({ ...pg, metodo: e.target.value })}
                >
                  <option value="pix">Pix</option>
                  <option value="boleto">Boleto</option>
                  <option value="cartao">Cartão</option>
                  <option value="transferencia">Transferência</option>
                  <option value="outro">Outro</option>
                </Seletor>
              </Campo>
            </div>
            <Entrada
              placeholder="Observação (opcional)"
              maxLength={300}
              value={pg.nota}
              onChange={(e) => setPg({ ...pg, nota: e.target.value })}
            />
            <Botao disabled={salvando || pg.valor === null} onClick={() => void registrar()}>
              <Icone nome="dinheiro" className="h-4 w-4" /> Registrar e estender o vencimento
            </Botao>
          </section>

          {pagamentos.length ? (
            <section>
              <h3 className="mb-2 font-semibold">Pagamentos</h3>
              <ul className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
                {pagamentos.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span>
                      <span className="font-semibold tabular-nums">{dataCurta(p.paidOn)}</span>
                      <span className="text-nevoa">
                        {' '}
                        · {p.months} {p.months === 1 ? 'mês' : 'meses'} · {p.method}
                        {p.note ? ` · ${p.note}` : ''}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatBRL(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Gaveta>
  );
}
