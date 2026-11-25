'use client';

import { escolher } from '@/lib/escolher';

export interface DiaLivre {
  date: string;
  rotulo: string;
  horarios: Array<{ time: string; professionalId: string }>;
}

/**
 * O cartão de horário do topo: os próximos horários livres de verdade, para marcar
 * num toque. É o que a clínica tem de mais concreto para mostrar.
 */
export function Proximos({
  serviceId,
  serviceName,
  duracao,
  dias,
  zap,
}: {
  serviceId: string;
  serviceName: string;
  duracao: string;
  dias: DiaLivre[];
  zap: string | null;
}) {
  return (
    <div className="relative">
      <div className="sobre-marca relative rounded-[1.75rem] bg-marca text-sobre-marca shadow-[0_40px_80px_-40px_rgb(15_32_40/0.55)]">
        <div className="px-6 pt-6 pb-5 sm:px-7">
          <p className="text-sm text-sobre-marca/70">Próximos horários livres</p>
          <p className="mt-0.5 font-semibold">
            {serviceName} <span className="font-normal text-sobre-marca/70">· {duracao}</span>
          </p>
        </div>
        {dias.length ? (
          <ul className="divide-y divide-white/10 border-t border-white/10">
            {dias.map((d) => (
              <li key={d.date} className="flex items-center gap-4 px-6 py-4 sm:px-7">
                <span className="w-20 shrink-0 font-display text-[1.35rem] leading-tight first-letter:uppercase">
                  {d.rotulo}
                </span>
                <span className="flex flex-wrap gap-2">
                  {d.horarios.map((h) => (
                    <button
                      key={h.time}
                      type="button"
                      onClick={() =>
                        escolher({ serviceId, professionalId: null, date: d.date, time: h.time })
                      }
                      className="h-10 rounded-xl bg-white/10 px-3.5 font-display text-[1.15rem] tabular-nums transition-colors hover:bg-destaque hover:text-sobre-destaque"
                    >
                      {h.time}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-t border-white/10 px-6 py-6 sm:px-7">
            <p className="font-display text-xl">Agenda cheia nos próximos dias</p>
            <p className="mt-1 text-sm text-sobre-marca/75">
              Veja outras datas no agendamento ou fale com a clínica.
            </p>
            {zap ? (
              <a
                href={zap}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex h-10 items-center rounded-xl bg-destaque px-4 font-semibold text-sobre-destaque"
              >
                Falar no WhatsApp
              </a>
            ) : null}
          </div>
        )}
        {/* Canhoto do cartão: o picote com os dois recortes. */}
        <div className="relative border-t-2 border-dashed border-white/20 px-6 py-4 text-sm text-sobre-marca/75 sm:px-7">
          <span aria-hidden className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-porcelana" />
          <span
            aria-hidden
            className="absolute -top-3 -right-3 h-6 w-6 rounded-full bg-porcelana"
          />
          Sem cadastro nem senha. A confirmação chega no seu WhatsApp.
        </div>
      </div>
    </div>
  );
}

/** Linha da tabela de serviços que já abre o agendamento com o serviço escolhido. */
export function EscolherServico({
  serviceId,
  data,
  hora,
  children,
  className,
}: {
  serviceId: string;
  data?: string;
  hora?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ir = () =>
    escolher(
      data && hora ? { serviceId, professionalId: null, date: data, time: hora } : { serviceId },
    );
  return (
    <button type="button" onClick={ir} className={className}>
      {children}
    </button>
  );
}
