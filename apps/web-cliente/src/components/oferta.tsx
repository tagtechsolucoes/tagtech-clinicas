'use client';

import { useEffect, useState } from 'react';
import { localClock } from '@tagtech/domain';
import { chamar, type OfferView } from '@/lib/api';
import { imagem } from '@/lib/tema';

const diaLongo = (ymd: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${ymd}T12:00:00Z`));

/** Abriu um horário: o paciente da lista de espera fica com ele num toque. */
export function Oferta({ token, inicial }: { token: string; inicial: OfferView }) {
  const [v, setV] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz = v.unit.timezone;
  const hora = (iso: string) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  const dia = localClock(new Date(v.startsAt), tz).ymd;
  const resta = Math.max(0, new Date(v.expiresAt).getTime() - agora);
  const aberta = v.status === 'offered' && resta > 0;
  const mm = Math.floor(resta / 60000);

  async function agir(acao: 'accept' | 'decline') {
    setErro(null);
    setOcupado(true);
    try {
      setV(
        await chamar<OfferView>(`/public/offers/${token}/${acao}`, { method: 'POST', body: '{}' }),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  const titulo =
    v.status === 'accepted'
      ? 'O horário é seu!'
      : v.status === 'declined'
        ? 'Tudo bem'
        : aberta
          ? 'Abriu um horário para você'
          : 'Este horário já foi';

  return (
    <main className="min-h-dvh">
      <div className="sobre-marca bg-marca px-5 pt-8 pb-24 text-sobre-marca">
        <div className="mx-auto flex max-w-lg items-center gap-3">
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
      <div className="mx-auto -mt-16 max-w-lg px-5 pb-16">
        <div className="rounded-[1.75rem] bg-folha p-6 shadow-[0_30px_60px_-40px_rgb(15_32_40/0.5)] ring-1 ring-linha sm:p-7">
          <p className="text-sm font-semibold text-nevoa">Olá, {v.patientFirstName}</p>
          <h1 className="mt-1 text-[2rem] leading-tight font-medium">{titulo}</h1>

          <div
            className={`mt-6 rounded-2xl p-5 ${aberta || v.status === 'accepted' ? 'bg-porcelana' : 'bg-porcelana opacity-60'}`}
          >
            <p className="font-display text-[1.7rem] leading-tight first-letter:uppercase">
              {diaLongo(dia)}
            </p>
            <p className="mt-0.5 font-display text-[2.6rem] leading-none tabular-nums">
              {hora(v.startsAt)}
            </p>
            <p className="mt-3 font-medium">
              {v.serviceName} com {v.professionalName}
            </p>
            {v.unit.address ? <p className="text-sm text-nevoa">{v.unit.address}</p> : null}
          </div>

          {v.status === 'accepted' ? (
            <p className="mt-5 text-nevoa">
              Marcado. Você vai receber a confirmação no WhatsApp.
              {v.manageToken ? (
                <>
                  {' '}
                  <a href={`/a/${v.manageToken}`} className="font-semibold text-marca underline">
                    Ver minha consulta
                  </a>
                </>
              ) : null}
            </p>
          ) : v.status === 'declined' ? (
            <p className="mt-5 text-nevoa">
              Passamos este horário para a próxima pessoa. Você continua na lista de espera.
            </p>
          ) : !aberta ? (
            <p className="mt-5 text-nevoa">
              O prazo acabou ou outra pessoa ficou com ele. Você continua na lista de espera.
            </p>
          ) : (
            <>
              <p className="mt-4 text-sm text-nevoa" aria-live="polite">
                Reservado para você por mais{' '}
                <strong className="text-tinta">
                  {mm >= 60 ? `${Math.floor(mm / 60)} h ${mm % 60} min` : `${mm} min`}
                </strong>
                . Depois passa para a próxima pessoa da fila.
              </p>
              {erro ? (
                <p
                  role="alert"
                  className="mt-4 rounded-xl bg-alerta-fundo px-4 py-3 text-sm font-medium text-alerta"
                >
                  {erro}
                </p>
              ) : null}
              <div className="mt-6 space-y-2.5">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => agir('accept')}
                  className="h-13 w-full rounded-2xl bg-destaque text-[1.05rem] font-semibold text-sobre-destaque hover:bg-destaque-forte disabled:opacity-50"
                >
                  Quero este horário
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => agir('decline')}
                  className="h-12 w-full rounded-2xl font-semibold text-nevoa ring-1 ring-linha hover:text-tinta"
                >
                  Não posso, passar a vez
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
