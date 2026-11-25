'use client';

import { useState } from 'react';
import { formatPhoneBR, localClock, STATUS_LABELS, whatsappLink } from '@tagtech/domain';
import { chamar, type ManageView } from '@/lib/api';
import { imagem } from '@/lib/tema';
import { PixSinal } from './pix';

const diaLongo = (ymd: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${ymd}T12:00:00Z`));

/** O paciente vê a consulta e confirma ou desmarca. */
export function Gerenciar({ token, inicial }: { token: string; inicial: ManageView }) {
  const [v, setV] = useState(inicial);
  const [desmarcando, setDesmarcando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const tz = v.unit.timezone;
  const hora = (iso: string) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  const dia = localClock(new Date(v.startsAt), tz).ymd;
  const zap = v.clinic.whatsapp
    ? whatsappLink(v.clinic.whatsapp, `Olá! Sobre a minha consulta de ${v.serviceName}.`)
    : null;

  async function agir(acao: 'confirm' | 'cancel') {
    setErro(null);
    setOcupado(true);
    try {
      setV(
        await chamar<ManageView>(`/public/appointments/${token}/${acao}`, {
          method: 'POST',
          body: '{}',
        }),
      );
      setDesmarcando(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  const cancelada = v.status === 'cancelled';
  const confirmada = v.status === 'confirmed';

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
          <h1 className="mt-1 text-[2rem] leading-tight font-medium">
            {cancelada
              ? 'Consulta desmarcada'
              : confirmada
                ? 'Presença confirmada'
                : 'Sua consulta'}
          </h1>
          <span
            className={`mt-3 inline-block rounded-lg px-2.5 py-1 text-sm font-semibold ${
              cancelada
                ? 'bg-porcelana text-nevoa'
                : confirmada
                  ? 'bg-ok-fundo text-ok'
                  : 'bg-porcelana text-marca'
            }`}
          >
            {STATUS_LABELS[v.status]}
          </span>

          <dl className={`mt-6 space-y-4 ${cancelada ? 'opacity-60' : ''}`}>
            <div>
              <dt className="text-xs font-semibold text-nevoa">Quando</dt>
              <dd className="mt-0.5 text-lg font-semibold first-letter:uppercase">
                {diaLongo(dia)}, às {hora(v.startsAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-nevoa">O quê</dt>
              <dd className="mt-0.5 font-medium">
                {v.serviceName} com {v.professionalName}
              </dd>
            </div>
            {v.unit.address ? (
              <div>
                <dt className="text-xs font-semibold text-nevoa">Onde</dt>
                <dd className="mt-0.5">
                  {v.unit.address}{' '}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.unit.address)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-marca underline"
                  >
                    Mapa
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>

          {v.deposit?.status === 'open' && !cancelada ? (
            <div className="mt-6">
              <PixSinal
                token={token}
                aoPagar={() => setV({ ...v, deposit: { ...v.deposit!, status: 'paid' } })}
              />
            </div>
          ) : null}
          {v.deposit?.status === 'paid' ? (
            <p className="mt-5 rounded-xl bg-ok-fundo px-4 py-3 text-sm font-semibold text-ok">
              Sinal recebido. Horário garantido.
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
            {v.canConfirm ? (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => agir('confirm')}
                className="h-13 w-full rounded-2xl bg-destaque text-[1.05rem] font-semibold text-sobre-destaque hover:bg-destaque-forte disabled:opacity-50"
              >
                Confirmar que vou
              </button>
            ) : null}
            {v.canCancel && !desmarcando ? (
              <button
                type="button"
                onClick={() => setDesmarcando(true)}
                className="h-12 w-full rounded-2xl font-semibold text-nevoa ring-1 ring-linha hover:text-alerta hover:ring-alerta/40"
              >
                Não vou poder ir
              </button>
            ) : null}
            {desmarcando ? (
              <div className="rounded-2xl bg-alerta-fundo/60 p-4">
                <p className="text-sm">
                  O horário fica livre para outra pessoa. Quer mesmo desmarcar?
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDesmarcando(false)}
                    className="h-11 rounded-xl bg-folha font-semibold ring-1 ring-linha"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => agir('cancel')}
                    className="h-11 rounded-xl bg-alerta font-semibold text-white disabled:opacity-50"
                  >
                    Desmarcar
                  </button>
                </div>
              </div>
            ) : null}
            {cancelada ? (
              <a
                href={`/c/${v.clinic.slug}#agendar`}
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-marca font-semibold text-sobre-marca"
              >
                Marcar outro horário
              </a>
            ) : null}
          </div>
        </div>
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
