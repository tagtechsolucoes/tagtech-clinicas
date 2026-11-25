'use client';

import { useState } from 'react';
import { formatBRL, formatPhoneBR, splitInstallments, whatsappLink } from '@tagtech/domain';
import { chamar, type PlanView } from '@/lib/api';
import { imagem } from '@/lib/tema';

const dataLonga = (ymd: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${ymd}T12:00:00Z`),
  );

/** O paciente vê o orçamento e aprova, escolhendo à vista ou parcelado. */
export function Orcamento({ token, inicial }: { token: string; inicial: PlanView }) {
  const [v, setV] = useState(inicial);
  const [parcelas, setParcelas] = useState(
    inicial.cashDiscountPct > 0 ? 1 : inicial.maxInstallments,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const aberto = v.status === 'sent' || v.status === 'draft';
  const zap = v.clinic.whatsapp
    ? whatsappLink(v.clinic.whatsapp, `Olá! Tenho uma dúvida sobre o orçamento "${v.title}".`)
    : null;

  async function decidir(acao: 'approve' | 'decline') {
    setErro(null);
    setOcupado(true);
    try {
      setV(
        await chamar<PlanView>(`/public/plans/${token}/${acao}`, {
          method: 'POST',
          body: JSON.stringify(acao === 'approve' ? { installments: parcelas } : {}),
        }),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  const opcoes = Array.from({ length: v.maxInstallments }, (_, i) => i + 1);

  return (
    <main className="min-h-dvh">
      <div className="sobre-marca bg-marca px-5 pt-8 pb-24 text-sobre-marca">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          {v.clinic.logoUrl ? (
            <img
              src={imagem(v.clinic.logoUrl)}
              alt=""
              className="h-10 w-10 rounded-xl object-cover"
            />
          ) : null}
          <span className="font-semibold">{v.clinic.name}</span>
        </div>
      </div>
      <div className="mx-auto -mt-16 max-w-xl px-5 pb-16">
        <article className="rounded-[1.75rem] bg-folha p-6 shadow-[0_30px_60px_-40px_rgb(15_32_40/0.5)] ring-1 ring-linha sm:p-8">
          <p className="text-sm font-semibold text-nevoa">Olá, {v.patientFirstName}</p>
          <h1 className="mt-1 text-[2rem] leading-tight font-medium">{v.title}</h1>
          {v.professionalName ? (
            <p className="mt-1 text-nevoa">Plano de tratamento com {v.professionalName}</p>
          ) : null}

          <ul className="mt-7 divide-y divide-linha border-y border-linha">
            {v.items.map((it, i) => (
              <li key={i} className="flex items-baseline gap-4 py-3.5">
                <span className="min-w-0 flex-1">
                  {it.description}
                  {it.tooth ? <span className="text-nevoa"> · dente {it.tooth}</span> : null}
                  {it.quantity > 1 ? <span className="text-nevoa"> · {it.quantity}x</span> : null}
                </span>
                <span className="tabular-nums">{formatBRL(it.quantity * it.unitPriceCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5">
            {v.discountCents > 0 ? (
              <div className="flex justify-between text-nevoa">
                <dt>Desconto</dt>
                <dd className="tabular-nums">− {formatBRL(v.discountCents)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between">
              <dt className="font-semibold">Total</dt>
              <dd className="font-display text-[2.2rem] tabular-nums">{formatBRL(v.total)}</dd>
            </div>
          </dl>
          {v.notes ? (
            <p className="mt-4 rounded-2xl bg-porcelana px-4 py-3 text-[0.95rem] whitespace-pre-line text-nevoa">
              {v.notes}
            </p>
          ) : null}

          {aberto ? (
            <>
              <fieldset className="mt-8">
                <legend className="font-display text-xl">Como você prefere pagar?</legend>
                <div className="mt-4 space-y-2.5">
                  {[true, ...(v.maxInstallments > 1 ? [false] : [])].map((vista) => {
                    const ativo = vista ? parcelas === 1 : parcelas > 1;
                    const n = vista ? 1 : parcelas > 1 ? parcelas : v.maxInstallments;
                    const valor = vista ? v.cashTotal : v.total;
                    return (
                      <div
                        key={String(vista)}
                        className={`rounded-2xl ring-1 transition ${
                          ativo
                            ? 'bg-porcelana ring-2 ring-marca'
                            : 'ring-linha hover:ring-tinta/30'
                        }`}
                      >
                        <label className="flex cursor-pointer items-center gap-4 px-4 py-4">
                          <input
                            type="radio"
                            name="forma"
                            checked={ativo}
                            onChange={() => setParcelas(vista ? 1 : v.maxInstallments)}
                            className="h-5 w-5 shrink-0 accent-[var(--color-marca)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">
                              {vista ? 'À vista' : `Parcelado em ${n}x`}
                            </span>
                            <span className="text-sm text-nevoa">
                              {vista
                                ? v.cashDiscountPct > 0
                                  ? `${v.cashDiscountPct}% de desconto`
                                  : 'Pagamento único'
                                : `${n}x de ${formatBRL(splitInstallments(valor, n)[0] ?? 0)}, sem juros`}
                            </span>
                          </span>
                          <span className="font-semibold tabular-nums">{formatBRL(valor)}</span>
                        </label>
                        {!vista && ativo ? (
                          <div
                            role="group"
                            aria-label="Número de parcelas"
                            className="flex flex-wrap gap-1.5 border-t border-linha px-4 py-3"
                          >
                            {opcoes.slice(1).map((k) => (
                              <button
                                key={k}
                                type="button"
                                aria-pressed={parcelas === k}
                                onClick={() => setParcelas(k)}
                                className={`h-9 min-w-11 rounded-lg px-2 text-sm font-semibold tabular-nums ${
                                  parcelas === k
                                    ? 'bg-marca text-sobre-marca'
                                    : 'bg-folha ring-1 ring-linha'
                                }`}
                              >
                                {k}x
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              {v.validUntil ? (
                <p className="mt-3 text-sm text-nevoa">
                  Condições válidas até {dataLonga(v.validUntil)}.
                </p>
              ) : null}

              {erro ? (
                <p
                  role="alert"
                  className="mt-5 rounded-xl bg-alerta-fundo px-4 py-3 text-sm font-medium text-alerta"
                >
                  {erro}
                </p>
              ) : null}

              <div className="mt-7 space-y-2.5">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => decidir('approve')}
                  className="h-13 w-full rounded-2xl bg-destaque text-[1.05rem] font-semibold text-sobre-destaque hover:bg-destaque-forte disabled:opacity-50"
                >
                  Aprovar orçamento
                </button>
                {recusando ? (
                  <div className="rounded-2xl bg-porcelana p-4">
                    <p className="text-sm">
                      Tudo bem. A clínica fica sabendo e pode te ajudar com outra proposta.
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRecusando(false)}
                        className="h-11 rounded-xl bg-folha font-semibold ring-1 ring-linha"
                      >
                        Voltar
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => decidir('decline')}
                        className="h-11 rounded-xl bg-tinta font-semibold text-white disabled:opacity-50"
                      >
                        Não quero agora
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRecusando(true)}
                    className="h-12 w-full rounded-2xl font-semibold text-nevoa ring-1 ring-linha hover:text-tinta"
                  >
                    Não quero agora
                  </button>
                )}
              </div>
            </>
          ) : (
            <div
              className={`mt-8 rounded-2xl px-5 py-4 ${v.status === 'approved' ? 'bg-ok-fundo text-ok' : 'bg-porcelana text-nevoa'}`}
            >
              <p className="font-semibold">
                {v.status === 'approved'
                  ? `Orçamento aprovado${
                      v.chosenInstallments && v.chosenInstallments > 1
                        ? ` em ${v.chosenInstallments}x`
                        : ' à vista'
                    }. Obrigado!`
                  : v.status === 'declined'
                    ? 'Você respondeu que não quer agora.'
                    : 'Este orçamento foi cancelado pela clínica.'}
              </p>
              {v.status === 'approved' ? (
                <p className="mt-1 text-sm text-tinta/70">
                  A clínica vai combinar com você o início do tratamento.
                </p>
              ) : null}
            </div>
          )}
        </article>
        {zap ? (
          <p className="mt-6 text-center text-sm text-nevoa">
            Dúvidas?{' '}
            <a
              href={zap}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-marca underline"
            >
              WhatsApp {formatPhoneBR(v.clinic.whatsapp)}
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
