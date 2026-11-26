import {
  FEATURE_LABELS,
  FEATURES,
  formatBRL,
  GRACE_DAYS,
  monthlyPrice,
  PLAN_INFO,
  planFor,
  type Feature,
} from '@tagtech/domain';
import { usePainel } from './contexto';
import { dataCurta } from './formato';
import { Cabecalho, Icone } from './ui';

const zapTagTech = (whatsapp: string, texto: string) =>
  whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}` : null;

/** Faixa no topo quando o teste acaba, a mensalidade vence ou a assinatura está bloqueada. */
export function AvisoAssinatura({ flutuante }: { flutuante?: boolean }) {
  const { assinatura: a, clinic, vinculo } = usePainel();
  const dias = a.daysLeft ?? 0;
  const msg =
    a.situation === 'blocked'
      ? {
          tom: 'alerta',
          texto:
            'A assinatura está suspensa. Você ainda consulta tudo, mas não dá para agendar nem alterar, e o site não aceita agendamentos.',
        }
      : a.situation === 'overdue'
        ? {
            tom: 'alerta',
            texto: `A mensalidade venceu há ${-dias} ${-dias === 1 ? 'dia' : 'dias'}. Sem o pagamento, o painel fica só para consulta em ${GRACE_DAYS + 1 + dias} ${GRACE_DAYS + 1 + dias === 1 ? 'dia' : 'dias'}.`,
          }
        : a.situation === 'due_soon'
          ? {
              tom: 'ambar',
              texto: `A mensalidade vence ${dias === 0 ? 'hoje' : `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}.`,
            }
          : a.situation === 'trial' && a.daysLeft !== null && dias <= 7
            ? {
                tom: 'ambar',
                texto: `Teste grátis: ${dias === 0 ? 'último dia' : `faltam ${dias} ${dias === 1 ? 'dia' : 'dias'}`}.`,
              }
            : null;
  if (!msg) return null;
  const dono = vinculo.role === 'owner' || vinculo.role === 'manager';
  const estilo =
    msg.tom === 'alerta'
      ? 'bg-alerta-fundo text-alerta ring-alerta/25'
      : 'bg-ambar-fundo text-ambar-tinta ring-ambar/30';
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm ring-1 ${estilo} ${
        flutuante ? 'fixed right-4 bottom-20 z-30 max-w-md shadow-lg lg:bottom-4' : 'mb-6'
      }`}
    >
      <Icone nome="alerta" className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1 font-medium">{msg.texto}</span>
      {dono ? (
        <a href="#plano" className="shrink-0 font-semibold underline underline-offset-2">
          Ver plano
        </a>
      ) : (
        <span className="shrink-0">Avise o responsável pela {clinic.name}.</span>
      )}
    </div>
  );
}

/** No lugar de uma tela que o plano não tem. */
export function ForaDoPlano({ recurso }: { recurso: Feature }) {
  const { assinatura } = usePainel();
  const alvo = PLAN_INFO[planFor(recurso)];
  const zap = zapTagTech(
    assinatura.payment.whatsapp,
    `Olá! Quero mudar a minha clínica para o plano ${alvo.name}.`,
  );
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-agua text-petroleo">
        <Icone nome="bloqueio" className="h-6 w-6" />
      </span>
      <h1 className="mt-5 text-[1.8rem] leading-tight">
        {assinatura.blocked ? 'Assinatura suspensa' : `Disponível no plano ${alvo.name}`}
      </h1>
      <p className="mt-3 text-nevoa">
        {assinatura.blocked
          ? 'Regularize a assinatura para voltar a usar esta tela.'
          : `${FEATURE_LABELS[recurso]}. Seu plano hoje é o ${PLAN_INFO[assinatura.plan].name}.`}
      </p>
      <div className="mt-7 flex justify-center gap-3">
        <a
          href="#plano"
          className="inline-flex h-11 items-center rounded-xl px-4 font-semibold ring-1 ring-linha hover:bg-folha"
        >
          Comparar planos
        </a>
        {zap ? (
          <a
            href={zap}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-petroleo px-4 font-semibold text-white"
          >
            <Icone nome="whatsapp" className="h-4 w-4" /> Falar com a TagTech
          </a>
        ) : null}
      </div>
    </div>
  );
}

const SITUACAO = {
  trial: { nome: 'Teste grátis', estilo: 'bg-azul-fundo text-azul' },
  ok: { nome: 'Em dia', estilo: 'bg-ok-fundo text-ok' },
  due_soon: { nome: 'Vence em breve', estilo: 'bg-ambar-fundo text-ambar-tinta' },
  overdue: { nome: 'Vencida', estilo: 'bg-alerta-fundo text-alerta' },
  blocked: { nome: 'Suspensa', estilo: 'bg-alerta-fundo text-alerta' },
} as const;

/** O plano da clínica, como pagar e o que cada plano libera. */
export function PlanoTela() {
  const { assinatura: a, clinic } = usePainel();
  const zap = zapTagTech(
    a.payment.whatsapp,
    `Olá! Sou da ${clinic.name} e quero falar sobre o meu plano.`,
  );
  const sit = SITUACAO[a.situation];
  return (
    <>
      <Cabecalho
        titulo="Plano"
        descricao="Sua assinatura do TagClin, como pagar e o que cada plano libera."
      />

      <section className="grid overflow-hidden rounded-3xl bg-folha ring-1 ring-linha lg:grid-cols-[1.1fr_1fr]">
        <div className="relative overflow-hidden bg-petroleo-escuro p-7 text-white">
          <div
            className="absolute -top-16 -right-16 h-48 w-48 rounded-full border border-white/10"
            aria-hidden
          />
          <p className="text-sm text-white/65">Seu plano</p>
          <p className="mt-1 text-[2.2rem] leading-none font-bold">{PLAN_INFO[a.plan].name}</p>
          <p className="mt-3 max-w-sm text-white/70">{PLAN_INFO[a.plan].pitch}</p>
          <span
            className={`mt-5 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${sit.estilo}`}
          >
            {sit.nome}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-px bg-linha">
          <Dado rotulo="Mensalidade" valor={formatBRL(monthlyPrice(a.plan, a.priceCents))} />
          <Dado
            rotulo={a.situation === 'trial' ? 'Teste até' : 'Pago até'}
            valor={a.until ? dataCurta(a.until) : '—'}
          />
          <Dado
            rotulo="Profissionais ativos"
            valor={a.maxProfessionals === null ? 'Sem limite' : `Até ${a.maxProfessionals}`}
          />
          <Dado
            rotulo="Situação"
            valor={
              a.daysLeft === null
                ? sit.nome
                : a.daysLeft >= 0
                  ? `${a.daysLeft} ${a.daysLeft === 1 ? 'dia' : 'dias'} restantes`
                  : `${-a.daysLeft} ${a.daysLeft === -1 ? 'dia' : 'dias'} de atraso`
            }
          />
        </dl>
      </section>

      <section className="mt-6 grid gap-5 rounded-3xl bg-folha p-6 ring-1 ring-linha lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h2 className="text-lg">Como pagar</h2>
          <p className="mt-1.5 whitespace-pre-line text-nevoa">
            {a.payment.instructions ||
              'A TagTech envia a cobrança todo mês pelo WhatsApp. Depois de pagar, mande o comprovante por lá.'}
          </p>
        </div>
        {zap ? (
          <a
            href={zap}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-petroleo px-5 font-semibold text-white"
          >
            <Icone nome="whatsapp" className="h-4 w-4" /> Falar com a TagTech
          </a>
        ) : null}
      </section>

      <h2 className="mt-10 text-xl">Planos</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {a.plans.map((p) => {
          const atual = p.id === a.plan;
          return (
            <article
              key={p.id}
              className={`flex flex-col rounded-3xl p-6 ring-1 ${atual ? 'bg-agua/60 ring-2 ring-petroleo' : 'bg-folha ring-linha'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xl font-bold">{p.name}</h3>
                {atual ? (
                  <span className="rounded-full bg-petroleo px-2.5 py-0.5 text-xs font-semibold text-white">
                    Seu plano
                  </span>
                ) : null}
              </div>
              <p className="mt-4 text-3xl font-bold tracking-tight">
                {formatBRL(p.priceCents)}
                <span className="text-sm font-normal text-nevoa"> /mês</span>
              </p>
              <p className="mt-2 text-sm text-nevoa">{p.pitch}</p>
              <p className="mt-4 text-sm font-semibold">
                {p.maxProfessionals === null
                  ? 'Profissionais sem limite'
                  : `Até ${p.maxProfessionals} ${p.maxProfessionals === 1 ? 'profissional' : 'profissionais'}`}
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                <Item ok>Agenda, pacientes, prontuário e documentos</Item>
                <Item ok>Site com agendamento online</Item>
                <Item ok>Confirmação e lembrete no WhatsApp</Item>
                {FEATURES.map((f) => (
                  <Item key={f} ok={p.features.includes(f)}>
                    {FEATURE_LABELS[f]}
                  </Item>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </>
  );
}

const Dado = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <div className="bg-folha px-6 py-5">
    <dt className="text-sm text-nevoa">{rotulo}</dt>
    <dd className="mt-1 text-lg font-semibold">{valor}</dd>
  </div>
);

function Item({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex gap-2.5 ${ok ? '' : 'text-bruma line-through decoration-bruma/40'}`}>
      <span
        className={`mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full ${ok ? 'bg-ok text-white' : 'bg-trilho text-bruma'}`}
        aria-hidden
      >
        <Icone nome={ok ? 'ok' : 'x'} className="h-3 w-3" />
      </span>
      <span>
        <span className="sr-only">{ok ? 'Inclui: ' : 'Não inclui: '}</span>
        {children}
      </span>
    </li>
  );
}
